import { useState, useEffect, useMemo, useRef, useCallback, useTransition } from 'react';
import { invoke, Channel } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { isTauri } from '../utils/tauri';
import type {
  ApiResponse,
  BookSource,
  SearchBook,
  SearchEvent,
  SearchFailure,
  SearchKeyword,
  SearchState,
  ScoreBreakdown,
  SourceKey,
  SourceStatus,
} from '../types';
import { useUiMode } from '../uiMode';
import SourceStatusStrip from '../components/search/SourceStatusStrip';
import FailureFooter from '../components/search/FailureFooter';

const ZERO_SCORE: ScoreBreakdown = {
  allQueryPresent: 0,
  words: 0,
  typo: 0,
  proximity: 255,
  sourceWeight: 0,
  attributeRank: 0,
  wordPosition: 255,
  sourceHealth: 0,
};

function compareScore(a: ScoreBreakdown, b: ScoreBreakdown): number {
  if (a.words !== b.words) return b.words - a.words;
  if (a.typo !== b.typo) return b.typo - a.typo;
  if (a.proximity !== b.proximity) return a.proximity - b.proximity;
  if (a.sourceWeight !== b.sourceWeight) return b.sourceWeight - a.sourceWeight;
  if (a.attributeRank !== b.attributeRank) return b.attributeRank - a.attributeRank;
  if (a.wordPosition !== b.wordPosition) return a.wordPosition - b.wordPosition;
  return b.sourceHealth - a.sourceHealth;
}

type ActiveSearchState = Extract<SearchState, { kind: 'streaming' | 'stalled' | 'done' }>;

function applyEvent(state: SearchState, event: SearchEvent, requestId: string): SearchState {
  if (state.kind !== 'streaming' && state.kind !== 'stalled' && state.kind !== 'done') return state;
  const active = state as ActiveSearchState;
  if (active.requestId !== requestId) return state;

  switch (event.event) {
    case 'Started':
      return state;
    case 'SourceStarted': {
      const statuses = { ...active.statuses };
      statuses[event.sourceUrl] = {
        state: 'running',
        sourceUrl: event.sourceUrl,
        sourceName: event.sourceName,
      };
      return { ...active, statuses };
    }
    case 'Result': {
      const bookWithScore = { ...event.book, _score: event.score } as SearchBook & {
        _score: ScoreBreakdown;
      };
      return { ...active, results: [...active.results, bookWithScore as SearchBook] };
    }
    case 'SourceFinished': {
      const statuses = { ...active.statuses };
      const existing = active.statuses[event.sourceUrl];
      statuses[event.sourceUrl] = {
        state: 'ok',
        sourceUrl: event.sourceUrl,
        sourceName: existing?.sourceName ?? '',
        count: event.count,
        latencyMs: event.latencyMs,
      };
      return { ...active, statuses };
    }
    case 'SourceFailed': {
      const statuses = { ...active.statuses };
      const existing = active.statuses[event.sourceUrl];
      const sourceName = existing?.sourceName ?? '';
      statuses[event.sourceUrl] = {
        state: 'failed',
        sourceUrl: event.sourceUrl,
        sourceName,
        error: event.error,
        latencyMs: event.latencyMs,
        kind: event.kind,
      };
      const failure: SearchFailure = {
        sourceUrl: event.sourceUrl,
        sourceName,
        error: event.error,
        kind: event.kind,
      };
      return { ...active, statuses, failures: [...active.failures, failure] };
    }
    case 'Done': {
      return {
        ...active,
        kind: 'done',
        totalResults: event.totalResults,
        durationMs: event.durationMs,
        requestId,
      };
    }
  }
}

function openBook(
  book: SearchBook,
  sources: BookSource[],
  navigate: ReturnType<typeof useNavigate>
) {
  const source = sources.find((s) => s.book_source_url === book.origin);
  if (!source) return;
  navigate(`/book/${encodeURIComponent(book.book_url)}`, {
    state: { preview: true, source, searchBook: book },
  });
}

function ResultCard({
  book,
  isMobileUi,
  onClick,
  t,
}: {
  book: SearchBook;
  isMobileUi: boolean;
  onClick: () => void;
  t: (key: string) => string;
}) {
  // v1 of ResultCard: covers are eager; Task 7 will lazy-load.
  // isMobileUi is reserved for future card-level layout tweaks.
  void isMobileUi;
  const tocUrl = book.toc_url || book.book_url;
  return (
    <div
      onClick={onClick}
      style={{
        background: '#fff',
        borderRadius: 14,
        padding: 14,
        display: 'flex',
        gap: 14,
        cursor: 'pointer',
        boxShadow: '0 1px 2px rgba(0,0,0,0.06), 0 3px 10px rgba(0,0,0,0.04)',
      }}
    >
      {book.cover_url ? (
        <div
          style={{
            width: 76,
            height: 96,
            flexShrink: 0,
            aspectRatio: '76 / 96',
            borderRadius: 10,
            overflow: 'hidden',
            background: 'linear-gradient(145deg, #e8eaf6 0%, #f3e5f5 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#5c6bc0',
            fontSize: 18,
            fontWeight: 800,
          }}
        >
          <img
            src={book.cover_url}
            alt="cover"
            loading="lazy"
            decoding="async"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        </div>
      ) : (
        <div
          style={{
            width: 76,
            height: 96,
            borderRadius: 10,
            background: 'linear-gradient(145deg, #e8eaf6 0%, #f3e5f5 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#5c6bc0',
            fontSize: 18,
            fontWeight: 800,
            flexShrink: 0,
          }}
        >
          {book.name.slice(0, 2)}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: '#1a1a2e' }}>{book.name}</div>
        <div style={{ color: '#8a8a9a', fontSize: 13, fontWeight: 500 }}>{book.author}</div>
        {book.intro && (
          <div
            style={{
              color: '#666',
              fontSize: 12,
              marginTop: 4,
              lineHeight: 1.5,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {book.intro}
          </div>
        )}
        <div
          style={{
            color: '#bbb',
            fontSize: 11,
            fontWeight: 500,
            marginTop: 4,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span>{book.origin_name || 'unknown'}</span>
          {tocUrl && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (isTauri()) {
                  void openUrl(tocUrl).catch((err) => console.error('openUrl failed:', err));
                } else {
                  window.open(tocUrl, '_blank', 'noopener');
                }
              }}
              title={tocUrl}
              aria-label={t('bookDetail.openOriginal')}
              style={{
                padding: '2px 8px',
                background: 'transparent',
                color: '#888',
                border: '1px solid transparent',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 11,
                lineHeight: 1,
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = '#1976d2';
                e.currentTarget.style.borderColor = '#bbdefb';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = '#888';
                e.currentTarget.style.borderColor = 'transparent';
              }}
            >
              ↗ {t('bookDetail.openOriginal')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const sectionStyle = (mobile: boolean): React.CSSProperties => ({
  background: '#fff',
  borderRadius: 12,
  padding: mobile ? 16 : 24,
  boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
  marginBottom: 24,
});

const inputStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 8,
  border: '1px solid #e0e0e0',
  fontSize: 14,
  outline: 'none',
  fontFamily: 'inherit',
};

const btnPrimary: React.CSSProperties = {
  padding: '10px 18px',
  borderRadius: 8,
  border: 'none',
  background: '#1976d2',
  color: '#fff',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};

const chipStyle: React.CSSProperties = {
  padding: '4px 12px',
  borderRadius: 16,
  border: '1px solid #e0e0e0',
  background: '#f5f7fa',
  cursor: 'pointer',
  fontSize: 13,
  color: '#555',
  fontWeight: 500,
};

const chipDangerStyle: React.CSSProperties = {
  ...chipStyle,
  borderColor: '#ffcdd2',
  background: '#fff0f0',
  color: '#f44336',
};

export default function Home() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isMobileUi } = useUiMode();
  const [sources, setSources] = useState<BookSource[]>([]);
  const [searchKey, setSearchKey] = useState('');
  const [searchHistory, setSearchHistory] = useState<SearchKeyword[]>([]);
  const [state, setState] = useState<SearchState>({ kind: 'idle' });
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [, startTransition] = useTransition();
  const currentChannelRef = useRef<Channel<SearchEvent> | null>(null);
  const currentRequestIdRef = useRef<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcuts: /, ArrowUp/Down, Enter, Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const inField = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      if (e.key === '/' && !inField) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      const activeResults =
        state.kind === 'streaming' || state.kind === 'stalled' || state.kind === 'done'
          ? state.results
          : [];
      if (e.key === 'ArrowDown' && activeResults.length > 0) {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, activeResults.length - 1));
      } else if (e.key === 'ArrowUp' && activeResults.length > 0) {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (
        e.key === 'Enter' &&
        !inField &&
        selectedIndex >= 0 &&
        activeResults[selectedIndex]
      ) {
        e.preventDefault();
        openBook(activeResults[selectedIndex], sources, navigate);
      } else if (e.key === 'Escape') {
        if (state.kind === 'streaming' || state.kind === 'stalled') {
          // The previous run_stream_real continues on the backend until its
          // 3.5s global timeout OR until a new search supersedes it (the
          // server-side watch channel cancel fires on the next invoke).
          // Locally, transition to 'done' so the UI unblocks and shows
          // whatever streamed in so far.
          setState({
            kind: 'done',
            query: state.query,
            results: state.results,
            statuses: state.statuses,
            failures: state.failures,
            totalResults: state.results.length,
            durationMs: 0,
            requestId: state.requestId,
          });
        } else {
          setSearchKey('');
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, selectedIndex, sources, navigate]);

  useEffect(() => {
    void loadSources();
    void loadSearchHistory();
    void loadLastSearch();
  }, []);

  async function loadSources() {
    try {
      const resp = await invoke<ApiResponse<BookSource[]>>('get_book_sources');
      if (resp.success && resp.data) setSources(resp.data);
    } catch (e) {
      console.error('Failed to load sources:', e);
    }
  }

  async function loadSearchHistory() {
    try {
      const resp = await invoke<ApiResponse<SearchKeyword[]>>('get_search_keywords', { limit: 10 });
      if (resp.success && resp.data) setSearchHistory(resp.data);
    } catch (e) {
      console.error('Failed to load history:', e);
    }
  }

  async function loadLastSearch() {
    try {
      const resp = await invoke<
        ApiResponse<{
          request_id: string;
          query: string;
          results: SearchBook[];
          total_results: number;
          duration_ms: number;
        } | null>
      >('get_last_search');
      // Only restore the query so the user sees context from the
      // previous session. Full result replay would require the same
      // shape as the streaming state's results/statuses/failures,
      // which the v1 snapshot intentionally omits.
      if (resp.success && resp.data && resp.data.query) {
        setSearchKey(resp.data.query);
      }
    } catch (e) {
      console.error('Failed to load last search:', e);
    }
  }

  const cancelSearch = useCallback(async () => {
    if (currentRequestIdRef.current == null) return;
    try {
      await invoke<number>('cancel_search', {
        requestId: currentRequestIdRef.current,
      });
    } catch (e) {
      console.error('cancel_search failed:', e);
    }
  }, []);

  async function clearHistory() {
    try {
      await invoke('clear_search_keywords');
      setSearchHistory([]);
    } catch (e) {
      console.error('Failed to clear history:', e);
    }
  }

  const handleSearch = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (!trimmed) return;
      const enabled = sources.filter((s) => s.enabled && s.search_url);
      if (enabled.length === 0) {
        setState({ kind: 'error', message: t('home.noEnabledSources') });
        return;
      }

      // Cancel previous channel. The Rust side will see the new request_id
      // via the watch channel and stop emitting; the JS side just stops listening.
      currentChannelRef.current = null;

      const requestId = crypto.randomUUID();
      currentRequestIdRef.current = requestId;
      const channel = new Channel<SearchEvent>();
      currentChannelRef.current = channel;

      const initialStatuses: Record<SourceKey, SourceStatus> = {};
      for (const s of enabled) {
        initialStatuses[s.book_source_url] = {
          state: 'pending',
          sourceUrl: s.book_source_url,
          sourceName: s.book_source_name,
        };
      }
      setState({
        kind: 'streaming',
        query: trimmed,
        results: [],
        statuses: initialStatuses,
        failures: [],
        startedAt: Date.now(),
        requestId,
      });

      channel.onmessage = (event) => {
        if (currentRequestIdRef.current !== requestId) return; // stale
        startTransition(() => {
          setState((s) => applyEvent(s, event, requestId));
        });
      };

      try {
        await invoke('search_books_stream_v2', {
          query: trimmed,
          sources: enabled,
          channel,
        });
      } catch (e) {
        if (currentRequestIdRef.current === requestId) {
          setState({ kind: 'error', message: String(e) });
        }
      }
    },
    [sources, t]
  );

  const sortedResults: SearchBook[] = (() => {
    if (state.kind === 'streaming' || state.kind === 'stalled' || state.kind === 'done') {
      return [...state.results].sort((a, b) => {
        const sa = (a as SearchBook & { _score?: ScoreBreakdown })._score ?? ZERO_SCORE;
        const sb = (b as SearchBook & { _score?: ScoreBreakdown })._score ?? ZERO_SCORE;
        return compareScore(sa, sb);
      });
    }
    return [];
  })();

  // When the user has not opted in to seeing unrelated results, drop
  // any result whose every unique query char does not appear in the
  // title (allQueryPresent == 0). This is the "completely unrelated"
  // signal — partial / substring matches (e.g. "霸体" matching
  // query "三体") are still shown.
  const [showIrrelevant, setShowIrrelevant] = useState<boolean>(() => {
    try {
      return localStorage.getItem('search.showIrrelevant') === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('search.showIrrelevant', showIrrelevant ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [showIrrelevant]);
  const relevantResults = useMemo(
    () =>
      showIrrelevant
        ? sortedResults
        : sortedResults.filter((b) => {
            const score = (b as SearchBook & { _score?: ScoreBreakdown })._score;
            return score ? score.allQueryPresent === 1 : true;
          }),
    [sortedResults, showIrrelevant]
  );
  const hiddenCount = sortedResults.length - relevantResults.length;

  const sourceStatusList: SourceStatus[] = (() => {
    if (state.kind === 'streaming' || state.kind === 'stalled' || state.kind === 'done') {
      return Object.values(state.statuses);
    }
    return [];
  })();

  const failureList: SearchFailure[] = (() => {
    if (state.kind === 'streaming' || state.kind === 'stalled' || state.kind === 'done') {
      return state.failures;
    }
    return [];
  })();

  const retryAll = useCallback(() => {
    void handleSearch(searchKey);
  }, [handleSearch, searchKey]);

  return (
    <div>
      {/* Search Bar */}
      <section style={sectionStyle(isMobileUi)}>
        <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700, color: '#1a1a2e' }}>
          {t('layout.searchPage')}
        </h2>
        <div
          style={{
            display: 'flex',
            flexDirection: isMobileUi ? 'column' : 'row',
            gap: 10,
            alignItems: isMobileUi ? 'stretch' : 'center',
          }}
        >
          <input
            ref={searchInputRef}
            type="text"
            value={searchKey}
            onChange={(e) => setSearchKey(e.target.value)}
            placeholder={t('home.enterBookName')}
            style={{ ...inputStyle, flex: 1, width: isMobileUi ? '100%' : undefined }}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch(searchKey)}
          />
          <button
            onClick={() => handleSearch(searchKey)}
            disabled={state.kind === 'streaming' || state.kind === 'stalled'}
            style={{
              ...btnPrimary,
              opacity: state.kind === 'streaming' || state.kind === 'stalled' ? 0.7 : 1,
              ...(isMobileUi ? { width: '100%', minHeight: 44 } : {}),
            }}
          >
            {state.kind === 'streaming' || state.kind === 'stalled'
              ? t('common.loading')
              : t('common.search')}
          </button>
          {(state.kind === 'streaming' || state.kind === 'stalled') && (
            <button
              onClick={() => void cancelSearch()}
              style={{
                ...btnPrimary,
                background: '#fff',
                color: '#f44336',
                border: '1px solid #ffcdd2',
                ...(isMobileUi ? { width: '100%', minHeight: 44 } : {}),
              }}
            >
              ⏹ {t('home.cancel')}
            </button>
          )}
        </div>

        {searchHistory.length > 0 && (
          <div
            style={{
              marginTop: 14,
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <span style={{ fontSize: 13, color: '#888', fontWeight: 500 }}>
              {t('home.history')}
            </span>
            {searchHistory.map((item) => (
              <button
                key={item.id || item.keyword}
                onClick={() => {
                  setSearchKey(item.keyword);
                  void handleSearch(item.keyword);
                }}
                style={chipStyle}
              >
                {item.keyword}
              </button>
            ))}
            <button onClick={clearHistory} style={chipDangerStyle}>
              {t('home.clearHistory')}
            </button>
          </div>
        )}
      </section>

      {/* Source status strip (only when searching) */}
      {sourceStatusList.length > 0 && <SourceStatusStrip statuses={sourceStatusList} />}

      {/* Error message */}
      {state.kind === 'error' && (
        <div
          style={{
            background: '#ffebee',
            color: '#c62828',
            padding: '10px 16px',
            borderRadius: 8,
            marginBottom: 16,
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          {state.message}
        </div>
      )}

      {/* Results */}
      {sortedResults.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h2
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: '#1a1a2e',
              marginBottom: 16,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <span>
              {t('home.resultsCount', { count: relevantResults.length })}
              {hiddenCount > 0 && (
                <span style={{ color: '#999', fontWeight: 400, fontSize: 14, marginLeft: 8 }}>
                  {t('home.filteredOut', { count: hiddenCount })}
                </span>
              )}
            </span>
            <button
              onClick={() => setShowIrrelevant((v) => !v)}
              title={showIrrelevant ? t('home.hideIrrelevantHint') : t('home.showIrrelevantHint')}
              style={{
                padding: '4px 10px',
                background: showIrrelevant ? '#1976d2' : '#fff',
                color: showIrrelevant ? '#fff' : '#555',
                border: `1px solid ${showIrrelevant ? '#1976d2' : '#d0d0d0'}`,
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 500,
                transition: 'all 0.15s',
              }}
            >
              {showIrrelevant ? t('home.hideIrrelevant') : t('home.showIrrelevant')}
            </button>
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {relevantResults.map((book) => (
              <ResultCard
                key={book.book_url}
                book={book}
                isMobileUi={isMobileUi}
                t={t}
                onClick={() => openBook(book, sources, navigate)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Failure footer */}
      {failureList.length > 0 && <FailureFooter failures={failureList} onRetryAll={retryAll} />}

      {/* Status: idle hint */}
      {state.kind === 'idle' && sources.length > 0 && (
        <p style={{ color: '#888', fontSize: 13, marginTop: 24 }}>
          {t('home.sourcesCount', {
            count: sources.filter((s) => s.enabled && s.search_url).length,
          })}
        </p>
      )}
    </div>
  );
}
