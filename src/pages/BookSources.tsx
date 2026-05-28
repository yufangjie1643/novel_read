import { useState, useEffect, useCallback, useDeferredValue } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import type { ApiResponse, BookSource, SearchBook } from '../types';

const SOURCE_RENDER_BATCH_SIZE = 80;
const SOURCE_RENDER_INCREMENT = 120;

export default function BookSources() {
  const { t } = useTranslation();
  const [sources, setSources] = useState<BookSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [visibleCount, setVisibleCount] = useState(SOURCE_RENDER_BATCH_SIZE);
  const deferredFilter = useDeferredValue(filter);
  const [checkingSources, setCheckingSources] = useState(false);

  // Batch mode
  const [batchMode, setBatchMode] = useState(false);
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());

  const loadSources = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await invoke<ApiResponse<BookSource[]>>('get_book_sources');
      if (resp.success && resp.data) {
        setSources(resp.data);
      }
    } catch (e) {
      setMessage(t('common.error', { message: String(e) }));
    }
    setLoading(false);
  }, [t]);

  useEffect(() => {
    loadSources();
  }, [loadSources]);

  // Clear selection when filter changes or batch mode exits
  useEffect(() => {
    setSelectedUrls(new Set());
  }, [filter, statusFilter]);

  useEffect(() => {
    setVisibleCount(SOURCE_RENDER_BATCH_SIZE);
  }, [deferredFilter, statusFilter, sources.length]);

  function toggleBatchMode() {
    setBatchMode((v) => !v);
    setSelectedUrls(new Set());
  }

  function toggleSelect(url: string) {
    setSelectedUrls((prev) => {
      const next = new Set(prev);
      if (next.has(url)) {
        next.delete(url);
      } else {
        next.add(url);
      }
      return next;
    });
  }

  function selectAll() {
    setSelectedUrls(new Set(filtered.map((s) => s.book_source_url)));
  }

  function deselectAll() {
    setSelectedUrls(new Set());
  }

  function invertSelection() {
    setSelectedUrls((prev) => {
      const next = new Set<string>();
      for (const s of filtered) {
        if (!prev.has(s.book_source_url)) {
          next.add(s.book_source_url);
        }
      }
      return next;
    });
  }

  function checkSelectedInterval() {
    if (selectedUrls.size < 2) return;
    const selectedPositions = filtered
      .map((source, index) => (selectedUrls.has(source.book_source_url) ? index : -1))
      .filter((index) => index >= 0);
    if (selectedPositions.length < 2) return;
    const min = Math.min(...selectedPositions);
    const max = Math.max(...selectedPositions);
    setSelectedUrls((prev) => {
      const next = new Set(prev);
      filtered.slice(min, max + 1).forEach((source) => next.add(source.book_source_url));
      return next;
    });
  }

  function selectedSources() {
    const selected = new Set(selectedUrls);
    return sources.filter((source) => selected.has(source.book_source_url));
  }

  function splitGroups(group?: string) {
    return (group || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function safeJsonParse(value?: string) {
    if (!value) return undefined;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  async function updateSelectedSources(
    action: string,
    mapSource: (source: BookSource, index: number) => BookSource | null
  ) {
    const selected = selectedSources();
    if (selected.length === 0) return;
    let success = 0;
    let failed = 0;
    for (let index = 0; index < selected.length; index++) {
      const updated = mapSource(selected[index], index);
      if (!updated) {
        success++;
        continue;
      }
      try {
        const resp = await invoke<ApiResponse<null>>('update_book_source', { source: updated });
        if (resp.success) success++;
        else failed++;
      } catch {
        failed++;
      }
    }
    setMessage(t('bookSources.batchResult', { action, success, failed }));
    await loadSources();
  }

  async function batchUpdateExplore(enabled: boolean) {
    await updateSelectedSources(
      enabled ? t('bookSources.batchEnableExplore') : t('bookSources.batchDisableExplore'),
      (source) => (source.enabled_explore === enabled ? null : { ...source, enabled_explore: enabled })
    );
  }

  async function batchMoveSelection(toTop: boolean) {
    const selected = selectedSources();
    if (selected.length === 0) return;
    const orders = sources.map((source) => source.custom_order ?? 0);
    const base = toTop ? Math.min(...orders, 0) - 1 : Math.max(...orders, 0) + 1;
    const sorted = [...selected].sort((a, b) => (a.custom_order ?? 0) - (b.custom_order ?? 0));
    await updateSelectedSources(toTop ? t('bookSources.selectionToTop') : t('bookSources.selectionToBottom'), (source) => {
      const index = sorted.findIndex((item) => item.book_source_url === source.book_source_url);
      return {
        ...source,
        custom_order: toTop ? base - index : base + index,
      };
    });
  }

  async function batchAddGroup() {
    const group = prompt(t('bookSources.groupNamePrompt'))?.trim();
    if (!group) return;
    await updateSelectedSources(t('bookSources.addGroup'), (source) => {
      const groups = new Set(splitGroups(source.book_source_group));
      if (groups.has(group)) return null;
      groups.add(group);
      return { ...source, book_source_group: Array.from(groups).join(',') };
    });
  }

  async function batchRemoveGroup() {
    const group = prompt(t('bookSources.groupNamePrompt'))?.trim();
    if (!group) return;
    await updateSelectedSources(t('bookSources.removeGroup'), (source) => {
      const groups = splitGroups(source.book_source_group).filter((item) => item !== group);
      if (groups.join(',') === (source.book_source_group || '')) return null;
      return { ...source, book_source_group: groups.join(',') || undefined };
    });
  }

  async function batchCheckSources() {
    const key = prompt(t('bookSources.checkKeywordPrompt'), '我的')?.trim();
    if (!key) return;
    const selected = selectedSources();
    if (selected.length === 0) return;
    setCheckingSources(true);
    let success = 0;
    let failed = 0;
    for (let index = 0; index < selected.length; index++) {
      const source = selected[index];
      setMessage(
        t('bookSources.checkSourceProgress', {
          current: index + 1,
          total: selected.length,
          name: source.book_source_name || source.book_source_url,
        })
      );
      try {
        const resp = await invoke<ApiResponse<SearchBook[]>>('search_books', {
          source,
          key,
          page: 1,
        });
        if (resp.success) success++;
        else failed++;
      } catch {
        failed++;
      }
    }
    setCheckingSources(false);
    setMessage(t('bookSources.checkSourceResult', { success, failed }));
  }

  async function batchUpdateEnabled(enabled: boolean) {
    if (selectedUrls.size === 0) return;
    let success = 0;
    let failed = 0;
    for (const url of selectedUrls) {
      const source = sources.find((s) => s.book_source_url === url);
      if (!source || source.enabled === enabled) {
        if (source) success++;
        continue;
      }
      const updated = { ...source, enabled };
      try {
        const resp = await invoke<ApiResponse<null>>('update_book_source', { source: updated });
        if (resp.success) success++;
        else failed++;
      } catch {
        failed++;
      }
    }
    setMessage(
      t('bookSources.batchResult', {
        action: enabled ? t('bookSources.batchEnable') : t('bookSources.batchDisable'),
        success,
        failed,
      })
    );
    await loadSources();
  }

  async function batchDelete() {
    if (selectedUrls.size === 0) return;
    if (!confirm(t('bookSources.batchDeleteConfirm', { count: selectedUrls.size }))) return;
    let success = 0;
    let failed = 0;
    for (const url of selectedUrls) {
      try {
        const resp = await invoke<ApiResponse<null>>('delete_book_source', { url });
        if (resp.success) success++;
        else failed++;
      } catch {
        failed++;
      }
    }
    setMessage(
      t('bookSources.batchResult', {
        action: t('bookSources.batchDelete'),
        success,
        failed,
      })
    );
    setSelectedUrls(new Set());
    await loadSources();
  }

  async function toggleEnabled(source: BookSource) {
    const updated = { ...source, enabled: !source.enabled };
    try {
      const resp = await invoke<ApiResponse<null>>('update_book_source', { source: updated });
      if (resp.success) {
        setSources((prev) =>
          prev.map((s) => (s.book_source_url === source.book_source_url ? updated : s))
        );
      } else {
        setMessage(t('bookSources.updateFailed', { error: resp.error || '' }));
      }
    } catch (e) {
      setMessage(t('common.error', { message: String(e) }));
    }
  }

  async function toggleExplore(source: BookSource) {
    const updated = { ...source, enabled_explore: !source.enabled_explore };
    try {
      const resp = await invoke<ApiResponse<null>>('update_book_source', { source: updated });
      if (resp.success) {
        setSources((prev) =>
          prev.map((s) => (s.book_source_url === source.book_source_url ? updated : s))
        );
      } else {
        setMessage(t('bookSources.updateFailed', { error: resp.error || '' }));
      }
    } catch (e) {
      setMessage(t('common.error', { message: String(e) }));
    }
  }

  async function deleteSource(source: BookSource) {
    if (!confirm(t('bookSources.deleteConfirm', { name: source.book_source_name }))) return;
    try {
      const resp = await invoke<ApiResponse<null>>('delete_book_source', {
        url: source.book_source_url,
      });
      if (resp.success) {
        setSources((prev) => prev.filter((s) => s.book_source_url !== source.book_source_url));
      } else {
        setMessage(t('bookSources.deleteFailed', { error: resp.error || '' }));
      }
    } catch (e) {
      setMessage(t('common.error', { message: String(e) }));
    }
  }

  async function importFromUrl() {
    if (!importUrl.trim()) return;
    setImporting(true);
    setMessage(t('bookSources.importing'));
    try {
      const resp = await invoke<ApiResponse<BookSource[]>>('import_source_from_url', {
        url: importUrl.trim(),
      });
      if (resp.success && resp.data) {
        for (const source of resp.data) {
          await invoke('add_book_source', { source });
        }
        setMessage(t('bookSources.importSuccess', { count: resp.data.length }));
        setImportUrl('');
        await loadSources();
      } else {
        setMessage(t('bookSources.importFailed', { error: resp.error || '' }));
      }
    } catch (e) {
      setMessage(t('common.error', { message: String(e) }));
    }
    setImporting(false);
  }

  async function importFromFile(file: File) {
    setImporting(true);
    setMessage(t('bookSources.importing'));
    try {
      const text = await file.text();
      const resp = await invoke<ApiResponse<BookSource[]>>('import_source_from_json', {
        json: text,
      });
      if (resp.success && resp.data) {
        for (const source of resp.data) {
          await invoke('add_book_source', { source });
        }
        setMessage(t('bookSources.importSuccess', { count: resp.data.length }));
        await loadSources();
      } else {
        setMessage(t('bookSources.importFailed', { error: resp.error || '' }));
      }
    } catch (e) {
      setMessage(t('common.error', { message: String(e) }));
    }
    setImporting(false);
  }

  function exportSources(targetSources = sources) {
    const camelCaseSources = targetSources.map((s) => {
      const obj: Record<string, unknown> = {};
      if (s.book_source_url) obj.bookSourceUrl = s.book_source_url;
      if (s.book_source_name) obj.bookSourceName = s.book_source_name;
      if (s.book_source_group) obj.bookSourceGroup = s.book_source_group;
      if (s.book_source_type !== undefined) obj.bookSourceType = s.book_source_type;
      if (s.book_url_pattern) obj.bookUrlPattern = s.book_url_pattern;
      if (s.custom_order !== undefined) obj.customOrder = s.custom_order;
      if (s.enabled !== undefined) obj.enabled = s.enabled;
      if (s.enabled_explore !== undefined) obj.enabledExplore = s.enabled_explore;
      if (s.js_lib) obj.jsLib = s.js_lib;
      if (s.enabled_cookie_jar !== undefined) obj.enabledCookieJar = s.enabled_cookie_jar;
      if (s.concurrent_rate) obj.concurrentRate = s.concurrent_rate;
      if (s.header) obj.header = s.header;
      if (s.login_url) obj.loginUrl = s.login_url;
      if (s.login_ui) obj.loginUi = s.login_ui;
      if (s.login_check_js) obj.loginCheckJs = s.login_check_js;
      if (s.cover_decode_js) obj.coverDecodeJs = s.cover_decode_js;
      if (s.book_source_comment) obj.bookSourceComment = s.book_source_comment;
      if (s.variable_comment) obj.variableComment = s.variable_comment;
      if (s.last_update_time !== undefined) obj.lastUpdateTime = s.last_update_time;
      if (s.respond_time !== undefined) obj.respondTime = s.respond_time;
      if (s.weight !== undefined) obj.weight = s.weight;
      if (s.explore_url) obj.exploreUrl = s.explore_url;
      if (s.explore_screen) obj.exploreScreen = s.explore_screen;
      if (s.rule_explore) obj.ruleExplore = safeJsonParse(s.rule_explore);
      if (s.search_url) obj.searchUrl = s.search_url;
      if (s.rule_search) obj.ruleSearch = safeJsonParse(s.rule_search);
      if (s.rule_book_info) obj.ruleBookInfo = safeJsonParse(s.rule_book_info);
      if (s.rule_toc) obj.ruleToc = safeJsonParse(s.rule_toc);
      if (s.rule_content) obj.ruleContent = safeJsonParse(s.rule_content);
      if (s.rule_review) obj.ruleReview = safeJsonParse(s.rule_review);
      return obj;
    });

    const json = JSON.stringify(camelCaseSources, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `book_sources_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setMessage(t('bookSources.exportSuccess', { count: targetSources.length }));
  }

  function exportSelectedSources() {
    const selected = selectedSources();
    if (selected.length === 0) return;
    exportSources(selected);
  }

  const keyword = deferredFilter.trim().toLowerCase();
  const filtered = sources.filter((s) => {
    if (!s) return false;
    if (statusFilter === 'enabled' && !s.enabled) return false;
    if (statusFilter === 'disabled' && s.enabled) return false;
    if (!keyword) return true;
    const name = (s.book_source_name || '').toLowerCase();
    const url = (s.book_source_url || '').toLowerCase();
    const group = (s.book_source_group || '').toLowerCase();
    return name.includes(keyword) || url.includes(keyword) || group.includes(keyword);
  });

  const visibleSources = filtered.slice(0, Math.min(visibleCount, filtered.length));
  const hasMoreSources = visibleSources.length < filtered.length;

  const enabledCount = sources.filter((s) => s?.enabled).length;

  const selectedCount = selectedUrls.size;

  return (
    <div>
      <h1 style={{ margin: '0 0 20px', fontSize: 24, fontWeight: 700, color: '#1a1a2e' }}>
        {t('bookSources.title')}
      </h1>

      {/* Stats */}
      <div
        style={{
          display: 'flex',
          gap: 16,
          marginBottom: 20,
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            background: '#fff',
            borderRadius: 12,
            padding: '16px 20px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
            flex: 1,
            minWidth: 140,
          }}
        >
          <div style={{ fontSize: 24, fontWeight: 700, color: '#1976d2' }}>{sources.length}</div>
          <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>{t('bookSources.total')}</div>
        </div>
        <div
          style={{
            background: '#fff',
            borderRadius: 12,
            padding: '16px 20px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
            flex: 1,
            minWidth: 140,
          }}
        >
          <div style={{ fontSize: 24, fontWeight: 700, color: '#4caf50' }}>{enabledCount}</div>
          <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>
            {t('bookSources.enabled')}
          </div>
        </div>
        <div
          style={{
            background: '#fff',
            borderRadius: 12,
            padding: '16px 20px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
            flex: 1,
            minWidth: 140,
          }}
        >
          <div style={{ fontSize: 24, fontWeight: 700, color: '#f44336' }}>
            {sources.length - enabledCount}
          </div>
          <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>
            {t('bookSources.disabled')}
          </div>
        </div>
      </div>

      {/* Import + Export + Batch toggle */}
      <div
        style={{
          background: '#fff',
          borderRadius: 12,
          padding: 16,
          marginBottom: 20,
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
        }}
      >
        <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder={t('bookSources.importUrlPlaceholder')}
            value={importUrl}
            onChange={(e) => setImportUrl(e.target.value)}
            style={{
              flex: 1,
              minWidth: 200,
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid #e0e0e0',
              fontSize: 14,
              outline: 'none',
              fontFamily: 'inherit',
            }}
          />
          <button
            onClick={importFromUrl}
            disabled={importing || !importUrl.trim()}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: 'none',
              background: importing ? '#f5f5f5' : '#1976d2',
              color: importing ? '#999' : '#fff',
              fontSize: 14,
              fontWeight: 600,
              cursor: importing ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {importing ? t('bookSources.importing') : t('bookSources.import')}
          </button>
          <button
            onClick={() => exportSources()}
            disabled={sources.length === 0}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: '1px solid #e0e0e0',
              background: sources.length === 0 ? '#f5f5f5' : '#fff',
              color: sources.length === 0 ? '#999' : '#555',
              fontSize: 14,
              fontWeight: 600,
              cursor: sources.length === 0 ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {t('bookSources.export')}
          </button>
          <input
            type="file"
            accept=".json"
            id="source-file-input"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importFromFile(file);
              (e.target as HTMLInputElement).value = '';
            }}
          />
          <button
            onClick={() => document.getElementById('source-file-input')?.click()}
            disabled={importing}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: '1px solid #e0e0e0',
              background: importing ? '#f5f5f5' : '#fff',
              color: importing ? '#999' : '#555',
              fontSize: 14,
              fontWeight: 600,
              cursor: importing ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {t('bookSources.importFile')}
          </button>
          <button
            onClick={toggleBatchMode}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: batchMode ? '1px solid #1976d2' : '1px solid #e0e0e0',
              background: batchMode ? '#e3f2fd' : '#fff',
              color: batchMode ? '#1565c0' : '#555',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {batchMode ? t('bookSources.exitBatch') : t('bookSources.batchMode')}
          </button>
        </div>

        {/* Batch selection controls */}
        {batchMode && (
          <div
            style={{
              display: 'flex',
              gap: 8,
              marginBottom: 12,
              flexWrap: 'wrap',
              alignItems: 'center',
              padding: '8px 12px',
              background: '#f5f7fa',
              borderRadius: 8,
            }}
          >
            <button
              onClick={selectAll}
              style={{
                padding: '4px 12px',
                borderRadius: 6,
                border: '1px solid #e0e0e0',
                background: '#fff',
                color: '#555',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              {t('bookSources.selectAll')}
            </button>
            <button
              onClick={deselectAll}
              style={{
                padding: '4px 12px',
                borderRadius: 6,
                border: '1px solid #e0e0e0',
                background: '#fff',
                color: '#555',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              {t('bookSources.deselectAll')}
            </button>
            <button
              onClick={invertSelection}
              style={{
                padding: '4px 12px',
                borderRadius: 6,
                border: '1px solid #e0e0e0',
                background: '#fff',
                color: '#555',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              {t('bookSources.invertSelection')}
            </button>
            <button
              onClick={checkSelectedInterval}
              disabled={selectedCount < 2}
              style={{
                padding: '4px 12px',
                borderRadius: 6,
                border: '1px solid #e0e0e0',
                background: selectedCount < 2 ? '#f5f5f5' : '#fff',
                color: selectedCount < 2 ? '#aaa' : '#555',
                fontSize: 13,
                cursor: selectedCount < 2 ? 'not-allowed' : 'pointer',
              }}
            >
              {t('bookSources.checkSelectedInterval')}
            </button>
            <span style={{ fontSize: 13, color: '#666', marginLeft: 'auto' }}>
              {t('bookSources.selectedCount', { count: selectedCount })}
            </span>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          {(['all', 'enabled', 'disabled'] as const).map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              style={{
                padding: '5px 14px',
                borderRadius: 16,
                border: '1px solid',
                borderColor: statusFilter === status ? '#1976d2' : '#e0e0e0',
                background: statusFilter === status ? '#e3f2fd' : '#fff',
                color: statusFilter === status ? '#1565c0' : '#666',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              {status === 'all' && t('bookSources.all')}
              {status === 'enabled' && t('bookSources.enabled')}
              {status === 'disabled' && t('bookSources.disabled')}
            </button>
          ))}
        </div>
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            placeholder={t('bookSources.filterPlaceholder')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 36px 8px 12px',
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
                right: 8,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: '#999',
                fontSize: 16,
                padding: '2px 6px',
                lineHeight: 1,
              }}
            >
              ×
            </button>
          )}
        </div>
      </div>

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

      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#888' }}>
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
          <p>{t('common.loading')}</p>
        </div>
      ) : filtered.length === 0 ? (
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
          {sources.length === 0 ? t('bookSources.noSources') : t('bookSources.noFilterResults')}
        </div>
      ) : (
        <div
          style={{
            background: '#fff',
            borderRadius: 12,
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
            overflow: 'hidden',
          }}
        >
          {visibleSources.map((source) => {
            const isSelected = selectedUrls.has(source.book_source_url);
            return (
              <div
                key={source.book_source_url}
                className={isSelected ? 'book-source-row selected' : 'book-source-row'}
                onClick={() => {
                  if (batchMode) toggleSelect(source.book_source_url);
                }}
                style={{
                  padding: '14px 16px',
                  borderBottom: '1px solid #f8f8f8',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  background: isSelected ? '#e3f2fd' : '#fff',
                }}
              >
                {/* Batch checkbox */}
                {batchMode && (
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(source.book_source_url)}
                    onClick={(event) => event.stopPropagation()}
                    style={{ width: 18, height: 18, cursor: 'pointer', flexShrink: 0 }}
                  />
                )}

                {/* Enabled toggle */}
                {!batchMode && (
                  <button
                    onClick={() => toggleEnabled(source)}
                    title={source.enabled ? t('bookSources.disable') : t('bookSources.enable')}
                    style={{
                      width: 36,
                      height: 20,
                      borderRadius: 10,
                      border: 'none',
                      background: source.enabled ? '#4caf50' : '#ccc',
                      cursor: 'pointer',
                      position: 'relative',
                      flexShrink: 0,
                      padding: 0,
                      transition: 'background 0.2s',
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute',
                        top: 2,
                        left: source.enabled ? 18 : 2,
                        width: 16,
                        height: 16,
                        borderRadius: '50%',
                        background: '#fff',
                        transition: 'left 0.2s',
                        display: 'block',
                      }}
                    />
                  </button>
                )}

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: 14,
                      color: source.enabled ? '#1a1a2e' : '#aaa',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={source.book_source_name}
                  >
                    {source.book_source_name || t('bookSources.unnamed')}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: '#aaa',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={source.book_source_url}
                  >
                    {source.book_source_url}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                    {source.book_source_group && (
                      <span
                        style={{
                          fontSize: 11,
                          color: '#888',
                          background: '#f5f5f5',
                          padding: '2px 8px',
                          borderRadius: 4,
                        }}
                      >
                        {source.book_source_group}
                      </span>
                    )}
                    {source.search_url && (
                      <span
                        style={{
                          fontSize: 11,
                          color: '#1976d2',
                          background: '#eef4fd',
                          padding: '2px 8px',
                          borderRadius: 4,
                        }}
                      >
                        {t('home.hasSearch')}
                      </span>
                    )}
                    {source.explore_url && (
                      <span
                        style={{
                          fontSize: 11,
                          color: '#4caf50',
                          background: '#e8f5e9',
                          padding: '2px 8px',
                          borderRadius: 4,
                        }}
                      >
                        {t('bookSources.hasExplore')}
                      </span>
                    )}
                  </div>
                </div>

                {/* Batch mode: show enabled badge instead of toggle */}
                {batchMode && (
                  <span
                    style={{
                      fontSize: 11,
                      padding: '2px 8px',
                      borderRadius: 4,
                      background: source.enabled ? '#e8f5e9' : '#f5f5f5',
                      color: source.enabled ? '#2e7d32' : '#999',
                      fontWeight: 500,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {source.enabled ? t('common.enabled') : t('common.disabled')}
                  </span>
                )}

                {/* Explore toggle */}
                {!batchMode && (
                  <button
                    onClick={() => toggleExplore(source)}
                    title={t('bookSources.explore')}
                    style={{
                      padding: '4px 10px',
                      fontSize: 12,
                      borderRadius: 6,
                      border: '1px solid',
                      borderColor: source.enabled_explore ? '#a5d6a7' : '#e0e0e0',
                      background: source.enabled_explore ? '#e8f5e9' : '#fff',
                      color: source.enabled_explore ? '#2e7d32' : '#aaa',
                      cursor: 'pointer',
                      fontWeight: 500,
                      flexShrink: 0,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {t('bookSources.explore')}
                  </button>
                )}

                {/* Delete */}
                {!batchMode && (
                  <button
                    onClick={() => deleteSource(source)}
                    style={{
                      padding: '4px 10px',
                      fontSize: 12,
                      color: '#f44336',
                      border: '1px solid #ffcdd2',
                      background: '#fff0f0',
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontWeight: 500,
                      flexShrink: 0,
                    }}
                  >
                    {t('common.delete')}
                  </button>
                )}
              </div>
            );
          })}
          {hasMoreSources && (
            <div
              style={{
                padding: 16,
                display: 'grid',
                justifyItems: 'center',
                gap: 8,
                background: '#fff',
              }}
            >
              <div style={{ fontSize: 12, color: '#888' }}>
                {t('bookSources.renderedCount', {
                  shown: visibleSources.length,
                  total: filtered.length,
                  defaultValue: `已显示 ${visibleSources.length} / ${filtered.length}`,
                })}
              </div>
              <button
                type="button"
                onClick={() =>
                  setVisibleCount((count) =>
                    Math.min(count + SOURCE_RENDER_INCREMENT, filtered.length)
                  )
                }
                style={{
                  padding: '8px 18px',
                  borderRadius: 8,
                  border: '1px solid #bbdefb',
                  background: '#eef4fd',
                  color: '#1976d2',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {t('bookSources.loadMore', { defaultValue: '加载更多' })}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Floating batch action bar */}
      {batchMode && selectedCount > 0 && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#fff',
            borderRadius: 12,
            boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
            padding: '12px 20px',
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            zIndex: 100,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 600, color: '#1a1a2e', whiteSpace: 'nowrap' }}>
            {t('bookSources.selectedCount', { count: selectedCount })}
          </span>
          <div style={{ width: 1, height: 20, background: '#e0e0e0' }} />
          <button
            onClick={() => batchUpdateEnabled(true)}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid #a5d6a7',
              background: '#e8f5e9',
              color: '#2e7d32',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {t('bookSources.batchEnable')}
          </button>
          <button
            onClick={() => batchUpdateEnabled(false)}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid #e0e0e0',
              background: '#f5f5f5',
              color: '#666',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {t('bookSources.batchDisable')}
          </button>
          <button
            onClick={() => batchUpdateExplore(true)}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid #bbdefb',
              background: '#eef4fd',
              color: '#1565c0',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {t('bookSources.batchEnableExplore')}
          </button>
          <button
            onClick={() => batchUpdateExplore(false)}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid #e0e0e0',
              background: '#fff',
              color: '#666',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {t('bookSources.batchDisableExplore')}
          </button>
          <button
            onClick={() => batchMoveSelection(true)}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid #e0e0e0',
              background: '#fff',
              color: '#555',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {t('bookSources.selectionToTop')}
          </button>
          <button
            onClick={() => batchMoveSelection(false)}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid #e0e0e0',
              background: '#fff',
              color: '#555',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {t('bookSources.selectionToBottom')}
          </button>
          <button
            onClick={batchAddGroup}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid #d7ccc8',
              background: '#fffaf7',
              color: '#6d4c41',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {t('bookSources.addGroup')}
          </button>
          <button
            onClick={batchRemoveGroup}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid #e0e0e0',
              background: '#fff',
              color: '#666',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {t('bookSources.removeGroup')}
          </button>
          <button
            onClick={exportSelectedSources}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid #c8e6c9',
              background: '#f4fbf4',
              color: '#2e7d32',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {t('bookSources.exportSelected')}
          </button>
          <button
            onClick={batchCheckSources}
            disabled={checkingSources}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid #bbdefb',
              background: checkingSources ? '#f5f5f5' : '#eef4fd',
              color: checkingSources ? '#999' : '#1565c0',
              fontSize: 13,
              fontWeight: 600,
              cursor: checkingSources ? 'not-allowed' : 'pointer',
            }}
          >
            {checkingSources ? t('bookSources.checkingSource') : t('bookSources.checkSelectedSource')}
          </button>
          <button
            onClick={batchDelete}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid #ffcdd2',
              background: '#fff0f0',
              color: '#f44336',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {t('bookSources.batchDelete')}
          </button>
        </div>
      )}
    </div>
  );
}
