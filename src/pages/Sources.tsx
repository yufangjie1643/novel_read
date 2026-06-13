import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ApiResponse, BookSource, SourceStats } from '../types';
import { useUiMode } from '../uiMode';
import { isTauri } from '../utils/tauri';

type SortKey = 'name' | 'health' | 'success' | 'latency' | 'lastChecked';
type SortDir = 'asc' | 'desc';

export default function Sources() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isMobileUi } = useUiMode();
  const [sources, setSources] = useState<BookSource[]>([]);
  const [stats, setStats] = useState<SourceStats[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('health');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    // Browser mode (no Tauri runtime) — skip IPC, render empty state.
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

  const statsByUrl = new Map(stats.map((s) => [s.sourceUrl, s]));
  const rows = sources.map((s) => ({ source: s, stats: statsByUrl.get(s.book_source_url) ?? null }));

  const successRate = (s: SourceStats | null): number =>
    s && s.rollingTotalCount > 0 ? s.rollingSuccessCount / s.rollingTotalCount : 1;
  const avgLatency = (s: SourceStats | null): number =>
    s && s.totalQueries > 0 ? s.totalLatencyMs / s.totalQueries : 0;

  const sorted = [...rows].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    switch (sortKey) {
      case 'name':
        return dir * a.source.book_source_name.localeCompare(b.source.book_source_name);
      case 'health':
        return dir * ((b.stats?.healthScore ?? 1) - (a.stats?.healthScore ?? 1));
      case 'success':
        return dir * (successRate(b.stats) - successRate(a.stats));
      case 'latency':
        return dir * (avgLatency(a.stats) - avgLatency(b.stats));
      case 'lastChecked':
        return dir * ((b.stats?.lastCheckedAt ?? 0) - (a.stats?.lastCheckedAt ?? 0));
    }
  });

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(k);
      setSortDir('desc');
    }
  };

  const headerCell = (key: SortKey, label: string) => (
    <th
      onClick={() => toggleSort(key)}
      style={{ padding: 8, textAlign: 'left', cursor: 'pointer', userSelect: 'none', fontSize: 13, color: '#555' }}
    >
      {label} {sortKey === key ? (sortDir === 'asc' ? '▲' : '▼') : ''}
    </th>
  );

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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#1a1a2e' }}>
            {t('layout.bookSources', 'Book sources')}
          </h2>
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
        </div>

        {sorted.length === 0 ? (
          <p style={{ color: '#888' }}>{t('home.noSources', 'No sources configured.')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #eee' }}>
                  {headerCell('name', t('home.sourceNameCol', 'Name'))}
                  {headerCell('health', t('home.sourceHealthCol', 'Health'))}
                  {headerCell('success', t('home.sourceSuccessCol', 'Success'))}
                  {headerCell('latency', t('home.sourceLatencyCol', 'Avg latency'))}
                  <th style={{ padding: 8, textAlign: 'left', fontSize: 13, color: '#555' }}>
                    {t('home.sourceLastErrorCol', 'Last error')}
                  </th>
                  {headerCell('lastChecked', t('home.sourceLastCheckedCol', 'Last checked'))}
                </tr>
              </thead>
              <tbody>
                {sorted.map(({ source, stats: s }) => {
                  const health = s?.healthScore ?? 1;
                  const healthColor = health >= 0.8 ? '#4caf50' : health >= 0.5 ? '#ff9800' : '#f44336';
                  return (
                    <tr
                      key={source.book_source_url}
                      onClick={() => navigate(`/sources/${encodeURIComponent(source.book_source_url)}`)}
                      style={{ borderBottom: '1px solid #f0f0f0', cursor: 'pointer' }}
                    >
                      <td style={{ padding: 8, fontSize: 14, fontWeight: 500 }}>
                        {source.book_source_name}
                        {source.book_source_type === 1 && (
                          <span style={{ marginLeft: 6, fontSize: 10, color: '#888' }}>(RSS)</span>
                        )}
                      </td>
                      <td style={{ padding: 8 }}>
                        <span
                          style={{
                            padding: '2px 8px',
                            borderRadius: 10,
                            background: healthColor,
                            color: '#fff',
                            fontSize: 12,
                            fontWeight: 600,
                          }}
                        >
                          {health.toFixed(2)}
                        </span>
                      </td>
                      <td style={{ padding: 8, fontSize: 13, color: '#555' }}>
                        {(successRate(s) * 100).toFixed(0)}%
                      </td>
                      <td style={{ padding: 8, fontSize: 13, color: '#555' }}>{avgLatency(s).toFixed(0)} ms</td>
                      <td
                        style={{
                          padding: 8,
                          fontSize: 12,
                          color: '#888',
                          maxWidth: 200,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={s?.lastErrorMessage ?? ''}
                      >
                        {s?.lastErrorMessage ?? '—'}
                      </td>
                      <td style={{ padding: 8, fontSize: 12, color: '#888' }}>
                        {s?.lastCheckedAt ? new Date(s.lastCheckedAt * 1000).toLocaleString() : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
