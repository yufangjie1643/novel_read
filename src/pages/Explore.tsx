import { useState, useEffect, useCallback, useRef, useDeferredValue, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type {
  ApiResponse,
  BookSource,
  BookSourceGroup as Group,
  BookSourceSummary,
  ExploreItem,
  ExploreItemsPage,
  ExploreKind,
} from '../types';
import { BookSourceGroup, type KindsState } from '../components/explore/BookSourceGroup';
import { BookSourceMenu, type BookSourceAction } from '../components/explore/BookSourceMenu';

const PAGE_LIMIT = 300;

export default function Explore() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [groups, setGroups] = useState<Group[]>([]);
  const [searchKey, setSearchKey] = useState('');
  const deferredFilter = useDeferredValue(searchKey);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, true>>({});
  const [kindsBySource, setKindsBySource] = useState<Record<string, KindsState>>({});
  const [menuState, setMenuState] = useState<{ group: Group; anchorEl: HTMLElement } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Group | null>(null);
  const mountedRef = useRef(false);
  const kindRequestIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Initial load: pull a one-shot full list and group by source_url
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setSourcesLoading(true);
      setError(null);
      try {
        const [itemsResp, summariesResp] = await Promise.all([
          invoke<ApiResponse<ExploreItemsPage>>('get_explore_items', {
            offset: 0,
            limit: PAGE_LIMIT,
            filter: null,
          }),
          invoke<ApiResponse<BookSourceSummary[]>>('get_book_source_summaries'),
        ]);
        if (cancelled) return;
        if (itemsResp.success && itemsResp.data) {
          const summaryMap = new Map<string, BookSourceSummary>();
          if (summariesResp.success && summariesResp.data) {
            for (const s of summariesResp.data) summaryMap.set(s.bookSourceUrl, s);
          }
          const grouped = groupItems(itemsResp.data.items, summaryMap);
          setGroups(grouped);
          // Auto-expand the first group
          if (grouped.length > 0) {
            setExpanded({ [grouped[0].sourceUrl]: true });
          }
        } else {
          setError(itemsResp.error || t('explore.error.load'));
        }
      } catch (e) {
        if (!cancelled) setError(t('common.error', { message: String(e) }));
      } finally {
        if (!cancelled) setSourcesLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadKinds = useCallback(
    async (sourceUrl: string) => {
      setKindsBySource((prev) => ({ ...prev, [sourceUrl]: { kind: 'loading' } }));
      const requestId = ++kindRequestIdRef.current;
      try {
        const resp = await invoke<ApiResponse<ExploreKind[]>>('get_explore_kinds', {
          sourceUrl,
        });
        if (!mountedRef.current || requestId !== kindRequestIdRef.current) return;
        if (resp.success && resp.data) {
          setKindsBySource((prev) => ({ ...prev, [sourceUrl]: { kind: 'ok', kinds: resp.data! } }));
        } else {
          setKindsBySource((prev) => ({
            ...prev,
            [sourceUrl]: { kind: 'error', message: resp.error || t('explore.error.explore') },
          }));
        }
      } catch (e) {
        if (!mountedRef.current || requestId !== kindRequestIdRef.current) return;
        setKindsBySource((prev) => ({
          ...prev,
          [sourceUrl]: { kind: 'error', message: String(e) },
        }));
      }
    },
    [t]
  );

  // When a group is expanded and its kinds haven't been loaded yet, fetch them
  useEffect(() => {
    for (const sourceUrl of Object.keys(expanded)) {
      if (!kindsBySource[sourceUrl]) {
        void loadKinds(sourceUrl);
      }
    }
  }, [expanded, kindsBySource, loadKinds]);

  function toggle(sourceUrl: string) {
    setExpanded((prev) => {
      const next = { ...prev };
      if (next[sourceUrl]) {
        delete next[sourceUrl];
      } else {
        next[sourceUrl] = true;
      }
      return next;
    });
  }

  function handleChipClick(group: Group, kind: ExploreKind) {
    if (!kind.url) return;
    navigate('/explore-show', {
      state: {
        exploreName: `${group.sourceName} / ${kind.title}`,
        sourceUrl: group.sourceUrl,
        exploreUrl: kind.url,
      },
    });
  }

  function handleErrorClick(kind: ExploreKind) {
    const message = kind.url || '(no stack trace)';
    window.alert(`${t('explore.errorDialog.title')}\n\n${message}`);
  }

  function handleMenuAction(action: BookSourceAction) {
    if (!menuState) return;
    const { group } = menuState;
    switch (action) {
      case 'edit':
        navigate(`/sources/${encodeURIComponent(group.sourceUrl)}`);
        return;
      case 'top':
        void invoke<ApiResponse<null>>('top_book_source', { url: group.sourceUrl }).then(() => {
          void reloadGroups();
        });
        return;
      case 'login':
        void openLogin(group.sourceUrl);
        return;
      case 'refresh':
        setKindsBySource((prev) => {
          const next = { ...prev };
          delete next[group.sourceUrl];
          return next;
        });
        void loadKinds(group.sourceUrl);
        return;
      case 'delete':
        setPendingDelete(group);
        return;
    }
  }

  async function openLogin(sourceUrl: string) {
    try {
      const resp = await invoke<ApiResponse<BookSource | null>>('get_book_source', { url: sourceUrl });
      if (resp.success && resp.data?.login_url) {
        await openUrl(resp.data.login_url);
      }
    } catch (e) {
      console.error('openLogin failed:', e);
    }
  }

  async function reloadGroups() {
    try {
      const [itemsResp, summariesResp] = await Promise.all([
        invoke<ApiResponse<ExploreItemsPage>>('get_explore_items', {
          offset: 0,
          limit: PAGE_LIMIT,
          filter: null,
        }),
        invoke<ApiResponse<BookSourceSummary[]>>('get_book_source_summaries'),
      ]);
      if (itemsResp.success && itemsResp.data) {
        const summaryMap = new Map<string, BookSourceSummary>();
        if (summariesResp.success && summariesResp.data) {
          for (const s of summariesResp.data) summaryMap.set(s.bookSourceUrl, s);
        }
        setGroups(groupItems(itemsResp.data.items, summaryMap));
      }
    } catch (e) {
      console.error('reloadGroups failed:', e);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const group = pendingDelete;
    setPendingDelete(null);
    try {
      const resp = await invoke<ApiResponse<null>>('delete_book_source', { url: group.sourceUrl });
      if (resp.success) {
        setGroups((prev) => prev.filter((g) => g.sourceUrl !== group.sourceUrl));
        setExpanded((prev) => {
          const next = { ...prev };
          delete next[group.sourceUrl];
          return next;
        });
        setKindsBySource((prev) => {
          const next = { ...prev };
          delete next[group.sourceUrl];
          return next;
        });
      } else {
        setError(resp.error || t('explore.error.load'));
      }
    } catch (e) {
      setError(t('common.error', { message: String(e) }));
    }
  }

  // Filter (client-side)
  const visibleGroups = useMemo(() => {
    const trimmed = deferredFilter.trim();
    if (!trimmed) return groups;
    if (trimmed.startsWith('group:')) {
      const key = trimmed.substring('group:'.length).toLowerCase();
      return groups.filter((g) => (g.sourceGroup || '').toLowerCase().includes(key));
    }
    const key = trimmed.toLowerCase();
    return groups.filter((g) => {
      if (g.sourceName.toLowerCase().includes(key)) return true;
      const kindsState = kindsBySource[g.sourceUrl];
      if (kindsState?.kind === 'ok') {
        return kindsState.kinds.some((k: ExploreKind) => k.title.toLowerCase().includes(key));
      }
      return false;
    });
  }, [groups, deferredFilter, kindsBySource]);

  return (
    <div>
      <h1 style={{ margin: '0 0 16px', fontSize: 24, fontWeight: 700, color: '#1a1a2e' }}>
        {t('explore.title')}
      </h1>

      <div style={{ position: 'relative', marginBottom: 16 }}>
        <input
          type="text"
          placeholder={t('explore.searchPlaceholder')}
          value={searchKey}
          onChange={(e) => setSearchKey(e.target.value)}
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
        {searchKey && (
          <button
            onClick={() => setSearchKey('')}
            aria-label="clear"
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

      {error && (
        <div
          style={{
            background: '#ffebee',
            color: '#c62828',
            padding: '10px 16px',
            borderRadius: 8,
            marginBottom: 16,
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          {error}
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
      ) : visibleGroups.length === 0 ? (
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
          {groups.length === 0
            ? t('explore.noExploreSources')
            : t('common.none')}
        </div>
      ) : (
        <div
          style={{
            background: '#fff',
            borderRadius: 12,
            padding: '4px 8px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          }}
        >
          {visibleGroups.map((group) => (
            <BookSourceGroup
              key={group.sourceUrl}
              group={group}
              kindsState={kindsBySource[group.sourceUrl] ?? { kind: 'idle' }}
              isExpanded={!!expanded[group.sourceUrl]}
              onToggle={() => toggle(group.sourceUrl)}
              onChipClick={(kind) => handleChipClick(group, kind)}
              onErrorClick={handleErrorClick}
              onMenuOpen={() => {
                const el = document.querySelector(
                  `[data-source-row="${CSS.escape(group.sourceUrl)}"]`
                ) as HTMLElement | null;
                if (el) setMenuState({ group, anchorEl: el });
              }}
              onRetryKinds={() => void loadKinds(group.sourceUrl)}
            />
          ))}
        </div>
      )}

      {menuState && (
        <BookSourceMenu
          anchorEl={menuState.anchorEl}
          onClose={() => setMenuState(null)}
          onAction={handleMenuAction}
        />
      )}

      {pendingDelete && (
        <div
          role="dialog"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            zIndex: 1100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setPendingDelete(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff',
              borderRadius: 12,
              padding: 24,
              maxWidth: 400,
              width: '90%',
              boxShadow: '0 12px 32px rgba(0,0,0,0.2)',
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
              {t('explore.menu.deleteConfirm', { name: pendingDelete.sourceName })}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setPendingDelete(null)}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: '1px solid #e0e0e0',
                  background: '#fff',
                  color: '#555',
                  cursor: 'pointer',
                }}
              >
                {t('common.cancel', { defaultValue: '取消' })}
              </button>
              <button
                onClick={confirmDelete}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: '#f44336',
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                {t('explore.menu.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function groupItems(items: ExploreItem[], summaries: Map<string, BookSourceSummary>): Group[] {
  const map = new Map<string, Group>();
  for (const item of items) {
    if (!map.has(item.source_url)) {
      const summary = summaries.get(item.source_url);
      map.set(item.source_url, {
        sourceUrl: item.source_url,
        sourceName: item.source_name,
        sourceGroup: summary?.bookSourceGroup ?? null,
        hasLoginUrl: false,
        weight: summary?.weight ?? 0,
        customOrder: summary?.customOrder ?? 0,
      });
    }
  }
  return Array.from(map.values());
}
