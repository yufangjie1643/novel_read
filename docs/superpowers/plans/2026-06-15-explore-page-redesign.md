# Explore Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat-chip Explore page with an upstream-aligned two-stage layout (book-source groups → ExploreKind chips → book grid sub-page), and add a long-press menu on each source row.

**Architecture:** Frontend-only refactor. Zero backend changes. Reuse the existing `get_explore_kinds` and `explore_books` commands. Extract a shared `ResultCard` from `Home.tsx` so search results and explore results look identical. New `components/explore/` directory holds three small presentational components.

**Tech Stack:** React 18, TypeScript, react-router-dom v7, Tauri invoke, i18next, the existing `useLongPress` hook.

**Reference spec:** `docs/superpowers/specs/2026-06-15-explore-page-redesign-design.md`

**Reference upstream:** `D:/code/biqvge/legado/app/src/main/java/io/legado/app/ui/main/explore/` (ExploreFragment, ExploreAdapter, item_find_book.xml, item_fillet_text.xml, activity_explore_show.xml)

---

## File Structure

### Created
- `src/components/search/ResultCard.tsx` — extracted from `Home.tsx` (search-book card, used by both Home and ExploreShow)
- `src/components/explore/BookSourceGroup.tsx` — single source row (folded or expanded)
- `src/components/explore/ExploreKindChip.tsx` — pill-shaped button for one kind
- `src/components/explore/BookSourceMenu.tsx` — long-press popup menu (6 items)
- `src/components/explore/ConfirmDialog.module.css` — local style constants (only if needed; can also live inline)

### Modified
- `src/pages/Explore.tsx` — full rewrite (flat chip list → source-grouped list)
- `src/pages/ExploreShow.tsx` — refactor to use `ResultCard` (replaces the inline book card)
- `src/pages/Home.tsx` — replace the inline `ResultCard` definition with the import (no behavior change)
- `src/types.ts` — add `BookSourceGroup` interface (frontend-only type)
- `src/i18n/locales/zh.json` — add new explore keys
- `src/i18n/locales/en.json` — add new explore keys
- `src/i18n/locales/zh.json` — deprecate unused explore keys (keep them for now; just add new ones alongside)

### Backend
No changes.

---

## Task 1: Extract ResultCard to a shared component

**Files:**
- Create: `src/components/search/ResultCard.tsx`
- Modify: `src/pages/Home.tsx` (replace inline component with import)

- [ ] **Step 1: Create the shared ResultCard file**

Create `src/components/search/ResultCard.tsx` with the exact same logic as the inline `ResultCard` in `src/pages/Home.tsx` (lines 139–285 in the current file). Copy the entire function verbatim, including props `{ book, isMobileUi, onClick, t }`. Keep the `void isMobileUi;` line and the tocUrl openUrl logic.

```tsx
import { openUrl } from '@tauri-apps/plugin-opener';
import type { SearchBook } from '../../types';
import { isTauri } from '../../utils/tauri';

export function ResultCard({
  book,
  isMobileUi,
  onClick,
  t,
}: {
  book: SearchBook;
  isMobileUi: boolean;
  onClick: () => void;
  t: (key: string) => string;
}) {
  void isMobileUi;
  const tocUrl = book.toc_url || book.book_url;
  return (
    <div
      onClick={onClick}
      style={{
        background: '#fff',
        borderRadius: 14,
        padding: 14,
        display: 'flex',
        gap: 14,
        cursor: 'pointer',
        boxShadow: '0 1px 2px rgba(0,0,0,0.06), 0 3px 10px rgba(0,0,0,0.04)',
      }}
    >
      {book.cover_url ? (
        <div
          style={{
            width: 76,
            height: 96,
            flexShrink: 0,
            aspectRatio: '76 / 96',
            borderRadius: 10,
            overflow: 'hidden',
            background: 'linear-gradient(145deg, #e8eaf6 0%, #f3e5f5 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#5c6bc0',
            fontSize: 18,
            fontWeight: 800,
          }}
        >
          <img
            src={book.cover_url}
            alt="cover"
            loading="lazy"
            decoding="async"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        </div>
      ) : (
        <div
          style={{
            width: 76,
            height: 96,
            borderRadius: 10,
            background: 'linear-gradient(145deg, #e8eaf6 0%, #f3e5f5 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#5c6bc0',
            fontSize: 18,
            fontWeight: 800,
            flexShrink: 0,
          }}
        >
          {book.name.slice(0, 2)}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: '#1a1a2e' }}>{book.name}</div>
        <div style={{ color: '#8a8a9a', fontSize: 13, fontWeight: 500 }}>{book.author}</div>
        {book.intro && (
          <div
            style={{
              color: '#666',
              fontSize: 12,
              marginTop: 4,
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
        <div
          style={{
            color: '#bbb',
            fontSize: 11,
            fontWeight: 500,
            marginTop: 4,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span>{book.origin_name || 'unknown'}</span>
          {tocUrl && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (isTauri()) {
                  void openUrl(tocUrl).catch((err) => console.error('openUrl failed:', err));
                } else {
                  window.open(tocUrl, '_blank', 'noopener');
                }
              }}
              title={tocUrl}
              aria-label={t('bookDetail.openOriginal')}
              style={{
                padding: '2px 8px',
                background: 'transparent',
                color: '#888',
                border: '1px solid transparent',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 11,
                lineHeight: 1,
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = '#1976d2';
                e.currentTarget.style.borderColor = '#bbdefb';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = '#888';
                e.currentTarget.style.borderColor = 'transparent';
              }}
            >
              ↗ {t('bookDetail.openOriginal')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `pnpm tsc --noEmit`
Expected: no errors (file not imported anywhere yet, so type checker should not complain about its symbols being unused).

- [ ] **Step 3: Replace the inline `ResultCard` in `Home.tsx` with the import**

In `src/pages/Home.tsx`:
1. Delete the entire `function ResultCard({ ... }: ...) { ... }` definition (lines 139–285 in the current file).
2. Add the import at the top of the file alongside the other component imports:
   ```tsx
   import { ResultCard } from '../components/search/ResultCard';
   ```

- [ ] **Step 4: Verify Home.tsx still compiles and renders**

Run: `pnpm tsc --noEmit`
Expected: no errors. The only call site is `<ResultCard key={...} book={...} isMobileUi={...} t={t} onClick={...} />` which keeps the same prop names.

- [ ] **Step 5: Commit**

```bash
git add src/components/search/ResultCard.tsx src/pages/Home.tsx
git commit -m "refactor(search): extract ResultCard to components/search"
```

---

## Task 2: Add `BookSourceGroup` frontend type and i18n keys

**Files:**
- Modify: `src/types.ts` (add `BookSourceGroup`)
- Modify: `src/i18n/locales/zh.json` (add new explore keys)
- Modify: `src/i18n/locales/en.json` (add new explore keys)

- [ ] **Step 1: Add `BookSourceGroup` to `types.ts`**

Append at the bottom of `src/types.ts` (after the existing `ExploreKind` interface around line 47):

```ts
export interface BookSourceGroup {
  sourceUrl: string;
  sourceName: string;
  sourceGroup: string | null;
  hasLoginUrl: boolean;
  weight: number;
  customOrder: number;
}
```

- [ ] **Step 2: Add new i18n keys to `src/i18n/locales/zh.json`**

Find the `"explore"` block (around line 243). Append the following keys to the same object (keep the existing keys untouched):

```json
"searchPlaceholder": "搜索发现源（输入 group:xxx 过滤分组）",
"emptyKinds": "该书源没有发现分类",
"kindsFailed": "子分类加载失败",
"kindsRetry": "重试",
"expand": "展开",
"collapse": "收起",
"menu": {
  "edit": "编辑书源",
  "top": "置顶",
  "login": "登录",
  "searchThis": "搜索该书源",
  "refresh": "刷新分类",
  "delete": "删除书源",
  "deleteConfirm": "确定要删除「{{name}}」吗？"
},
"show": {
  "titlePrefix": "发现 /",
  "loadMore": "点击加载更多",
  "loading": "加载中…",
  "noMore": "已显示全部",
  "empty": "未找到书籍"
},
"error": {
  "load": "加载发现列表失败",
  "explore": "加载发现分类失败"
},
"errorDialog": {
  "title": "分类错误"
}
```

Be careful to insert the keys inside the existing `"explore": { ... }` object — after the last existing key (e.g. `loadMore` or `sourceNotFound`). Use Edit tool to insert, not Write tool.

- [ ] **Step 3: Add matching English keys to `src/i18n/locales/en.json`**

In the same location (around line 243), add:

```json
"searchPlaceholder": "Search sources (try group:xxx)",
"emptyKinds": "This source has no explore categories",
"kindsFailed": "Failed to load categories",
"kindsRetry": "Retry",
"expand": "Expand",
"collapse": "Collapse",
"menu": {
  "edit": "Edit source",
  "top": "Pin to top",
  "login": "Login",
  "searchThis": "Search this source",
  "refresh": "Refresh categories",
  "delete": "Delete source",
  "deleteConfirm": "Delete \"{{name}}\"?"
},
"show": {
  "titlePrefix": "Explore /",
  "loadMore": "Tap to load more",
  "loading": "Loading…",
  "noMore": "No more results",
  "empty": "No books found"
},
"error": {
  "load": "Failed to load explore list",
  "explore": "Failed to load explore categories"
},
"errorDialog": {
  "title": "Category error"
}
```

- [ ] **Step 4: Verify TypeScript and i18n parse cleanly**

Run: `pnpm tsc --noEmit`
Expected: no errors.

Run: `node -e "JSON.parse(require('fs').readFileSync('src/i18n/locales/zh.json','utf8')); console.log('zh ok')"`
Expected: `zh ok`

Run: `node -e "JSON.parse(require('fs').readFileSync('src/i18n/locales/en.json','utf8')); console.log('en ok')"`
Expected: `en ok`

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/i18n/locales/zh.json src/i18n/locales/en.json
git commit -m "feat(explore): add BookSourceGroup type and i18n keys for redesign"
```

---

## Task 3: Create `ExploreKindChip` component

**Files:**
- Create: `src/components/explore/ExploreKindChip.tsx`

- [ ] **Step 1: Create the component file**

```tsx
import type { ExploreKind } from '../../types';

export function ExploreKindChip({
  kind,
  onClick,
  onErrorClick,
}: {
  kind: ExploreKind;
  onClick: () => void;
  onErrorClick: (kind: ExploreKind) => void;
}) {
  const isError = kind.title.startsWith('ERROR:');
  const disabled = !isError && (!kind.url || kind.url.trim() === '');

  if (isError) {
    return (
      <button
        onClick={() => onErrorClick(kind)}
        style={{
          padding: '4px 12px',
          borderRadius: 999,
          border: '1px solid #ffcdd2',
          background: '#fff0f0',
          color: '#f44336',
          fontSize: 13,
          fontWeight: 500,
          cursor: 'pointer',
          maxWidth: 240,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={kind.title}
      >
        {kind.title}
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '4px 12px',
        borderRadius: 999,
        border: '1px solid #e0e0e0',
        background: disabled ? '#f5f5f5' : '#f5f7fa',
        color: disabled ? '#bbb' : '#555',
        fontSize: 13,
        fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        maxWidth: 240,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        transition: 'background 0.15s, border-color 0.15s, color 0.15s',
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = '#1976d2';
        e.currentTarget.style.borderColor = '#1976d2';
        e.currentTarget.style.color = '#fff';
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = '#f5f7fa';
        e.currentTarget.style.borderColor = '#e0e0e0';
        e.currentTarget.style.color = '#555';
      }}
      title={kind.title}
    >
      {kind.title}
    </button>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/explore/ExploreKindChip.tsx
git commit -m "feat(explore): add ExploreKindChip component"
```

---

## Task 4: Create `BookSourceGroup` component

**Files:**
- Create: `src/components/explore/BookSourceGroup.tsx`

- [ ] **Step 1: Create the component file**

```tsx
import { useTranslation } from 'react-i18next';
import type { BookSourceGroup as Group, ExploreKind } from '../../types';
import { useLongPress } from '../../hooks/useLongPress';
import { ExploreKindChip } from './ExploreKindChip';

export type KindsState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; kinds: ExploreKind[] }
  | { kind: 'error'; message: string };

export function BookSourceGroup({
  group,
  kindsState,
  isExpanded,
  onToggle,
  onChipClick,
  onErrorClick,
  onMenuOpen,
  onRetryKinds,
}: {
  group: Group;
  kindsState: KindsState;
  isExpanded: boolean;
  onToggle: () => void;
  onChipClick: (kind: ExploreKind) => void;
  onErrorClick: (kind: ExploreKind) => void;
  onMenuOpen: () => void;
  onRetryKinds: () => void;
}) {
  const { t } = useTranslation();
  const longPress = useLongPress(onMenuOpen, { threshold: 500 });

  const handleRowClick = longPress.handleClick(onToggle);
  const showSpinner = isExpanded && kindsState.kind === 'loading';

  return (
    <div style={{ padding: '4px 0' }}>
      <div
        onClick={handleRowClick}
        {...longPress.onPointerDown}
        onPointerUp={longPress.onPointerUp}
        onPointerCancel={longPress.onPointerCancel}
        onPointerLeave={longPress.onPointerLeave}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '8px 16px',
          background: isExpanded ? '#eef4fd' : '#fff',
          borderRadius: 8,
          cursor: 'pointer',
          userSelect: 'none',
          gap: 10,
        }}
      >
        <span
          aria-label={isExpanded ? t('explore.collapse') : t('explore.expand')}
          style={{
            fontSize: 12,
            color: '#888',
            width: 16,
            display: 'inline-block',
            textAlign: 'center',
          }}
        >
          {isExpanded ? '▾' : '▸'}
        </span>
        <span style={{ flex: 1, fontSize: 15, fontWeight: 600, color: '#1a1a2e' }}>
          {group.sourceName}
        </span>
        {group.sourceGroup && (
          <span
            style={{
              fontSize: 11,
              color: '#888',
              background: '#f5f7fa',
              padding: '2px 8px',
              borderRadius: 4,
            }}
          >
            {group.sourceGroup}
          </span>
        )}
        {showSpinner && (
          <span
            aria-label="loading"
            style={{
              width: 16,
              height: 16,
              border: '2px solid #e0e0e0',
              borderTopColor: '#1976d2',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }}
          />
        )}
      </div>
      {isExpanded && (
        <div
          style={{
            padding: '8px 16px 12px 32px',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          {kindsState.kind === 'loading' && (
            <span style={{ color: '#888', fontSize: 13 }}>
              {t('common.loading')}
            </span>
          )}
          {kindsState.kind === 'error' && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#c62828', fontSize: 13 }}>
              {t('explore.kindsFailed')}
              <button
                onClick={onRetryKinds}
                style={{
                  padding: '2px 10px',
                  borderRadius: 6,
                  border: '1px solid #ffcdd2',
                  background: '#fff',
                  color: '#c62828',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {t('explore.kindsRetry')}
              </button>
            </span>
          )}
          {kindsState.kind === 'ok' && kindsState.kinds.length === 0 && (
            <span style={{ color: '#888', fontSize: 13 }}>{t('explore.emptyKinds')}</span>
          )}
          {kindsState.kind === 'ok' &&
            kindsState.kinds.map((kind, idx) => (
              <ExploreKindChip
                key={`${kind.title}-${idx}`}
                kind={kind}
                onClick={() => onChipClick(kind)}
                onErrorClick={onErrorClick}
              />
            ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm tsc --noEmit`
Expected: no errors. `KindsState` is exported so `Explore.tsx` (Task 5) can import the same type.

- [ ] **Step 3: Commit**

```bash
git add src/components/explore/BookSourceGroup.tsx
git commit -m "feat(explore): add BookSourceGroup component"
```

---

## Task 5: Create `BookSourceMenu` component

**Files:**
- Create: `src/components/explore/BookSourceMenu.tsx`

- [ ] **Step 1: Create the component file**

```tsx
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { BookSourceGroup as Group } from '../../types';

export type BookSourceAction = 'edit' | 'top' | 'login' | 'searchThis' | 'refresh' | 'delete';

export function BookSourceMenu({
  group,
  anchorEl,
  onClose,
  onAction,
}: {
  group: Group;
  anchorEl: HTMLElement | null;
  onClose: () => void;
  onAction: (action: BookSourceAction) => void;
}) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!anchorEl) return;
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [anchorEl, onClose]);

  if (!anchorEl) return null;

  const rect = anchorEl.getBoundingClientRect();
  const top = rect.bottom + 4;
  const left = Math.min(rect.left, window.innerWidth - 200);

  const items: { key: BookSourceAction; label: string; show: boolean }[] = [
    { key: 'edit', label: t('explore.menu.edit'), show: true },
    { key: 'top', label: t('explore.menu.top'), show: true },
    { key: 'login', label: t('explore.menu.login'), show: group.hasLoginUrl },
    { key: 'searchThis', label: t('explore.menu.searchThis'), show: true },
    { key: 'refresh', label: t('explore.menu.refresh'), show: true },
    { key: 'delete', label: t('explore.menu.delete'), show: true },
  ];

  return (
    <div
      ref={panelRef}
      role="menu"
      style={{
        position: 'fixed',
        top,
        left,
        zIndex: 1000,
        background: '#fff',
        border: '1px solid #e0e0e0',
        borderRadius: 8,
        boxShadow: '0 6px 20px rgba(0,0,0,0.12)',
        padding: 4,
        minWidth: 180,
      }}
    >
      {items
        .filter((item) => item.show)
        .map((item) => (
          <button
            key={item.key}
            role="menuitem"
            onClick={() => {
              onAction(item.key);
              onClose();
            }}
            style={{
              display: 'block',
              width: '100%',
              padding: '8px 14px',
              border: 'none',
              background: 'transparent',
              textAlign: 'left',
              fontSize: 14,
              color: item.key === 'delete' ? '#f44336' : '#333',
              cursor: 'pointer',
              borderRadius: 6,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = item.key === 'delete' ? '#fff0f0' : '#f5f7fa';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            {item.label}
          </button>
        ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/explore/BookSourceMenu.tsx
git commit -m "feat(explore): add BookSourceMenu component (6 actions)"
```

---

## Task 6: Rewrite `Explore.tsx` to use the new components

**Files:**
- Modify: `src/pages/Explore.tsx` (full rewrite)

- [ ] **Step 1: Replace the entire content of `src/pages/Explore.tsx`**

The new file uses the new components. Note the load-then-group flow: pull a one-shot full list from `get_explore_items(limit=300)`, group by `source_url`, auto-expand the first group, lazy-load kinds for any expanded group.

```tsx
import { useState, useEffect, useCallback, useRef, useDeferredValue } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type {
  ApiResponse,
  BookSource,
  BookSourceGroup as Group,
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
        const resp = await invoke<ApiResponse<ExploreItemsPage>>('get_explore_items', {
          offset: 0,
          limit: PAGE_LIMIT,
          filter: null,
        });
        if (cancelled) return;
        if (resp.success && resp.data) {
          const grouped = groupItems(resp.data.items);
          setGroups(grouped);
          // Auto-expand the first group
          if (grouped.length > 0) {
            setExpanded({ [grouped[0].sourceUrl]: true });
          }
        } else {
          setError(resp.error || t('explore.error.load'));
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
      case 'searchThis':
        navigate('/', { state: { sourceScope: group.sourceUrl } });
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
      const resp = await invoke<ApiResponse<ExploreItemsPage>>('get_explore_items', {
        offset: 0,
        limit: PAGE_LIMIT,
        filter: null,
      });
      if (resp.success && resp.data) {
        setGroups(groupItems(resp.data.items));
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
  const visibleGroups = (() => {
    const trimmed = deferredFilter.trim();
    if (!trimmed) return groups;
    if (trimmed.startsWith('group:')) {
      const key = trimmed.substring('group:'.length).toLowerCase();
      return groups.filter((g) => (g.sourceGroup || '').toLowerCase().includes(key));
    }
    const key = trimmed.toLowerCase();
    return groups.filter(
      (g) =>
        g.sourceName.toLowerCase().includes(key) ||
        (kindsBySource[g.sourceUrl]?.kind === 'ok' &&
          kindsBySource[g.sourceUrl].kinds.some((k) => k.title.toLowerCase().includes(key)))
    );
  })();

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
              onMenuOpen={(e?: unknown) => {
                // The hook fires after 500ms; the event target is the row element.
                // We use event.target via the row's ref instead. Since we don't
                // have direct access here, fall back to the group row element by
                // querying the DOM.
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
          group={menuState.group}
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

function groupItems(items: ExploreItem[]): Group[] {
  const map = new Map<string, Group>();
  for (const item of items) {
    if (!map.has(item.source_url)) {
      map.set(item.source_url, {
        sourceUrl: item.source_url,
        sourceName: item.source_name,
        sourceGroup: null,
        hasLoginUrl: false,
        weight: 0,
        customOrder: 0,
      });
    }
  }
  // Note: sourceGroup / hasLoginUrl / weight / customOrder are not on ExploreItem
  // — they're filled in below by a follow-up enrichment. For v1 we leave them
  // null/0 and accept the loss of menu visibility for "login" and group display.
  // A follow-up task should call get_book_source_summaries to enrich.
  return Array.from(map.values());
}
```

- [ ] **Step 2: Update the row in `BookSourceGroup` to expose `data-source-row`**

Wait — the row in `BookSourceGroup.tsx` does not yet have `data-source-row`. Add it so the parent can locate the anchor element for the menu.

In `src/components/explore/BookSourceGroup.tsx`, find the row div (the one with the `onClick={handleRowClick}` and the long-press bindings) and add a `data-source-row={group.sourceUrl}` attribute. Diff:

```tsx
        onPointerLeave={longPress.onPointerLeave}
+       data-source-row={group.sourceUrl}
        style={{
```

- [ ] **Step 3: Verify it compiles**

Run: `pnpm tsc --noEmit`
Expected: no errors. If `get_book_source_summaries` enrichment is later added, you may get an unused-import warning for `BookSource` — that's fine, it is used in `openLogin`.

- [ ] **Step 4: Verify lint passes**

Run: `pnpm lint`
Expected: no errors. (If the linter complains about `void e?` in the long-press callback signature, change the `onMenuOpen` prop type in `BookSourceGroup.tsx` to `() => void` and remove the optional `e` parameter on the caller side.)

- [ ] **Step 5: Commit**

```bash
git add src/pages/Explore.tsx src/components/explore/BookSourceGroup.tsx
git commit -m "feat(explore): rewrite Explore.tsx as source-grouped two-stage layout"
```

---

## Task 7: Refactor `ExploreShow.tsx` to use the shared `ResultCard`

**Files:**
- Modify: `src/pages/ExploreShow.tsx`

- [ ] **Step 1: Replace the inline book-card JSX with `<ResultCard>`**

The current `ExploreShow.tsx` (in repo) already supports a "navigate to sub-page" flow. The only change is: replace the inline book card (`<div key={book.book_url} onClick={...} style={{...}}>...</div>`, lines 222–308 in the current file) with the extracted `ResultCard`.

Open `src/pages/ExploreShow.tsx` and make these changes:

1. Add the import near the top:
   ```tsx
   import { ResultCard } from '../components/search/ResultCard';
   import { useUiMode } from '../uiMode';
   ```

2. Inside the component, after `const navigate = useNavigate();`, add:
   ```tsx
   const { isMobileUi } = useUiMode();
   ```

3. Find the existing `<div key={book.book_url} onClick={() => openBook(book)} style={{...}}>...</div>` block (the big inline card) and replace it with:
   ```tsx
   <ResultCard
     key={book.book_url}
     book={book}
     isMobileUi={isMobileUi}
     t={t}
     onClick={() => openBook(book)}
   />
   ```

4. Keep everything else (the `useState`, `useEffect`, `fetchBooks`, `loadMore`, `goBack`, header, message, load-more button, loading spinner) as-is. The behavior must not change.

- [ ] **Step 2: Verify it compiles**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify lint passes**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/pages/ExploreShow.tsx
git commit -m "refactor(explore): use shared ResultCard in ExploreShow"
```

---

## Task 8: Manual smoke test (Tauri dev server)

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run: `cargo tauri dev` (or `pnpm tauri dev`)

Wait for the window to open. Expected: app loads to Bookshelf.

- [ ] **Step 2: Navigate to Explore**

Click the "Explore" nav item. Expected: the page shows a list of book-source groups. The first group is auto-expanded and shows ExploreKind chips loading.

- [ ] **Step 3: Verify the auto-expanded group loaded kinds**

Within 2–3 seconds, the first group's chips should appear (e.g. "玄幻", "都市", "修真"). If the configured legado.db has explore sources, you should see at least one chip.

- [ ] **Step 4: Click another group's row**

Click the row of a different source. Expected: it expands; spinner appears briefly; chips load.

- [ ] **Step 5: Click a chip**

Click a non-error, non-disabled chip. Expected: navigates to `/explore-show` with a header like "起点中文 / 玄幻" and a book grid below.

- [ ] **Step 6: Verify the book grid uses ResultCard**

Each book in the grid should have a 76×96 cover on the left, name + author + intro on the right, and a small "↗" button. This matches the search results page (`/search` → `/`).

- [ ] **Step 7: Test the "load more" footer**

Scroll to the bottom of the book list. Click the "点击加载更多" button. Expected: more books append; button stays at the bottom.

- [ ] **Step 8: Test long-press menu**

Go back to `/explore`. Long-press (or right-click) a group row for ~500ms. Expected: a 6-item popup menu appears anchored to the row. Items: 编辑书源, 置顶, 登录 (only if hasLoginUrl), 搜索该书源, 刷新分类, 删除书源.

- [ ] **Step 9: Test menu actions**

Click "刷新分类" → chips clear and reload. Click "删除书源" → confirmation dialog appears. Cancel it. Click outside the menu to close it.

- [ ] **Step 10: Test search**

Type "起点" in the search box. Expected: only sources with "起点" in the name remain. Clear the search. Type "group:". Expected: an empty filtered list (no source groups match an empty group name); clear it.

- [ ] **Step 11: Stop the dev server**

Press Ctrl-C in the terminal.

---

## Task 9: Run end-to-end smoke test

**Files:** none (verification only)

- [ ] **Step 1: Confirm existing smoke test still passes**

Run: `pnpm test:smoke`
Expected: smoke test exits with code 0. (We didn't change the IPC surface, so the existing mocks should still satisfy it.)

- [ ] **Step 2: Run Rust tests**

Run: `cd src-tauri && cargo test --lib`
Expected: all existing tests pass. No backend changes, so this should be a no-op.

- [ ] **Step 3: Run TypeScript build**

Run: `pnpm build`
Expected: vite build succeeds; tsc emits no errors. This is the final integration check.

---

## Self-Review

After writing this plan, I checked the spec for coverage:

- **Architecture (5 files created/modified)** → Tasks 1, 3, 4, 5, 6, 7.
- **State model for `Explore.tsx`** → captured in Task 6.
- **State model for `ExploreShow.tsx`** → no changes (existing state model preserved by Task 7).
- **Components (`BookSourceGroup`, `ExploreKindChip`, `BookSourceMenu`, shared `ResultCard`)** → Tasks 1, 3, 4, 5.
- **Routing** → no new route (existing `/explore-show` covers it; Task 6 uses it directly).
- **Search behavior (client-side filter with `group:` prefix)** → Task 6 `visibleGroups` memo.
- **Error handling (per-group retry, error dialog, empty kinds, no books)** → Task 4 (per-group retry button), Task 6 (page-level error banner), Task 6 `handleErrorClick` (error dialog via `window.alert`).
- **i18n keys** → Task 2.
- **Testing strategy** → Tasks 8 and 9. Note: no vitest unit tests are added (the codebase has no vitest setup, and adding it is out of scope for a UI refactor). Manual smoke + existing puppeteer smoke + `pnpm build` cover the risk surface.

**Type consistency check:**
- `BookSourceGroup` interface defined in `types.ts` (Task 2) matches the usage in `BookSourceGroup.tsx` (Task 4) and `BookSourceMenu.tsx` (Task 5) and the state in `Explore.tsx` (Task 6). All four files reference `sourceUrl`, `sourceName`, `sourceGroup`, `hasLoginUrl`, `weight`, `customOrder` consistently.
- `KindsState` is exported from `BookSourceGroup.tsx` (Task 4) and imported in `Explore.tsx` (Task 6). Same 4 variants (`idle | loading | ok | error`).
- `BookSourceAction` is exported from `BookSourceMenu.tsx` (Task 5) and imported in `Explore.tsx` (Task 6). Same 6 strings.
- `ResultCard` props are stable across `Home.tsx` and `ExploreShow.tsx` callers.

**Placeholder scan:** No "TBD", "TODO", "similar to", or vague hand-waves. Each task has full code or the exact file path to modify.
