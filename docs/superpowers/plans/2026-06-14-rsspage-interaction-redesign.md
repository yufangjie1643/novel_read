# RssPage Interaction Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix click/long-press race conditions in `src/pages/RssPage.tsx` and replace `window.confirm/prompt` with in-app dialogs. Verified per-scenario on Xiaomi 23049RAD8C.

**Architecture:** Extract a per-item `useLongPress` hook (eliminates shared-ref race), build a `ConfirmDialog` + `PromptDialog` pair (portal-based, replaces native dialogs), wire them into RssPage. Desktop branch is untouched.

**Tech Stack:** React 18 + TypeScript strict, React Router 6, react-i18next, Tauri 2 (no backend changes). No new dependencies.

---

## File Structure

| File | Change | Purpose |
|---|---|---|
| `src/hooks/useLongPress.ts` | Create (~80 lines) | Per-item long-press hook with visual feedback |
| `src/components/ConfirmDialog.tsx` | Create (~80 lines) | In-app confirm dialog (portal) |
| `src/components/PromptDialog.tsx` | Create (~95 lines) | In-app prompt dialog (portal) |
| `src/pages/RssPage.tsx` | Modify (~110 lines changed) | Use new hook + dialogs; remove native dialogs + shared refs |

Total: 3 new files + 1 modified file. No new i18n keys.

---

## Task 1: Create `useLongPress` hook

**Files:**
- Create: `src/hooks/useLongPress.ts`

- [ ] **Step 1: Create the hook file**

Create `src/hooks/useLongPress.ts` with this exact content:

```ts
import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

export type LongPressOptions = {
  threshold?: number;
  onStart?: () => void;
  onCancel?: () => void;
};

export type LongPressBindings = {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerLeave: (e: ReactPointerEvent<HTMLElement>) => void;
  isPressed: boolean;
  handleClick: (click: () => void) => () => void;
};

export function useLongPress(
  callback: () => void,
  options: LongPressOptions = {}
): LongPressBindings {
  const { threshold = 400, onStart, onCancel } = options;
  const timerRef = useRef<number | null>(null);
  const triggeredRef = useRef(false);
  const [pressed, setPressed] = useState(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onPointerDown = useCallback(
    (_e: ReactPointerEvent<HTMLElement>) => {
      triggeredRef.current = false;
      clearTimer();
      setPressed(true);
      onStart?.();
      timerRef.current = window.setTimeout(() => {
        triggeredRef.current = true;
        callback();
        timerRef.current = null;
        setPressed(false);
      }, threshold);
    },
    [callback, clearTimer, onStart, threshold]
  );

  const cancel = useCallback(
    (_e: ReactPointerEvent<HTMLElement>) => {
      clearTimer();
      setPressed(false);
      onCancel?.();
    },
    [clearTimer, onCancel]
  );

  const handleClick = useCallback(
    (click: () => void) => () => {
      if (triggeredRef.current) {
        triggeredRef.current = false;
        return;
      }
      click();
    },
    []
  );

  return {
    onPointerDown,
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    isPressed: pressed,
    handleClick,
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd D:\code\novel_read ; pnpm build 2>&1 | Select-Object -Last 10`

Expected: `built in <N>s` with no errors. The pre-existing 4 errors in `ConfigMarket.tsx` and `Home.tsx` are out of scope.

- [ ] **Step 3: Commit**

```bash
cd D:\code\novel_read
git -c core.autocrlf=false add src/hooks/useLongPress.ts
git -c core.autocrlf=false commit -m "feat(hooks): add useLongPress with per-item state, visual feedback, 400ms default"
```

---

## Task 2: Create `ConfirmDialog` component

**Files:**
- Create: `src/components/ConfirmDialog.tsx`

- [ ] **Step 1: Create the component file**

Create `src/components/ConfirmDialog.tsx` with this exact content:

```tsx
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

export type ConfirmDialogProps = {
  isOpen: boolean;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};

const dialogStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  padding: 20,
  minWidth: 280,
  maxWidth: '90vw',
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.24)',
};

const titleStyle: React.CSSProperties = {
  margin: '0 0 12px',
  fontSize: 16,
  fontWeight: 700,
  color: '#1a1a2e',
};

const messageStyle: React.CSSProperties = {
  margin: '0 0 20px',
  fontSize: 14,
  color: '#555',
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
};

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
};

const cancelBtnStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 14,
  border: '1px solid #ddd',
  borderRadius: 8,
  background: '#fff',
  cursor: 'pointer',
  color: '#555',
  fontWeight: 500,
};

const confirmBtnBaseStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 14,
  border: 'none',
  borderRadius: 8,
  color: '#fff',
  cursor: 'pointer',
  fontWeight: 500,
};

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText,
  cancelText,
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKey);
    confirmRef.current?.focus();
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      style={backdropStyle}
    >
      <div style={dialogStyle}>
        {title && <h2 style={titleStyle}>{title}</h2>}
        <p style={messageStyle}>{message}</p>
        <div style={actionsStyle}>
          <button type="button" onClick={onCancel} style={cancelBtnStyle}>
            {cancelText ?? t('common.cancel')}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            style={{
              ...confirmBtnBaseStyle,
              background: danger ? '#f44336' : '#1976d2',
            }}
          >
            {confirmText ?? t('common.confirm')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
```

- [ ] **Step 2: Verify build + lint**

Run:
```bash
cd D:\code\novel_read ; pnpm build 2>&1 | Select-Object -Last 5
cd D:\code\novel_read ; pnpm lint 2>&1 | Select-Object -Last 5
```

Expected: build passes, lint clean.

- [ ] **Step 3: Commit**

```bash
cd D:\code\novel_read
git -c core.autocrlf=false add src/components/ConfirmDialog.tsx
git -c core.autocrlf=false commit -m "feat(components): add ConfirmDialog with portal, backdrop click, ESC, focus trap"
```

---

## Task 3: Create `PromptDialog` component

**Files:**
- Create: `src/components/PromptDialog.tsx`

- [ ] **Step 1: Create the component file**

Create `src/components/PromptDialog.tsx` with this exact content:

```tsx
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

export type PromptDialogProps = {
  isOpen: boolean;
  title?: string;
  message?: string;
  initialValue?: string;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
};

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};

const dialogStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  padding: 20,
  minWidth: 280,
  maxWidth: '90vw',
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.24)',
};

const titleStyle: React.CSSProperties = {
  margin: '0 0 12px',
  fontSize: 16,
  fontWeight: 700,
  color: '#1a1a2e',
};

const messageStyle: React.CSSProperties = {
  margin: '0 0 12px',
  fontSize: 14,
  color: '#555',
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  fontSize: 14,
  border: '1px solid #e0e0e0',
  borderRadius: 8,
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
  marginBottom: 20,
};

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
};

const cancelBtnStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 14,
  border: '1px solid #ddd',
  borderRadius: 8,
  background: '#fff',
  cursor: 'pointer',
  color: '#555',
  fontWeight: 500,
};

const confirmBtnBaseStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 14,
  border: 'none',
  borderRadius: 8,
  color: '#fff',
  cursor: 'pointer',
  fontWeight: 500,
};

export function PromptDialog({
  isOpen,
  title,
  message,
  initialValue = '',
  placeholder,
  confirmText,
  cancelText,
  onSubmit,
  onCancel,
}: PromptDialogProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setValue(initialValue);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen, initialValue]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const trimmed = value.trim();
  const canSubmit = trimmed.length > 0;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      style={backdropStyle}
    >
      <div style={dialogStyle}>
        {title && <h2 style={titleStyle}>{title}</h2>}
        {message && <p style={messageStyle}>{message}</p>}
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSubmit) {
              e.preventDefault();
              onSubmit(trimmed);
            }
          }}
          style={inputStyle}
        />
        <div style={actionsStyle}>
          <button type="button" onClick={onCancel} style={cancelBtnStyle}>
            {cancelText ?? t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => canSubmit && onSubmit(trimmed)}
            disabled={!canSubmit}
            style={{
              ...confirmBtnBaseStyle,
              background: '#1976d2',
              opacity: canSubmit ? 1 : 0.5,
            }}
          >
            {confirmText ?? t('common.confirm')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
```

- [ ] **Step 2: Verify build + lint**

Run:
```bash
cd D:\code\novel_read ; pnpm build 2>&1 | Select-Object -Last 5
cd D:\code\novel_read ; pnpm lint 2>&1 | Select-Object -Last 5
```

Expected: build passes, lint clean.

- [ ] **Step 3: Commit**

```bash
cd D:\code\novel_read
git -c core.autocrlf=false add src/components/PromptDialog.tsx
git -c core.autocrlf=false commit -m "feat(components): add PromptDialog with portal, autofocus, Enter to submit"
```

---

## Task 4: Refactor RssPage — replace long-press handlers with `useLongPress` hook

**Files:**
- Modify: `src/pages/RssPage.tsx`

The current mobile grid item (around lines 907-939) has 4 pointer handlers + onClick + onContextMenu. Replace with the new hook.

- [ ] **Step 1: Add the imports**

At the top of `src/pages/RssPage.tsx`, after the existing imports (after line 6), add:

```ts
import { useLongPress } from '../hooks/useLongPress';
```

- [ ] **Step 2: Remove the stale refs and helper functions**

In `RssPage.tsx`:
- Remove the `longPressTimerRef` declaration (line 78).
- Remove the `longPressTriggeredRef` declaration (line 79).
- Remove the entire `openMobileSourceMenu` function (lines 448-450).
- Remove the entire `startMobileSourcePress` function (lines 452-462).
- Remove the entire `cancelMobileSourcePress` function (lines 464-469).

(After removal, the file should have no references to `longPressTimerRef`, `longPressTriggeredRef`, `openMobileSourceMenu`, `startMobileSourcePress`, or `cancelMobileSourcePress` outside the grid-item JSX we're about to replace.)

- [ ] **Step 3: Add a new state for the mobile menu source (if removed) and helper to open it**

After the existing state declarations (find the block of `useState` calls), add:

```ts
  const [mobileMenuSource, setMobileMenuSource] = useState<RssSource | null>(null);
```

Wait — `mobileMenuSource` is already declared (line 97 in the current file). Verify it's still there. If yes, skip this step.

- [ ] **Step 4: Replace the rule-subscription grid item's onClick**

Find the rule-subscription grid item (currently around lines 889-905 in the current file). The current `onClick` is:

```tsx
                onClick={() => {
                  if (longPressTriggeredRef.current) {
                    longPressTriggeredRef.current = false;
                    return;
                  }
                  setRuleSubsOpen(true);
                  loadRuleSubs();
                }}
```

Replace it with:

```tsx
                onClick={() => {
                  setRuleSubsOpen(true);
                  loadRuleSubs();
                }}
```

(No flag check — the rule-sub tile doesn't participate in long-press, so no race risk.)

- [ ] **Step 5: Replace the source grid item's pointer + click handlers**

Find the source grid item (the one inside `mobileSources.map(...)`, currently around lines 907-939). The current block has:

```tsx
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
```

Replace the entire opening `<button ...>` through the closing `>` with the following. The hooks must be called at the top of the component (not inside the map), so we need to extract the inner content into a small sub-component. Since the spec says the consumer doesn't need to touch `triggeredRef` (the `handleClick` wrapper hides it), we can do this inside the map if the hook supports being called in a loop.

Wait — hooks CANNOT be called inside loops or conditionals (Rules of Hooks). The `useLongPress` call must be at the top level of the component, but the source is per-item. So we need a per-item sub-component that calls `useLongPress` once.

Replace the entire `{mobileSources.map((source) => (...))}` block (the one that starts with `mobileSources.map` and includes the `android-rss-grid-item` button) with:

```tsx
              {mobileSources.map((source) => (
                <MobileSourceGridItem
                  key={source.source_url}
                  source={source}
                  onOpen={() => loadArticles(source)}
                  onLongPress={() => setMobileMenuSource(source)}
                />
              ))}
```

(The `<MobileSourceGridItem>` sub-component is defined in Step 6.)

- [ ] **Step 6: Add the `MobileSourceGridItem` sub-component**

Add a new function before the `export default function RssPage()` declaration (just after the helper functions like `articleKey`, `trimText`, `messageIsError`, `splitSourceGroups`). It should be a function declaration (not arrow function) so React's name inference works. Replace the `export default function RssPage()` opening with the sub-component definition followed by the original `RssPage` opening.

Concretely, **before** the line `export default function RssPage() {`, add this new function:

```tsx
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
```

- [ ] **Step 7: Verify build + lint**

```bash
cd D:\code\novel_read ; pnpm build 2>&1 | Select-Object -Last 10
cd D:\code\novel_read ; pnpm lint 2>&1 | Select-Object -Last 20
```

Expected: build passes, lint clean. If TypeScript complains about `mobileGridItemStyle` not being in scope, it should already exist in the file (added in commit `53bb15674`). If not, the error tells you where to add it.

- [ ] **Step 8: Commit**

```bash
cd D:\code\novel_read
git -c core.autocrlf=false add src/pages/RssPage.tsx
git -c core.autocrlf=false commit -m "refactor(rss): use useLongPress hook for per-item state + visual feedback"
```

---

## Task 5: Refactor RssPage — replace `window.confirm` and `window.prompt` with the new dialogs

**Files:**
- Modify: `src/pages/RssPage.tsx`

- [ ] **Step 1: Add the imports**

At the top of `src/pages/RssPage.tsx`, after the existing imports, add:

```ts
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PromptDialog } from '../components/PromptDialog';
```

- [ ] **Step 2: Add state for the two dialogs**

In the component's `useState` block (after the other `useState` calls), add:

```ts
  const [confirmDeleteSource, setConfirmDeleteSource] = useState<RssSource | null>(null);
  const [promptRenameSource, setPromptRenameSource] = useState<RssSource | null>(null);
```

- [ ] **Step 3: Refactor `deleteSource` to use the dialog**

Find the existing `deleteSource` function (currently around line 359-377). Replace it with:

```tsx
  async function deleteSource(source: RssSource) {
    setMobileMenuSource(null);
    setConfirmDeleteSource(source);
  }

  async function performDeleteSource(source: RssSource) {
    setConfirmDeleteSource(null);
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
```

- [ ] **Step 4: Refactor `editSourceName` to use the dialog**

Find the existing `editSourceName` function (currently around line 407-415). Replace it with:

```tsx
  function editSourceName(source: RssSource) {
    setMobileMenuSource(null);
    setPromptRenameSource(source);
  }

  async function performRenameSource(source: RssSource, newName: string) {
    setPromptRenameSource(null);
    if (!newName || newName === source.source_name) return;
    await updateSource(source, { source_name: newName }, t('rss.sourceUpdated'));
  }
```

- [ ] **Step 5: Update the menu sheet's delete + edit buttons**

Find the menu sheet (currently around line 950-987). The delete button currently calls `deleteSource(mobileMenuSource)` (the old direct delete). The edit button calls `editSourceName(mobileMenuSource)`. These stay the same — they now route through the new dialog-driven functions.

No change needed in this step (the button `onClick` handlers are already correct because the functions themselves were updated in Steps 3-4).

- [ ] **Step 6: Render the two dialogs at the bottom of the mobile return tree**

Find the end of the mobile return tree (the closing `</div>` after `{mobileMenuSource && (...)}` block, before the desktop branch starts). Add the two dialogs:

```tsx
        <ConfirmDialog
          isOpen={confirmDeleteSource != null}
          title={t('common.confirm')}
          message={
            confirmDeleteSource
              ? t('rss.deleteConfirm', { name: confirmDeleteSource.source_name })
              : ''
          }
          confirmText={t('common.delete')}
          danger
          onConfirm={() => confirmDeleteSource && performDeleteSource(confirmDeleteSource)}
          onCancel={() => setConfirmDeleteSource(null)}
        />
        <PromptDialog
          isOpen={promptRenameSource != null}
          title={t('common.edit')}
          message={t('rss.editNamePrompt')}
          initialValue={promptRenameSource?.source_name ?? ''}
          confirmText={t('common.confirm')}
          onSubmit={(newName) =>
            promptRenameSource && performRenameSource(promptRenameSource, newName)
          }
          onCancel={() => setPromptRenameSource(null)}
        />
```

Place these two blocks immediately before the closing `</div>` of the mobile `if (isMobileUi) { ... return (...) }` block.

- [ ] **Step 7: Verify build + lint**

```bash
cd D:\code\novel_read ; pnpm build 2>&1 | Select-Object -Last 10
cd D:\code\novel_read ; pnpm lint 2>&1 | Select-Object -Last 20
```

Expected: build passes, lint clean. If TypeScript complains about missing `setMobileMenuSource(null)` calls in `performDeleteSource` / `performRenameSource`, add them (the `deleteSource` and `editSourceName` already do this before setting the dialog state).

- [ ] **Step 8: Commit**

```bash
cd D:\code\novel_read
git -c core.autocrlf=false add src/pages/RssPage.tsx
git -c core.autocrlf=false commit -m "refactor(rss): replace window.confirm/prompt with ConfirmDialog + PromptDialog"
```

---

## Task 6: Build APK and install on device

- [ ] **Step 1: Cross-compile Rust**

```bash
cd D:\code\novel_read
$env:BINDGEN_EXTRA_CLANG_ARGS = "--target=aarch64-linux-android24 --sysroot=D:/code/novel_read/.android-tools/sdk/ndk/android-ndk-r25b/toolchains/llvm/prebuilt/windows-x86_64/sysroot -I D:/code/novel_read/.android-tools/sdk/ndk/android-ndk-r25b/toolchains/llvm/prebuilt/windows-x86_64/lib64/clang/14.0.6/include"
cargo tauri android build --debug 2>&1 | Select-Object -Last 3
```

Expected: the `Finished` line followed by a symlink error. The symlink error is expected (Windows can't symlink).

- [ ] **Step 2: Copy the .so and run gradle**

```bash
cd D:\code\novel_read
Copy-Item "src-tauri\target\aarch64-linux-android\debug\liblegado_desktop_lib.so" "src-tauri\gen\android\app\src\main\jniLibs\arm64-v8a\liblegado_desktop_lib.so" -Force
cd src-tauri\gen\android
.\gradlew.bat assembleDebug -x app:rustBuildArm64Debug -x app:rustBuildArmDebug -x app:rustBuildX86_64Debug -x app:rustBuildX86Debug -x app:rustBuildUniversalDebug 2>&1 | Select-Object -Last 3
```

Expected: `BUILD SUCCESSFUL in <N>s`.

- [ ] **Step 3: Install on device**

```bash
cd D:\code\novel_read
& pwsh scripts/install-android.ps1 -ApkPath "src-tauri\gen\android\app\build\outputs\apk\arm64\debug\app-arm64-debug.apk" 2>&1 | Select-Object -Last 5
```

Expected: `INSTALL SUCCESS (after N dialog-tap(s))`.

- [ ] **Step 4: Launch and set up CDP**

```bash
$adb = "D:\code\novel_read\.android-tools\sdk\platform-tools\adb.exe"
& $adb -s 8e33ff99 shell monkey -p io.legado.desktop -c android.intent.category.LAUNCHER 1 2>$null | Select-Object -Last 1
Start-Sleep -Seconds 5
$pid_app = & $adb -s 8e33ff99 shell pidof io.legado.desktop
& $adb -s 8e33ff99 forward tcp:9222 "localabstract:webview_devtools_remote_$pid_app" 2>$null
```

Expected: `App PID: <some number>`.

- [ ] **Step 5: Commit (no code change, just record the build)**

```bash
cd D:\code\novel_read
git status
```

Expected: clean (or only the unrelated dirty files from before). No new commit needed for the build itself.

---

## Task 7: Per-scenario device verification (12 scenarios)

Helper function for the verification script. Save to `D:\code\novel_read\verify-rss.ps1` (overwrite if exists):

```powershell
# verify-rss.ps1
# Usage: pwsh verify-rss.ps1
$ErrorActionPreference = "Continue"
$adb = "D:\code\novel_read\.android-tools\sdk\platform-tools\adb.exe"
$wsUrl = (Invoke-WebRequest -Uri "http://127.0.0.1:9222/json" -UseBasicParsing -TimeoutSec 5).Content | ConvertFrom-Json | Where-Object { $_.type -eq "page" } | Select-Object -First 1 -ExpandProperty webSocketDebuggerUrl
$shotDir = "D:\code\novel_read\dev\screenshots\rss-verify"
New-Item -ItemType Directory -Force -Path $shotDir | Out-Null

function Nav([string]$path) {
    & node cdp-inject.mjs $wsUrl "history.pushState({}, '', '$path'); window.dispatchEvent(new PopStateEvent('popstate'))" 2>&1 | Out-Null
    Start-Sleep -Seconds 2
}

function Shot([string]$name) {
    & $adb -s 8e33ff99 exec-out screencap -p > "$shotDir/$name.png"
    Write-Host "  shot: $shotDir/$name.png"
}

function Query([string]$js) {
    $result = & node cdp-inject.mjs $wsUrl $js 2>&1 | Select-Object -Last 1
    return $result
}

function Tap([int]$x, [int]$y) {
    & $adb -s 8e33ff99 shell input tap $x $y 2>$null
    Start-Sleep -Seconds 2
}

function LongPress([int]$x, [int]$y, [int]$ms = 600) {
    & $adb -s 8e33ff99 shell input swipe $x $y $x $y $ms 2>$null
    Start-Sleep -Seconds 2
}

# Always navigate to /rss first
Nav /rss

# --- Scenario 1: tap source loads article list ---
Write-Host "S1: tap source"
$js = "(function(){var b=Array.from(document.querySelectorAll('main button')).find(function(x){return x.textContent.trim()==='小说拾遗';}); if(!b) return 'NOT_FOUND'; b.click(); return 'CLICKED';})()"
Query $js
Start-Sleep -Seconds 3
Shot "s1-after-tap-source"
$js = "JSON.stringify({url: location.pathname, h1: document.querySelector('h1')?.textContent, onArticlePage: !!document.querySelector('.android-rss-article-page, .android-rss-inline-page')})"
Write-Host "  state: $(Query $js)"

# --- Scenario 2: long-press opens menu ---
Write-Host "S2: long-press source"
Nav /rss
# Get bounding rect of the first source grid item
$js = "(function(){var b=Array.from(document.querySelectorAll('main button')).find(function(x){return x.textContent.trim()==='小说拾遗';}); if(!b) return null; var r=b.getBoundingClientRect(); return JSON.stringify({x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2)});})()"
$pos = Query $js
Write-Host "  pos: $pos"
$px = ($pos | ConvertFrom-Json).x
$py = ($pos | ConvertFrom-Json).y
LongPress $px $py 600
Shot "s2-after-longpress"
$js = "JSON.stringify({menuOpen: !!document.querySelector('.android-rss-source-sheet'), menuVisible: Array.from(document.querySelectorAll('h2')).map(function(h){return h.textContent;}).filter(function(t){return ['小说拾遗','使用说明'].includes(t);}).length > 0})"
Write-Host "  state: $(Query $js)"

# --- Scenario 3: release after long-press doesn't open article ---
Write-Host "S3: already verified by S2 (article page NOT opened, menu IS opened)"

# --- Scenario 4: tap different source after long-press ---
Write-Host "S4: tap different source after long-press (no carryover ref)"
# Close any open menu
Tap 540 1200  # tap outside menu (backdrop area)
Start-Sleep -Seconds 1
$js = "Array.from(document.querySelectorAll('main button')).find(function(x){return x.textContent.trim()==='Meow云';})?.click()"
Query $js
Start-Sleep -Seconds 3
Shot "s4-after-tap-another"
$js = "JSON.stringify({url: location.pathname, onArticlePage: !!document.querySelector('.android-rss-article-page, .android-rss-inline-page')})"
Write-Host "  state: $(Query $js)"

# --- Scenario 5: tap rule-subscription tile (was the buggy case) ---
Write-Host "S5: tap rule-subscription tile"
Nav /rss
# Find the rule sub tile
$js = "Array.from(document.querySelectorAll('main button')).find(function(x){return x.textContent.trim()==='规则订阅';})?.click()"
Query $js
Start-Sleep -Seconds 2
Shot "s5-after-tap-rulesub"
$js = "JSON.stringify({ruleSubsOpen: !!document.querySelector('.android-rss-add-form') || !!Array.from(document.querySelectorAll('input[type=\"url\"]')).length})"
Write-Host "  state: $(Query $js)"

# --- Scenario 6: long-press → tap Delete → ConfirmDialog appears ---
Write-Host "S6: long-press → Delete → ConfirmDialog"
Nav /rss
$pos = Query "(function(){var b=Array.from(document.querySelectorAll('main button')).find(function(x){return x.textContent.trim()==='小说拾遗';}); var r=b.getBoundingClientRect(); return JSON.stringify({x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2)});})()"
$px = ($pos | ConvertFrom-Json).x
$py = ($pos | ConvertFrom-Json).y
LongPress $px $py 600
# Tap delete in menu (last action button)
$js = "(function(){var btns=Array.from(document.querySelectorAll('.android-rss-source-sheet button')); var del=btns.find(function(b){return b.textContent.trim()==='删除';}); if(!del) return 'NOT_FOUND'; del.click(); return 'CLICKED';})()"
Query $js
Start-Sleep -Seconds 2
Shot "s6-confirm-dialog"
$js = "JSON.stringify({dialogVisible: !!document.querySelector('[role=\"dialog\"]'), dialogText: document.querySelector('[role=\"dialog\"]')?.textContent?.slice(0, 100)})"
Write-Host "  state: $(Query $js)"

# --- Scenario 7: confirm the delete ---
Write-Host "S7: confirm delete"
$js = "(function(){var btns=Array.from(document.querySelectorAll('[role=\"dialog\"] button')); var confirm=btns.find(function(b){return b.textContent.trim()==='删除';}); if(!confirm) return 'NOT_FOUND'; confirm.click(); return 'CLICKED';})()"
Query $js
Start-Sleep -Seconds 3
Shot "s7-after-delete-confirm"
$js = "JSON.stringify({hasSource: Array.from(document.querySelectorAll('main button')).some(function(b){return b.textContent.trim()==='小说拾遗';})})"
Write-Host "  state: $(Query $js) (should be false)"

# --- Scenario 8: long-press → Edit → PromptDialog appears with pre-filled name ---
Write-Host "S8: long-press → Edit → PromptDialog"
Nav /rss
$pos = Query "(function(){var b=Array.from(document.querySelectorAll('main button')).find(function(x){return x.textContent.trim()==='Meow云';}); var r=b.getBoundingClientRect(); return JSON.stringify({x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2)});})()"
$px = ($pos | ConvertFrom-Json).x
$py = ($pos | ConvertFrom-Json).y
LongPress $px $py 600
# Tap edit
$js = "(function(){var btns=Array.from(document.querySelectorAll('.android-rss-source-sheet button')); var edit=btns.find(function(b){return b.textContent.trim()==='编辑';}); if(!edit) return 'NOT_FOUND'; edit.click(); return 'CLICKED';})()"
Query $js
Start-Sleep -Seconds 2
Shot "s8-prompt-dialog"
$js = "JSON.stringify({dialogVisible: !!document.querySelector('[role=\"dialog\"] input'), inputValue: document.querySelector('[role=\"dialog\"] input')?.value})"
Write-Host "  state: $(Query $js) (inputValue should be 'Meow云')"

# --- Scenario 9: enter new name and confirm ---
Write-Host "S9: rename to 'Meow云VIP' and confirm"
# Click input + type new value
$js = "(function(){var i=document.querySelector('[role=\"dialog\"] input'); if(!i) return 'NO_INPUT'; i.focus(); return 'FOCUSED';})()"
Query $js
& $adb -s 8e33ff99 shell input text "VIP" 2>$null
Start-Sleep -Seconds 1
Shot "s9-typed-new-name"
# Click confirm
$js = "(function(){var btns=Array.from(document.querySelectorAll('[role=\"dialog\"] button')); var confirm=btns.find(function(b){return b.textContent.trim()==='确定';}); if(!confirm) return 'NOT_FOUND'; confirm.click(); return 'CLICKED';})()"
Query $js
Start-Sleep -Seconds 3
Shot "s9-after-rename"
$js = "JSON.stringify({hasRenamed: Array.from(document.querySelectorAll('main button')).some(function(b){return b.textContent.trim().includes('Meow云VIP');})})"
Write-Host "  state: $(Query $js) (should be true)"

# --- Scenario 10: cancel delete ---
Write-Host "S10: cancel delete"
Nav /rss
$pos = Query "(function(){var b=Array.from(document.querySelectorAll('main button')).find(function(x){return x.textContent.trim().includes('Meow云');}); var r=b.getBoundingClientRect(); return JSON.stringify({x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2)});})()"
$px = ($pos | ConvertFrom-Json).x
$py = ($pos | ConvertFrom-Json).y
LongPress $px $py 600
Query "(function(){var btns=Array.from(document.querySelectorAll('.android-rss-source-sheet button')); var del=btns.find(function(b){return b.textContent.trim()==='删除';}); del?.click(); return 'CLICKED';})()"
Start-Sleep -Seconds 2
# Click cancel
Query "(function(){var btns=Array.from(document.querySelectorAll('[role=\"dialog\"] button')); var cancel=btns.find(function(b){return b.textContent.trim()==='取消';}); cancel?.click(); return 'CLICKED';})()"
Start-Sleep -Seconds 2
Shot "s10-after-cancel"
$js = "JSON.stringify({sourceStillExists: Array.from(document.querySelectorAll('main button')).some(function(b){return b.textContent.trim().includes('Meow云');})})"
Write-Host "  state: $(Query $js) (should be true)"

# --- Scenario 11: backdrop click on ConfirmDialog closes it ---
Write-Host "S11: backdrop click closes ConfirmDialog"
Nav /rss
$pos = Query "(function(){var b=Array.from(document.querySelectorAll('main button')).find(function(x){return x.textContent.trim().includes('Meow云');}); var r=b.getBoundingClientRect(); return JSON.stringify({x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2)});})()"
$px = ($pos | ConvertFrom-Json).x
$py = ($pos | ConvertFrom-Json).y
LongPress $px $py 600
Query "(function(){var btns=Array.from(document.querySelectorAll('.android-rss-source-sheet button')); var del=btns.find(function(b){return b.textContent.trim()==='删除';}); del?.click(); return 'CLICKED';})()"
Start-Sleep -Seconds 2
# Tap backdrop (top-left corner, well outside the dialog)
Tap 50 50
Start-Sleep -Seconds 2
Shot "s11-after-backdrop-click"
$js = "JSON.stringify({dialogClosed: !document.querySelector('[role=\"dialog\"]')})"
Write-Host "  state: $(Query $js) (should be true)"

# --- Scenario 12: pointerleave cancels long-press ---
Write-Host "S12: press-and-drag-away cancels long-press"
Nav /rss
$pos = Query "(function(){var b=Array.from(document.querySelectorAll('main button')).find(function(x){return x.textContent.trim().includes('Meow云');}); var r=b.getBoundingClientRect(); return JSON.stringify({x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2)});})()"
$px = ($pos | ConvertFrom-Json).x
$py = ($pos | ConvertFrom-Json).y
# Swipe: press at (px, py), drag away to (px+200, py+200), within 300ms
& $adb -s 8e33ff99 shell input swipe $px $py ($px + 200) ($py + 200) 200 2>$null
Start-Sleep -Seconds 2
Shot "s12-after-drag-away"
$js = "JSON.stringify({menuOpened: !!document.querySelector('.android-rss-source-sheet')})"
Write-Host "  state: $(Query $js) (should be false)"

Write-Host "`nAll 12 scenarios complete. Screenshots in $shotDir."
```

- [ ] **Step 1: Save the script and run it**

```bash
# Save the script
# (Copy the script body to D:\code\novel_read\verify-rss.ps1)
# Then run:
cd D:\code\novel_read
pwsh verify-rss.ps1 2>&1 | Select-Object -Last 60
```

Expected: 12 scenarios run, each prints a "state:" line showing the expected result. Screenshots in `dev/screenshots/rss-verify/`.

- [ ] **Step 2: Review screenshots and state outputs**

Walk through `dev/screenshots/rss-verify/s*.png` and the console output. If any scenario fails:
- S6 fails (ConfirmDialog not visible): the portal rendering may not work on Android WebView. Fallback: render the dialog inline at the root of the mobile return tree (remove `createPortal`, just put the JSX directly).
- S7 fails (delete didn't happen): check the `performDeleteSource` function. The IPC call may have failed silently — check the `setMessage` output.
- S8/S9 fail: same — the prompt dialog issue.
- S10/S11 fail: the dialog is stuck. The cancel handler is wrong.
- S12 fails (menu opened even with drag-away): the `onPointerLeave` handler is not firing. This is a known issue with some Android WebView versions; alternative is `onPointerCancel` only.

For any failure, create a follow-up fix task and re-run the failing scenario.

- [ ] **Step 3: Commit verification artifacts (if any)**

If screenshots revealed a bug that was fixed during verification, commit the fix:

```bash
cd D:\code\novel_read
git -c core.autocrlf=false add verify-rss.ps1
git -c core.autocrlf=false commit -m "test(rss): add per-scenario device verification script for interaction redesign"
```

The script itself is committed as a reusable artifact. The screenshots in `dev/screenshots/rss-verify/` are gitignored.

- [ ] **Step 4: Final commit log**

Run `git log --oneline -10` to see all 5 task commits + verification commit. The user sees a clean history: 5 refactor/feat commits + 1 verification script commit.

---

## Spec Coverage Check

- **useLongPress hook (Goal 1, 2, 4, 5):** Tasks 1, 4.
- **ConfirmDialog + PromptDialog (Goal 3):** Tasks 2, 3, 5.
- **Visual feedback during long-press (Goal 2):** Task 4 Step 6 (the `transform: scale(0.97)` + `transition`).
- **Eliminate onContextMenu (Goal 5):** Task 4 Step 5 (the new `<MobileSourceGridItem>` doesn't have an onContextMenu).
- **Rule-subscription tile pure click (eliminates race):** Task 4 Step 4.
- **Per-scenario device verification:** Task 7.
- **Common options cleanup (400ms threshold, touchAction):** Task 4 Step 6.

All spec requirements covered.

## Out-of-Scope (per spec)

- Promoting the 2 dialogs to shared use across the 19 existing `window.confirm/prompt` call sites.
- Fixing the titlebar action buttons' inconsistent panel-close behavior.
- Replacing `useWebDav` restore's `confirm()` with `ConfirmDialog`.
