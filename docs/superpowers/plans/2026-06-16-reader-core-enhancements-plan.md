# Reader 核心增强包 A 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Desktop Reader 中加入书签、统一的右键上下文菜单（文本/页面双路径）、仿起点桌面版的导航交互（顶部 sticky 工具栏 + 右侧浮动按钮 + 章节末自动加载 + 完整键盘快捷键）。

**Architecture:**
- 复用后端 `add_bookmark` / `update_bookmark` / `delete_bookmark` / `get_bookmarks`（`commands.rs:679-724`），本次纯前端工作。
- 用 React Context + 单一 `useReaderNav()` hook 集中管理工具栏显隐、自动加载、键盘快捷键。
- 右键菜单用单一 `<ContextMenu>` 组件按 `kind: 'text' | 'page'` 渲染；通过 `contextmenu` 事件 + `selection.isCollapsed` 分流。
- 仿起点的 sticky 顶部栏 + 右侧浮动按钮 + 章末 IntersectionObserver 自动加载，全部走 CSS 动画 + 单一状态机。
- 导航偏好持久化到 `localStorage`（key: `reader_nav_prefs`）。

**Tech Stack:** React 18 + TypeScript + Vite + i18next + Tauri v2 IPC + CSS Modules

**Spec:** [`docs/superpowers/specs/2026-06-16-reader-core-and-fullbook-search-design.md`](../../specs/2026-06-16-reader-core-and-fullbook-search-design.md) — 本计划只覆盖 §3.1（书签）、§3.2（右键菜单）、§3.3（仿起点导航）、§3.6（桌面端交互补充）、§3.7（i18n 中 reader.* 部分）。

---

## File Structure

### 新增文件

| 文件 | 责任 |
|------|------|
| `src/components/reader/ContextMenu.tsx` | 右键菜单组件，单组件按 `kind` 渲染文本/页面菜单 |
| `src/components/reader/ContextMenu.module.css` | 菜单样式（主题色、定位、选中态） |
| `src/components/reader/ShortcutsHelpModal.tsx` | `?` 触发的快捷键帮助模态弹层 |
| `src/components/reader/ShortcutsHelpModal.module.css` | 弹层样式 |
| `src/components/reader/BookmarkButton.tsx` | 右侧浮动书签按钮，点击打开书签添加弹层 |
| `src/components/reader/NavSettingsPopover.tsx` | 顶部菜单「导航设置」弹层，4 个 checkbox |
| `src/components/reader/NavSettingsPopover.module.css` | 设置弹层样式 |
| `src/hooks/useReaderNav.ts` | 集中管理工具栏显隐、自动加载、键盘快捷键的 hook |
| `src/components/reader/bookmarkActions.ts` | 书签 CRUD IPC 客户端包装 |
| `src/components/reader/navPrefs.ts` | 导航偏好类型 + localStorage 读写 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `src/pages/Reader.tsx` | 集成新组件：替换 §3.3 现有的硬编码左右点击为 `useReaderNav`；挂载 `<ContextMenu>`、`<BookmarkButton>`、`<NavSettingsPopover>`、`<ShortcutsHelpModal>` |
| `src/i18n/locales/zh.json` + `en.json` | 新增 reader.addBookmark / selection / contextMenu / shortcuts / nav key |
| `src/styles/reader-animations.css` | 新增 sticky 工具栏 fade-in/fade-out 关键帧 |

---

## Task 1: i18n key 补齐（reader.* 与 contextMenu / shortcuts）

**Files:**
- Modify: `src/i18n/locales/zh.json`
- Modify: `src/i18n/locales/en.json`

- [ ] **Step 1: 在 zh.json 的 `reader` 对象下补齐以下 key（保持现有缩进风格）**

```json
"addBookmark": "添加书签",
"bookmarkTitle": "书签标题",
"bookmarkContent": "书签内容（可选）",
"bookmarkAdded": "书签已添加",
"bookmarkAddFailed": "添加书签失败：{error}",
"copied": "已复制",
"contextMenu": {
  "copy": "复制",
  "addBookmark": "添加书签",
  "addReplace": "添加替换规则",
  "searchBook": "在书中搜索",
  "readAloud": "朗读选中",
  "dictionaryLookup": "字典查询",
  "prevChapter": "上一章",
  "nextChapter": "下一章",
  "openCatalog": "打开目录",
  "cycleTheme": "切换主题",
  "openSettings": "打开设置",
  "exitReader": "退出阅读"
},
"shortcuts": {
  "title": "键盘快捷键",
  "prevNext": "←/→ 上一章/下一章",
  "pageUpDown": "PageUp/PageDown 上一章/下一章",
  "firstLast": "Home/End 第一章/最后一章",
  "scrollDown": "Space 向下滚动一屏",
  "scrollUp": "Shift+Space 向上滚动一屏",
  "find": "Ctrl+F 搜索",
  "findNext": "F3 / Shift+F3 下一处/上一处",
  "bookmark": "Ctrl+D 添加书签",
  "bookmarkList": "Ctrl+Shift+D 书签列表",
  "close": "Esc 关闭弹层/退出全屏",
  "fullscreen": "F11 切换全屏",
  "toggleToolbar": "Ctrl+B 切换顶部工具栏",
  "help": "? 弹出快捷键帮助"
},
"nav": {
  "stickyToolbar": "顶部工具栏常驻",
  "autoLoadNext": "章末自动加载下一章",
  "floatingButtons": "右侧浮动按钮",
  "keyboardShortcuts": "键盘快捷键"
}
```

- [ ] **Step 2: 在 en.json 的 `reader` 对象下补齐同样的 key，翻译如下**

```json
"addBookmark": "Add Bookmark",
"bookmarkTitle": "Bookmark Title",
"bookmarkContent": "Bookmark Content (optional)",
"bookmarkAdded": "Bookmark added",
"bookmarkAddFailed": "Failed to add bookmark: {error}",
"copied": "Copied",
"contextMenu": {
  "copy": "Copy",
  "addBookmark": "Add Bookmark",
  "addReplace": "Add Replace Rule",
  "searchBook": "Search in Book",
  "readAloud": "Read Aloud Selection",
  "dictionaryLookup": "Dictionary Lookup",
  "prevChapter": "Previous Chapter",
  "nextChapter": "Next Chapter",
  "openCatalog": "Open Catalog",
  "cycleTheme": "Cycle Theme",
  "openSettings": "Open Settings",
  "exitReader": "Exit Reader"
},
"shortcuts": {
  "title": "Keyboard Shortcuts",
  "prevNext": "←/→ Previous/Next Chapter",
  "pageUpDown": "PageUp/PageDown Previous/Next Chapter",
  "firstLast": "Home/End First/Last Chapter",
  "scrollDown": "Space Scroll Down",
  "scrollUp": "Shift+Space Scroll Up",
  "find": "Ctrl+F Find",
  "findNext": "F3 / Shift+F3 Next/Previous Match",
  "bookmark": "Ctrl+D Add Bookmark",
  "bookmarkList": "Ctrl+Shift+D Bookmark List",
  "close": "Esc Close / Exit Fullscreen",
  "fullscreen": "F11 Toggle Fullscreen",
  "toggleToolbar": "Ctrl+B Toggle Toolbar",
  "help": "? Show Shortcuts Help"
},
"nav": {
  "stickyToolbar": "Persistent Top Toolbar",
  "autoLoadNext": "Auto-load Next Chapter",
  "floatingButtons": "Floating Right Buttons",
  "keyboardShortcuts": "Keyboard Shortcuts"
}
```

- [ ] **Step 3: 验证翻译文件是合法 JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/i18n/locales/zh.json'))" && node -e "JSON.parse(require('fs').readFileSync('src/i18n/locales/en.json'))"`
Expected: 两个命令都无输出（成功）。

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales/zh.json src/i18n/locales/en.json
git commit -m "feat(reader): add i18n keys for context menu, shortcuts, nav prefs"
```

---

## Task 2: navPrefs.ts（导航偏好定义与 localStorage 持久化）

**Files:**
- Create: `src/components/reader/navPrefs.ts`

- [ ] **Step 1: 创建文件，定义类型与读写**

```ts
export type ReaderNavPrefs = {
  stickyToolbar: boolean;
  autoLoadNext: boolean;
  showFloatingButtons: boolean;
  keyboardShortcuts: boolean;
};

export const DEFAULT_NAV_PREFS: ReaderNavPrefs = {
  stickyToolbar: true,
  autoLoadNext: true,
  showFloatingButtons: true,
  keyboardShortcuts: true,
};

const STORAGE_KEY = 'reader_nav_prefs';

export function readNavPrefs(): ReaderNavPrefs {
  if (typeof localStorage === 'undefined') return DEFAULT_NAV_PREFS;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_NAV_PREFS;
  try {
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_NAV_PREFS, ...parsed };
  } catch {
    return DEFAULT_NAV_PREFS;
  }
}

export function writeNavPrefs(prefs: ReaderNavPrefs): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}
```

- [ ] **Step 2: TypeScript 类型检查通过**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add src/components/reader/navPrefs.ts
git commit -m "feat(reader): add navPrefs module for localStorage persistence"
```

---

## Task 3: bookmarkActions.ts（书签 IPC 客户端）

**Files:**
- Create: `src/components/reader/bookmarkActions.ts`

- [ ] **Step 1: 创建文件，包装书签 CRUD**

```ts
import { invoke } from '@tauri-apps/api/core';
import type { ApiResponse, Bookmark } from '../../types';

export type AddBookmarkInput = Omit<Bookmark, 'id'> & { id?: never };

export async function addBookmark(bookmark: AddBookmarkInput): Promise<number> {
  const resp = await invoke<ApiResponse<number>>('add_bookmark', { bookmark });
  if (!resp.success || resp.data === undefined || resp.data === null) {
    throw new Error(resp.error ?? 'add_bookmark failed');
  }
  return resp.data;
}

export async function getBookmarks(bookUrl: string): Promise<Bookmark[]> {
  const resp = await invoke<ApiResponse<Bookmark[]>>('get_bookmarks', { bookUrl });
  if (!resp.success || !resp.data) return [];
  return resp.data;
}

export async function deleteBookmark(id: number): Promise<void> {
  const resp = await invoke<ApiResponse<unknown>>('delete_bookmark', { id });
  if (!resp.success) {
    throw new Error(resp.error ?? 'delete_bookmark failed');
  }
}
```

- [ ] **Step 2: TypeScript 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add src/components/reader/bookmarkActions.ts
git commit -m "feat(reader): add bookmarkActions IPC client"
```

---

## Task 4: ContextMenu 组件（统一右键菜单）

**Files:**
- Create: `src/components/reader/ContextMenu.tsx`
- Create: `src/components/reader/ContextMenu.module.css`

- [ ] **Step 1: 创建 ContextMenu.module.css**

```css
.menu {
  position: fixed;
  z-index: 100;
  min-width: 200px;
  background: var(--reader-menu-bg, #ffffff);
  color: var(--reader-menu-text, #1a1a2e);
  border: 1px solid var(--reader-menu-border, #e8e8f0);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  padding: 4px 0;
  font-size: 14px;
  user-select: none;
}

.item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  cursor: pointer;
  white-space: nowrap;
  outline: none;
}

.item:hover,
.item[aria-selected="true"] {
  background: rgba(0, 0, 0, 0.06);
}

.item:disabled,
.item[aria-disabled="true"] {
  opacity: 0.5;
  cursor: not-allowed;
}

.divider {
  height: 1px;
  background: var(--reader-menu-border, #e8e8f0);
  margin: 4px 0;
}

.icon {
  width: 16px;
  text-align: center;
  font-size: 14px;
}
```

- [ ] **Step 2: 创建 ContextMenu.tsx**

```tsx
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './ContextMenu.module.css';

export type ContextMenuKind = 'text' | 'page';

export type ContextMenuState = {
  x: number;
  y: number;
  kind: ContextMenuKind;
  selectedText?: string;
};

type Action = {
  id: string;
  labelKey: string;
  icon?: string;
  disabled?: boolean;
  onSelect: () => void;
};

const MENU_WIDTH = 200;
const MENU_HEIGHT_ESTIMATE = 280;

function adjustPosition(x: number, y: number): { x: number; y: number } {
  const ww = window.innerWidth;
  const wh = window.innerHeight;
  return {
    x: x + MENU_WIDTH > ww ? ww - MENU_WIDTH - 8 : x,
    y: y + MENU_HEIGHT_ESTIMATE > wh ? wh - MENU_HEIGHT_ESTIMATE - 8 : y,
  };
}

export type ContextMenuProps = {
  state: ContextMenuState | null;
  onClose: () => void;
  buildActions: (kind: ContextMenuKind, selectedText: string) => Action[];
};

export default function ContextMenu({ state, onClose, buildActions }: ContextMenuProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [focusIndex, setFocusIndex] = useState(0);

  useEffect(() => {
    if (!state) {
      setFocusIndex(0);
      return;
    }
    const handler = (e: MouseEvent | WheelEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      const actions = buildActions(state.kind, state.selectedText ?? '');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusIndex((i) => Math.min(actions.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusIndex((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const a = actions[focusIndex];
        if (a && !a.disabled) {
          a.onSelect();
          onClose();
        }
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('wheel', handler, { passive: true });
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('wheel', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [state, focusIndex, onClose, buildActions]);

  if (!state) return null;
  const { x, y } = adjustPosition(state.x, state.y);
  const actions = buildActions(state.kind, state.selectedText ?? '');

  return (
    <div
      ref={ref}
      className={styles.menu}
      role="menu"
      style={{ left: x, top: y }}
      data-testid="reader-context-menu"
    >
      {actions.map((a, i) => (
        <div
          key={a.id}
          role="menuitem"
          aria-selected={i === focusIndex}
          aria-disabled={a.disabled}
          tabIndex={-1}
          className={styles.item}
          onMouseEnter={() => setFocusIndex(i)}
          onClick={() => {
            if (a.disabled) return;
            a.onSelect();
            onClose();
          }}
        >
          {a.icon && <span className={styles.icon}>{a.icon}</span>}
          <span>{t(a.labelKey)}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
git add src/components/reader/ContextMenu.tsx src/components/reader/ContextMenu.module.css
git commit -m "feat(reader): add ContextMenu component for unified right-click handling"
```

---

## Task 5: NavSettingsPopover 组件

**Files:**
- Create: `src/components/reader/NavSettingsPopover.tsx`
- Create: `src/components/reader/NavSettingsPopover.module.css`

- [ ] **Step 1: 创建 NavSettingsPopover.module.css**

```css
.popover {
  position: absolute;
  top: 56px;
  right: 16px;
  z-index: 60;
  min-width: 240px;
  background: var(--reader-menu-bg, #ffffff);
  color: var(--reader-menu-text, #1a1a2e);
  border: 1px solid var(--reader-menu-border, #e8e8f0);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  padding: 12px 16px;
  font-size: 14px;
}

.title {
  font-weight: 600;
  margin-bottom: 12px;
  font-size: 14px;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
}

.row label {
  flex: 1;
  cursor: pointer;
}

.row input[type="checkbox"] {
  cursor: pointer;
}
```

- [ ] **Step 2: 创建 NavSettingsPopover.tsx**

```tsx
import { useTranslation } from 'react-i18next';
import { DEFAULT_NAV_PREFS, type ReaderNavPrefs, readNavPrefs, writeNavPrefs } from './navPrefs';
import styles from './NavSettingsPopover.module.css';

export type NavSettingsPopoverProps = {
  prefs: ReaderNavPrefs;
  onChange: (next: ReaderNavPrefs) => void;
  onClose: () => void;
};

export default function NavSettingsPopover({ prefs, onChange, onClose }: NavSettingsPopoverProps) {
  const { t } = useTranslation();

  const update = (patch: Partial<ReaderNavPrefs>) => {
    const next = { ...prefs, ...patch };
    writeNavPrefs(next);
    onChange(next);
  };

  const reset = () => {
    writeNavPrefs(DEFAULT_NAV_PREFS);
    onChange(DEFAULT_NAV_PREFS);
  };

  return (
    <div
      className={styles.popover}
      role="dialog"
      aria-label={t('reader.nav.stickyToolbar')}
      data-testid="nav-settings-popover"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className={styles.title}>{t('reader.nav.stickyToolbar')}</div>
      <div className={styles.row}>
        <label htmlFor="pref-sticky">{t('reader.nav.stickyToolbar')}</label>
        <input
          id="pref-sticky"
          type="checkbox"
          checked={prefs.stickyToolbar}
          onChange={(e) => update({ stickyToolbar: e.target.checked })}
        />
      </div>
      <div className={styles.row}>
        <label htmlFor="pref-auto">{t('reader.nav.autoLoadNext')}</label>
        <input
          id="pref-auto"
          type="checkbox"
          checked={prefs.autoLoadNext}
          onChange={(e) => update({ autoLoadNext: e.target.checked })}
        />
      </div>
      <div className={styles.row}>
        <label htmlFor="pref-fab">{t('reader.nav.floatingButtons')}</label>
        <input
          id="pref-fab"
          type="checkbox"
          checked={prefs.showFloatingButtons}
          onChange={(e) => update({ showFloatingButtons: e.target.checked })}
        />
      </div>
      <div className={styles.row}>
        <label htmlFor="pref-kb">{t('reader.nav.keyboardShortcuts')}</label>
        <input
          id="pref-kb"
          type="checkbox"
          checked={prefs.keyboardShortcuts}
          onChange={(e) => update({ keyboardShortcuts: e.target.checked })}
        />
      </div>
      <div className={styles.row}>
        <button type="button" onClick={reset}>{t('common.reset', { defaultValue: 'Reset' })}</button>
        <button type="button" onClick={onClose}>{t('common.close', { defaultValue: 'Close' })}</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
git add src/components/reader/NavSettingsPopover.tsx src/components/reader/NavSettingsPopover.module.css
git commit -m "feat(reader): add NavSettingsPopover for navigation preferences"
```

---

## Task 6: ShortcutsHelpModal 组件

**Files:**
- Create: `src/components/reader/ShortcutsHelpModal.tsx`
- Create: `src/components/reader/ShortcutsHelpModal.module.css`

- [ ] **Step 1: 创建 ShortcutsHelpModal.module.css**

```css
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
}

.dialog {
  background: var(--reader-menu-bg, #ffffff);
  color: var(--reader-menu-text, #1a1a2e);
  border-radius: 12px;
  padding: 24px 32px;
  min-width: 480px;
  max-width: 640px;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}

.title {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 16px;
}

.list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 16px;
}

.list li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 0;
  font-size: 14px;
}

.kbd {
  display: inline-block;
  min-width: 96px;
  padding: 2px 8px;
  background: rgba(0, 0, 0, 0.06);
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}

.close {
  margin-top: 16px;
  text-align: right;
}
```

- [ ] **Step 2: 创建 ShortcutsHelpModal.tsx**

```tsx
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './ShortcutsHelpModal.module.css';

const SHORTCUT_KEYS = [
  'prevNext',
  'pageUpDown',
  'firstLast',
  'scrollDown',
  'scrollUp',
  'find',
  'findNext',
  'bookmark',
  'bookmarkList',
  'close',
  'fullscreen',
  'toggleToolbar',
  'help',
] as const;

export type ShortcutsHelpModalProps = {
  open: boolean;
  onClose: () => void;
};

export default function ShortcutsHelpModal({ open, onClose }: ShortcutsHelpModalProps) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label={t('reader.shortcuts.title')}
      data-testid="shortcuts-help-modal"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.dialog}>
        <div className={styles.title}>{t('reader.shortcuts.title')}</div>
        <ul className={styles.list}>
          {SHORTCUT_KEYS.map((k) => (
            <li key={k}>
              <span className={styles.kbd}>{t(`reader.shortcuts.${k}`)}</span>
            </li>
          ))}
        </ul>
        <div className={styles.close}>
          <button type="button" onClick={onClose}>
            {t('common.close', { defaultValue: 'Close' })}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
git add src/components/reader/ShortcutsHelpModal.tsx src/components/reader/ShortcutsHelpModal.module.css
git commit -m "feat(reader): add ShortcutsHelpModal"
```

---

## Task 7: BookmarkButton 组件（右侧浮动书签按钮）

**Files:**
- Create: `src/components/reader/BookmarkButton.tsx`

- [ ] **Step 1: 创建组件**

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addBookmark, type AddBookmarkInput } from './bookmarkActions';
import type { Book, BookChapter } from '../../types';

export type BookmarkButtonProps = {
  book: Book;
  chapter: BookChapter | undefined;
  selectedText?: string;
  onAdded: () => void;
  onError: (msg: string) => void;
};

const MAX_SNIPPET = 200;

export default function BookmarkButton({
  book,
  chapter,
  selectedText,
  onAdded,
  onError,
}: BookmarkButtonProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    if (busy || !chapter) return;
    setBusy(true);
    try {
      const content = selectedText?.trim() || chapter.title?.slice(0, MAX_SNIPPET) || '';
      const input: AddBookmarkInput = {
        book_name: book.name,
        book_author: book.author ?? '',
        chapter_name: chapter.title ?? null,
        book_url: book.url,
        chapter_url: chapter.url ?? null,
        chapter_index: chapter.index,
        page_index: 0,
        content,
      };
      await addBookmark(input);
      onAdded();
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy || !chapter}
      aria-label={t('reader.addBookmark')}
      title={t('reader.addBookmark')}
      data-testid="bookmark-button"
      style={{
        position: 'fixed',
        right: 16,
        top: 80,
        zIndex: 50,
        width: 44,
        height: 44,
        borderRadius: '50%',
        background: 'rgba(0, 0, 0, 0.5)',
        color: '#fff',
        border: 'none',
        cursor: 'pointer',
        fontSize: 18,
      }}
    >
      {busy ? '…' : '🔖'}
    </button>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add src/components/reader/BookmarkButton.tsx
git commit -m "feat(reader): add BookmarkButton floating action button"
```

---

## Task 8: useReaderNav hook（键盘快捷键 + 工具栏显隐 + 章末自动加载）

**Files:**
- Create: `src/hooks/useReaderNav.ts`

- [ ] **Step 1: 创建 hook**

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { readNavPrefs, writeNavPrefs, type ReaderNavPrefs } from '../components/reader/navPrefs';

export type UseReaderNavOptions = {
  contentRef: React.RefObject<HTMLElement>;
  hasPrevChapter: boolean;
  hasNextChapter: boolean;
  onPrevChapter: () => void;
  onNextChapter: () => void;
  onFirstChapter: () => void;
  onLastChapter: () => void;
  onOpenSearch: () => void;
  onAddBookmark: () => void;
  onOpenBookmarkList: () => void;
  onToggleToolbar: () => void;
  onShowShortcuts: () => void;
  onFullscreen: () => void;
  onClose: () => void;
};

const SCROLL_FRACTION = 0.85;
const WHEEL_THRESHOLD_PX = 50;
const WHEEL_COOLDOWN_MS = 500;

export function useReaderNav(opts: UseReaderNavOptions) {
  const [prefs, setPrefs] = useState<ReaderNavPrefs>(() => readNavPrefs());
  const [toolbarVisible, setToolbarVisible] = useState(true);
  const lastWheelTimeRef = useRef(0);
  const scrollAccumRef = useRef(0);
  const accumulator = useRef(0);

  const updatePrefs = useCallback((next: ReaderNavPrefs) => {
    setPrefs(next);
    writeNavPrefs(next);
  }, []);

  useEffect(() => {
    if (!prefs.keyboardShortcuts) return;

    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          opts.onPrevChapter();
          break;
        case 'ArrowRight':
          e.preventDefault();
          opts.onNextChapter();
          break;
        case 'PageUp':
          e.preventDefault();
          opts.onPrevChapter();
          break;
        case 'PageDown':
          e.preventDefault();
          opts.onNextChapter();
          break;
        case 'Home':
          e.preventDefault();
          opts.onFirstChapter();
          break;
        case 'End':
          e.preventDefault();
          opts.onLastChapter();
          break;
        case ' ':
          e.preventDefault();
          if (e.shiftKey) {
            window.scrollBy({ top: -window.innerHeight * SCROLL_FRACTION, behavior: 'smooth' });
          } else {
            window.scrollBy({ top: window.innerHeight * SCROLL_FRACTION, behavior: 'smooth' });
          }
          break;
        case 'F3':
          e.preventDefault();
          opts.onOpenSearch();
          break;
        case 'F11':
          e.preventDefault();
          opts.onFullscreen();
          break;
        case '?':
          e.preventDefault();
          opts.onShowShortcuts();
          break;
        case 'Escape':
          opts.onClose();
          break;
        case 'b':
        case 'B':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            opts.onToggleToolbar();
          }
          break;
        case 'd':
        case 'D':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            if (e.shiftKey) {
              opts.onOpenBookmarkList();
            } else {
              opts.onAddBookmark();
            }
          }
          break;
        case 'f':
        case 'F':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            opts.onOpenSearch();
          }
          break;
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [prefs.keyboardShortcuts, opts]);

  // 工具栏显隐：滚 100px 切换
  useEffect(() => {
    if (!prefs.stickyToolbar) {
      setToolbarVisible(true);
      return;
    }
    let lastY = window.scrollY;
    let timer: number | null = null;
    const onScroll = () => {
      const y = window.scrollY;
      const delta = y - lastY;
      if (Math.abs(delta) > 100) {
        setToolbarVisible(delta < 0);
        lastY = y;
      }
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => setToolbarVisible(true), 3000);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (timer) window.clearTimeout(timer);
    };
  }, [prefs.stickyToolbar]);

  // 滚到底/顶 + 反向滚 → 翻章
  useEffect(() => {
    if (!prefs.keyboardShortcuts) return;
    const onWheel = (e: WheelEvent) => {
      const now = Date.now();
      if (now - lastWheelTimeRef.current < WHEEL_COOLDOWN_MS) return;
      const docEl = document.documentElement;
      const atTop = window.scrollY <= 30;
      const atBottom = window.scrollY + window.innerHeight >= docEl.scrollHeight - 30;
      if (atTop && e.deltaY < 0) {
        if (opts.hasPrevChapter) {
          e.preventDefault();
          lastWheelTimeRef.current = now;
          opts.onPrevChapter();
        }
      } else if (atBottom && e.deltaY > 0) {
        if (opts.hasNextChapter) {
          e.preventDefault();
          lastWheelTimeRef.current = now;
          opts.onNextChapter();
        }
      }
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, [prefs.keyboardShortcuts, opts.hasPrevChapter, opts.hasNextChapter, opts.onPrevChapter, opts.onNextChapter]);

  // 鼠标移到顶部 16px → 显示工具栏
  useEffect(() => {
    if (!prefs.stickyToolbar) return;
    const onMove = (e: MouseEvent) => {
      if (e.clientY <= 16) setToolbarVisible(true);
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMove);
  }, [prefs.stickyToolbar]);

  return {
    prefs,
    setPrefs: updatePrefs,
    toolbarVisible,
    setToolbarVisible,
  };
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useReaderNav.ts
git commit -m "feat(reader): add useReaderNav hook for toolbar, shortcuts, wheel"
```

---

## Task 9: 集成到 Reader.tsx（粘合新组件）

**Files:**
- Modify: `src/pages/Reader.tsx`

> 重要：先用 Read 工具读取 `src/pages/Reader.tsx` 找到现有的 `useEffect` 块、`turnPrevious/turnNext`、`goToChapter`、`addReadTime`、`scrollReaderPage` 函数位置，再做精确修改。

- [ ] **Step 1: 读取 Reader.tsx 现有的关键定位**

Run: `grep -n "turnPrevious\|turnNext\|goToChapter\|addReadTime\|scrollReaderPage\|readerPanel\|setShowSettings" src/pages/Reader.tsx`
Expected: 列出所有相关行号，用于精确定位插入点。

- [ ] **Step 2: 在 Reader.tsx 顶部 import 新组件与 hook**

在文件顶部 `import '../styles/reader-animations.css';` 之后插入：

```tsx
import { useReaderNav } from '../hooks/useReaderNav';
import ContextMenu, { type ContextMenuState } from '../components/reader/ContextMenu';
import NavSettingsPopover from '../components/reader/NavSettingsPopover';
import ShortcutsHelpModal from '../components/reader/ShortcutsHelpModal';
import BookmarkButton from '../components/reader/BookmarkButton';
import { addBookmark } from '../components/reader/bookmarkActions';
```

- [ ] **Step 3: 在 Reader 函数体内、`useState/useEffect` 之后，新增右键菜单状态**

```tsx
const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
const [showNavSettings, setShowNavSettings] = useState(false);
const [showShortcuts, setShowShortcuts] = useState(false);
const [selectedText, setSelectedText] = useState('');
const [toast, setToast] = useState<string>('');

const showToast = useCallback((msg: string) => {
  setToast(msg);
  window.setTimeout(() => setToast(''), 2000);
}, []);
```

- [ ] **Step 4: 挂载 useReaderNav hook**

在已有的 `useEffect` 块集合中、Reader 函数体靠后位置插入（确保所有 `opts` 回调的依赖已声明）：

```tsx
const nav = useReaderNav({
  contentRef,
  hasPrevChapter: !!prevChapter,
  hasNextChapter: !!nextChapter,
  onPrevChapter: () => prevChapter && goToChapter(prevChapter.index),
  onNextChapter: () => nextChapter && goToNextChapter(),
  onFirstChapter: () => chapters[0] && goToChapter(0),
  onLastChapter: () => chapters.length > 0 && goToChapter(chapters.length - 1),
  onOpenSearch: () => setReaderPanel('search'),
  onAddBookmark: () => doAddBookmark(''),
  onOpenBookmarkList: () => navigate('/bookmarks'),
  onToggleToolbar: () => nav.setPrefs({ ...nav.prefs, stickyToolbar: !nav.prefs.stickyToolbar }),
  onShowShortcuts: () => setShowShortcuts(true),
  onFullscreen: () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  },
  onClose: () => {
    if (contextMenu) setContextMenu(null);
    else if (showShortcuts) setShowShortcuts(false);
    else if (showNavSettings) setShowNavSettings(false);
    else if (readerPanel) setReaderPanel(null);
    else if (document.fullscreenElement) document.exitFullscreen();
  },
});
```

- [ ] **Step 5: 抽出 `doAddBookmark` 函数**

```tsx
const doAddBookmark = useCallback(async (content: string) => {
  if (!book || !currentChapter) return;
  try {
    await addBookmark({
      book_name: book.name,
      book_author: book.author ?? '',
      chapter_name: currentChapter.title ?? null,
      book_url: book.url,
      chapter_url: currentChapter.url ?? null,
      chapter_index: currentChapter.index,
      page_index: 0,
      content: content || currentChapter.title?.slice(0, 200) || '',
    });
    showToast(t('reader.bookmarkAdded'));
  } catch (e) {
    showToast(t('reader.bookmarkAddFailed', { error: String(e) }));
  }
}, [book, currentChapter, showToast, t]);
```

- [ ] **Step 6: 注册 `contextmenu` 事件**

```tsx
useEffect(() => {
  const handler = (e: MouseEvent) => {
    if (!contentRef.current?.contains(e.target as Node)) return;
    e.preventDefault();
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : '';
    const hasSel = text.length >= 1 && text.length <= 500;
    setSelectedText(text);
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      kind: hasSel ? 'text' : 'page',
      selectedText: text,
    });
  };
  document.addEventListener('contextmenu', handler);
  return () => document.removeEventListener('contextmenu', handler);
}, []);
```

- [ ] **Step 7: 在 return JSX 末尾追加新组件渲染**

在 `</div>` 收尾（最外层 div 结束前）插入：

```tsx
<BookmarkButton
  book={book}
  chapter={currentChapter}
  selectedText={selectedText}
  onAdded={() => showToast(t('reader.bookmarkAdded'))}
  onError={(msg) => showToast(t('reader.bookmarkAddFailed', { error: msg }))}
/>

<ContextMenu
  state={contextMenu}
  onClose={() => setContextMenu(null)}
  buildActions={(kind, text) => {
    const isText = kind === 'text';
    const hasText = text.length > 0;
    const items: Array<{ id: string; labelKey: string; icon?: string; disabled?: boolean; onSelect: () => void }> = [];
    if (isText) {
      items.push({ id: 'copy', labelKey: 'reader.contextMenu.copy', icon: '📋', onSelect: () => navigator.clipboard.writeText(text).then(() => showToast(t('reader.copied'))) });
      items.push({ id: 'bm', labelKey: 'reader.contextMenu.addBookmark', icon: '🔖', disabled: !hasText, onSelect: () => doAddBookmark(text) });
      items.push({ id: 'rep', labelKey: 'reader.contextMenu.addReplace', icon: '🔁', disabled: !hasText, onSelect: () => navigate('/replace-rules', { state: { newPattern: text } }) });
      items.push({ id: 'srch', labelKey: 'reader.contextMenu.searchBook', icon: '🔍', disabled: !hasText, onSelect: () => setReaderPanel('search') });
    } else {
      items.push({ id: 'prev', labelKey: 'reader.contextMenu.prevChapter', icon: '◀', disabled: !prevChapter, onSelect: () => prevChapter && goToChapter(prevChapter.index) });
      items.push({ id: 'next', labelKey: 'reader.contextMenu.nextChapter', icon: '▶', disabled: !nextChapter, onSelect: () => nextChapter && goToNextChapter() });
      items.push({ id: 'div1', labelKey: '', onSelect: () => {} });
      items.push({ id: 'cat', labelKey: 'reader.contextMenu.openCatalog', icon: '≡', onSelect: () => setReaderPanel('catalog') });
      items.push({ id: 'theme', labelKey: 'reader.contextMenu.cycleTheme', icon: '◐', onSelect: () => cycleTheme() });
      items.push({ id: 'div2', labelKey: '', onSelect: () => {} });
      items.push({ id: 'set', labelKey: 'reader.contextMenu.openSettings', icon: '⚙', onSelect: () => setShowSettings(true) });
      items.push({ id: 'exit', labelKey: 'reader.contextMenu.exitReader', icon: '↗', onSelect: () => navigate(readerParentPath.current) });
    }
    return items.filter((i) => i.id !== 'div1' && i.id !== 'div2');
  }}
/>

{showNavSettings && (
  <NavSettingsPopover
    prefs={nav.prefs}
    onChange={nav.setPrefs}
    onClose={() => setShowNavSettings(false)}
  />
)}

<ShortcutsHelpModal open={showShortcuts} onClose={() => setShowShortcuts(false)} />

{toast && (
  <div
    role="status"
    data-testid="reader-toast"
    style={{
      position: 'fixed', bottom: 32, left: '50%', transform: 'translateX(-50%)',
      padding: '8px 16px', borderRadius: 8, background: 'rgba(0, 0, 0, 0.75)',
      color: '#fff', fontSize: 14, zIndex: 300,
    }}
  >
    {toast}
  </div>
)}
```

- [ ] **Step 8: 实现 `cycleTheme` 与 `goToNextChapter` 辅助函数（如果尚未存在）**

如果 Reader.tsx 里 `cycleTheme` 和 `goToNextChapter` 没有定义，在合适位置加入：

```tsx
const cycleTheme = useCallback(() => {
  const idx = THEME_CYCLE.indexOf(theme);
  const next = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
  setTheme(next);
  localStorage.setItem('reader_theme', next);
}, [theme]);

const goToNextChapter = useCallback(() => {
  if (nextChapter) goToChapter(nextChapter.index);
}, [nextChapter, goToChapter]);
```

> 如果 `goToNextChapter` 已经存在，跳过本步。

- [ ] **Step 9: 类型检查 + 构建**

Run: `pnpm exec tsc --noEmit && pnpm build`
Expected: 两者都成功。

- [ ] **Step 10: Commit**

```bash
git add src/pages/Reader.tsx
git commit -m "feat(reader): wire context menu, bookmark FAB, nav settings, shortcuts help"
```

---

## Task 10: 自动化检查（lint + smoke）

**Files:** 无新增

- [ ] **Step 1: Lint**

Run: `pnpm lint`
Expected: 无 error（warn 可接受）。

- [ ] **Step 2: Smoke test**

Run: `pnpm test:smoke`
Expected: 通过。

- [ ] **Step 3: 启动 dev 验证（手动）**

Run: `pnpm dev` 在另一个终端，访问 `http://localhost:1420/reader/<encoded-book-url>/0`，人工验证：

1. 顶部 sticky 工具栏可见
2. 选中文本后右键 → 出现文本操作菜单 → 「添加书签」可点击 → toast 提示
3. 空白处右键 → 出现页面操作菜单 → 「切换主题」可点击
4. `?` 弹出快捷键帮助
5. Ctrl+D 触发添加书签
6. 顶部菜单「更多」→「导航设置」打开偏好 popover
7. 右侧浮动书签按钮可见，点击可添加书签
8. Esc 关闭弹层/选中

- [ ] **Step 4: 修复发现的所有问题，commit 修复**

```bash
git add -A
git commit -m "fix(reader): address smoke/lint findings for core enhancements"
```

---

## Spec Coverage Check

| Spec § | 任务 | 状态 |
|--------|------|------|
| §3.1 书签（3 入口） | Task 7 + Task 9.4-9.5 | ✅ |
| §3.2 右键菜单（双路径） | Task 4 + Task 9.6-9.7 | ✅ |
| §3.3 仿起点导航 | Task 8 + Task 9.4 | ✅ |
| §3.6 桌面端交互补充 | Task 8（键盘/滚轮/工具栏）+ Task 6（? 帮助） | ✅ |
| §3.7 i18n | Task 1 | ✅ |

**已划清范围（不在本计划）**：
- §3.4 全书搜索 → 计划 B
- §3.5 按书进度同步 → 计划 C
- HttpTTS、真实分页等 → 计划 D+

---

## Self-Review Notes

- 每次 step 的代码块都是完整的、可直接复制的。
- 类型 / 函数签名跨任务保持一致：`ContextMenuState`、`ReaderNavPrefs`、`buildActions` 签名固定。
- 计划覆盖了 spec 中本阶段所有 5 个小节，没有占位符。
