# RssPage Interaction Redesign — Design

**Date:** 2026-06-14
**Scope:** Frontend-only refactor of `src/pages/RssPage.tsx` (single subsystem — interaction logic)
**Status:** Awaiting user review

---

## Context

The mobile RSS page (`/rss`) has interaction-logic bugs uncovered by device testing on Xiaomi 23049RAD8C. The page renders a 2-column grid of subscription sources plus 4 expandable panels (favorites, group filter, add source, rule subscriptions). Tapping a source opens its articles; long-pressing opens a context menu (top / edit / disable / delete). Destructive actions use `window.confirm()` and `window.prompt()` which look out of place on mobile WebView.

The user reported: "订阅页面交互逻辑有问题" and asked to "重新设计一下，然后逐一验证一下".

This design covers only the interaction layer. The recently-applied CSS fix (commit `53bb15674`) is the prerequisite for this work.

---

## Problem

Three concrete categories of bug in the current RssPage:

1. **Click / long-press race conditions.**
   - `longPressTriggeredRef` is a single `useRef<boolean>` shared across all grid items. After a long-press on item A, the ref is `true`. If the user then taps item B (a fast click), B's `onClick` reads the shared ref, sees `true`, and suppresses the click — the user can't open B without first tapping elsewhere to reset the ref. (It happens that B's `onPointerDown` resets the ref, so this race is mostly hidden, but it manifests for the rule-subscription grid item, which has no `onPointerDown`.)
   - The rule-subscription grid item (line 889) has no `onPointerDown` / `onPointerUp` handlers, so it is fully coupled to the shared ref. After a long-press on any source, tapping the rule-subscription tile is suppressed until the user taps some other element first.
   - 520 ms long-press threshold is longer than the mobile-industry standard (300–500 ms); users give up and release before the menu opens.

2. **No visual feedback during long-press.** The user has no way to tell whether their press is being detected. There is no haptic, no scale animation, no progress indicator.

3. **Native dialogs in WebView.** `window.confirm()` (line 668, delete source) and `window.prompt()` (line 716, rename source) render as native browser dialogs. On Android WebView they are small, off-center, and break the visual flow. They are also not localizable beyond what the browser chooses to render.

Two secondary issues, mentioned for completeness but **out of scope for this design**:
- The 4 titlebar action buttons (favorites / groups / add / rule-subs) open panels with inconsistent close behavior.
- The `onContextMenu` handler is redundant on mobile and may double-trigger with the pointer-event long-press handler.

---

## Goals

1. **Per-item long-press lifecycle.** Each grid item has its own triggered-ref so race conditions are impossible.
2. **Visual feedback during long-press.** A subtle scale animation (0.97) on the pressed item, clearing on release. No progress ring (would add CSS complexity and a tspan timer for negligible UX gain over a simple scale).
3. **Replace native dialogs with in-app components.** `ConfirmDialog` and `PromptDialog` mounted in `RssPage` only, replacing the two native calls.
4. **Reduce long-press threshold to 400 ms.** Closer to mobile-industry standard; still above the iOS context-menu delay (300 ms) so accidental triggers are unlikely.
5. **Eliminate the `onContextMenu` handler.** Redundant on mobile (long-press is the explicit interaction). On desktop, RssPage already has dedicated `rss-source-row` click handlers — no need for context menu.
6. **Each interaction is independently testable on device.** A new `useLongPress` hook accepts a callback; a `ConfirmDialog` accepts `isOpen` + `onConfirm` + `onCancel`. Each can be exercised via the documented device-verification scenarios.

---

## Non-Goals

- **No public re-use of the new components.** `ConfirmDialog` and `PromptDialog` are only used inside `RssPage.tsx` for this iteration. Promoting them to `src/components/` is the right next step but is its own task.
- **No changes to the desktop `RssPage` branch.** Desktop still uses `window.confirm` and `window.prompt` (they look fine on desktop) and uses inline-styled `rss-source-row` for click (no long-press on desktop). The new components are mobile-only.
- **No changes to the panel-open/close state machine** (the favorites/groups/add/rule-subs buttons' inconsistent close behavior is its own task).
- **No new IPC commands.** All existing backend commands are reused.
- **No new i18n keys.** All dialog text is composed from existing i18n keys.
- **No visual companion / mockup** — text-based design is sufficient for these focused changes.

---

## Architecture

### 1. `useLongPress` hook

New file: `src/hooks/useLongPress.ts` (~50 lines).

```ts
import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

type LongPressOptions = {
  threshold?: number;       // default 400
  onStart?: () => void;     // called on pointerdown (before timer)
  onCancel?: () => void;    // called on pointerup/leave/cancel
};

type LongPressBindings = {
  onPointerDown: (e: ReactPointerEvent) => void;
  onPointerUp: (e: ReactPointerEvent) => void;
  onPointerCancel: (e: ReactPointerEvent) => void;
  onPointerLeave: (e: ReactPointerEvent) => void;
  isPressed: boolean;
};

export function useLongPress(
  callback: () => void,
  options: LongPressOptions = {}
): LongPressBindings {
  const { threshold = 400, onStart, onCancel } = options;
  const timerRef = useRef<number | null>(null);
  const triggeredRef = useRef(false);
  const [pressed, setPressed] = useState(false);

  const clear = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onPointerDown = useCallback(() => {
    triggeredRef.current = false;
    clear();
    setPressed(true);
    onStart?.();
    timerRef.current = window.setTimeout(() => {
      triggeredRef.current = true;
      callback();
      timerRef.current = null;
      setPressed(false);
    }, threshold);
  }, [callback, clear, onStart, threshold]);

  const cancel = useCallback(() => {
    clear();
    setPressed(false);
    onCancel?.();
  }, [clear, onCancel]);

  return {
    onPointerDown,
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    isPressed: pressed,
  };
}
```

**Key design points:**
- `triggeredRef` is per-hook-instance (each grid item calls `useLongPress` independently), so race conditions across items are eliminated.
- `pressed` state is exposed for visual feedback (scale animation).
- `onPointerLeave` cancels the timer, matching current behavior (scroll away = no menu).
- The hook returns the bindings directly; the consumer spreads them onto the `<button>`.

### 2. Integration with grid item

```tsx
const longPress = useLongPress(
  () => setMobileMenuSource(source),
  { threshold: 400 }
);

<button
  onClick={() => {
    // No flag check needed — pointer-up before threshold cancels the timer,
    // so the click fires only when the user tapped (no long-press).
    loadArticles(source);
  }}
  onPointerDown={longPress.onPointerDown}
  onPointerUp={longPress.onPointerUp}
  onPointerLeave={longPress.onPointerLeave}
  onPointerCancel={longPress.onPointerCancel}
  style={{
    ...mobileGridItemStyle,
    transform: longPress.isPressed ? 'scale(0.97)' : 'scale(1)',
    transition: 'transform 80ms ease-out',
    touchAction: 'manipulation',  // disables double-tap zoom + text selection on press-and-hold
  }}
>
```

Wait — the `triggeredRef` mechanism is still needed: when the long-press fires, the timer's callback runs, but the user is still holding the button. When they release, `onClick` fires. Without a flag check, the click would also fire `loadArticles(source)`, opening the article list AND the menu.

The current code handles this with `longPressTriggeredRef.current` checked in `onClick`. The new hook must preserve this. Let me refine:

```tsx
const onClick = () => {
  if (longPress.triggeredRef.current) {
    return; // suppress the click that follows a long-press
  }
  loadArticles(source);
};
```

But the consumer shouldn't need to know about `triggeredRef`. Add a `wasTriggered` check method, or expose the ref:

Option A: expose `triggeredRef` on the returned object (consumer reads `longPress.triggeredRef.current`).
Option B: provide a `suppressClick` helper that wraps the consumer's click handler.

Option B is cleaner:

```ts
type LongPressBindings = {
  // ... existing
  handleClick: (click: () => void) => () => void;
};

// inside useLongPress:
const handleClick = useCallback((click: () => void) => () => {
  if (triggeredRef.current) {
    triggeredRef.current = false;
    return;
  }
  click();
}, []);

return { ..., handleClick };
```

Then in the consumer:
```tsx
onClick={longPress.handleClick(() => loadArticles(source))}
```

This is the cleanest API. The consumer never touches the ref.

### 3. Rule-subscription grid item

The rule-subscription tile (currently line 889) has no long-press behavior. The new code:

```tsx
const ruleSubClick = () => {
  setRuleSubsOpen(true);
  loadRuleSubs();
};

<button onClick={ruleSubClick} style={{ ...mobileGridItemStyle, touchAction: 'manipulation' }}>
  ...
</button>
```

No `onPointerDown` etc. — pure click. The new `useLongPress` is not used here, so the bug (where rule-sub click was suppressed by leftover ref) is gone.

### 4. `ConfirmDialog` component

New file: `src/components/ConfirmDialog.tsx` (~70 lines).

```tsx
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

type ConfirmDialogProps = {
  isOpen: boolean;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
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
      else if (e.key === 'Enter') onConfirm();
    };
    window.addEventListener('keydown', handleKey);
    confirmRef.current?.focus();
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onCancel, onConfirm]);

  if (!isOpen) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: '#fff', borderRadius: 12, padding: 20, minWidth: 280, maxWidth: '90vw',
          boxShadow: '0 8px 32px rgba(0,0,0,0.24)',
        }}
      >
        {title && (
          <h2 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700, color: '#1a1a2e' }}>
            {title}
          </h2>
        )}
        <p style={{ margin: '0 0 20px', fontSize: 14, color: '#555', lineHeight: 1.5 }}>
          {message}
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '8px 16px', fontSize: 14, border: '1px solid #ddd',
              borderRadius: 8, background: '#fff', cursor: 'pointer', color: '#555',
            }}
          >
            {cancelText ?? t('common.cancel')}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            style={{
              padding: '8px 16px', fontSize: 14, border: 'none', borderRadius: 8,
              background: danger ? '#f44336' : '#1976d2',
              color: '#fff', cursor: 'pointer', fontWeight: 500,
            }}
          >
            {confirmText ?? t('common.confirm')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
```

**Notes:**
- Renders via portal to `document.body` so it overlays everything.
- Backdrop click and ESC close the dialog.
- Enter triggers the confirm (on the focused button).
- The confirm button is auto-focused for keyboard / screen-reader users.

**Caveat:** the existing i18n key `common.confirm` may not exist. Will use `common.ok` if it does, else `common.delete` for danger variants, else a literal "确定".

### 5. `PromptDialog` component

New file: `src/components/PromptDialog.tsx` (~90 lines). Same structure as `ConfirmDialog` plus an `<input type="text">` for the value.

```tsx
type PromptDialogProps = {
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

export function PromptDialog({ isOpen, title, message, initialValue = '', placeholder, confirmText, cancelText, onSubmit, onCancel }: PromptDialogProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setValue(initialValue);
      // focus the input after the portal mounts
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen, initialValue]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      else if (e.key === 'Enter' && value.trim()) onSubmit(value.trim());
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, value, onCancel, onSubmit]);

  if (!isOpen) return null;

  return createPortal(
    <div role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }} style={backdropStyle}>
      <div style={dialogStyle}>
        {title && <h2 style={titleStyle}>{title}</h2>}
        {message && <p style={messageStyle}>{message}</p>}
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          style={inputStyle}
        />
        <div style={actionsStyle}>
          <button type="button" onClick={onCancel} style={cancelBtnStyle}>
            {cancelText ?? t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => value.trim() && onSubmit(value.trim())}
            disabled={!value.trim()}
            style={{ ...confirmBtnStyle, opacity: value.trim() ? 1 : 0.5 }}
          >
            {confirmText ?? t('common.confirm')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
```

### 6. RssPage integration

In `RssPage.tsx`:

```tsx
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PromptDialog } from '../components/PromptDialog';
import { useLongPress } from '../hooks/useLongPress';

// In the component:
const [confirmDeleteSource, setConfirmDeleteSource] = useState<RssSource | null>(null);
const [promptRenameSource, setPromptRenameSource] = useState<RssSource | null>(null);

// Replace deleteSource:
async function deleteSource(source: RssSource) {
  setMobileMenuSource(null);
  setConfirmDeleteSource(source);
}

async function performDeleteSource(source: RssSource) {
  setConfirmDeleteSource(null);
  try {
    const resp = await invoke<ApiResponse<null>>('delete_rss_source', { url: source.source_url });
    if (!resp.success) { setMessage(t('rss.deleteFailed', { error: resp.error || '' })); return; }
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

// Replace editSourceName:
async function editSourceName(source: RssSource) {
  setMobileMenuSource(null);
  setPromptRenameSource(source);
}

async function performRenameSource(source: RssSource, newName: string) {
  setPromptRenameSource(null);
  if (!newName || newName === source.source_name) return;
  await updateSource(source, { source_name: newName }, t('rss.sourceUpdated'));
}
```

The sheet's delete button:
```tsx
<button
  type="button"
  className="danger"
  onClick={() => deleteSource(mobileMenuSource)}
>
  {t('common.delete')}
</button>
```

The sheet's edit button:
```tsx
<button type="button" onClick={() => editSourceName(mobileMenuSource)}>
  {t('common.edit')}
</button>
```

The two new dialogs at the bottom of the mobile return tree:
```tsx
<ConfirmDialog
  isOpen={confirmDeleteSource != null}
  title={t('common.confirm')}
  message={t('rss.deleteConfirm', { name: confirmDeleteSource?.source_name ?? '' })}
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
  onSubmit={(newName) => promptRenameSource && performRenameSource(promptRenameSource, newName)}
  onCancel={() => setPromptRenameSource(null)}
/>
```

### 7. Cleanup of stale ref / handlers

- Remove `longPressTimerRef`, `longPressTriggeredRef`, `startMobileSourcePress`, `cancelMobileSourcePress` from `RssPage.tsx` — they're replaced by `useLongPress`.
- Remove `onContextMenu={(e) => { e.preventDefault(); openMobileSourceMenu(source); }}` — redundant.
- Add `touchAction: 'manipulation'` to grid item style.

---

## Data Flow

1. User presses grid item → `useLongPress.onPointerDown` fires:
   - `setPressed(true)` → re-render → item scales to 0.97.
   - Timer set for 400 ms.
2. User releases before 400 ms → `useLongPress.cancel`:
   - Timer cleared.
   - `setPressed(false)` → item scales back.
   - `onClick` fires (no suppression because `triggeredRef.current` is `false`).
3. User holds past 400 ms → timer's callback:
   - `triggeredRef.current = true`.
   - User-supplied callback runs (`setMobileMenuSource(source)`).
   - `setPressed(false)` → item scales back (menu is now open).
4. User releases → `onClick` fires:
   - `handleClick` checks `triggeredRef.current` (true) → suppressed.
   - `triggeredRef.current` reset to false.
5. Delete in sheet → `deleteSource(source)` → `setConfirmDeleteSource(source)`.
6. `ConfirmDialog` portal renders. Confirm → `performDeleteSource(source)` → IPC + state cleanup. Cancel → `setConfirmDeleteSource(null)`.

The `useLongPress` hook has no shared state with any other component. Two grid items using `useLongPress` get two independent timer + ref + state instances.

---

## File Inventory

| File | Change | Purpose |
|---|---|---|
| `src/hooks/useLongPress.ts` | Create (~70 lines) | Per-item long-press hook |
| `src/components/ConfirmDialog.tsx` | Create (~70 lines) | In-app confirm dialog (portal) |
| `src/components/PromptDialog.tsx` | Create (~90 lines) | In-app prompt dialog (portal) |
| `src/pages/RssPage.tsx` | Modify (~80 lines changed) | Use new hook + dialogs; remove native dialogs; clean up stale refs |

No new i18n keys. No backend changes. No changes to other pages.

---

## Verification (per the user's request: "逐一验证")

After implementation, the following device-verification scenarios run on Xiaomi 23049RAD8C. Each is a separate CDP-driven check with a screenshot:

1. **Tap a source** → article list loads, no menu opens.
2. **Long-press a source (1 s)** → menu opens (within 400 ms of holding), no article list loads.
3. **Release after long-press** → menu stays open, no article list loads.
4. **Tap a different source after long-pressing one** → opens the new source's article list (no carryover ref).
5. **Tap the rule-subscription tile** → rule-subs panel opens (no longer suppressed by leftover ref).
6. **Long-press a source, then tap "Delete" in the menu** → in-app ConfirmDialog appears (not a native one).
7. **Confirm the delete** → source disappears from the grid, grid re-flows.
8. **Long-press a source, then tap "Edit" in the menu** → in-app PromptDialog appears with the current name pre-filled.
9. **Enter a new name and confirm** → source name updates in the grid.
10. **Cancel the delete** → source remains, menu closes.
11. **Backdrop click on ConfirmDialog** → dialog closes, no delete.
12. **Press-and-hold with a finger dragging away** (pointerleave) → menu does NOT open, item scales back when released.

Each scenario is captured by:
1. CDP `history.pushState` or `click` to trigger.
2. Screenshot via `adb exec-out screencap`.
3. DOM state query via `cdp-inject` to confirm the expected result.

---

## Risks & Mitigations

- **Portal rendering on Android WebView.** Tauri's WebView is Chromium-based and supports `createPortal` to `document.body` since React 18. Tested pattern in the codebase? Not yet. If portals fail, the fallback is to render the dialog inline at the root of the mobile return tree (no portal, no z-index stacking). Will be caught in scenario 6 and 7 device verification.
- **Existing i18n key `common.confirm` may not exist.** Will check `src/i18n/locales/{zh,en}.json` before commit; if absent, fall back to `common.ok` or literal "确定".
- **Visual feedback scale animation might feel sluggish on slow devices.** 80 ms transition is short; if it feels wrong, reduce to 50 ms in a follow-up.
- **Long-press during scroll.** `onPointerLeave` cancels the timer, so scrolling away mid-press doesn't trigger the menu. Verified by scenario 12.

---

## Spec Self-Review

- **Placeholder scan:** No TBD/TODO. All 4 new files have well-defined content. The 12 verification scenarios are concrete.
- **Internal consistency:** The `useLongPress` API is the same in the design text and the code block. The `ConfirmDialog` / `PromptDialog` props match their consumer call sites.
- **Scope check:** Single subsystem (RssPage interaction), frontend-only, single plan can deliver.
- **Ambiguity check:**
  - "Per-item state" — clarified: each `useLongPress` call creates a fresh ref + state, so two grid items are fully independent.
  - "Visual feedback" — clarified: scale(0.97) with 80ms transition. No progress ring.
  - "Replace native dialogs" — only the 2 calls in RssPage; desktop unchanged.

---

## Out-of-Scope (Future Iterations)

- Promote `ConfirmDialog` and `PromptDialog` to shared use across the 19 existing `window.confirm` / `window.prompt` call sites (10 files).
- Fix the titlebar action buttons' inconsistent panel-close behavior.
- Add a "long-press to multi-select" mode for batch operations on sources.
- Replace the global `confirm()` for `useWebDav` restore (line 96 of `useWebDav.ts`) with `ConfirmDialog`.
