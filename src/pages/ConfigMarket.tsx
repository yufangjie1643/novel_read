import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import type {
  ApiResponse,
  BookSource,
  HttpTTS,
  ReplaceRule,
  RssSource,
  SourceLink,
} from '../types';
import { useUiMode } from '../uiMode';
import { isTauri } from '../utils/tauri';

const DEFAULT_MARKET_URL = 'https://legado.aoaostar.com/';
const RECOMMENDED_SOURCES: ReadonlyArray<{
  key: string;
  url: string;
  type: 'bookSource' | 'rssSource' | 'replaceRule' | 'httpTTS';
  nameZh: string;
  nameEn: string;
}> = [
  {
    key: 'aoaostar-book',
    url: 'https://legado.aoaostar.com/',
    type: 'bookSource',
    nameZh: 'AOAOSTAR 书源合集',
    nameEn: 'AOAOSTAR book source bundle',
  },
  {
    key: 'miaogongzi-book',
    url: 'http://yuedu.miaogongzi.net/shuyuan',
    type: 'bookSource',
    nameZh: '喵公子书源',
    nameEn: 'Miaogongzi sources',
  },
  {
    key: 'nyaa-rss',
    url: 'https://shuyuan.nyasama.cc/cdn/5f626361539d546e6fa3a02b24598284.json',
    type: 'rssSource',
    nameZh: 'Nya源·合集',
    nameEn: 'Nya source bundle (RSS)',
  },
  {
    key: 'legado-rss',
    url: 'https://cdn.jsdelivr.net/gh/gedoor/legado@master/app/src/main/assets/defaultData/rssSources.json',
    type: 'rssSource',
    nameZh: 'Legado 官方 RSS 源',
    nameEn: 'Legado official RSS bundle',
  },
  {
    key: 'legado-replace',
    url: 'https://cdn.jsdelivr.net/gh/gedoor/legado@master/app/src/main/assets/defaultData/replaceRules.json',
    type: 'replaceRule',
    nameZh: 'Legado 净化规则',
    nameEn: 'Legado replace rules',
  },
];
const SUPPORTED_TYPES = new Set([
  'bookSource',
  'rssSource',
  'replaceRule',
  'httpTTS',
  'theme',
  'readConfig',
]);
const TYPE_ORDER = ['bookSource', 'rssSource', 'replaceRule', 'httpTTS', 'theme', 'readConfig'];
const IMPORT_MESSAGE_TYPE = 'legado-config-import';

function linkKey(link: SourceLink) {
  return `${link.link_type}|${link.source_url}`;
}

function escapeAttr(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function buildPreviewHtml(html: string, baseUrl: string) {
  const baseTag = `<base href="${escapeAttr(baseUrl)}">`;
  const importStyle = `<style>
    a[href^="legado://import/"], a[href^="yuedu://import/"] {
      display: inline-flex;
      align-items: center;
      min-height: 28px;
      padding: 2px 10px;
      border-radius: 6px;
      background: #e7f7eb;
      color: #24753a !important;
      font-weight: 700;
      text-decoration: none;
    }
  </style>`;
  const bridgeScript = `<script>
    (function () {
      function importAnchor(target) {
        while (target && target !== document) {
          if (target.tagName === 'A') {
            var href = target.getAttribute('href') || '';
            if (href.indexOf('legado://import/') === 0 || href.indexOf('yuedu://import/') === 0) {
              return target;
            }
          }
          target = target.parentNode;
        }
        return null;
      }
      document.addEventListener('click', function (event) {
        var anchor = importAnchor(event.target);
        if (!anchor) return;
        event.preventDefault();
        event.stopPropagation();
        window.parent.postMessage({
          type: '${IMPORT_MESSAGE_TYPE}',
          href: anchor.getAttribute('href') || anchor.href,
          label: (anchor.textContent || '').trim()
        }, '*');
      }, true);
    })();
  </script>`;

  const withBase = /<head\b[^>]*>/i.test(html)
    ? html.replace(/<head\b[^>]*>/i, (match) => `${match}${baseTag}${importStyle}`)
    : `${baseTag}${importStyle}${html}`;

  return /<\/body>/i.test(withBase)
    ? withBase.replace(/<\/body>/i, `${bridgeScript}</body>`)
    : `${withBase}${bridgeScript}`;
}

function parseImportHref(href: string, label?: string): SourceLink | null {
  const normalized = href.replace(/&amp;/g, '&').trim();
  const prefix = normalized.startsWith('legado://import/')
    ? 'legado://import/'
    : normalized.startsWith('yuedu://import/')
      ? 'yuedu://import/'
      : '';
  if (!prefix) return null;

  const rest = normalized.slice(prefix.length);
  const [linkType, query = ''] = rest.split('?');
  const sourceUrl = new URLSearchParams(query).get('src') || '';
  if (!linkType || !sourceUrl) return null;

  return {
    raw_url: normalized,
    source_url: sourceUrl,
    link_type: linkType,
    label,
  };
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

async function addAll<T>(items: T[], command: string, argName: string) {
  let success = 0;
  let failed = 0;
  for (const item of items) {
    try {
      const resp = await invoke<ApiResponse<null>>(command, { [argName]: item });
      if (resp.success) success++;
      else failed++;
    } catch {
      failed++;
    }
  }
  return { success, failed };
}

type ReaderThemeConfig = { bg: string; text: string; border: string; button: string };

const DEFAULT_READER_THEME: ReaderThemeConfig = {
  bg: '#f5f5f5',
  text: '#333333',
  border: '#dddddd',
  button: '#eeeeee',
};

function firstJsonObject(json: string) {
  const value = JSON.parse(json) as unknown;
  const item = Array.isArray(value) ? value[0] : value;
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error('Expected JSON object');
  }
  return item as Record<string, unknown>;
}

function stringField(obj: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  }
  return undefined;
}

function numberField(obj: Record<string, unknown>, keys: string[]) {
  const value = stringField(obj, keys);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanField(obj: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      if (value === 'true') return true;
      if (value === 'false') return false;
    }
  }
  return false;
}

function androidColorToCss(value: unknown, fallback: string) {
  if (typeof value !== 'string' && typeof value !== 'number') return fallback;
  let color = String(value).trim();
  if (!color) return fallback;
  if (color.startsWith('0x')) color = `#${color.slice(2)}`;
  if (!color.startsWith('#')) color = `#${color}`;
  const hex = color.slice(1);
  if (/^[0-9a-f]{8}$/i.test(hex)) return `#${hex.slice(2)}`;
  if (/^[0-9a-f]{6}$/i.test(hex)) return `#${hex}`;
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return `#${hex
      .split('')
      .map((char) => char + char)
      .join('')}`;
  }
  return fallback;
}

function readableTextFor(bg: string) {
  const hex = bg.replace('#', '');
  const value = /^[0-9a-f]{6}$/i.test(hex) ? parseInt(hex, 16) : 0xffffff;
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness < 145 ? '#e8eaed' : '#1f2933';
}

function applyImportedReaderTheme(theme: ReaderThemeConfig) {
  localStorage.setItem('reader_custom_theme', JSON.stringify(theme));
  localStorage.setItem('reader_theme', 'custom');
}

function applyThemeJson(json: string) {
  const obj = firstJsonObject(json);
  const bg = androidColorToCss(
    stringField(obj, ['backgroundColor', 'primaryColor', 'bgStr']),
    DEFAULT_READER_THEME.bg
  );
  const button = androidColorToCss(
    stringField(obj, ['bottomBackground', 'primaryColor', 'buttonColor']),
    bg
  );
  const text = androidColorToCss(
    stringField(obj, ['textColor', 'foregroundColor']),
    readableTextFor(bg)
  );
  const border = androidColorToCss(
    stringField(obj, ['accentColor', 'borderColor']),
    button === bg ? DEFAULT_READER_THEME.border : button
  );
  applyImportedReaderTheme({ bg, text, border, button });
}

function applyReadConfigJson(json: string) {
  const obj = firstJsonObject(json);
  const night = booleanField(obj, ['isNightTheme']);
  const bg = androidColorToCss(
    stringField(obj, night ? ['bgStrNight', 'bgStr'] : ['bgStr', 'bgStrNight']),
    DEFAULT_READER_THEME.bg
  );
  const text = androidColorToCss(
    stringField(obj, night ? ['textColorNight', 'textColor'] : ['textColor', 'textColorNight']),
    readableTextFor(bg)
  );
  const border = androidColorToCss(stringField(obj, ['accentColor']), DEFAULT_READER_THEME.border);
  applyImportedReaderTheme({ bg, text, border, button: bg });

  const textSize = numberField(obj, ['textSize', 'fontSize']);
  if (textSize !== undefined) {
    localStorage.setItem('reader_font_size', String(Math.min(32, Math.max(12, textSize))));
  }
  const lineSpacingExtra = numberField(obj, ['lineSpacingExtra', 'lineSpacing']);
  if (lineSpacingExtra !== undefined) {
    const lineHeight = Math.min(2.5, Math.max(1.2, 1.2 + lineSpacingExtra / 24));
    localStorage.setItem('reader_line_height', lineHeight.toFixed(1));
  }
  const paragraphSpacing = numberField(obj, ['paragraphSpacing']);
  if (paragraphSpacing !== undefined) {
    const spacing = Math.min(2, Math.max(0, paragraphSpacing / 16));
    localStorage.setItem('reader_paragraph_spacing', spacing.toFixed(1));
  }
}

export default function ConfigMarket() {
  const { t } = useTranslation();
  const { isMobileUi } = useUiMode();
  const [siteUrl, setSiteUrl] = useState(DEFAULT_MARKET_URL);
  const [frameUrl, setFrameUrl] = useState(DEFAULT_MARKET_URL);
  const [previewHtml, setPreviewHtml] = useState('');
  const [links, setLinks] = useState<SourceLink[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [typeFilter, setTypeFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState('');
  const [recommendImporting, setRecommendImporting] = useState<string | null>(null);
  const [importedRecommendKeys, setImportedRecommendKeys] = useState<Set<string>>(new Set());

  async function importRecommended(key: string) {
    const item = RECOMMENDED_SOURCES.find((s) => s.key === key);
    if (!item || recommendImporting) return;
    setRecommendImporting(key);
    setMessage(
      t('configMarket.oneClickImporting', {
        name: t(`configMarket.rec_${key}_name`, { defaultValue: item.nameZh }),
      })
    );
    try {
      const command = {
        bookSource: 'import_source_from_url',
        rssSource: 'import_rss_source_from_url',
        replaceRule: 'import_replace_rules_from_url',
        httpTTS: 'import_http_tts_from_url',
      }[item.type];
      if (!command) throw new Error('unsupported type');
      await invoke<ApiResponse<unknown>>(command, { url: item.url });
      setImportedRecommendKeys((prev) => new Set(prev).add(key));
      setMessage(
        t('configMarket.oneClickImportResult', {
          name: t(`configMarket.rec_${key}_name`, { defaultValue: item.nameZh }),
          imported: 1,
          failed: 0,
        })
      );
    } catch (e) {
      setMessage(
        t('configMarket.oneClickImportFailed', {
          name: t(`configMarket.rec_${key}_name`, { defaultValue: item.nameZh }),
          error: String(e),
        })
      );
    } finally {
      setRecommendImporting(null);
    }
  }

  const supportedLinks = useMemo(
    () => links.filter((link) => SUPPORTED_TYPES.has(link.link_type)),
    [links]
  );
  const unsupportedCount = links.length - supportedLinks.length;

  const countsByType = useMemo(() => {
    const counts = new Map<string, number>();
    for (const link of links) {
      counts.set(link.link_type, (counts.get(link.link_type) || 0) + 1);
    }
    return counts;
  }, [links]);

  const visibleLinks = links.filter((link) => {
    if (typeFilter === 'all') return true;
    if (typeFilter === 'supported') return SUPPORTED_TYPES.has(link.link_type);
    if (typeFilter === 'unsupported') return !SUPPORTED_TYPES.has(link.link_type);
    return link.link_type === typeFilter;
  });

  const typeLabel = useCallback(
    (type: string) => {
      return t(`configMarket.types.${type}`, { defaultValue: type });
    },
    [t]
  );

  function displayName(link: SourceLink) {
    const fileName = link.source_url.split('/').pop() || link.source_url;
    if (link.label && !['一键导入', 'Import'].includes(link.label)) {
      return link.label;
    }
    return fileName;
  }

  function selectSupported(nextLinks = links) {
    setSelected(
      new Set(nextLinks.filter((link) => SUPPORTED_TYPES.has(link.link_type)).map(linkKey))
    );
  }

  function selectAllVisible() {
    const visibleSupported = visibleLinks.filter((link) => SUPPORTED_TYPES.has(link.link_type));
    setSelected(new Set(visibleSupported.map(linkKey)));
  }

  function selectNone() {
    setSelected(new Set());
  }

  function invertSelection() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const link of visibleLinks) {
        if (!SUPPORTED_TYPES.has(link.link_type)) continue;
        const key = linkKey(link);
        if (next.has(key)) next.delete(key);
        else next.add(key);
      }
      return next;
    });
  }

  async function loadLinks(url = siteUrl.trim()) {
    if (!url) return;
    // Browser mode (no Tauri runtime) — skip IPC.
    if (!isTauri()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setMessage(t('configMarket.loading'));
    try {
      const [linksResp, htmlResp] = await Promise.all([
        invoke<ApiResponse<SourceLink[]>>('fetch_import_links_from_url', { url }),
        invoke<ApiResponse<string>>('fetch_import_page_html', { url }),
      ]);

      if (htmlResp.success && htmlResp.data) {
        setPreviewHtml(buildPreviewHtml(htmlResp.data, url));
      } else {
        setPreviewHtml('');
      }

      if (linksResp.success && linksResp.data) {
        setLinks(linksResp.data);
        selectSupported(linksResp.data);
        setFrameUrl(url);
        setMessage(t('configMarket.found', { count: linksResp.data.length }));
      } else {
        setMessage(t('configMarket.loadFailed', { error: linksResp.error || '' }));
      }
    } catch (e) {
      setMessage(t('common.error', { message: String(e) }));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLinks(DEFAULT_MARKET_URL);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleLink(link: SourceLink) {
    if (!SUPPORTED_TYPES.has(link.link_type)) return;
    const key = linkKey(link);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const importLink = useCallback(async (link: SourceLink) => {
    if (link.link_type === 'bookSource') {
      const resp = await invoke<ApiResponse<BookSource[]>>('import_source_from_url', {
        url: link.source_url,
      });
      if (!resp.success || !resp.data) throw new Error(resp.error || link.source_url);
      return addAll(resp.data, 'add_book_source', 'source');
    }
    if (link.link_type === 'rssSource') {
      const resp = await invoke<ApiResponse<RssSource[]>>('import_rss_source_from_url', {
        url: link.source_url,
      });
      if (!resp.success || !resp.data) throw new Error(resp.error || link.source_url);
      return addAll(resp.data, 'add_rss_source', 'source');
    }
    if (link.link_type === 'replaceRule') {
      const resp = await invoke<ApiResponse<ReplaceRule[]>>('import_replace_rules_from_url', {
        url: link.source_url,
      });
      if (!resp.success || !resp.data) throw new Error(resp.error || link.source_url);
      return addAll(resp.data, 'add_replace_rule', 'rule');
    }
    if (link.link_type === 'httpTTS') {
      const resp = await invoke<ApiResponse<HttpTTS[]>>('import_http_tts_from_url', {
        url: link.source_url,
      });
      if (!resp.success || !resp.data) throw new Error(resp.error || link.source_url);
      return addAll(resp.data, 'add_http_tts', 'tts');
    }
    if (link.link_type === 'theme') {
      const resp = await invoke<ApiResponse<string>>('fetch_import_config_text', {
        url: link.source_url,
      });
      if (!resp.success || !resp.data) throw new Error(resp.error || link.source_url);
      applyThemeJson(resp.data);
      return { success: 1, failed: 0 };
    }
    if (link.link_type === 'readConfig') {
      const resp = await invoke<ApiResponse<string>>('fetch_import_config_text', {
        url: link.source_url,
      });
      if (!resp.success || !resp.data) throw new Error(resp.error || link.source_url);
      applyReadConfigJson(resp.data);
      return { success: 1, failed: 0 };
    }
    return { success: 0, failed: 0 };
  }, []);

  const importOneClickLink = useCallback(
    async (rawLink: SourceLink) => {
      const knownLink = links.find((link) => linkKey(link) === linkKey(rawLink)) || rawLink;
      const name = displayName(knownLink);

      if (!SUPPORTED_TYPES.has(knownLink.link_type)) {
        setMessage(
          t('configMarket.unsupportedImportType', { type: typeLabel(knownLink.link_type) })
        );
        return;
      }
      if (importing) return;

      setImporting(true);
      setMessage(t('configMarket.oneClickImporting', { name }));
      try {
        const result = await importLink(knownLink);
        setMessage(
          t('configMarket.oneClickImportResult', {
            name,
            imported: result.success,
            failed: result.failed,
          })
        );
      } catch (e) {
        setMessage(t('configMarket.oneClickImportFailed', { name, error: String(e) }));
      } finally {
        setImporting(false);
      }
    },
    [importLink, importing, links, t, typeLabel]
  );

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const data = event.data as { type?: unknown; href?: unknown; label?: unknown };
      if (!data || data.type !== IMPORT_MESSAGE_TYPE || typeof data.href !== 'string') return;
      const link = parseImportHref(
        data.href,
        typeof data.label === 'string' ? data.label : undefined
      );
      if (!link) return;
      importOneClickLink(link);
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [importOneClickLink]);

  async function importSelected() {
    const selectedLinks = links.filter((link) => selected.has(linkKey(link)));
    if (!selectedLinks.length) return;
    setImporting(true);
    setMessage(t('configMarket.importing', { count: selectedLinks.length }));

    let imported = 0;
    let failed = 0;
    for (const link of selectedLinks) {
      try {
        const result = await importLink(link);
        imported += result.success;
        failed += result.failed;
      } catch {
        failed++;
      }
    }

    setMessage(t('configMarket.result', { imported, failed }));
    setImporting(false);
  }

  const cardStyle: React.CSSProperties = {
    background: '#fff',
    borderRadius: 8,
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
    padding: isMobileUi ? 16 : 24,
    marginBottom: 20,
    overflow: 'hidden',
  };

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: isMobileUi ? 'stretch' : 'center',
    flexDirection: isMobileUi ? 'column' : 'row',
    gap: isMobileUi ? 8 : 12,
    padding: '12px 0',
    borderBottom: '1px solid #f8f8f8',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 14,
    color: '#555',
  };

  const inputStyle: React.CSSProperties = {
    flex: 1,
    minWidth: isMobileUi ? '100%' : 260,
    padding: '8px 10px',
    border: '1px solid #d8dee8',
    borderRadius: 8,
    fontSize: 13,
    outline: 'none',
  };

  const primaryBtnStyle: React.CSSProperties = {
    padding: '8px 14px',
    borderRadius: 8,
    border: '1px solid #d8dee8',
    background: '#fff',
    color: '#1a1a2e',
    fontWeight: 600,
    cursor: 'pointer',
  };

  return (
    <div>
      <section style={cardStyle}>
        <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 700, color: '#1a1a2e' }}>
          {t('configMarket.title')}
        </h1>
        <p style={{ margin: '0 0 14px', color: '#667085', fontSize: 14, lineHeight: 1.6 }}>
          {t('configMarket.subtitle')}
        </p>
        <div style={{ ...rowStyle, borderBottom: 0, paddingTop: 6 }}>
          <span style={{ ...labelStyle, fontWeight: 600, color: '#1a1a2e' }}>
            {t('configMarket.recommended')}
          </span>
          <span style={{ fontSize: 12, color: '#98a2b3' }}>
            {t('configMarket.recommendedHint')}
          </span>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: isMobileUi ? '1fr' : 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 10,
            marginTop: 10,
          }}
        >
          {RECOMMENDED_SOURCES.map((item) => {
            const imported = importedRecommendKeys.has(item.key);
            const busy = recommendImporting === item.key;
            const name = t(`configMarket.rec_${item.key}_name`, { defaultValue: item.nameZh });
            return (
              <div
                key={item.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '10px 12px',
                  border: '1px solid #eef0f4',
                  borderRadius: 8,
                  background: imported ? '#f7fbf9' : '#fafbfc',
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: '#1a1a2e',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {name}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: '#98a2b3',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                    title={item.url}
                  >
                    {item.url}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => importRecommended(item.key)}
                  disabled={imported || busy || recommendImporting != null}
                  style={{
                    ...primaryBtnStyle,
                    padding: '5px 12px',
                    fontSize: 12,
                    color: imported ? '#2a9d6a' : '#1a1a2e',
                    background: imported ? '#eaf6f0' : '#fff',
                    cursor: imported || busy ? 'default' : 'pointer',
                    flexShrink: 0,
                  }}
                >
                  {imported
                    ? t('configMarket.imported')
                    : busy
                      ? t('common.loading')
                      : t('configMarket.oneClickImport')}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <section style={cardStyle}>
        <h2 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 600, color: '#1a1a2e' }}>
          {t('configMarket.browseMarket')}
        </h2>
        <p style={{ margin: '0 0 12px', color: '#98a2b3', fontSize: 13 }}>
          {t('configMarket.browseHint')}
        </p>
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            marginBottom: 12,
            flexWrap: 'wrap',
          }}
        >
          <input
            value={siteUrl}
            onChange={(e) => setSiteUrl(e.target.value)}
            style={inputStyle}
            placeholder="https://"
          />
          <button
            type="button"
            onClick={() => loadLinks(siteUrl.trim())}
            disabled={loading || !siteUrl.trim()}
            style={{
              ...primaryBtnStyle,
              opacity: loading || !siteUrl.trim() ? 0.6 : 1,
            }}
          >
            {loading ? t('common.loading') : t('configMarket.refresh')}
          </button>
        </div>
        <iframe
          src={previewHtml ? undefined : frameUrl}
          srcDoc={previewHtml || undefined}
          title={t('configMarket.preview')}
          sandbox="allow-scripts allow-forms allow-popups"
          referrerPolicy="no-referrer"
          style={{
            width: '100%',
            height: isMobileUi ? 360 : 480,
            minHeight: 320,
            border: '1px solid #eef0f4',
            borderRadius: 8,
            background: '#fff',
            display: 'block',
          }}
        />
      </section>

      <div
        style={{
          display: 'flex',
          alignItems: isMobileUi ? 'stretch' : 'flex-start',
          flexDirection: isMobileUi ? 'column' : 'row',
          gap: 16,
          marginBottom: 18,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: '0 0 6px', fontSize: 24, color: '#172033' }}>
            {t('configMarket.title')}
          </h1>
          <p style={{ margin: 0, color: '#667085', fontSize: 14, lineHeight: 1.6 }}>
            {t('configMarket.subtitle')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={() => selectSupported()}
            style={{
              padding: '7px 12px',
              border: '1px solid #d7e3f4',
              borderRadius: 8,
              background: '#fff',
              color: '#365b87',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {t('configMarket.selectSupported')}
          </button>
          <button
            onClick={importSelected}
            disabled={importing || selected.size === 0}
            style={{
              padding: '7px 14px',
              border: '1px solid #9ad0a4',
              borderRadius: 8,
              background: importing || selected.size === 0 ? '#f5f5f5' : '#e7f7eb',
              color: importing || selected.size === 0 ? '#999' : '#24753a',
              fontWeight: 700,
              cursor: importing || selected.size === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {importing ? t('bookSources.importing') : t('configMarket.importSelected')}
          </button>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isMobileUi ? '1fr' : 'minmax(0, 1fr) 420px',
          gap: 16,
          alignItems: 'start',
        }}
      >
        <section style={cardStyle}>
          <div
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'center',
              padding: 12,
              borderBottom: '1px solid #eef2f7',
              flexWrap: 'wrap',
            }}
          >
            <strong style={{ color: '#172033', fontSize: 14 }}>{t('configMarket.preview')}</strong>
            <input
              value={siteUrl}
              onChange={(e) => setSiteUrl(e.target.value)}
              style={{
                flex: 1,
                minWidth: isMobileUi ? '100%' : 260,
                padding: '8px 10px',
                border: '1px solid #d8dee8',
                borderRadius: 8,
                fontSize: 13,
                outline: 'none',
              }}
            />
            <button
              onClick={() => loadLinks(siteUrl.trim())}
              disabled={loading || !siteUrl.trim()}
              style={{
                padding: '8px 12px',
                border: '1px solid #bbdefb',
                borderRadius: 8,
                background: loading ? '#f5f5f5' : '#eef6ff',
                color: loading ? '#999' : '#1769aa',
                fontWeight: 700,
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? t('common.loading') : t('configMarket.refresh')}
            </button>
          </div>
          <iframe
            src={previewHtml ? undefined : frameUrl}
            srcDoc={previewHtml || undefined}
            title={t('configMarket.preview')}
            sandbox="allow-scripts allow-forms allow-popups"
            referrerPolicy="no-referrer"
            style={{
              width: '100%',
              height: isMobileUi ? 520 : 'calc(100vh - 230px)',
              minHeight: 520,
              border: 'none',
              background: '#fff',
              display: 'block',
            }}
          />
        </section>

        <aside style={cardStyle}>
          <div style={{ padding: 14, borderBottom: '1px solid #eef2f7' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 10,
                marginBottom: 10,
              }}
            >
              <strong style={{ color: '#172033', fontSize: 14 }}>
                {t('configMarket.importList')}
              </strong>
              <span style={{ color: '#667085', fontSize: 12 }}>
                {t('configMarket.selection', {
                  selected: selected.size,
                  supported: supportedLinks.length,
                  unsupported: unsupportedCount,
                })}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[
                ['all', t('common.all')],
                ['supported', t('configMarket.supported')],
                ['unsupported', t('configMarket.unsupportedOnly')],
                ...TYPE_ORDER.filter((type) => countsByType.has(type)).map((type) => [
                  type,
                  typeLabel(type),
                ]),
              ].map(([type, label]) => (
                <button
                  key={type}
                  onClick={() => setTypeFilter(type)}
                  style={{
                    padding: '4px 9px',
                    borderRadius: 999,
                    border: '1px solid',
                    borderColor: typeFilter === type ? '#1976d2' : '#d8dee8',
                    background: typeFilter === type ? '#eef6ff' : '#fff',
                    color: typeFilter === type ? '#1769aa' : '#667085',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              <button
                onClick={selectAllVisible}
                disabled={importing}
                style={{
                  padding: '4px 9px',
                  borderRadius: 6,
                  border: '1px solid #d8dee8',
                  background: '#fff',
                  color: '#667085',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: importing ? 'not-allowed' : 'pointer',
                }}
              >
                {t('configMarket.selectAll')}
              </button>
              <button
                onClick={selectNone}
                disabled={importing}
                style={{
                  padding: '4px 9px',
                  borderRadius: 6,
                  border: '1px solid #d8dee8',
                  background: '#fff',
                  color: '#667085',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: importing ? 'not-allowed' : 'pointer',
                }}
              >
                {t('configMarket.selectNone')}
              </button>
              <button
                onClick={invertSelection}
                disabled={importing}
                style={{
                  padding: '4px 9px',
                  borderRadius: 6,
                  border: '1px solid #d8dee8',
                  background: '#fff',
                  color: '#667085',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: importing ? 'not-allowed' : 'pointer',
                }}
              >
                {t('configMarket.invertSelection')}
              </button>
            </div>
          </div>

          {message && (
            <div
              style={{
                margin: '12px 14px 0',
                padding: '8px 10px',
                borderRadius: 8,
                background: messageIsError(message) ? '#fff0f0' : '#eef6ff',
                color: messageIsError(message) ? '#b42318' : '#1769aa',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {message}
            </div>
          )}

          <div
            style={{
              maxHeight: isMobileUi ? 'none' : 'calc(100vh - 360px)',
              overflowY: 'auto',
              padding: 14,
            }}
          >
            {visibleLinks.length === 0 ? (
              <div style={{ color: '#98a2b3', fontSize: 13, textAlign: 'center', padding: 28 }}>
                {t('configMarket.noItems')}
              </div>
            ) : (
              visibleLinks.map((link) => {
                const supported = SUPPORTED_TYPES.has(link.link_type);
                const checked = selected.has(linkKey(link));
                return (
                  <div
                    key={linkKey(link)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: isMobileUi
                        ? '18px minmax(0, 1fr)'
                        : '18px minmax(0, 1fr) auto',
                      gap: 10,
                      alignItems: 'start',
                      padding: '10px 0',
                      borderBottom: '1px solid #f2f4f7',
                      opacity: supported ? 1 : 0.58,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!supported || importing}
                      onChange={() => toggleLink(link)}
                      style={{ width: 16, height: 16, marginTop: 2 }}
                    />
                    <button
                      type="button"
                      onClick={() => toggleLink(link)}
                      disabled={!supported || importing}
                      style={{
                        minWidth: 0,
                        border: 0,
                        background: 'transparent',
                        padding: 0,
                        textAlign: 'left',
                        cursor: supported ? 'pointer' : 'not-allowed',
                      }}
                    >
                      <span
                        style={{
                          display: 'flex',
                          gap: 8,
                          alignItems: 'center',
                          minWidth: 0,
                          marginBottom: 4,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            color: supported ? '#1769aa' : '#98a2b3',
                            background: supported ? '#eef6ff' : '#f2f4f7',
                            borderRadius: 4,
                            padding: '2px 6px',
                            fontWeight: 800,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {typeLabel(link.link_type)}
                        </span>
                        {!supported && (
                          <span style={{ fontSize: 11, color: '#98a2b3' }}>
                            {t('configMarket.unsupported')}
                          </span>
                        )}
                      </span>
                      <span
                        style={{
                          display: 'block',
                          color: '#172033',
                          fontSize: 13,
                          fontWeight: 700,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={link.source_url}
                      >
                        {displayName(link)}
                      </span>
                      <span
                        style={{
                          display: 'block',
                          color: '#98a2b3',
                          fontSize: 12,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          marginTop: 2,
                        }}
                        title={link.source_url}
                      >
                        {link.source_url}
                      </span>
                    </button>
                    {supported && (
                      <button
                        type="button"
                        onClick={() => importOneClickLink(link)}
                        disabled={importing}
                        style={{
                          gridColumn: isMobileUi ? '2 / 3' : undefined,
                          justifySelf: isMobileUi ? 'start' : 'end',
                          padding: '5px 10px',
                          border: '1px solid #9ad0a4',
                          borderRadius: 8,
                          background: importing ? '#f5f5f5' : '#e7f7eb',
                          color: importing ? '#999' : '#24753a',
                          fontSize: 12,
                          fontWeight: 800,
                          cursor: importing ? 'not-allowed' : 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {t('configMarket.oneClickImport')}
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
