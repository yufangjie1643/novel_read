import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ApiResponse, BookSource, SearchBook, SearchKeyword, RuleSub } from '../types';

export default function Home() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [sources, setSources] = useState<BookSource[]>([]);
  const [searchKey, setSearchKey] = useState('');
  const [searchResults, setSearchResults] = useState<SearchBook[]>([]);
  const [searchHistory, setSearchHistory] = useState<SearchKeyword[]>([]);
  const [ruleSubs, setRuleSubs] = useState<RuleSub[]>([]);
  const [newSubUrl, setNewSubUrl] = useState('');
  const [newSubName, setNewSubName] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    loadSources();
    loadSearchHistory();
    loadRuleSubs();
    // Restore previous search state from sessionStorage
    const savedKey = sessionStorage.getItem('searchKey');
    const savedResults = sessionStorage.getItem('searchResults');
    if (savedKey) setSearchKey(savedKey);
    if (savedResults) {
      try {
        setSearchResults(JSON.parse(savedResults));
      } catch {
        sessionStorage.removeItem('searchResults');
      }
    }
  }, []);

  // Clear persisted search state when user clears the input
  useEffect(() => {
    if (!searchKey && searchResults.length === 0) {
      sessionStorage.removeItem('searchKey');
      sessionStorage.removeItem('searchResults');
    }
  }, [searchKey, searchResults]);

  async function loadSources() {
    try {
      const resp = await invoke<ApiResponse<BookSource[]>>('get_book_sources');
      if (resp.success && resp.data) {
        setSources(resp.data);
      }
    } catch (e) {
      console.error('Failed to load sources:', e);
    }
  }

  async function loadSearchHistory() {
    try {
      const resp = await invoke<ApiResponse<SearchKeyword[]>>('get_search_keywords', {
        limit: 10,
      });
      if (resp.success && resp.data) {
        setSearchHistory(resp.data);
      }
    } catch (e) {
      console.error('Failed to load search history:', e);
    }
  }

  async function saveSearchKeyword(keyword: string) {
    try {
      await invoke('add_search_keyword', { keyword: keyword.trim() });
      await loadSearchHistory();
    } catch (e) {
      console.error('Failed to save keyword:', e);
    }
  }

  async function clearHistory() {
    try {
      await invoke('clear_search_keywords');
      setSearchHistory([]);
    } catch (e) {
      console.error('Failed to clear history:', e);
    }
  }

  async function loadRuleSubs() {
    try {
      const resp = await invoke<ApiResponse<RuleSub[]>>('get_rule_subs');
      if (resp.success && resp.data) {
        setRuleSubs(resp.data);
      }
    } catch (e) {
      console.error('Failed to load rule subs:', e);
    }
  }

  async function addRuleSub() {
    if (!newSubUrl.trim() || !newSubName.trim()) return;
    try {
      await invoke('add_rule_sub', {
        sub: {
          name: newSubName.trim(),
          url: newSubUrl.trim(),
          sub_type: 0,
          custom_order: 0,
          enabled: true,
          auto_update: true,
          last_update_time: 0,
        },
      });
      setNewSubUrl('');
      setNewSubName('');
      await loadRuleSubs();
    } catch (e) {
      setMessage(t('home.addSubscriptionFailed', { error: String(e) }));
    }
  }

  async function deleteRuleSub(id: number) {
    try {
      await invoke('delete_rule_sub', { id });
      await loadRuleSubs();
    } catch (e) {
      setMessage(t('home.deleteSubscriptionFailed', { error: String(e) }));
    }
  }

  async function checkSubUpdates() {
    setLoading(true);
    setMessage(t('home.checkUpdates'));
    for (const sub of ruleSubs.filter((s) => s.enabled && s.url)) {
      try {
        const resp = await invoke<ApiResponse<BookSource[]>>('import_source_from_url', {
          url: sub.url,
        });
        if (resp.success && resp.data) {
          for (const source of resp.data) {
            await invoke('add_book_source', { source });
          }
        }
      } catch (e) {
        console.error(`Failed to update ${sub.name}:`, e);
      }
    }
    setMessage(t('home.checkUpdates'));
    setLoading(false);
    await loadSources();
  }

  async function searchBooks() {
    if (!searchKey.trim()) return;
    const enabledSources = sources.filter((s) => s.enabled && s.search_url);
    if (enabledSources.length === 0) {
      setMessage(t('home.noEnabledSources'));
      return;
    }
    setLoading(true);
    setMessage(t('home.searchingSources', { count: enabledSources.length }));
    setSearchResults([]);

    const CONCURRENCY = Math.max(1, Math.min(20, parseInt(localStorage.getItem('search_concurrency') || '5', 10) || 5));
    const allResults: SearchBook[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < enabledSources.length; i += CONCURRENCY) {
      const batch = enabledSources.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.allSettled(
        batch.map(async (source) => {
          const resp = await invoke<ApiResponse<SearchBook[]>>('search_books', {
            source,
            key: searchKey.trim(),
            page: 1,
          });
          if (resp.success && resp.data) {
            return resp.data;
          }
          return [];
        })
      );

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          for (const book of result.value) {
            const key = `${book.name}|${book.author || ''}`;
            if (!seen.has(key)) {
              seen.add(key);
              allResults.push(book);
            }
          }
        }
      }

      setMessage(
        t('home.searchingProgress', {
          current: Math.min(i + CONCURRENCY, enabledSources.length),
          total: enabledSources.length,
        })
      );
    }

    setSearchResults(allResults);
    setMessage(
      t('home.searchResults', { count: allResults.length, sourceCount: enabledSources.length })
    );
    setLoading(false);
    await saveSearchKeyword(searchKey.trim());
    // Persist search state for page navigation
    sessionStorage.setItem('searchKey', searchKey.trim());
    sessionStorage.setItem('searchResults', JSON.stringify(allResults));
  }

  async function openBook(book: SearchBook) {
    const source = sources.find((s) => s.book_source_url === book.origin);
    if (!source) {
      setMessage(t('explore.sourceNotFound'));
      return;
    }

    navigate(`/book/${encodeURIComponent(book.book_url)}`, {
      state: {
        preview: true,
        source,
        searchBook: book,
      },
    });
  }

  const inputStyle: React.CSSProperties = {
    padding: '10px 14px',
    borderRadius: 8,
    border: '1px solid #e0e0e0',
    fontSize: 14,
    outline: 'none',
    transition: 'border-color 0.2s',
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
    transition: 'background 0.2s',
  };

  const btnSecondary: React.CSSProperties = {
    padding: '8px 16px',
    borderRadius: 8,
    border: '1px solid #e0e0e0',
    background: '#fff',
    color: '#555',
    fontSize: 14,
    cursor: 'pointer',
    fontWeight: 500,
  };

  return (
    <div>
      {/* Search Section */}
      <section
        style={{
          background: '#fff',
          borderRadius: 12,
          padding: 24,
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          marginBottom: 24,
        }}
      >
        <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700, color: '#1a1a2e' }}>
          {t('layout.searchPage')}
        </h2>
        <div style={{ display: 'flex', gap: 10 }}>
          <input
            type="text"
            value={searchKey}
            onChange={(e) => setSearchKey(e.target.value)}
            placeholder={t('home.enterBookName')}
            style={{ ...inputStyle, flex: 1 }}
            onKeyDown={(e) => e.key === 'Enter' && searchBooks()}
          />
          <button
            onClick={searchBooks}
            disabled={loading}
            style={{
              ...btnPrimary,
              opacity: loading ? 0.7 : 1,
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? t('common.loading') : t('common.search')}
          </button>
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
                  searchBooks();
                }}
                style={{
                  padding: '4px 12px',
                  borderRadius: 16,
                  border: '1px solid #e0e0e0',
                  background: '#f5f7fa',
                  cursor: 'pointer',
                  fontSize: 13,
                  color: '#555',
                  fontWeight: 500,
                }}
              >
                {item.keyword}
              </button>
            ))}
            <button
              onClick={clearHistory}
              style={{
                padding: '4px 12px',
                borderRadius: 16,
                border: '1px solid #ffcdd2',
                background: '#fff0f0',
                cursor: 'pointer',
                fontSize: 13,
                color: '#f44336',
                fontWeight: 500,
              }}
            >
              {t('home.clearHistory')}
            </button>
          </div>
        )}
      </section>

      {/* Source Status */}
      <section
        style={{
          background: '#fff',
          borderRadius: 12,
          padding: '16px 24px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          marginBottom: 24,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 14, color: '#555' }}>
              {sources.length === 0
                ? t('home.noSources')
                : t('home.sourcesCount', { count: sources.length })}
            </span>
            {sources.length > 0 && (
              <>
                <span
                  style={{
                    fontSize: 12,
                    padding: '2px 8px',
                    borderRadius: 10,
                    background: '#e3f2fd',
                    color: '#1565c0',
                    fontWeight: 500,
                  }}
                >
                  {t('home.searchingSources', {
                    count: sources.filter((s) => s.enabled && s.search_url).length,
                  })}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    padding: '2px 8px',
                    borderRadius: 10,
                    background: '#f3e5f5',
                    color: '#7b1fa2',
                    fontWeight: 500,
                  }}
                >
                  {t('bookSources.hasExplore')}:{' '}
                  {sources.filter((s) => s.enabled && s.explore_url).length}
                </span>
              </>
            )}
          </div>
          <button
            onClick={() => navigate('/book-sources')}
            style={{
              ...btnSecondary,
              borderColor: '#bbdefb',
              color: '#1976d2',
              fontSize: 13,
              padding: '6px 14px',
            }}
          >
            {t('layout.bookSources')} →
          </button>
        </div>
      </section>

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

      {/* Search Results */}
      {searchResults.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1a1a2e', marginBottom: 16 }}>
            {t('home.resultsCount', { count: searchResults.length })}
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {searchResults.map((book) => (
              <div
                key={book.book_url}
                onClick={() => openBook(book)}
                style={{
                  background: '#fff',
                  borderRadius: 12,
                  padding: 16,
                  display: 'flex',
                  gap: 16,
                  cursor: 'pointer',
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
                    alt="cover"
                    style={{
                      width: 80,
                      height: 100,
                      objectFit: 'cover',
                      borderRadius: 8,
                      background: '#f0f0f0',
                      flexShrink: 0,
                    }}
                    onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
                  />
                ) : (
                  <div
                    style={{
                      width: 80,
                      height: 100,
                      borderRadius: 8,
                      background: 'linear-gradient(135deg, #e3f2fd 0%, #f3e5f5 100%)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#1976d2',
                      fontSize: 13,
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {book.name.slice(0, 2)}
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 16,
                      color: '#1a1a2e',
                      marginBottom: 4,
                    }}
                  >
                    {book.name}
                  </div>
                  <div style={{ color: '#666', fontSize: 14, marginBottom: 4 }}>
                    {book.author} {book.kind && `· ${book.kind}`}
                  </div>
                  {book.latest_chapter_title && (
                    <div style={{ color: '#888', fontSize: 13, marginBottom: 4 }}>
                      {t('home.latest', { chapter: book.latest_chapter_title })}
                    </div>
                  )}
                  {book.intro && (
                    <div
                      style={{
                        color: '#555',
                        fontSize: 13,
                        marginBottom: 4,
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
                  <div style={{ color: '#999', fontSize: 12 }}>
                    {t('home.source', { name: book.origin_name || 'unknown' })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Rule Subscriptions */}
      <section
        style={{
          background: '#fff',
          borderRadius: 12,
          padding: 24,
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#1a1a2e' }}>
            {t('home.sourceSubscriptions')}
          </h2>
          <button
            onClick={checkSubUpdates}
            disabled={loading || ruleSubs.length === 0}
            style={{
              ...btnSecondary,
              borderColor: '#ffe082',
              color: '#f9a825',
              opacity: loading || ruleSubs.length === 0 ? 0.6 : 1,
              cursor: loading || ruleSubs.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {t('home.checkUpdates')}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
          <input
            type="text"
            placeholder={t('home.subNamePlaceholder')}
            value={newSubName}
            onChange={(e) => setNewSubName(e.target.value)}
            style={{ ...inputStyle, width: 160 }}
          />
          <input
            type="text"
            placeholder={t('home.subUrlPlaceholder')}
            value={newSubUrl}
            onChange={(e) => setNewSubUrl(e.target.value)}
            style={{ ...inputStyle, flex: 1 }}
          />
          <button onClick={addRuleSub} style={btnPrimary}>
            {t('common.add')}
          </button>
        </div>

        {ruleSubs.length === 0 ? (
          <p style={{ color: '#888', margin: 0 }}>{t('home.noSubscriptions')}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ruleSubs.map((sub) => (
              <div
                key={sub.id}
                style={{
                  padding: '12px 16px',
                  borderRadius: 8,
                  background: '#fafbfc',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, color: '#1a1a2e', fontSize: 14 }}>
                    {sub.name || t('home.unnamed')}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: '#888',
                      marginTop: 2,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: 400,
                    }}
                    title={sub.url}
                  >
                    {sub.url}
                  </div>
                </div>
                <button
                  onClick={() => sub.id && deleteRuleSub(sub.id)}
                  style={{
                    padding: '4px 10px',
                    fontSize: 12,
                    color: '#f44336',
                    border: '1px solid #ffcdd2',
                    background: '#fff0f0',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontWeight: 500,
                  }}
                >
                  {t('common.delete')}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
