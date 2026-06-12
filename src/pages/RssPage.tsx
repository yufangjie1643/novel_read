import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import type { ApiResponse, BookSource, RssSource, RssArticle, RssStar, RuleSub, SourceLink } from '../types';
import { useUiMode } from '../uiMode';

const desktopCardStyle: CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
  overflow: 'hidden',
};

const desktopInputStyle: CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid #e0e0e0',
  fontSize: 14,
  outline: 'none',
  fontFamily: 'inherit',
  marginBottom: 8,
};

function isValidUrl(value: string) {
  try {
    const parsed = new URL(value);
    return Boolean(parsed.protocol && parsed.href);
  } catch {
    return false;
  }
}

function isNetworkUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function articleKey(article: RssArticle, index: number) {
  return article.id
    ? `${article.origin}-${article.id}`
    : `${article.origin}-${article.link || article.title}-${index}`;
}

function trimText(value: string | undefined, max: number) {
  if (!value) return '';
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

function messageIsError(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes('error') ||
    lower.includes('failed') ||
    message.includes('失败') ||
    message.includes('错误')
  );
}

function splitSourceGroups(group?: string) {
  return (group || '')
    .split(/[,，;；]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function RssPage() {
  const { t } = useTranslation();
  const { isMobileUi } = useUiMode();
  const aliveRef = useRef(true);
  const loadRequestRef = useRef(0);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const [sources, setSources] = useState<RssSource[]>([]);
  const [articles, setArticles] = useState<RssArticle[]>([]);
  const [selectedSource, setSelectedSource] = useState<RssSource | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [message, setMessage] = useState('');
  const [newSourceUrl, setNewSourceUrl] = useState('');
  const [newSourceName, setNewSourceName] = useState('');
  const [newSourceSingleUrl, setNewSourceSingleUrl] = useState(false);
  const [readArticleIds, setReadArticleIds] = useState<Set<number>>(new Set());
  const [sourceLinks, setSourceLinks] = useState<SourceLink[]>([]);
  const [sourceLinksLoading, setSourceLinksLoading] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [mobileSearchQuery, setMobileSearchQuery] = useState('');
  const [mobileGroupFilter, setMobileGroupFilter] = useState('');
  const [mobileGroupsOpen, setMobileGroupsOpen] = useState(false);
  const [mobileAddOpen, setMobileAddOpen] = useState(false);
  const [mobileMenuSource, setMobileMenuSource] = useState<RssSource | null>(null);
  const [mobileStarsOpen, setMobileStarsOpen] = useState(false);
  const [rssStars, setRssStars] = useState<RssStar[]>([]);
  const [ruleSubsOpen, setRuleSubsOpen] = useState(false);
  const [ruleSubs, setRuleSubs] = useState<RuleSub[]>([]);
  const [newRuleSubUrl, setNewRuleSubUrl] = useState('');
  const [newRuleSubName, setNewRuleSubName] = useState('');
  const [ruleSubsLoading, setRuleSubsLoading] = useState(false);

  const loadSources = useCallback(async () => {
    try {
      const resp = await invoke<ApiResponse<RssSource[]>>('get_rss_sources');
      if (!aliveRef.current) return;
      if (resp.success && resp.data) {
        setSources(resp.data);
      } else {
        setMessage(t('rss.loadSourcesFailed', { error: resp.error || '' }));
      }
    } catch (e) {
      if (aliveRef.current) {
        setMessage(t('rss.loadSourcesFailed', { error: String(e) }));
      }
    }
  }, [t]);

  useEffect(() => {
    aliveRef.current = true;
    loadSources();
    return () => {
      aliveRef.current = false;
      loadRequestRef.current += 1;
      if (longPressTimerRef.current != null) {
        window.clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    };
  }, [loadSources]);

  const loadRuleSubs = useCallback(async () => {
    setRuleSubsLoading(true);
    try {
      const resp = await invoke<ApiResponse<RuleSub[]>>('get_rule_subs');
      if (!aliveRef.current) return;
      if (resp.success && resp.data) {
        setRuleSubs(resp.data);
      } else {
        setMessage(t('rss.loadRuleSubsFailed', { error: resp.error || '' }));
      }
    } catch (e) {
      if (aliveRef.current) {
        setMessage(t('rss.loadRuleSubsFailed', { error: String(e) }));
      }
    } finally {
      if (aliveRef.current) {
        setRuleSubsLoading(false);
      }
    }
  }, [t]);

  async function addRuleSub() {
    const name = newRuleSubName.trim();
    const url = newRuleSubUrl.trim();
    if (!name || !url || !isNetworkUrl(url)) {
      setMessage(t('rss.invalidRuleSubUrl'));
      return;
    }
    try {
      const sub: RuleSub = {
        name,
        url,
        sub_type: 0,
        custom_order: 0,
        enabled: true,
        auto_update: false,
        last_update_time: 0,
      };
      const resp = await invoke<ApiResponse<null>>('add_rule_sub', { sub });
      if (resp.success) {
        setNewRuleSubName('');
        setNewRuleSubUrl('');
        setMessage(t('rss.addRuleSubSuccess'));
        await loadRuleSubs();
      } else {
        setMessage(t('rss.addRuleSubFailed', { error: resp.error || '' }));
      }
    } catch (e) {
      setMessage(t('rss.addRuleSubFailed', { error: String(e) }));
    }
  }

  async function deleteRuleSub(id: number) {
    try {
      const resp = await invoke<ApiResponse<null>>('delete_rule_sub', { id });
      if (resp.success) {
        setMessage(t('rss.deleteRuleSubSuccess'));
        await loadRuleSubs();
      } else {
        setMessage(t('rss.deleteRuleSubFailed', { error: resp.error || '' }));
      }
    } catch (e) {
      setMessage(t('rss.deleteRuleSubFailed', { error: String(e) }));
    }
  }

  async function loadArticles(source: RssSource) {
    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;
    setSelectedSource(source);
    setLoading(true);
    setArticles([]);
    setSourceLinks([]);
    setReadArticleIds(new Set());
    setMessage(t('common.loading'));

    try {
      const resp = await invoke<ApiResponse<RssArticle[]>>('get_rss_articles', {
        origin: source.source_url,
      });
      if (!aliveRef.current || requestId !== loadRequestRef.current) return;

      if (resp.success && resp.data) {
        setArticles(resp.data);
        setMessage(
          resp.data.length > 0
            ? t('rss.articlesCount', { count: resp.data.length })
            : t('rss.noArticles')
        );
      } else {
        setMessage(t('rss.noArticles'));
      }

      const readResp = await invoke<ApiResponse<number[]>>('get_rss_read_article_ids', {
        origin: source.source_url,
      });
      if (!aliveRef.current || requestId !== loadRequestRef.current) return;
      setReadArticleIds(new Set(readResp.success && readResp.data ? readResp.data : []));
    } catch (e) {
      if (aliveRef.current && requestId === loadRequestRef.current) {
        setMessage(t('common.error', { message: String(e) }));
      }
    } finally {
      if (aliveRef.current && requestId === loadRequestRef.current) {
        setLoading(false);
      }
    }
  }

  async function fetchArticles() {
    if (!selectedSource) return;
    if (!isNetworkUrl(selectedSource.source_url)) {
      setMessage(t('rss.unsupportedSourceUrl'));
      return;
    }
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
    } finally {
      if (aliveRef.current) setFetching(false);
    }
  }

  async function loadInstallableLinks() {
    const html = articles.find((article) => article.content)?.content;
    if (!html) {
      setMessage(t('rss.noInstallableSources'));
      return;
    }
    setSourceLinksLoading(true);
    setMessage(t('rss.parsingLinks'));
    try {
      const linkResp = await invoke<ApiResponse<SourceLink[]>>('parse_source_links_from_html', {
        html,
      });
      if (linkResp.success && linkResp.data) {
        setSourceLinks(linkResp.data);
        setMessage(
          linkResp.data.length > 0
            ? t('rss.installableCount', { count: linkResp.data.length })
            : t('rss.noInstallableSources')
        );
      } else {
        setMessage(t('rss.installFailed', { error: linkResp.error || '' }));
      }
    } catch (e) {
      setMessage(t('rss.installFailed', { error: String(e) }));
    } finally {
      setSourceLinksLoading(false);
    }
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
    } finally {
      setInstalling(false);
    }
  }

  async function addSource() {
    const url = newSourceUrl.trim();
    const name = newSourceName.trim();
    if (!url || !name) {
      setMessage(t('rss.sourceRequired'));
      return;
    }
    if (!isValidUrl(url)) {
      setMessage(t('rss.invalidSourceUrl'));
      return;
    }
    if (sources.some((source) => source.source_url === url)) {
      setMessage(t('rss.duplicateSource'));
      return;
    }
    try {
      const source: RssSource = {
        source_url: url,
        source_name: name,
        enabled: true,
        custom_order: sources.length,
        last_update_time: 0,
        single_url: newSourceSingleUrl,
      };
      const resp = await invoke<ApiResponse<null>>('add_rss_source', { source });
      if (resp.success) {
        setNewSourceUrl('');
        setNewSourceName('');
        setNewSourceSingleUrl(false);
        setMessage(t('rss.addSourceSuccess'));
        await loadSources();
      } else {
        setMessage(t('rss.addSourceFailed', { error: resp.error || '' }));
      }
    } catch (e) {
      setMessage(t('rss.addSourceFailed', { error: String(e) }));
    }
  }

  async function deleteSource(source: RssSource) {
    if (!confirm(t('rss.deleteConfirm', { name: source.source_name }))) return;
    try {
      const resp = await invoke<ApiResponse<null>>('delete_rss_source', { url: source.source_url });
      if (!resp.success) {
        setMessage(t('rss.deleteFailed', { error: resp.error || '' }));
        return;
      }
      if (selectedSource?.source_url === source.source_url) {
        setSelectedSource(null);
        setArticles([]);
        setSourceLinks([]);
        setReadArticleIds(new Set());
      }
      await loadSources();
    } catch (e) {
      setMessage(t('rss.deleteFailed', { error: String(e) }));
    }
  }

  async function updateSource(
    source: RssSource,
    patch: Partial<RssSource>,
    successMessage: string
  ) {
    try {
      const updated = { ...source, ...patch };
      const resp = await invoke<ApiResponse<null>>('update_rss_source', { source: updated });
      if (!resp.success) {
        setMessage(t('rss.updateFailed', { error: resp.error || '' }));
        return;
      }
      setMessage(successMessage);
      if (selectedSource?.source_url === source.source_url) {
        setSelectedSource(updated);
      }
      await loadSources();
    } catch (e) {
      setMessage(t('rss.updateFailed', { error: String(e) }));
    }
  }

  async function topSource(source: RssSource) {
    const firstOrder = Math.min(0, ...sources.map((item) => item.custom_order ?? 0));
    await updateSource(source, { custom_order: firstOrder - 1 }, t('rss.sourceMovedTop'));
    setMobileMenuSource(null);
  }

  async function editSourceName(source: RssSource) {
    const nextName = prompt(t('rss.editNamePrompt'), source.source_name)?.trim();
    if (!nextName || nextName === source.source_name) {
      setMobileMenuSource(null);
      return;
    }
    await updateSource(source, { source_name: nextName }, t('rss.sourceUpdated'));
    setMobileMenuSource(null);
  }

  async function disableSource(source: RssSource) {
    await updateSource(source, { enabled: false }, t('rss.sourceDisabled'));
    if (selectedSource?.source_url === source.source_url) {
      setSelectedSource(null);
      setArticles([]);
      setSourceLinks([]);
      setReadArticleIds(new Set());
    }
    setMobileMenuSource(null);
  }

  async function openMobileStars() {
    if (mobileStarsOpen) {
      setMobileStarsOpen(false);
      return;
    }
    setMobileStarsOpen(true);
    setMobileAddOpen(false);
    setMobileGroupsOpen(false);
    try {
      const resp = await invoke<ApiResponse<RssStar[]>>('get_rss_stars');
      if (resp.success && resp.data) {
        setRssStars(resp.data);
      } else {
        setMessage(t('rss.loadFavoritesFailed', { error: resp.error || '' }));
      }
    } catch (e) {
      setMessage(t('rss.loadFavoritesFailed', { error: String(e) }));
    }
  }

  function openMobileSourceMenu(source: RssSource) {
    setMobileMenuSource(source);
  }

  function startMobileSourcePress(source: RssSource) {
    longPressTriggeredRef.current = false;
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current);
    }
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
      openMobileSourceMenu(source);
      longPressTimerRef.current = null;
    }, 520);
  }

  function cancelMobileSourcePress() {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  async function markAsRead(article: RssArticle) {
    if (article.id == null) return;
    const articleId = article.id;
    try {
      await invoke('mark_rss_read', {
        record: {
          origin: article.origin,
          article_id: articleId,
        },
      });
      setReadArticleIds((prev) => new Set(prev).add(articleId));
    } catch (e) {
      console.error('Failed to mark as read:', e);
    }
  }

  function renderSourceBadge(source: RssSource) {
    return (
      <span className={source.single_url ? 'rss-source-badge web' : 'rss-source-badge'}>
        {source.single_url ? t('rss.webSource') : t('rss.rssFeed')}
      </span>
    );
  }

  function renderSourceLinks() {
    if (!selectedSource?.single_url) return null;
    return (
      <div
        className={isMobileUi ? 'android-rss-link-panel' : undefined}
        style={isMobileUi ? undefined : { padding: '16px 20px' }}
      >
        <div className="rss-link-head">
          <h4>{t('rss.installableSources')}</h4>
          <button
            type="button"
            onClick={loadInstallableLinks}
            disabled={sourceLinksLoading || installing}
          >
            {sourceLinksLoading ? t('rss.parsingLinks') : t('rss.loadInstallableSources')}
          </button>
        </div>
        {sourceLinks.length > 0 ? (
          <div className={isMobileUi ? 'android-rss-source-links' : 'rss-source-links'}>
            {sourceLinks.map((link, idx) => (
              <div
                key={`${link.source_url}-${idx}`}
                className={isMobileUi ? 'android-rss-source-link' : 'rss-source-link'}
              >
                <div>
                  <strong title={link.label || link.source_url}>
                    {link.label || link.source_url}
                  </strong>
                  <span title={link.source_url}>{link.source_url}</span>
                </div>
                <button type="button" onClick={() => installSourceLink(link)} disabled={installing}>
                  {t('rss.install')}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="rss-muted">{t('rss.noInstallableSources')}</p>
        )}
      </div>
    );
  }

  function renderArticleList(mobile: boolean) {
    if (articles.length === 0) {
      return (
        <div className={mobile ? 'android-empty-panel' : 'rss-empty-state'}>
          <p>{t('rss.noArticles')}</p>
        </div>
      );
    }

    return (
      <div className={mobile ? 'android-rss-articles' : undefined}>
        {articles.map((article, index) => {
          const isRead = article.id != null && readArticleIds.has(article.id);
          return (
            <article
              key={articleKey(article, index)}
              className={mobile ? `android-rss-article${isRead ? ' read' : ''}` : undefined}
              onClick={() => markAsRead(article)}
              style={
                mobile
                  ? undefined
                  : {
                      padding: '14px 20px',
                      borderBottom: '1px solid #f8f8f8',
                      cursor: 'pointer',
                      background: isRead ? '#fafbfc' : '#fff',
                    }
              }
            >
              <h3
                style={
                  mobile
                    ? undefined
                    : {
                        fontWeight: isRead ? 'normal' : 700,
                        fontSize: 15,
                        color: isRead ? '#888' : '#1a1a2e',
                        margin: '0 0 4px',
                      }
                }
              >
                {article.title}
              </h3>
              {article.pub_date && <time>{article.pub_date}</time>}
              {article.description && <p>{trimText(article.description, mobile ? 120 : 200)}</p>}
              {article.link && (
                <a
                  href={article.link}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  {t('rss.openLink')}
                </a>
              )}
            </article>
          );
        })}
      </div>
    );
  }

  const mobileSourceGroups = Array.from(
    new Set(sources.flatMap((source) => splitSourceGroups(source.source_group)))
  ).sort((a, b) => a.localeCompare(b));

  const mobileQuery = mobileSearchQuery.trim().toLowerCase();
  const mobileSources = sources
    .filter((source) => source.enabled)
    .filter((source) => {
      if (
        mobileGroupFilter &&
        !splitSourceGroups(source.source_group).includes(mobileGroupFilter)
      ) {
        return false;
      }
      if (!mobileQuery) return true;
      return (
        source.source_name.toLowerCase().includes(mobileQuery) ||
        source.source_url.toLowerCase().includes(mobileQuery) ||
        (source.source_group || '').toLowerCase().includes(mobileQuery)
      );
    });

  const iframeHtml =
    selectedSource?.single_url && articles.length > 0 ? articles[0].content || '' : '';
  const showMobileArticleMessage =
    Boolean(message) && (messageIsError(message) || fetching || sourceLinksLoading || installing);

  if (isMobileUi) {
    if (selectedSource) {
      return (
        <div className="android-screen android-rss-page android-rss-article-page">
          <header className="android-rss-titlebar compact">
            <button
              type="button"
              className="android-rss-back-button"
              aria-label={t('common.back')}
              onClick={() => {
                setSelectedSource(null);
                setArticles([]);
                setSourceLinks([]);
                setReadArticleIds(new Set());
                setMessage('');
              }}
            >
              ‹
            </button>
            <h1>{selectedSource.source_name}</h1>
            <div className="android-rss-title-actions">
              <button
                type="button"
                aria-label={t('rss.refresh')}
                onClick={fetchArticles}
                disabled={fetching || loading}
              >
                <img src="/mobile-media/sub_line.svg" alt="" />
              </button>
            </div>
          </header>

          {showMobileArticleMessage && (
            <div className={messageIsError(message) ? 'android-message error' : 'android-message'}>
              {message}
            </div>
          )}

          {loading ? (
            <div className="android-empty-panel">
              <p>{t('common.loading')}</p>
            </div>
          ) : selectedSource.single_url ? (
            <>
              {iframeHtml && (
                <iframe
                  srcDoc={iframeHtml}
                  className="android-rss-inline-page"
                  title={selectedSource.source_name}
                  sandbox="allow-same-origin"
                />
              )}
              {renderSourceLinks()}
              {renderArticleList(true)}
            </>
          ) : (
            renderArticleList(true)
          )}
        </div>
      );
    }

    return (
      <div className="android-screen android-rss-page">
        <header className="android-rss-titlebar">
          <div className="android-rss-title-row">
            <h1>{t('layout.subscription', { defaultValue: t('layout.rss') })}</h1>
            <div className="android-rss-title-actions">
              <button
                type="button"
                aria-label={t('rss.favorites')}
                className={mobileStarsOpen ? 'active' : undefined}
                onClick={openMobileStars}
              >
                <span aria-hidden="true">☆</span>
              </button>
              <button
                type="button"
                aria-label={t('rss.groupFilter')}
                className={mobileGroupsOpen ? 'active' : undefined}
                onClick={() => {
                  setMobileGroupsOpen((open) => !open);
                  setMobileStarsOpen(false);
                }}
              >
                <img src="/mobile-media/folder.svg" alt="" />
              </button>
              <button
                type="button"
                aria-label={t('rss.manageSources')}
                className={mobileAddOpen ? 'active' : undefined}
                onClick={() => {
                  setMobileAddOpen((open) => !open);
                  setMobileStarsOpen(false);
                }}
              >
                <img src="/mobile-media/add.svg" alt="" />
              </button>
              <button
                type="button"
                aria-label={t('rss.ruleSubscription')}
                className={ruleSubsOpen ? 'active' : undefined}
                onClick={() => {
                  setRuleSubsOpen((open) => !open);
                  if (!ruleSubsOpen) {
                    setMobileStarsOpen(false);
                    setMobileAddOpen(false);
                    setMobileGroupsOpen(false);
                    loadRuleSubs();
                  }
                }}
              >
                <span aria-hidden="true">⊞</span>
              </button>
            </div>
          </div>

          <label className="android-rss-search">
            <img src="/mobile-media/search.svg" alt="" />
            <input
              type="search"
              placeholder={t('common.search')}
              value={mobileSearchQuery}
              onChange={(e) => {
                setMobileSearchQuery(e.target.value);
                setMobileStarsOpen(false);
              }}
            />
          </label>
        </header>

        {mobileGroupsOpen && (
          <div className="android-rss-filter-row">
            <button
              type="button"
              className={mobileGroupFilter ? undefined : 'active'}
              onClick={() => setMobileGroupFilter('')}
            >
              {t('common.all')}
            </button>
            {mobileSourceGroups.map((group) => (
              <button
                key={group}
                type="button"
                className={mobileGroupFilter === group ? 'active' : undefined}
                onClick={() => setMobileGroupFilter(group)}
              >
                {group}
              </button>
            ))}
          </div>
        )}

        {mobileAddOpen && (
          <section className="android-rss-add-card">
            <input
              type="text"
              placeholder={t('rss.sourceNamePlaceholder')}
              value={newSourceName}
              onChange={(e) => setNewSourceName(e.target.value)}
            />
            <input
              type="text"
              placeholder={t('rss.sourceUrlPlaceholder')}
              value={newSourceUrl}
              onChange={(e) => setNewSourceUrl(e.target.value)}
            />
            <label>
              <input
                type="checkbox"
                checked={newSourceSingleUrl}
                onChange={(e) => setNewSourceSingleUrl(e.target.checked)}
              />
              <span>{t('rss.singleUrlSource')}</span>
            </label>
            <button type="button" onClick={addSource}>
              {t('rss.addSource')}
            </button>
          </section>
        )}

        {message && (
          <div className={messageIsError(message) ? 'android-message error' : 'android-message'}>
            {message}
          </div>
        )}

        {mobileStarsOpen ? (
          <section className="android-rss-stars">
            {rssStars.length === 0 ? (
              <div className="android-empty-panel">
                <p>{t('rss.noFavorites')}</p>
              </div>
            ) : (
              rssStars.map((star) => (
                <div
                  key={`${star.origin}-${star.title}-${star.id ?? ''}`}
                  className="android-rss-star-row"
                >
                  <strong>{star.title}</strong>
                  <span>{star.sort || star.origin}</span>
                </div>
              ))
            )}
          </section>
        ) : ruleSubsOpen ? (
          <section className="android-rss-stars">
            <div className="android-rss-add-form">
              <input
                type="text"
                placeholder={t('rss.ruleSubNamePlaceholder')}
                value={newRuleSubName}
                onChange={(e) => setNewRuleSubName(e.target.value)}
              />
              <input
                type="url"
                placeholder={t('rss.ruleSubUrlPlaceholder')}
                value={newRuleSubUrl}
                onChange={(e) => setNewRuleSubUrl(e.target.value)}
              />
              <button
                type="button"
                className="android-rss-add-button"
                onClick={addRuleSub}
                disabled={ruleSubsLoading}
              >
                {t('rss.addRuleSub')}
              </button>
            </div>
            {ruleSubsLoading && ruleSubs.length === 0 ? (
              <div className="android-empty-panel">
                <p>{t('common.loading')}</p>
              </div>
            ) : ruleSubs.length === 0 ? (
              <div className="android-empty-panel">
                <p>{t('rss.noRuleSubs')}</p>
              </div>
            ) : (
              ruleSubs.map((sub) => (
                <div
                  key={sub.id ?? sub.url ?? sub.name ?? 'sub'}
                  className="android-rss-star-row"
                >
                  <div className="android-rss-rule-sub-info">
                    <strong>{sub.name || sub.url}</strong>
                    {sub.url && sub.name && <span className="android-rss-rule-sub-url">{sub.url}</span>}
                  </div>
                  <button
                    type="button"
                    className="android-rss-row-delete"
                    aria-label={t('common.delete')}
                    onClick={() => sub.id != null && deleteRuleSub(sub.id)}
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </section>
        ) : (
          <section className="android-rss-grid-wrap">
            <div className="android-rss-grid">
              <button
                type="button"
                className="android-rss-grid-item"
                onClick={() => {
                  if (longPressTriggeredRef.current) {
                    longPressTriggeredRef.current = false;
                    return;
                  }
                  setRuleSubsOpen(true);
                  loadRuleSubs();
                }}
              >
                <span className="android-rss-icon-wrap legado">
                  <img src="/mobile-media/app_icon.png" alt="" />
                </span>
                <span className="android-rss-grid-name">{t('rss.ruleSubscription')}</span>
              </button>

              {mobileSources.map((source) => (
                <button
                  key={source.source_url}
                  type="button"
                  className="android-rss-grid-item"
                  onClick={() => {
                    if (longPressTriggeredRef.current) {
                      longPressTriggeredRef.current = false;
                      return;
                    }
                    loadArticles(source);
                  }}
                  onPointerDown={() => startMobileSourcePress(source)}
                  onPointerUp={cancelMobileSourcePress}
                  onPointerCancel={cancelMobileSourcePress}
                  onPointerLeave={cancelMobileSourcePress}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    openMobileSourceMenu(source);
                  }}
                >
                  <span className="android-rss-icon-wrap">
                    <img
                      src={source.source_icon?.trim() || '/mobile-media/sub_line.svg'}
                      alt=""
                      onError={(e) => {
                        e.currentTarget.src = '/mobile-media/sub_line.svg';
                      }}
                    />
                  </span>
                  <span className="android-rss-grid-name">{source.source_name}</span>
                </button>
              ))}
            </div>

            {mobileSources.length === 0 && sources.length === 0 && (
              <div className="android-empty-panel">
                <p>{t('rss.noSources')}</p>
              </div>
            )}
          </section>
        )}

        {mobileMenuSource && (
          <div
            className="android-rss-sheet-backdrop"
            role="presentation"
            onClick={() => setMobileMenuSource(null)}
          >
            <section
              className="android-rss-source-sheet"
              role="dialog"
              aria-label={mobileMenuSource.source_name}
              onClick={(e) => e.stopPropagation()}
            >
              <h2>{mobileMenuSource.source_name}</h2>
              <button type="button" onClick={() => topSource(mobileMenuSource)}>
                {t('rss.toTop')}
              </button>
              <button type="button" onClick={() => editSourceName(mobileMenuSource)}>
                {t('common.edit')}
              </button>
              <button type="button" onClick={() => disableSource(mobileMenuSource)}>
                {t('rss.disableSource')}
              </button>
              <button
                type="button"
                className="danger"
                onClick={async () => {
                  await deleteSource(mobileMenuSource);
                  setMobileMenuSource(null);
                }}
              >
                {t('common.delete')}
              </button>
              <button type="button" onClick={() => setMobileMenuSource(null)}>
                {t('common.cancel')}
              </button>
            </section>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 20, minHeight: '70vh' }}>
      <div style={{ width: 280, flexShrink: 0 }}>
        <div style={{ ...desktopCardStyle, padding: 16 }}>
          <h3 style={{ margin: '0 0 14px', fontSize: 16, fontWeight: 700, color: '#1a1a2e' }}>
            {t('rss.sourcesTitle')}
          </h3>

          <div style={{ marginBottom: 14 }}>
            <input
              type="text"
              placeholder={t('rss.sourceNamePlaceholder')}
              value={newSourceName}
              onChange={(e) => setNewSourceName(e.target.value)}
              style={desktopInputStyle}
            />
            <input
              type="text"
              placeholder={t('rss.sourceUrlPlaceholder')}
              value={newSourceUrl}
              onChange={(e) => setNewSourceUrl(e.target.value)}
              style={desktopInputStyle}
            />
            <label className="rss-checkbox-row">
              <input
                type="checkbox"
                checked={newSourceSingleUrl}
                onChange={(e) => setNewSourceSingleUrl(e.target.checked)}
              />
              <span>{t('rss.singleUrlSource')}</span>
            </label>
            <button type="button" onClick={addSource} className="rss-primary-button">
              {t('rss.addSource')}
            </button>
          </div>

          <div>
            {sources.length === 0 ? (
              <p style={{ padding: 12, color: '#888', margin: 0, textAlign: 'center' }}>
                {t('rss.noSources')}
              </p>
            ) : (
              sources.map((source) => (
                <div
                  key={source.source_url}
                  onClick={() => loadArticles(source)}
                  className={
                    selectedSource?.source_url === source.source_url
                      ? 'rss-source-row selected'
                      : 'rss-source-row'
                  }
                >
                  <span>
                    {source.source_name}
                    {renderSourceBadge(source)}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteSource(source);
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

      <div style={{ flex: 1, minWidth: 0 }}>
        {selectedSource ? (
          <div style={desktopCardStyle}>
            <div className="rss-panel-head">
              <span>
                {selectedSource.source_name}
                {renderSourceBadge(selectedSource)}
              </span>
              <button type="button" onClick={fetchArticles} disabled={fetching || loading}>
                {fetching ? t('rss.fetching') : t('rss.refresh')}
              </button>
            </div>
            {message && (
              <div className={messageIsError(message) ? 'rss-message error' : 'rss-message'}>
                {message}
              </div>
            )}
            {loading ? (
              <div className="rss-empty-state">
                <p>{t('common.loading')}</p>
              </div>
            ) : selectedSource.single_url ? (
              <div>
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
                {renderSourceLinks()}
              </div>
            ) : (
              renderArticleList(false)
            )}
          </div>
        ) : (
          <div className="rss-empty-state" style={desktopCardStyle}>
            <p>{t('rss.selectSourcePrompt')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
