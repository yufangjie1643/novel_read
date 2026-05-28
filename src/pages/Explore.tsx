import { useState, useEffect, useCallback, useRef, useDeferredValue, startTransition } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ApiResponse, BookSource, ExploreItem, ExploreItemsPage, SearchBook } from '../types';

const EXPLORE_RENDER_BATCH_SIZE = 80;
const EXPLORE_RENDER_INCREMENT = 120;
const EXPLORE_LOAD_DELAY_MS = 500;

export default function Explore() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [exploreItems, setExploreItems] = useState<ExploreItem[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [results, setResults] = useState<SearchBook[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [activeSourceUrl, setActiveSourceUrl] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [sourceCache, setSourceCache] = useState<Record<string, BookSource>>({});
  const deferredFilter = useDeferredValue(filter);
  const mountedRef = useRef(false);
  const listRequestIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      listRequestIdRef.current += 1;
    };
  }, []);

  const loadItemsPage = useCallback(
    async (offset: number, filterText: string, reset: boolean, requestId: number) => {
      if (reset) {
        setSourcesLoading(true);
      } else {
        setLoadingMore(true);
      }

      const limit = reset ? EXPLORE_RENDER_BATCH_SIZE : EXPLORE_RENDER_INCREMENT;
      const normalizedFilter = filterText.trim();
      try {
        const resp = await invoke<ApiResponse<ExploreItemsPage>>('get_explore_items', {
          offset,
          limit,
          filter: normalizedFilter || null,
        });
        if (!mountedRef.current || requestId !== listRequestIdRef.current) return;
        if (resp.success && resp.data) {
          startTransition(() => {
            setExploreItems((prev) =>
              reset ? resp.data!.items : [...prev, ...resp.data!.items]
            );
            setTotalItems(resp.data!.total);
          });
        } else if (resp.error) {
          setMessage(t('common.error', { message: resp.error }));
        }
      } catch (e) {
        if (mountedRef.current && requestId === listRequestIdRef.current) {
          setMessage(t('common.error', { message: String(e) }));
        }
      } finally {
        if (mountedRef.current && requestId === listRequestIdRef.current) {
          if (reset) {
            setSourcesLoading(false);
          } else {
            setLoadingMore(false);
          }
        }
      }
    },
    [t]
  );

  useEffect(() => {
    const requestId = listRequestIdRef.current + 1;
    listRequestIdRef.current = requestId;
    setExploreItems([]);
    setTotalItems(0);
    setResults([]);
    setMessage('');
    setActiveItemId(null);
    setActiveSourceUrl(null);
    setSourcesLoading(true);
    setLoadingMore(false);

    const timer = window.setTimeout(() => {
      void loadItemsPage(0, deferredFilter, true, requestId);
    }, EXPLORE_LOAD_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
      listRequestIdRef.current += 1;
    };
  }, [deferredFilter, loadItemsPage]);

  async function getBookSource(url: string) {
    const cached = sourceCache[url];
    if (cached) return cached;

    const resp = await invoke<ApiResponse<BookSource | null>>('get_book_source', { url });
    if (!resp.success || !resp.data) {
      throw new Error(resp.error || t('explore.sourceNotFound'));
    }
    if (mountedRef.current) {
      setSourceCache((prev) => ({ ...prev, [url]: resp.data! }));
    }
    return resp.data;
  }

  async function loadMoreItems() {
    if (loadingMore || sourcesLoading || exploreItems.length >= totalItems) return;
    const requestId = listRequestIdRef.current;
    await loadItemsPage(exploreItems.length, deferredFilter, false, requestId);
  }

  async function fetchExplore(item: ExploreItem) {
    setActiveItemId(item.id);
    setActiveSourceUrl(item.source_url);
    setLoading(true);
    setMessage(t('common.loading'));
    setResults([]);

    try {
      const source = await getBookSource(item.source_url);
      const resp = await invoke<ApiResponse<SearchBook[]>>('explore_books', {
        source,
        url: item.url,
        page: 1,
      });
      if (!mountedRef.current) return;
      if (resp.success && resp.data) {
        setResults(resp.data);
        setMessage(t('explore.foundBooks', { count: resp.data.length }));
      } else {
        setMessage(t('explore.failed', { error: resp.error || 'unknown error' }));
      }
    } catch (e) {
      if (mountedRef.current) {
        setMessage(t('common.error', { message: String(e) }));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  async function openBook(book: SearchBook) {
    const sourceUrl = book.origin || activeSourceUrl;
    if (!sourceUrl) {
      setMessage(t('explore.sourceNotFound'));
      return;
    }

    try {
      const source = await getBookSource(sourceUrl);
      navigate(`/book/${encodeURIComponent(book.book_url)}`, {
        state: {
          preview: true,
          source,
          searchBook: book,
        },
      });
    } catch (e) {
      setMessage(t('common.error', { message: String(e) }));
    }
  }

  const hasMoreItems = exploreItems.length < totalItems;
  const isFiltering = deferredFilter.trim().length > 0;

  return (
    <div>
      <h1 style={{ margin: '0 0 20px', fontSize: 24, fontWeight: 700, color: '#1a1a2e' }}>
        {t('explore.title')}
      </h1>

      {(exploreItems.length > 0 || isFiltering) && (
        <div style={{ position: 'relative', marginBottom: 16 }}>
          <input
            type="text"
            placeholder={t('explore.filterPlaceholder')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 36px 10px 14px',
              borderRadius: 8,
              border: '1px solid #e0e0e0',
              fontSize: 14,
              outline: 'none',
              fontFamily: 'inherit',
              boxSizing: 'border-box',
            }}
          />
          {filter && (
            <button
              onClick={() => setFilter('')}
              style={{
                position: 'absolute',
                right: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: '#999',
                fontSize: 18,
                padding: 0,
                lineHeight: 1,
              }}
            >
              ×
            </button>
          )}
        </div>
      )}

      {sourcesLoading ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: '#888' }}>
          <div
            style={{
              width: 28,
              height: 28,
              border: '3px solid #e8e8f0',
              borderTopColor: '#1976d2',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
              margin: '0 auto 12px',
            }}
          />
          <p style={{ fontSize: 14 }}>{t('common.loading')}</p>
        </div>
      ) : totalItems === 0 && !isFiltering ? (
        <div
          style={{
            textAlign: 'center',
            padding: '60px 20px',
            color: '#888',
            background: '#fff',
            borderRadius: 12,
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          }}
        >
          {t('explore.noExploreSources')}
        </div>
      ) : exploreItems.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '40px 20px',
            color: '#888',
            background: '#fff',
            borderRadius: 12,
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
            marginBottom: 20,
          }}
        >
          {t('explore.noFilterResults')}
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
            {exploreItems.map((item) => {
              const isActive = activeItemId === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => fetchExplore(item)}
                  disabled={loading}
                  style={{
                    padding: '7px 16px',
                    borderRadius: 20,
                    border: '1px solid',
                    borderColor: isActive ? '#1976d2' : '#e0e0e0',
                    background: isActive ? '#1976d2' : '#fff',
                    color: isActive ? '#fff' : '#555',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    fontSize: 13,
                    fontWeight: 500,
                    transition: 'background 0.2s, border-color 0.2s, color 0.2s',
                    boxShadow: isActive ? '0 2px 8px rgba(25,118,210,0.3)' : 'none',
                  }}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
          {hasMoreItems && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                margin: '-4px 0 20px',
                flexWrap: 'wrap',
              }}
            >
              <span style={{ fontSize: 12, color: '#888' }}>
                {t('explore.renderedCount', {
                  shown: exploreItems.length,
                  total: totalItems,
                  defaultValue: `已显示 ${exploreItems.length} / ${totalItems}`,
                })}
              </span>
              <button
                type="button"
                onClick={loadMoreItems}
                disabled={loadingMore}
                style={{
                  padding: '8px 18px',
                  borderRadius: 8,
                  border: '1px solid #bbdefb',
                  background: '#eef4fd',
                  color: '#1976d2',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: loadingMore ? 'not-allowed' : 'pointer',
                  opacity: loadingMore ? 0.7 : 1,
                }}
              >
                {loadingMore
                  ? t('common.loading')
                  : t('explore.loadMore', { defaultValue: '加载更多' })}
              </button>
            </div>
          )}
        </>
      )}

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

      {loading && (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: '#888' }}>
          <div
            style={{
              width: 28,
              height: 28,
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

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 20,
        }}
      >
        {results.map((book) => (
          <div
            key={book.book_url}
            onClick={() => openBook(book)}
            style={{
              background: '#fff',
              borderRadius: 12,
              padding: 14,
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
              transition: 'transform 0.2s, box-shadow 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)';
            }}
          >
            {book.cover_url ? (
              <img
                src={book.cover_url}
                alt={book.name}
                style={{
                  width: '100%',
                  height: 220,
                  objectFit: 'cover',
                  borderRadius: 8,
                  background: '#f0f0f0',
                }}
                onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
              />
            ) : (
              <div
                style={{
                  width: '100%',
                  height: 220,
                  borderRadius: 8,
                  background: 'linear-gradient(135deg, #e3f2fd 0%, #f3e5f5 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#1976d2',
                  fontSize: 16,
                  fontWeight: 700,
                }}
              >
                {book.name.slice(0, 2)}
              </div>
            )}
            <div
              style={{
                fontWeight: 700,
                fontSize: 14,
                color: '#1a1a2e',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={book.name}
            >
              {book.name}
            </div>
            <div style={{ color: '#666', fontSize: 12 }}>{book.author}</div>
            {book.intro && (
              <div
                style={{
                  color: '#888',
                  fontSize: 12,
                  lineHeight: 1.5,
                  display: '-webkit-box',
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {book.intro}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
