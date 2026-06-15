import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import type { ApiResponse, BookSource, SearchBook } from '../types';
import { ResultCard } from '../components/search/ResultCard';
import { useUiMode } from '../uiMode';

interface ExploreShowState {
  exploreName: string;
  sourceUrl: string;
  exploreUrl: string;
  source?: BookSource;
}

export default function ExploreShow() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isMobileUi } = useUiMode();
  const location = useLocation();
  const state = (location.state as ExploreShowState | null) || {
    exploreName: '',
    sourceUrl: '',
    exploreUrl: '',
  };

  const [books, setBooks] = useState<SearchBook[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [message, setMessage] = useState('');
  const pageRef = useRef(1);
  const mountedRef = useRef(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, []);

  const fetchBooks = useCallback(
    async (page: number, isLoadMore: boolean) => {
      if (!state.source || !state.exploreUrl) return;
      const requestId = ++requestIdRef.current;

      if (!isLoadMore) {
        setLoading(true);
        setMessage(t('common.loading'));
      }

      try {
        const resp = await invoke<ApiResponse<SearchBook[]>>('explore_books', {
          source: state.source,
          url: state.exploreUrl,
          page,
        });
        if (!mountedRef.current || requestId !== requestIdRef.current) return;

        if (resp.success && resp.data) {
          if (isLoadMore) {
            setBooks((prev) => [...prev, ...resp.data!]);
          } else {
            setBooks(resp.data);
          }
          if (resp.data.length === 0) {
            setHasMore(false);
            if (!isLoadMore) {
              setMessage(t('common.none'));
            } else {
              setMessage('');
            }
          } else {
            setMessage(
              t('explore.foundBooks', {
                count: resp.data.length,
                defaultValue: `找到 ${resp.data.length} 本书`,
              })
            );
          }
        } else {
          setMessage(t('explore.failed', { error: resp.error || 'unknown error' }));
          setHasMore(false);
        }
      } catch (e) {
        if (mountedRef.current && requestId === requestIdRef.current) {
          setMessage(t('common.error', { message: String(e) }));
          setHasMore(false);
        }
      } finally {
        if (mountedRef.current && requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    },
    [state.source, state.exploreUrl, t]
  );

  useEffect(() => {
    if (state.source && state.exploreUrl) {
      pageRef.current = 1;
      setBooks([]);
      setHasMore(true);
      void fetchBooks(1, false);
    } else if (!state.source && state.sourceUrl) {
      // Need to load source first
      invoke<ApiResponse<BookSource | null>>('get_book_source', { url: state.sourceUrl })
        .then((resp) => {
          if (resp.success && resp.data && mountedRef.current) {
            state.source = resp.data;
            pageRef.current = 1;
            setBooks([]);
            setHasMore(true);
            void fetchBooks(1, false);
          } else if (mountedRef.current) {
            setMessage(t('explore.sourceNotFound'));
          }
        })
        .catch((e) => {
          if (mountedRef.current) {
            setMessage(t('common.error', { message: String(e) }));
          }
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loadMore() {
    if (loading || !hasMore) return;
    pageRef.current += 1;
    void fetchBooks(pageRef.current, true);
  }

  function openBook(book: SearchBook) {
    const sourceUrl = book.origin || state.sourceUrl;
    if (!sourceUrl) {
      setMessage(t('explore.sourceNotFound'));
      return;
    }
    navigate(`/book/${encodeURIComponent(book.book_url)}`, {
      state: {
        preview: true,
        source: state.source,
        searchBook: book,
        parent: location.pathname + (location.search || ''),
      },
    });
  }

  function goBack() {
    navigate('/explore');
  }

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 20,
          flexWrap: 'wrap',
        }}
      >
        <button
          onClick={goBack}
          style={{
            padding: '6px 14px',
            borderRadius: 8,
            border: '1px solid #e0e0e0',
            background: '#fff',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 500,
            color: '#555',
          }}
        >
          {t('common.back')}
        </button>
        <h1
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 700,
            color: '#1a1a2e',
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={state.exploreName}
        >
          {state.exploreName || t('explore.title')}
        </h1>
      </div>

      {/* Message */}
      {message && (
        <div
          style={{
            background: message.includes(t('common.error')) ? '#ffebee' : '#e3f2fd',
            color: message.includes(t('common.error')) ? '#c62828' : '#1565c0',
            padding: '10px 16px',
            borderRadius: 8,
            marginBottom: 16,
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          {message}
        </div>
      )}

      {/* Books Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
          gap: 16,
        }}
      >
        {books.map((book) => (
          <ResultCard
            key={book.book_url}
            book={book}
            isMobileUi={isMobileUi}
            t={t}
            onClick={() => openBook(book)}
          />
        ))}
      </div>

      {/* Load More */}
      {hasMore && books.length > 0 && (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <button
            onClick={loadMore}
            disabled={loading}
            style={{
              padding: '10px 32px',
              borderRadius: 8,
              border: '1px solid #bbdefb',
              background: '#eef4fd',
              color: '#1976d2',
              fontSize: 14,
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? t('common.loading') : t('explore.loadMore', { defaultValue: '加载更多' })}
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && books.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#888' }}>
          <div
            style={{
              width: 32,
              height: 32,
              border: '3px solid #e8e8f0',
              borderTopColor: '#1976d2',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
              margin: '0 auto 12px',
            }}
          />
          <p style={{ fontSize: 14 }}>{t('common.loading')}</p>
        </div>
      )}
    </div>
  );
}
