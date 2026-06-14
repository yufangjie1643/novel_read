import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import type {
  ApiResponse,
  BookSource,
  RssSource,
  RssArticle,
  RssStar,
  RuleSub,
  SourceLink,
} from '../types';
import { useUiMode } from '../uiMode';
import { useLongPress } from '../hooks/useLongPress';

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

const mobileArticlePageStyle: CSSProperties = {
  padding: '0 16px 24px',
};

const mobileTitlebarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '8px 0 12px',
};

const mobileTitlebarCompactStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '8px 0 12px',
};

const mobileBackButtonStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  fontSize: 28,
  lineHeight: 1,
  padding: '4px 8px',
  cursor: 'pointer',
  color: '#243447',
};

const mobileActionButtonStyle: CSSProperties = {
  width: 36,
  height: 36,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
  padding: 0,
  fontSize: 18,
  color: '#243447',
};

const mobileActionButtonActiveStyle: CSSProperties = {
  ...mobileActionButtonStyle,
  background: '#243447',
  color: '#fff',
};

const mobileTitleRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
};

const mobileTitleActionsStyle: CSSProperties = {
  display: 'flex',
  gap: 4,
};

const mobileSearchStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  background: '#fff',
  border: '1px solid #dce5df',
  borderRadius: 10,
  padding: '8px 12px',
  marginTop: 4,
};

const mobileSearchIconStyle: CSSProperties = {
  width: 18,
  height: 18,
  flexShrink: 0,
};

const mobileSearchInputStyle: CSSProperties = {
  flex: 1,
  border: 'none',
  outline: 'none',
  fontSize: 14,
  background: 'transparent',
  fontFamily: 'inherit',
  color: '#243447',
};

const mobileFilterRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  padding: '8px 0 12px',
};

const mobileFilterButtonBase: CSSProperties = {
  padding: '6px 12px',
  borderRadius: 16,
  border: '1px solid #dce5df',
  background: '#fff',
  color: '#54715e',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
};

const mobileFilterButtonActiveStyle: CSSProperties = {
  ...mobileFilterButtonBase,
  background: '#54715e',
  color: '#fff',
  borderColor: '#54715e',
};

const mobileAddCardStyle: CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
  padding: 16,
  display: 'grid',
  gap: 8,
  marginBottom: 12,
};

const mobileAddFormStyle: CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
  padding: 16,
  display: 'grid',
  gap: 8,
  marginBottom: 12,
};

const mobileInputStyle: CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid #e0e0e0',
  fontSize: 14,
  outline: 'none',
  fontFamily: 'inherit',
};

const mobilePrimaryButtonStyle: CSSProperties = {
  padding: '8px 16px',
  borderRadius: 8,
  border: 'none',
  background: '#54715e',
  color: '#fff',
  fontSize: 14,
  fontWeight: 700,
  cursor: 'pointer',
};

const mobileStarsStyle: CSSProperties = {
  display: 'grid',
  gap: 8,
};

const mobileStarRowStyle: CSSProperties = {
  background: '#fff',
  borderRadius: 10,
  padding: '12px 14px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
};

const mobileRuleSubInfoStyle: CSSProperties = {
  display: 'grid',
  gap: 2,
  minWidth: 0,
  flex: 1,
};

const mobileRuleSubUrlStyle: CSSProperties = {
  fontSize: 12,
  color: '#7f8983',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const mobileDeleteButtonStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#b33',
  fontSize: 22,
  lineHeight: 1,
  cursor: 'pointer',
  padding: '4px 8px',
};

const mobileGridWrapStyle: CSSProperties = {
  padding: '4px 0 16px',
};

const mobileGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, 1fr)',
  gap: 12,
};

const mobileGridItemStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  padding: 12,
  background: '#fff',
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
  fontFamily: 'inherit',
  textAlign: 'center',
  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
};

const mobileIconWrapStyle: CSSProperties = {
  width: 64,
  height: 64,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#edf2ed',
  borderRadius: 8,
  overflow: 'hidden',
};

const mobileGridNameStyle: CSSProperties = {
  marginTop: 8,
  fontSize: 12,
  color: '#1a1a2e',
  textAlign: 'center',
  wordBreak: 'break-word',
};

const mobileSheetBackdropStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.5)',
  zIndex: 100,
  display: 'flex',
  alignItems: 'flex-end',
};

const mobileSourceSheetStyle: CSSProperties = {
  width: '100%',
  background: '#fff',
  borderTopLeftRadius: 16,
  borderTopRightRadius: 16,
  padding: 20,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const mobileInlinePageStyle: CSSProperties = {
  width: '100%',
  height: 400,
  border: 'none',
  borderBottom: '1px solid #f0f0f0',
  marginBottom: 12,
};

const mobileArticlesListStyle: CSSProperties = {
  display: 'grid',
  gap: 1,
  background: '#f0f0f0',
};

const mobileArticleStyle: CSSProperties = {
  background: '#fff',
  padding: '14px 16px',
  display: 'grid',
  gap: 6,
  cursor: 'pointer',
};

const mobileLinkPanelStyle: CSSProperties = {
  padding: '0 0 12px',
};

const mobileSourceLinksStyle: CSSProperties = {
  display: 'grid',
  gap: 8,
};

const mobileSourceLinkStyle: CSSProperties = {
  background: '#fff',
  borderRadius: 10,
  padding: '12px 14px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
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

type MobileSourceGridItemProps = {
  source: RssSource;
  onOpen: () => void;
  onLongPress: () => void;
};

function MobileSourceGridItem({ source, onOpen, onLongPress }: MobileSourceGridItemProps) {
  const longPress = useLongPress(onLongPress, { threshold: 400 });

  return (
    <button
      type="button"
      className="android-rss-grid-item"
      onClick={longPress.handleClick(onOpen)}
      onPointerDown={longPress.onPointerDown}
      onPointerUp={longPress.onPointerUp}
      onPointerCancel={longPress.onPointerCancel}
      onPointerLeave={longPress.onPointerLeave}
      style={{
        ...mobileGridItemStyle,
        transform: longPress.isPressed ? 'scale(0.97)' : 'scale(1)',
        transition: 'transform 80ms ease-out',
        touchAction: 'manipulation',
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
  );
}

export default function RssPage() {
  const { t } = useTranslation();
  const { isMobileUi } = useUiMode();
  const aliveRef = useRef(true);
  const loadRequestRef = useRef(0);
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
      <div style={isMobileUi ? mobileLinkPanelStyle : { padding: '16px 20px' }}>
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
          <div style={isMobileUi ? mobileSourceLinksStyle : undefined}>
            {sourceLinks.map((link, idx) => (
              <div
                key={`${link.source_url}-${idx}`}
                style={isMobileUi ? mobileSourceLinkStyle : undefined}
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
      <div style={mobile ? mobileArticlesListStyle : undefined}>
        {articles.map((article, index) => {
          const isRead = article.id != null && readArticleIds.has(article.id);
          return (
            <article
              key={articleKey(article, index)}
              onClick={() => markAsRead(article)}
              style={
                mobile
                  ? { ...mobileArticleStyle, background: isRead ? '#fafbfc' : '#fff' }
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
        <div className="android-screen" style={mobileArticlePageStyle}>
          <header style={mobileTitlebarCompactStyle}>
            <button
              type="button"
              style={mobileBackButtonStyle}
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
            <div style={mobileTitleActionsStyle}>
              <button
                type="button"
                style={mobileActionButtonStyle}
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
                  style={mobileInlinePageStyle}
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
      <div className="android-screen">
        <header style={mobileTitlebarStyle}>
          <div style={mobileTitleRowStyle}>
            <h1>{t('layout.subscription', { defaultValue: t('layout.rss') })}</h1>
            <div style={mobileTitleActionsStyle}>
              <button
                type="button"
                aria-label={t('rss.favorites')}
                style={mobileStarsOpen ? mobileActionButtonActiveStyle : mobileActionButtonStyle}
                onClick={openMobileStars}
              >
                <span aria-hidden="true">☆</span>
              </button>
              <button
                type="button"
                aria-label={t('rss.groupFilter')}
                style={mobileGroupsOpen ? mobileActionButtonActiveStyle : mobileActionButtonStyle}
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
                style={mobileAddOpen ? mobileActionButtonActiveStyle : mobileActionButtonStyle}
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
                style={ruleSubsOpen ? mobileActionButtonActiveStyle : mobileActionButtonStyle}
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

          <label style={mobileSearchStyle}>
            <img src="/mobile-media/search.svg" alt="" style={mobileSearchIconStyle} />
            <input
              type="search"
              placeholder={t('common.search')}
              value={mobileSearchQuery}
              onChange={(e) => {
                setMobileSearchQuery(e.target.value);
                setMobileStarsOpen(false);
              }}
              style={mobileSearchInputStyle}
            />
          </label>
        </header>

        {mobileGroupsOpen && (
          <div style={mobileFilterRowStyle}>
            <button
              type="button"
              style={mobileGroupFilter ? mobileFilterButtonBase : mobileFilterButtonActiveStyle}
              onClick={() => setMobileGroupFilter('')}
            >
              {t('common.all')}
            </button>
            {mobileSourceGroups.map((group) => (
              <button
                key={group}
                type="button"
                style={
                  mobileGroupFilter === group
                    ? mobileFilterButtonActiveStyle
                    : mobileFilterButtonBase
                }
                onClick={() => setMobileGroupFilter(group)}
              >
                {group}
              </button>
            ))}
          </div>
        )}

        {mobileAddOpen && (
          <section style={mobileAddCardStyle}>
            <input
              type="text"
              placeholder={t('rss.sourceNamePlaceholder')}
              value={newSourceName}
              onChange={(e) => setNewSourceName(e.target.value)}
              style={mobileInputStyle}
            />
            <input
              type="text"
              placeholder={t('rss.sourceUrlPlaceholder')}
              value={newSourceUrl}
              onChange={(e) => setNewSourceUrl(e.target.value)}
              style={mobileInputStyle}
            />
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 14,
                color: '#243447',
              }}
            >
              <input
                type="checkbox"
                checked={newSourceSingleUrl}
                onChange={(e) => setNewSourceSingleUrl(e.target.checked)}
              />
              <span>{t('rss.singleUrlSource')}</span>
            </label>
            <button type="button" onClick={addSource} style={mobilePrimaryButtonStyle}>
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
          <section style={mobileStarsStyle}>
            {rssStars.length === 0 ? (
              <div className="android-empty-panel">
                <p>{t('rss.noFavorites')}</p>
              </div>
            ) : (
              rssStars.map((star) => (
                <div
                  key={`${star.origin}-${star.title}-${star.id ?? ''}`}
                  style={mobileStarRowStyle}
                >
                  <strong>{star.title}</strong>
                  <span>{star.sort || star.origin}</span>
                </div>
              ))
            )}
          </section>
        ) : ruleSubsOpen ? (
          <section style={mobileStarsStyle}>
            <div style={mobileAddFormStyle}>
              <input
                type="text"
                placeholder={t('rss.ruleSubNamePlaceholder')}
                value={newRuleSubName}
                onChange={(e) => setNewRuleSubName(e.target.value)}
                style={mobileInputStyle}
              />
              <input
                type="url"
                placeholder={t('rss.ruleSubUrlPlaceholder')}
                value={newRuleSubUrl}
                onChange={(e) => setNewRuleSubUrl(e.target.value)}
                style={mobileInputStyle}
              />
              <button
                type="button"
                style={mobilePrimaryButtonStyle}
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
                <div key={sub.id ?? sub.url ?? sub.name ?? 'sub'} style={mobileStarRowStyle}>
                  <div style={mobileRuleSubInfoStyle}>
                    <strong>{sub.name || sub.url}</strong>
                    {sub.url && sub.name && <span style={mobileRuleSubUrlStyle}>{sub.url}</span>}
                  </div>
                  <button
                    type="button"
                    style={mobileDeleteButtonStyle}
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
          <section style={mobileGridWrapStyle}>
            <div style={mobileGridStyle}>
              <button
                type="button"
                style={mobileGridItemStyle}
                onClick={() => {
                  setRuleSubsOpen(true);
                  loadRuleSubs();
                }}
              >
                <span style={mobileIconWrapStyle}>
                  <img
                    src="/mobile-media/app_icon.png"
                    alt=""
                    style={{ maxWidth: '100%', maxHeight: '100%' }}
                  />
                </span>
                <span style={mobileGridNameStyle}>{t('rss.ruleSubscription')}</span>
              </button>

              {mobileSources.map((source) => (
                <MobileSourceGridItem
                  key={source.source_url}
                  source={source}
                  onOpen={() => loadArticles(source)}
                  onLongPress={() => setMobileMenuSource(source)}
                />
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
            style={mobileSheetBackdropStyle}
            role="presentation"
            onClick={() => setMobileMenuSource(null)}
          >
            <section
              style={mobileSourceSheetStyle}
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
