import { useState, useCallback, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import type {
  ApiResponse,
  BookSource,
  RssSource,
  ReplaceRule,
  HttpTTS,
  SourceLink,
} from '../../types';

const DEFAULT_LEGADO_IMPORT_URL = 'https://legado.aoaostar.com/';
const SUPPORTED_IMPORT_TYPES = new Set(['bookSource', 'rssSource', 'replaceRule', 'httpTTS']);

function importLinkKey(link: SourceLink) {
  return `${link.link_type}|${link.source_url}`;
}

export function useBulkImport() {
  const { t } = useTranslation();
  const [bulkImportUrl, setBulkImportUrl] = useState(DEFAULT_LEGADO_IMPORT_URL);
  const [bulkLinks, setBulkLinks] = useState<SourceLink[]>([]);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<{ text: string; kind: 'idle' | 'error' | 'info' }>({
    text: '',
    kind: 'idle',
  });

  const importTypeLabel = useCallback(
    (type: string) => t(`settings.importType.${type}`, { defaultValue: type }),
    [t],
  );

  const isSupportedImportLink = useCallback(
    (link: SourceLink) => SUPPORTED_IMPORT_TYPES.has(link.link_type),
    [],
  );

  const setSelectedSupportedLinks = useCallback(
    (links: SourceLink[]) => {
      setBulkSelected(new Set(links.filter(isSupportedImportLink).map(importLinkKey)));
    },
    [isSupportedImportLink],
  );

  const addAll = useCallback(
    async <T,>(
      items: T[],
      command: string,
      argName: string,
    ): Promise<{ success: number; failed: number }> => {
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
    },
    [],
  );

  const toggleBulkLink = useCallback((link: SourceLink) => {
    const key = importLinkKey(link);
    setBulkSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const importBulkLink = useCallback(
    async (link: SourceLink): Promise<{ success: number; failed: number }> => {
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

      return { success: 0, failed: 0 };
    },
    [addAll],
  );

  const loadBulkImportLinks = useCallback(async () => {
    if (bulkLoading) return;
    if (!bulkImportUrl.trim()) return;
    setBulkLoading(true);
    setBulkMessage({ text: t('settings.bulkImportLoading'), kind: 'info' });
    try {
      const resp = await invoke<ApiResponse<SourceLink[]>>('fetch_import_links_from_url', {
        url: bulkImportUrl.trim(),
      });
      if (resp.success && resp.data) {
        setBulkLinks(resp.data);
        setSelectedSupportedLinks(resp.data);
        setBulkMessage({
          text: t('settings.bulkImportFound', { count: resp.data.length }),
          kind: 'info',
        });
      } else {
        setBulkMessage({
          text: t('settings.bulkImportLoadFailed', { error: resp.error || '' }),
          kind: 'error',
        });
      }
    } catch (e) {
      setBulkMessage({ text: t('common.error', { message: String(e) }), kind: 'error' });
    } finally {
      setBulkLoading(false);
    }
  }, [bulkImportUrl, bulkLoading, t, setSelectedSupportedLinks]);

  const importSelectedBulkLinks = useCallback(async () => {
    if (bulkImporting) return;
    const selectedLinks = bulkLinks.filter((link) => bulkSelected.has(importLinkKey(link)));
    if (selectedLinks.length === 0) return;

    setBulkImporting(true);
    setBulkMessage({
      text: t('settings.bulkImportInstalling', { count: selectedLinks.length }),
      kind: 'info',
    });
    let imported = 0;
    let failed = 0;
    let unsupported = 0;

    try {
      for (const link of selectedLinks) {
        if (!isSupportedImportLink(link)) {
          unsupported++;
          continue;
        }
        try {
          const result = await importBulkLink(link);
          imported += result.success;
          failed += result.failed;
        } catch {
          failed++;
        }
      }

      setBulkMessage({
        text: t('settings.bulkImportResult', { imported, failed, unsupported }),
        kind: failed > 0 ? 'error' : 'info',
      });
    } finally {
      setBulkImporting(false);
    }
  }, [bulkLinks, bulkSelected, bulkImporting, t, isSupportedImportLink, importBulkLink]);

  const selectedBulkCount = useMemo(() => bulkSelected.size, [bulkSelected]);
  const supportedBulkCount = useMemo(
    () => bulkLinks.filter(isSupportedImportLink).length,
    [bulkLinks, isSupportedImportLink],
  );

  return {
    bulkImportUrl,
    setBulkImportUrl,
    bulkLinks,
    bulkSelected,
    setBulkSelected,
    bulkLoading,
    bulkImporting,
    bulkMessage,
    setBulkMessage,
    selectedBulkCount,
    supportedBulkCount,
    importTypeLabel,
    isSupportedImportLink,
    importLinkKey,
    setSelectedSupportedLinks,
    loadBulkImportLinks,
    toggleBulkLink,
    importSelectedBulkLinks,
  };
}
