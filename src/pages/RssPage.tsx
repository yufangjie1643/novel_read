import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import type { ApiResponse, BookSource, RssSource, RssArticle, SourceLink } from '../types';

export default function RssPage() {
  const { t } = useTranslation();
  const [sources, setSources] = useState<RssSource[]>([]);
  const [articles, setArticles] = useState<RssArticle[]>([]);
  const [selectedSource, setSelectedSource] = useState<RssSource | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [message, setMessage] = useState('');
  const [newSourceUrl, setNewSourceUrl] = useState('');
  const [newSourceName, setNewSourceName] = useState('');
  const [readArticleIds, setReadArticleIds] = useState<Set<number>>(new Set());
  const [sourceLinks, setSourceLinks] = useState<SourceLink[]>([]);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    loadSources();
  }, []);

  async function loadSources() {
    try {
      const resp = await invoke<ApiResponse<RssSource[]>>('get_rss_sources');
      if (resp.success && resp.data) {
        setSources(resp.data);
      }
    } catch (e) {
      console.error('Failed to load RSS sources:', e);
    }
  }

  async function loadArticles(source: RssSource) {
    setSelectedSource(source);
    setLoading(true);
    setArticles([]);
    setSourceLinks([]);
    setMessage(t('common.loading'));

    try {
      const resp = await invoke<ApiResponse<RssArticle[]>>('get_rss_articles', {
        origin: source.source_url,
      });
      if (resp.success && resp.data) {
        setArticles(resp.data);
        setMessage(t('rss.articlesCount', { count: resp.data.length }));

        // For single_url sources, parse installable source links from HTML
        if (source.single_url && resp.data.length > 0 && resp.data[0].content) {
          try {
            const linkResp = await invoke<ApiResponse<SourceLink[]>>('parse_source_links_from_html', {
              html: resp.data[0].content,
            });
            if (linkResp.success && linkResp.data) {
              setSourceLinks(linkResp.data);
            }
          } catch (e) {
            console.error('Failed to parse source links:', e);
          }
        }

        const readResp = await invoke<ApiResponse<number[]>>('get_rss_read_article_ids', {
          origin: source.source_url,
        });
        if (readResp.success && readResp.data) {
          setReadArticleIds(new Set(readResp.data));
        }
      } else {
        setMessage(t('rss.noArticles'));
      }
    } catch (e) {
      setMessage(t('common.error', { message: String(e) }));
    }
    setLoading(false);
  }

  async function fetchArticles() {
    if (!selectedSource) return;
    setFetching(true);
    setMessage(t('rss.fetching'));
    try {
      const resp = await invoke<ApiResponse<null>>('fetch_rss_articles', {
        origin: selectedSource.source_url,
      });
      if (resp.success) {
        await loadArticles(selectedSource);
      } else {
        setMessage(t('rss.fetchFailed', { error: resp.error || '' }));
      }
    } catch (e) {
      setMessage(t('common.error', { message: String(e) }));
    }
    setFetching(false);
  }

  async function installSourceLink(link: SourceLink) {
    if (!link.source_url) return;
    setInstalling(true);
    setMessage(t('rss.installingSource', { name: link.label || link.source_url }));
    try {
      const resp = await invoke<ApiResponse<BookSource[]>>('import_source_from_url', {
        url: link.source_url,
      });
      if (resp.success && resp.data) {
        for (const source of resp.data) {
          await invoke('add_book_source', { source });
        }
        setMessage(t('rss.installSuccess', { count: resp.data.length }));
      } else {
        setMessage(t('rss.installFailed', { error: resp.error || '' }));
      }
    } catch (e) {
      setMessage(t('rss.installFailed', { error: String(e) }));
    }
    setInstalling(false);
  }

  async function addSource() {
    if (!newSourceUrl.trim() || !newSourceName.trim()) return;
    try {
      const source: RssSource = {
        source_url: newSourceUrl.trim(),
        source_name: newSourceName.trim(),
        enabled: true,
        custom_order: 0,
        last_update_time: 0,
      };
      await invoke('add_rss_source', { source });
      setNewSourceUrl('');
      setNewSourceName('');
      await loadSources();
    } catch (e) {
      setMessage(t('rss.addSourceFailed', { error: String(e) }));
    }
  }

  async function deleteSource(source: RssSource) {
    if (!confirm(t('rss.deleteConfirm', { name: source.source_name }))) return;
    try {
      await invoke('delete_rss_source', { url: source.source_url });
      if (selectedSource?.source_url === source.source_url) {
        setSelectedSource(null);
        setArticles([]);
        setSourceLinks([]);
      }
      await loadSources();
    } catch (e) {
      setMessage(t('rss.deleteFailed', { error: String(e) }));
    }
  }

  async function markAsRead(article: RssArticle) {
    if (!article.id) return;
    try {
      await invoke('mark_rss_read', {
        record: {
          origin: article.origin,
          article_id: article.id,
        },
      });
      setReadArticleIds((prev) => new Set(prev).add(article.id!));
    } catch (e) {
      console.error('Failed to mark as read:', e);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid #e0e0e0',
    fontSize: 14,
    outline: 'none',
    fontFamily: 'inherit',
    marginBottom: 8,
    boxSizing: 'border-box',
  };

  // HTML content for single_url iframe preview
  const iframeHtml =
    selectedSource?.single_url && articles.length > 0 ? articles[0].content || '' : '';

  return (
    <div style={{ display: 'flex', gap: 20, minHeight: '70vh' }}>
      {/* Sources sidebar */}
      <div style={{ width: 280, flexShrink: 0 }}>
        <div
          style={{
            background: '#fff',
            borderRadius: 12,
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
            padding: 16,
          }}
        >
          <h3 style={{ margin: '0 0 14px', fontSize: 16, fontWeight: 700, color: '#1a1a2e' }}>
            {t('rss.sourcesTitle')}
          </h3>

          <div style={{ marginBottom: 14 }}>
            <input
              type="text"
              placeholder={t('rss.sourceNamePlaceholder')}
              value={newSourceName}
              onChange={(e) => setNewSourceName(e.target.value)}
              style={inputStyle}
            />
            <input
              type="text"
              placeholder={t('rss.sourceUrlPlaceholder')}
              value={newSourceUrl}
              onChange={(e) => setNewSourceUrl(e.target.value)}
              style={inputStyle}
            />
            <button
              onClick={addSource}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 8,
                border: 'none',
                background: '#1976d2',
                color: '#fff',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {t('rss.addSource')}
            </button>
          </div>

          <div>
            {sources.length === 0 ? (
              <p style={{ padding: 12, color: '#888', margin: 0, textAlign: 'center' }}>
                {t('rss.noSources')}
              </p>
            ) : (
              sources.map((s) => (
                <div
                  key={s.source_url}
                  onClick={() => loadArticles(s)}
                  style={{
                    padding: '10px 12px',
                    cursor: 'pointer',
                    borderRadius: 8,
                    marginBottom: 4,
                    background:
                      selectedSource?.source_url === s.source_url ? '#eef4fd' : 'transparent',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    if (selectedSource?.source_url !== s.source_url) {
                      e.currentTarget.style.background = '#f5f7fa';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (selectedSource?.source_url !== s.source_url) {
                      e.currentTarget.style.background = 'transparent';
                    }
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: 14, color: '#333' }}>
                    {s.source_name}
                    {s.single_url && (
                      <span
                        style={{
                          fontSize: 10,
                          color: '#1976d2',
                          background: '#e3f2fd',
                          padding: '1px 5px',
                          borderRadius: 4,
                          marginLeft: 6,
                          fontWeight: 500,
                        }}
                      >
                        Web
                      </span>
                    )}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteSource(s);
                    }}
                    style={{
                      padding: '2px 8px',
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
              ))
            )}
          </div>
        </div>
      </div>

      {/* Articles panel */}
      <div style={{ flex: 1 }}>
        {selectedSource ? (
          <div
            style={{
              background: '#fff',
              borderRadius: 12,
              boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid #f0f0f0',
                fontSize: 16,
                fontWeight: 700,
                color: '#1a1a2e',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span>{selectedSource.source_name}</span>
              <button
                onClick={fetchArticles}
                disabled={fetching}
                style={{
                  padding: '5px 14px',
                  borderRadius: 6,
                  border: '1px solid #bbdefb',
                  background: fetching ? '#f5f5f5' : '#e3f2fd',
                  color: fetching ? '#999' : '#1976d2',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: fetching ? 'not-allowed' : 'pointer',
                }}
              >
                {fetching ? t('rss.fetching') : t('rss.refresh')}
              </button>
            </div>
            {message && (
              <div
                style={{
                  padding: '10px 20px',
                  color: '#1565c0',
                  background: '#e3f2fd',
                  fontSize: 14,
                  fontWeight: 500,
                }}
              >
                {message}
              </div>
            )}
            {loading ? (
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
            ) : selectedSource.single_url ? (
              <div>
                {/* Single URL source: iframe preview + source links */}
                {iframeHtml && (
                  <iframe
                    srcDoc={iframeHtml}
                    style={{
                      width: '100%',
                      height: 400,
                      border: 'none',
                      borderBottom: '1px solid #f0f0f0',
                    }}
                    title={selectedSource.source_name}
                    sandbox="allow-same-origin"
                  />
                )}
                {sourceLinks.length > 0 && (
                  <div style={{ padding: '16px 20px' }}>
                    <h4
                      style={{
                        margin: '0 0 12px',
                        fontSize: 15,
                        fontWeight: 700,
                        color: '#1a1a2e',
                      }}
                    >
                      {t('rss.installableSources')}
                    </h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {sourceLinks.map((link, idx) => (
                        <div
                          key={idx}
                          style={{
                            padding: '10px 14px',
                            borderRadius: 8,
                            background: '#f5f7fa',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: 12,
                          }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                fontWeight: 600,
                                fontSize: 14,
                                color: '#1a1a2e',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                              title={link.label || link.source_url}
                            >
                              {link.label || link.source_url}
                            </div>
                            <div
                              style={{
                                fontSize: 12,
                                color: '#888',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                marginTop: 2,
                              }}
                              title={link.source_url}
                            >
                              {link.source_url}
                            </div>
                          </div>
                          <button
                            onClick={() => installSourceLink(link)}
                            disabled={installing}
                            style={{
                              padding: '5px 12px',
                              borderRadius: 6,
                              border: 'none',
                              background: installing ? '#f5f5f5' : '#4caf50',
                              color: installing ? '#999' : '#fff',
                              fontSize: 13,
                              fontWeight: 600,
                              cursor: installing ? 'not-allowed' : 'pointer',
                              whiteSpace: 'nowrap',
                              flexShrink: 0,
                            }}
                          >
                            {t('rss.install')}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div>
                {articles.map((article) => {
                  const isRead = article.id && readArticleIds.has(article.id);
                  return (
                    <div
                      key={
                        article.id
                          ? `${article.origin}-${article.id}`
                          : `${article.origin}-${article.title}`
                      }
                      onClick={() => markAsRead(article)}
                      style={{
                        padding: '14px 20px',
                        borderBottom: '1px solid #f8f8f8',
                        cursor: 'pointer',
                        background: isRead ? '#fafbfc' : '#fff',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={(e) => {
                        if (!isRead) e.currentTarget.style.background = '#f5f7fa';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = isRead ? '#fafbfc' : '#fff';
                      }}
                    >
                      <div
                        style={{
                          fontWeight: isRead ? 'normal' : 700,
                          fontSize: 15,
                          color: isRead ? '#888' : '#1a1a2e',
                          marginBottom: 4,
                        }}
                      >
                        {article.title}
                      </div>
                      {article.pub_date && (
                        <div style={{ fontSize: 12, color: '#aaa', marginBottom: 4 }}>
                          {article.pub_date}
                        </div>
                      )}
                      {article.description && (
                        <div
                          style={{ fontSize: 13, color: '#666', marginBottom: 6, lineHeight: 1.5 }}
                        >
                          {article.description.slice(0, 200)}
                          {article.description.length > 200 ? '...' : ''}
                        </div>
                      )}
                      {article.link && (
                        <a
                          href={article.link}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{ fontSize: 12, color: '#1976d2', fontWeight: 500 }}
                        >
                          {t('rss.openLink')}
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div
            style={{
              textAlign: 'center',
              padding: '80px 20px',
              color: '#888',
              background: '#fff',
              borderRadius: 12,
              boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
            }}
          >
            <p style={{ fontSize: 16 }}>{t('rss.selectSourcePrompt')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
