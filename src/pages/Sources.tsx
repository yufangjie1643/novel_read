import { useEffect, useMemo, useState } from 'react';
import { List as VirtualList } from 'react-window';
import { invoke } from '@tauri-apps/api/core';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ApiResponse, BookSource, SourceStats } from '../types';
import { pickOpHealth, opSymbol, type OpSymbol } from '../types';
import { useUiMode } from '../uiMode';
import { isTauri } from '../utils/tauri';

type SortKey = 'name' | 'health' | 'success' | 'latency' | 'lastChecked';
type SortDir = 'asc' | 'desc';

const ROW_HEIGHT = 48;
const HEADER_HEIGHT = 40;
const TABLE_MIN_WIDTH = 900;

interface Row {
  source: BookSource;
  stats: SourceStats | null;
}

function successRate(s: SourceStats | null): number | null {
  if (!s || s.rollingTotalCount === 0) return null;
  return s.rollingSuccessCount / s.rollingTotalCount;
}

function avgLatency(s: SourceStats | null): number | null {
  if (!s || s.totalQueries === 0) return null;
  return s.totalLatencyMs / s.totalQueries;
}

export default function Sources() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isMobileUi } = useUiMode();
  const [sources, setSources] = useState<BookSource[]>([]);
  const [stats, setStats] = useState<SourceStats[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('health');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [filter, setFilter] = useState('');
  const [debouncedFilter, setDebouncedFilter] = useState('');
  const [testing, setTesting] = useState(false);
  const [testProgress, setTestProgress] = useState({ done: 0, total: 0 });
  const [listHeight, setListHeight] = useState(560);

  useEffect(() => {
    void load();
  }, []);

  // Debounce filter input (150ms) so each keystroke doesn't re-sort + re-virtualize
  useEffect(() => {
    const id = setTimeout(() => setDebouncedFilter(filter), 150);
    return () => clearTimeout(id);
  }, [filter]);

  // Resize the virtual list to fit the viewport, capped at a sensible
  // maximum so it doesn't dominate the page on tall screens.
  useEffect(() => {
    const update = () => {
      const max = Math.min(window.innerHeight - 280, 720);
      setListHeight(Math.max(max, ROW_HEIGHT * 4));
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  async function load() {
    if (!isTauri()) return;
    try {
      const [srcResp, statsResp] = await Promise.all([
        invoke<ApiResponse<BookSource[]>>('get_book_sources'),
        invoke<ApiResponse<SourceStats[]>>('get_source_stats'),
      ]);
      if (srcResp.success && srcResp.data) setSources(srcResp.data);
      if (statsResp.success && statsResp.data) setStats(statsResp.data);
    } catch (e) {
      console.error('Failed to load sources:', e);
    }
  }

  async function testAllSources() {
    if (!isTauri()) return;
    setTesting(true);
    setTestProgress({ done: 0, total: sources.length });
    let done = 0;
    for (const src of sources) {
      try {
        await invoke<ApiResponse<number>>('ping_source', { source: src });
      } catch (e) {
        console.warn(`ping_source failed for ${src.book_source_name}:`, e);
      }
      done += 1;
      setTestProgress({ done, total: sources.length });
    }
    // Refresh stats.
    try {
      const statsResp = await invoke<ApiResponse<SourceStats[]>>('get_source_stats');
      if (statsResp.success && statsResp.data) setStats(statsResp.data);
    } catch (e) {
      console.error('Failed to refresh stats after test:', e);
    }
    setTesting(false);
  }

  // Filter + sort memoized — only recompute when inputs change.
  const rows = useMemo<Row[]>(() => {
    const statsByUrl = new Map(stats.map((s) => [s.sourceUrl, s]));
    let out: Row[] = sources.map((s) => ({
      source: s,
      stats: statsByUrl.get(s.book_source_url) ?? null,
    }));

    const q = debouncedFilter.trim().toLowerCase();
    if (q) {
      out = out.filter(
        ({ source, stats: s }) =>
          source.book_source_name.toLowerCase().includes(q) ||
          source.book_source_url.toLowerCase().includes(q) ||
          (source.book_source_group ?? '').toLowerCase().includes(q) ||
          (s?.lastErrorMessage ?? '').toLowerCase().includes(q)
      );
    }

    const dir = sortDir === 'asc' ? 1 : -1;
    out.sort((a, b) => {
      switch (sortKey) {
        case 'name':
          return dir * a.source.book_source_name.localeCompare(b.source.book_source_name);
        case 'health':
          return dir * ((b.stats?.healthScore ?? 1) - (a.stats?.healthScore ?? 1));
        case 'success': {
          const av = successRate(a.stats) ?? -1;
          const bv = successRate(b.stats) ?? -1;
          return dir * (bv - av);
        }
        case 'latency': {
          const av = avgLatency(a.stats) ?? Number.POSITIVE_INFINITY;
          const bv = avgLatency(b.stats) ?? Number.POSITIVE_INFINITY;
          return dir * (av - bv);
        }
        case 'lastChecked':
          return dir * ((b.stats?.lastCheckedAt ?? 0) - (a.stats?.lastCheckedAt ?? 0));
      }
    });
    return out;
  }, [sources, stats, sortKey, sortDir, debouncedFilter]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(k);
      setSortDir('desc');
    }
  };

  const headerCell = (key: SortKey | null, label: string, widthStyle?: React.CSSProperties) => (
    <th
      onClick={key ? () => toggleSort(key) : undefined}
      style={{
        padding: 8,
        textAlign: 'left',
        cursor: key ? 'pointer' : 'default',
        userSelect: 'none',
        fontSize: 13,
        color: '#555',
        ...widthStyle,
      }}
    >
      {label} {key && sortKey === key ? (sortDir === 'asc' ? '▲' : '▼') : ''}
    </th>
  );

  // Row renderer for react-window — receives style with position absolute
  const RowRenderer = ({ index, style }: { index: number; style: React.CSSProperties }) => {
    const { source, stats: s } = rows[index];
    const hasStats = s != null && s.totalQueries > 0;
    const health = hasStats ? s!.healthScore : null;
    const healthColor =
      health == null
        ? '#bbb'
        : health >= 0.8
          ? '#4caf50'
          : health >= 0.5
            ? '#ff9800'
            : '#f44336';
    const opHealth = pickOpHealth(s);

    const renderOpBadge = (label: string, sym: OpSymbol, op: typeof opHealth.search) => {
      const color =
        sym === 'ok' ? '#4caf50' : sym === 'err' ? '#f44336' : sym === 'warn' ? '#ff9800' : '#bbb';
      const bg = sym === 'untested' ? 'transparent' : color;
      const border = sym === 'untested' ? '1px dashed #bbb' : 'none';
      const titleParts = [`${label}: ${op.ok} ok`];
      if (op.err > 0) titleParts.push(`${op.err} err`);
      if (op.timeout > 0) titleParts.push(`${op.timeout} timeout`);
      if (op.lastError) titleParts.push(op.lastError);
      const icon = sym === 'ok' ? '✓' : sym === 'err' ? '✗' : sym === 'warn' ? '!' : '?';
      return (
        <span
          key={label}
          title={titleParts.join(' · ')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 22,
            height: 22,
            padding: '0 6px',
            marginRight: 4,
            borderRadius: 4,
            background: bg,
            color: sym === 'untested' ? '#888' : '#fff',
            border,
            fontSize: 12,
            fontWeight: 600,
            cursor: 'help',
          }}
        >
          {icon}
          <span style={{ marginLeft: 4, fontSize: 11 }}>{label}</span>
        </span>
      );
    };

    return (
      <div
        style={{
          ...style,
          display: 'flex',
          alignItems: 'center',
          borderBottom: '1px solid #f0f0f0',
          cursor: 'pointer',
          background: index % 2 === 0 ? '#fff' : '#fafbfc',
        }}
        onClick={() => navigate(`/sources/${encodeURIComponent(source.book_source_url)}`)}
      >
        <div
          style={{
            flex: '0 0 200px',
            padding: '0 8px',
            fontSize: 14,
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {source.book_source_name}
          {source.book_source_type === 1 && (
            <span style={{ marginLeft: 6, fontSize: 10, color: '#888' }}>(RSS)</span>
          )}
        </div>
        <div style={{ flex: '0 0 70px', padding: '0 8px' }}>
          <span
            title={
              health == null
                ? t('home.sourceNotTested', 'Click "Test all" to measure this source')
                : `${t('home.sourceHealthCol', 'Health')}: ${health.toFixed(2)}`
            }
            style={{
              padding: '2px 8px',
              borderRadius: 10,
              background: health == null ? 'transparent' : healthColor,
              color: health == null ? '#888' : '#fff',
              border: health == null ? '1px dashed #bbb' : 'none',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {health == null ? '—' : health.toFixed(2)}
          </span>
        </div>
        <div style={{ flex: '0 0 200px', padding: '0 8px', display: 'flex', flexWrap: 'wrap' }}>
          {renderOpBadge('搜', opSymbol(opHealth.search), opHealth.search)}
          {renderOpBadge('探', opSymbol(opHealth.explore), opHealth.explore)}
          {renderOpBadge('目', opSymbol(opHealth.chapterList), opHealth.chapterList)}
          {renderOpBadge('章', opSymbol(opHealth.chapterContent), opHealth.chapterContent)}
        </div>
        <div style={{ flex: '0 0 70px', padding: '0 8px', fontSize: 13, color: '#555' }}>
          {(() => {
            const r = successRate(s);
            return r == null ? <span style={{ color: '#bbb' }}>—</span> : `${(r * 100).toFixed(0)}%`;
          })()}
        </div>
        <div style={{ flex: '0 0 90px', padding: '0 8px', fontSize: 13, color: '#555' }}>
          {(() => {
            const a = avgLatency(s);
            return a == null ? <span style={{ color: '#bbb' }}>—</span> : `${a.toFixed(0)} ms`;
          })()}
        </div>
        <div
          style={{
            flex: 1,
            padding: '0 8px',
            fontSize: 12,
            color: '#888',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={s?.lastErrorMessage ?? ''}
        >
          {s?.lastErrorMessage ?? '—'}
        </div>
        <div style={{ flex: '0 0 160px', padding: '0 8px', fontSize: 12, color: '#888' }}>
          {s?.lastCheckedAt ? new Date(s.lastCheckedAt * 1000).toLocaleString() : '—'}
        </div>
      </div>
    );
  };

  return (
    <div>
      <section
        style={{
          background: '#fff',
          borderRadius: 12,
          padding: isMobileUi ? 16 : 24,
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          marginBottom: 24,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#1a1a2e' }}>
            {t('layout.bookSources', 'Book sources')}
          </h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t(
                'home.filterSourcesPlaceholder',
                'Filter by name, URL, group, or error…'
              )}
              style={{
                padding: '6px 12px',
                border: '1px solid #e0e0e0',
                borderRadius: 6,
                fontSize: 13,
                width: 280,
              }}
            />
            <button
              onClick={() => navigate('/sources/import')}
              style={{
                padding: '6px 14px',
                borderRadius: 8,
                border: '1px solid #e0e0e0',
                background: '#fff',
                color: '#555',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              {t('home.sourceSubscriptions', 'Subscriptions')}
            </button>
            <button
              onClick={testAllSources}
              disabled={testing}
              title={t('home.testAllSourcesHint', 'Issue a tiny search to each enabled source to refresh its health score.')}
              style={{
                padding: '6px 14px',
                borderRadius: 8,
                border: '1px solid #e0e0e0',
                background: testing ? '#f5f5f5' : '#fff',
                color: testing ? '#999' : '#1565c0',
                fontSize: 13,
                fontWeight: 600,
                cursor: testing ? 'wait' : 'pointer',
              }}
            >
              {testing
                ? `${t('home.testing', 'Testing…')} ${testProgress.done}/${testProgress.total}`
                : t('home.testAll', 'Test all')}
            </button>
          </div>
        </div>

        {sources.length === 0 ? (
          <p style={{ color: '#888' }}>{t('home.noSources', 'No sources configured.')}</p>
        ) : (
          <>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
              {t('home.sourceCountSummary', {
                count: rows.length,
                total: sources.length,
                defaultValue: `Showing ${rows.length} of ${sources.length} sources`,
              })}
            </div>
            <div
              style={{
                overflowX: 'auto',
                minWidth: TABLE_MIN_WIDTH,
                border: '1px solid #f0f0f0',
                borderRadius: 8,
              }}
            >
              {/* Header (sticky) */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  height: HEADER_HEIGHT,
                  background: '#fafbfc',
                  borderBottom: '2px solid #eee',
                  position: 'sticky',
                  top: 0,
                  zIndex: 1,
                }}
              >
                {headerCell('name', t('home.sourceNameCol', 'Name'), { flex: '0 0 200px' })}
                {headerCell('health', t('home.sourceHealthCol', 'Health'), { flex: '0 0 70px' })}
                {headerCell(null, t('home.sourceOpsCol', 'Stages'), { flex: '0 0 200px' })}
                {headerCell('success', t('home.sourceSuccessCol', 'Success'), { flex: '0 0 70px' })}
                {headerCell('latency', t('home.sourceLatencyCol', 'Avg latency'), {
                  flex: '0 0 90px',
                })}
                {headerCell(null, t('home.sourceLastErrorCol', 'Last error'), { flex: 1 })}
                {headerCell('lastChecked', t('home.sourceLastCheckedCol', 'Last checked'), {
                  flex: '0 0 140px',
                })}
              </div>
              {/* Virtualized body */}
              {rows.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: '#888' }}>
                  {t('home.noMatches', 'No sources match the filter.')}
                </div>
              ) : (
                <VirtualList
                  rowComponent={RowRenderer}
                  rowCount={rows.length}
                  rowHeight={ROW_HEIGHT}
                  rowProps={{} as never}
                  style={{ height: Math.max(listHeight - HEADER_HEIGHT, ROW_HEIGHT * 3) }}
                  overscanCount={5}
                />
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
