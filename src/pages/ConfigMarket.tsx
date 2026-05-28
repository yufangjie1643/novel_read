import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import type { ApiResponse, BookSource, HttpTTS, ReplaceRule, RssSource, SourceLink } from '../types';
import { useUiMode } from '../uiMode';

const DEFAULT_MARKET_URL = 'https://legado.aoaostar.com/';
const SUPPORTED_TYPES = new Set(['bookSource', 'rssSource', 'replaceRule', 'httpTTS']);
const TYPE_ORDER = ['bookSource', 'rssSource', 'replaceRule', 'httpTTS', 'theme', 'readConfig'];

function linkKey(link: SourceLink) {
  return `${link.link_type}|${link.source_url}`;
}

export default function ConfigMarket() {
  const { t } = useTranslation();
  const { isMobileUi } = useUiMode();
  const [siteUrl, setSiteUrl] = useState(DEFAULT_MARKET_URL);
  const [frameUrl, setFrameUrl] = useState(DEFAULT_MARKET_URL);
  const [links, setLinks] = useState<SourceLink[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [typeFilter, setTypeFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState('');

  const supportedLinks = useMemo(() => links.filter((link) => SUPPORTED_TYPES.has(link.link_type)), [links]);
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

  function typeLabel(type: string) {
    return t(`configMarket.types.${type}`, { defaultValue: type });
  }

  function displayName(link: SourceLink) {
    const fileName = link.source_url.split('/').pop() || link.source_url;
    if (link.label && !['一键导入', 'Import'].includes(link.label)) {
      return link.label;
    }
    return fileName;
  }

  function selectSupported(nextLinks = links) {
    setSelected(new Set(nextLinks.filter((link) => SUPPORTED_TYPES.has(link.link_type)).map(linkKey)));
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
    setLoading(true);
    setMessage(t('configMarket.loading'));
    try {
      const resp = await invoke<ApiResponse<SourceLink[]>>('fetch_import_links_from_url', { url });
      if (resp.success && resp.data) {
        setLinks(resp.data);
        selectSupported(resp.data);
        setFrameUrl(url);
        setMessage(t('configMarket.found', { count: resp.data.length }));
      } else {
        setMessage(t('configMarket.loadFailed', { error: resp.error || '' }));
      }
    } catch (e) {
      setMessage(t('common.error', { message: String(e) }));
    }
    setLoading(false);
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

  async function importLink(link: SourceLink) {
    if (link.link_type === 'bookSource') {
      const resp = await invoke<ApiResponse<BookSource[]>>('import_source_from_url', { url: link.source_url });
      if (!resp.success || !resp.data) throw new Error(resp.error || link.source_url);
      return addAll(resp.data, 'add_book_source', 'source');
    }
    if (link.link_type === 'rssSource') {
      const resp = await invoke<ApiResponse<RssSource[]>>('import_rss_source_from_url', { url: link.source_url });
      if (!resp.success || !resp.data) throw new Error(resp.error || link.source_url);
      return addAll(resp.data, 'add_rss_source', 'source');
    }
    if (link.link_type === 'replaceRule') {
      const resp = await invoke<ApiResponse<ReplaceRule[]>>('import_replace_rules_from_url', { url: link.source_url });
      if (!resp.success || !resp.data) throw new Error(resp.error || link.source_url);
      return addAll(resp.data, 'add_replace_rule', 'rule');
    }
    if (link.link_type === 'httpTTS') {
      const resp = await invoke<ApiResponse<HttpTTS[]>>('import_http_tts_from_url', { url: link.source_url });
      if (!resp.success || !resp.data) throw new Error(resp.error || link.source_url);
      return addAll(resp.data, 'add_http_tts', 'tts');
    }
    return { success: 0, failed: 0 };
  }

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
    border: '1px solid #e8eef6',
    borderRadius: 8,
    boxShadow: '0 2px 8px rgba(18,35,62,0.06)',
    overflow: 'hidden',
  };

  return (
    <div>
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
          <h1 style={{ margin: '0 0 6px', fontSize: 24, color: '#172033' }}>{t('configMarket.title')}</h1>
          <p style={{ margin: 0, color: '#667085', fontSize: 14, lineHeight: 1.6 }}>{t('configMarket.subtitle')}</p>
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
            src={frameUrl}
            title={t('configMarket.preview')}
            sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
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
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
              <strong style={{ color: '#172033', fontSize: 14 }}>{t('configMarket.importList')}</strong>
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
                ...TYPE_ORDER.filter((type) => countsByType.has(type)).map((type) => [type, typeLabel(type)]),
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
                background: message.includes(t('common.error')) || message.includes('失败') ? '#fff0f0' : '#eef6ff',
                color: message.includes(t('common.error')) || message.includes('失败') ? '#b42318' : '#1769aa',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {message}
            </div>
          )}

          <div style={{ maxHeight: isMobileUi ? 'none' : 'calc(100vh - 360px)', overflowY: 'auto', padding: 14 }}>
            {visibleLinks.length === 0 ? (
              <div style={{ color: '#98a2b3', fontSize: 13, textAlign: 'center', padding: 28 }}>
                {t('configMarket.noItems')}
              </div>
            ) : (
              visibleLinks.map((link) => {
                const supported = SUPPORTED_TYPES.has(link.link_type);
                const checked = selected.has(linkKey(link));
                return (
                  <label
                    key={linkKey(link)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '18px minmax(0, 1fr)',
                      gap: 10,
                      alignItems: 'start',
                      padding: '10px 0',
                      borderBottom: '1px solid #f2f4f7',
                      cursor: supported ? 'pointer' : 'not-allowed',
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
                    <span style={{ minWidth: 0 }}>
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
                          <span style={{ fontSize: 11, color: '#98a2b3' }}>{t('configMarket.unsupported')}</span>
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
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
