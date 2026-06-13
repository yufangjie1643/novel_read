# Settings Page Categorization — Revised Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose the 972-line `src/pages/Settings.tsx` into focused sub-components + a thin router wrapper. Real React Router routes replace the current hash anchors (`#appearance`, `#webdav`).

**Status:** Task 1 (i18n keys) is DONE in commit `6f9f8bb64`. Tasks 2-9 below are the remaining work.

**Important:** The original spec (`docs/superpowers/specs/2026-06-13-settings-categorization-design.md`) and the original plan described a future state with 1693 lines, `prefString`/`prefBool`/`prefNumber` helpers, a `legado.pref` JSON blob, and 50+ Legado-style preferences. That is not the current state of the codebase. This revised plan covers the **actual** current settings (reader preferences + WebDAV + bulk import + server + reset) and lays the foundation for future Legado-style prefs to be slotted in later.

---

## Actual current state of `Settings.tsx` (972 lines)

### Sections (in render order)

| # | Section | Lines | Mobile hash | Desktop |
|---|---|---|---|---|
| 1 | Language toggle | 463-471 | inline | inline |
| 2 | Reader (font/theme/tts/line/paragraph) | 474-575 | `#appearance` | inline |
| 3 | Search (searchConcurrency) | 578-597 | inline | inline |
| 4 | Tools (debug/book-sources/config-market links) | 600-656 | inline | inline |
| 5 | Bulk Legado import | 659-836 | inline | inline |
| 6 | Reset settings | 839-859 | inline | inline |
| 7 | WebDAV | 862-976 | `#webdav` | inline |
| 8 | Bookshelf Share (web server) | 979-1019 | inline | inline |
| 9 | About | 1021-1028 | inline | inline |

### State hooks (lines 17-37, all in one component)

- `fontSize, theme, ttsRate, lineHeight, paragraphSpacing, searchConcurrency` — reader prefs (per-key `localStorage`)
- `davUrl, davUser, davPass, davMessage, davLoading` — WebDAV
- `serverRunning, serverUrl, serverMessage` — web server
- `bulkImportUrl, bulkLinks, bulkSelected, bulkLoading, bulkImporting, bulkMessage` — bulk import

### Mobile home tiles (`mobileMineHeader`, lines 398-447)

The mobile entry page (the "我的" panel) already has 4 tiles:
- `#appearance` → reader
- `#webdav` → backup
- `/book-sources` (separate route)
- `/config-market` (separate route)

These tiles become real React Router routes in Task 9.

### Architecture constraints (carried from the original spec)

- Mobile mirrors Legado's 4-category structure.
- Desktop gets its own 5-category sidebar nav.
- All i18n keys added to both `zh.json` and `en.json` in lockstep.
- Preserve LF line endings (`git -c core.autocrlf=false`).
- The 8 separate-route pages (`/book-sources`, `/about`, etc.) stay unchanged.

---

## File structure

| File | Change | Purpose |
|---|---|---|
| `src/pages/Settings.tsx` | -870 / +90 | Thin router wrapper (mobile Routes + desktop sidebar + main Routes + hash-anchor fallback) |
| `src/pages/settings/useReaderPrefs.ts` | Create (~70 lines) | Hook: reader prefs (font/theme/tts/line/paragraph/searchConcurrency/reset) |
| `src/pages/settings/useWebDav.ts` | Create (~100 lines) | Hook: WebDAV state + test/backup/restore |
| `src/pages/settings/useBulkImport.ts` | Create (~120 lines) | Hook: bulk import state + link loading/importing |
| `src/pages/settings/useServerControl.ts` | Create (~50 lines) | Hook: web server start/stop |
| `src/pages/settings/SettingsReader.tsx` | Create (~150 lines) | Reader + Search sections (used by mobile and desktop) |
| `src/pages/settings/SettingsBackup.tsx` | Create (~120 lines) | WebDAV section |
| `src/pages/settings/SettingsBulkImport.tsx` | Create (~200 lines) | Bulk import section |
| `src/pages/settings/SettingsOther.tsx` | Create (~80 lines) | Tools + Reset + Server + Language + About (the rest) |
| `src/pages/settings/SettingsSidebar.tsx` | Create (~70 lines) | Desktop-only sidebar with 5 NavLinks |
| `src/pages/settings/index.ts` | Create (~10 lines) | Re-exports |

Total: 1 heavily-shrunken file + 10 new files.

---

## Category mapping (mobile vs desktop)

| Mobile route | Component | Content | Desktop route | Component | Content |
|---|---|---|---|---|---|
| `/settings` | `SettingsHome` (the existing 我的) + 4 category tiles | reader / backup / bulk-import / other | `/settings` | redirects to `/settings/reader` | sidebar + main panel |
| `/settings/reader` | `SettingsReader` | font/theme/tts/line/paragraph + searchConcurrency | `/settings/reader` | same | same |
| `/settings/backup` | `SettingsBackup` | WebDAV | `/settings/backup` | same | same |
| `/settings/bulk-import` | `SettingsBulkImport` | bulk import | `/settings/bulk-import` | same | same |
| `/settings/other` | `SettingsOther` | tools + reset + server + language + about | `/settings/server` | `SettingsOther` (server portion) | web server start/stop |
| — | — | — | `/settings/other` | `SettingsOther` (other portion) | tools + reset + language + about |

The mobile "其它" page combines server + tools + reset + language + about (compact, single page). Desktop splits "其它" into 2 entries ("服务" + "其它") in the sidebar because there's room.

### Hash-anchor fallback (5-line shim)

| Old hash | New route |
|---|---|
| `#appearance` | `/settings/reader` |
| `#webdav` | `/settings/backup` |

The 2 other existing hash uses (no others) redirect via the shim.

---

## Task 1: Add 7 new i18n keys  — DONE (commit `6f9f8bb64`)

Keys: `settings.catTheme`, `settings.catBackup`, `settings.catOther`, `settings.catGeneral`, `settings.catAdvanced`, `settings.catAbout`, `settings.settingsNav`. Already in `src/i18n/locales/{zh,en}.json`.

**Note:** When implementing later tasks, **do not** add any new i18n keys without first checking that the plan's "additional i18n" sections are correct. If you need a key that isn't in the 7 above, surface it in your final report.

---

## Task 2: Extract `useReaderPrefs` hook

**Files:**
- Create: `src/pages/settings/useReaderPrefs.ts`
- Modify: `src/pages/Settings.tsx` (replace the 6 reader useState hooks + 5 update functions + the reader/search section JSX with hook + component call)

### Step 1: Create the hook

`src/pages/settings/useReaderPrefs.ts` (≈70 lines):

```ts
import { useState, useCallback, useEffect } from 'react';

const DEFAULTS = {
  fontSize: 18,
  theme: 'light',
  ttsRate: 1,
  lineHeight: 1.8,
  paragraphSpacing: 0.5,
  searchConcurrency: 5,
} as const;

const KEY_MAP = {
  fontSize: 'reader_font_size',
  theme: 'reader_theme',
  ttsRate: 'reader_tts_rate',
  lineHeight: 'reader_line_height',
  paragraphSpacing: 'reader_paragraph_spacing',
  searchConcurrency: 'search_concurrency',
} as const;

export function useReaderPrefs() {
  const [fontSize, setFontSize] = useState(DEFAULTS.fontSize);
  const [theme, setTheme] = useState(DEFAULTS.theme);
  const [ttsRate, setTtsRate] = useState(DEFAULTS.ttsRate);
  const [lineHeight, setLineHeight] = useState(DEFAULTS.lineHeight);
  const [paragraphSpacing, setParagraphSpacing] = useState(DEFAULTS.paragraphSpacing);
  const [searchConcurrency, setSearchConcurrency] = useState(DEFAULTS.searchConcurrency);

  useEffect(() => {
    setFontSize(Number(localStorage.getItem(KEY_MAP.fontSize)) || DEFAULTS.fontSize);
    setTheme(localStorage.getItem(KEY_MAP.theme) || DEFAULTS.theme);
    setTtsRate(Number(localStorage.getItem(KEY_MAP.ttsRate)) || DEFAULTS.ttsRate);
    setLineHeight(Number(localStorage.getItem(KEY_MAP.lineHeight)) || DEFAULTS.lineHeight);
    setParagraphSpacing(
      Number(localStorage.getItem(KEY_MAP.paragraphSpacing)) || DEFAULTS.paragraphSpacing,
    );
    setSearchConcurrency(
      Number(localStorage.getItem(KEY_MAP.searchConcurrency)) || DEFAULTS.searchConcurrency,
    );
  }, []);

  const updateFontSize = useCallback((delta: number) => {
    setFontSize((prev) => {
      const next = Math.max(12, Math.min(36, prev + delta));
      localStorage.setItem(KEY_MAP.fontSize, String(next));
      return next;
    });
  }, []);

  const updateTheme = useCallback((name: string) => {
    setTheme(name);
    localStorage.setItem(KEY_MAP.theme, name);
  }, []);

  const updateTtsRate = useCallback((v: number) => {
    setTtsRate(v);
    localStorage.setItem(KEY_MAP.ttsRate, String(v));
  }, []);

  const updateLineHeight = useCallback((v: number) => {
    setLineHeight(v);
    localStorage.setItem(KEY_MAP.lineHeight, String(v));
  }, []);

  const updateParagraphSpacing = useCallback((v: number) => {
    setParagraphSpacing(v);
    localStorage.setItem(KEY_MAP.paragraphSpacing, String(v));
  }, []);

  const updateSearchConcurrency = useCallback((v: number) => {
    setSearchConcurrency(v);
    localStorage.setItem(KEY_MAP.searchConcurrency, String(v));
  }, []);

  const reset = useCallback(() => {
    Object.values(KEY_MAP).forEach((k) => localStorage.removeItem(k));
    setFontSize(DEFAULTS.fontSize);
    setTheme(DEFAULTS.theme);
    setTtsRate(DEFAULTS.ttsRate);
    setLineHeight(DEFAULTS.lineHeight);
    setParagraphSpacing(DEFAULTS.paragraphSpacing);
    setSearchConcurrency(DEFAULTS.searchConcurrency);
  }, []);

  return {
    fontSize, theme, ttsRate, lineHeight, paragraphSpacing, searchConcurrency,
    updateFontSize, updateTheme, updateTtsRate, updateLineHeight,
    updateParagraphSpacing, updateSearchConcurrency, reset,
  };
}
```

### Step 2: Refactor `Settings.tsx` to use the hook

In `src/pages/Settings.tsx`:
- Remove the 6 `useState` lines (fontSize/theme/ttsRate/lineHeight/paragraphSpacing/searchConcurrency).
- Remove the 5 `update*` functions.
- Remove `resetSettings()` (moves to `SettingsOther` in Task 8, but its `useReaderPrefs.reset` lives here).
- Add: `const readerPrefs = useReaderPrefs();`.
- Replace the Reader + Search JSX sections (lines 473-597) with a `<SettingsReader {...readerPrefs} />` placeholder. (The component is built in Task 5 — for now, **inline the JSX in `Settings.tsx`** and just remove the dead state. The component extraction happens in Task 5.)

### Step 3: Verify behavior unchanged

```bash
cd D:\code\novel_read ; pnpm build 2>&1 | Select-Object -Last 5
```

Expected: build passes (the 4 pre-existing errors remain). No new errors.

### Step 4: Smoke-test locally (if possible)

- Start dev server: `pnpm dev`.
- Open `/settings` in browser.
- Adjust font size, switch theme, drag TTS / line-height / paragraph-spacing / search-concurrency sliders.
- Reload page — values persist (localStorage keys unchanged).
- Click "重置" (Reset) — values reset to defaults.

### Step 5: Commit

```bash
cd D:\code\novel_read
git -c core.autocrlf=false add src/pages/settings/useReaderPrefs.ts src/pages/Settings.tsx
git -c core.autocrlf=false commit -m "refactor(settings): extract useReaderPrefs hook from Settings.tsx"
```

---

## Task 3: Extract `useWebDav` hook

**Files:**
- Create: `src/pages/settings/useWebDav.ts`
- Modify: `src/pages/Settings.tsx` (replace the 5 WebDAV useState hooks + 3 async functions with hook call)

### Step 1: Create the hook

`src/pages/settings/useWebDav.ts` (≈100 lines): move the davUrl/davUser/davPass/davMessage/davLoading state, the testWebDav/backupToWebDav/restoreFromWebDav functions, and the `useEffect` that hydrates from localStorage. Return `{ davUrl, setDavUrl, davUser, setDavUser, davPass, setDavPass, davMessage, davLoading, testWebDav, backupToWebDav, restoreFromWebDav }`.

### Step 2: Refactor `Settings.tsx`

- Remove the 5 `useState` lines for WebDAV (davUrl, davUser, davPass, davMessage, davLoading).
- Remove `testWebDav`, `backupToWebDav`, `restoreFromWebDav` functions.
- Add: `const webdav = useWebDav();`.
- Replace the WebDAV section JSX (lines 861-976) with `{/* WebDAV section moved to SettingsBackup in Task 6 */}` for now. (Component is built in Task 6.)

### Step 3: Verify + commit

```bash
cd D:\code\novel_read ; pnpm build 2>&1 | Select-Object -Last 5
git -c core.autocrlf=false add src/pages/settings/useWebDav.ts src/pages/Settings.tsx
git -c core.autocrlf=false commit -m "refactor(settings): extract useWebDav hook from Settings.tsx"
```

---

## Task 4: Extract `useBulkImport` hook

**Files:**
- Create: `src/pages/settings/useBulkImport.ts`
- Modify: `src/pages/Settings.tsx`

### Step 1: Create the hook

`src/pages/settings/useBulkImport.ts` (≈120 lines): move all 7 useState hooks (bulkImportUrl, bulkLinks, bulkSelected, bulkLoading, bulkImporting, bulkMessage) and all bulk-import functions (importTypeLabel, isSupportedImportLink, setSelectedSupportedLinks, loadBulkImportLinks, toggleBulkLink, addAll, importBulkLink, importSelectedBulkLinks) + the `DEFAULT_LEGADO_IMPORT_URL` and `SUPPORTED_IMPORT_TYPES` constants + the `importLinkKey` function. Return everything grouped.

### Step 2: Refactor `Settings.tsx`

- Remove the 7 useState lines.
- Remove all bulk-import functions + constants + `importLinkKey`.
- Add: `const bulk = useBulkImport();`.
- Replace the bulk import JSX (lines 658-836) with `{/* moved to SettingsBulkImport in Task 7 */}` for now.

### Step 3: Verify + commit

```bash
cd D:\code\novel_read ; pnpm build 2>&1 | Select-Object -Last 5
git -c core.autocrlf=false add src/pages/settings/useBulkImport.ts src/pages/Settings.tsx
git -c core.autocrlf=false commit -m "refactor(settings): extract useBulkImport hook from Settings.tsx"
```

---

## Task 5: Create `SettingsReader` component

**Files:**
- Create: `src/pages/settings/SettingsReader.tsx`
- Modify: `src/pages/Settings.tsx` (use the component instead of inline JSX for reader + search sections)

### Step 1: Create the component

`src/pages/settings/SettingsReader.tsx` (≈150 lines): take the `useReaderPrefs` return shape as props (or call the hook directly inside the component). Render the existing Reader + Search sections (lines 473-597 of the original file). Move the `rowStyle`/`labelStyle`/`sectionStyle`/`sectionTitle` style objects into the component (or shared `settings/styles.ts`).

The component is used by both mobile `/settings/reader` route and desktop `/settings/reader` route.

### Step 2: Refactor `Settings.tsx`

- Import `SettingsReader`.
- Replace lines 473-597 with `<SettingsReader />`.

### Step 3: Verify + commit

```bash
cd D:\code\novel_read ; pnpm build 2>&1 | Select-Object -Last 5
git -c core.autocrlf=false add src/pages/settings/SettingsReader.tsx src/pages/Settings.tsx
git -c core.autocrlf=false commit -m "refactor(settings): extract SettingsReader component"
```

---

## Task 6: Create `SettingsBackup` component

**Files:**
- Create: `src/pages/settings/SettingsBackup.tsx`
- Modify: `src/pages/Settings.tsx`

### Step 1: Create the component

`src/pages/settings/SettingsBackup.tsx` (≈120 lines): render the WebDAV section (lines 861-976 of the original). Uses `useWebDav()`.

### Step 2: Refactor + verify + commit

```bash
cd D:\code\novel_read ; pnpm build 2>&1 | Select-Object -Last 5
git -c core.autocrlf=false add src/pages/settings/SettingsBackup.tsx src/pages/Settings.tsx
git -c core.autocrlf=false commit -m "refactor(settings): extract SettingsBackup component"
```

---

## Task 7: Create `SettingsBulkImport` component

**Files:**
- Create: `src/pages/settings/SettingsBulkImport.tsx`
- Modify: `src/pages/Settings.tsx`

### Step 1: Create the component

`src/pages/settings/SettingsBulkImport.tsx` (≈200 lines): render the bulk import section (lines 658-836 of the original). Uses `useBulkImport()`.

### Step 2: Refactor + verify + commit

```bash
cd D:\code\novel_read ; pnpm build 2>&1 | Select-Object -Last 5
git -c core.autocrlf=false add src/pages/settings/SettingsBulkImport.tsx src/pages/Settings.tsx
git -c core.autocrlf=false commit -m "refactor(settings): extract SettingsBulkImport component"
```

---

## Task 8: Create `SettingsOther` component + `useServerControl` hook

**Files:**
- Create: `src/pages/settings/useServerControl.ts`
- Create: `src/pages/settings/SettingsOther.tsx`
- Modify: `src/pages/Settings.tsx` (replace language/tools/reset/server/about sections with `<SettingsOther />`)

### Step 1: Create the `useServerControl` hook

`src/pages/settings/useServerControl.ts` (≈50 lines): move `serverRunning`, `serverUrl`, `serverMessage` state + `useEffect(checkServerStatus)` + `toggleServer` function.

### Step 2: Create the component

`src/pages/settings/SettingsOther.tsx` (≈80 lines): render the Language toggle + Tools section (debug/book-sources/config-market links) + Reset action + web server + About. The `resetSettings` function comes from `useReaderPrefs().reset` (passed in or imported).

The component takes a `mode: 'mobile' | 'desktop'` prop. Mobile: single page. Desktop: split into 2 sidebar entries — "服务" (server) and "其它" (the rest). For the initial implementation, render all sections stacked; the routing split happens in Task 9.

### Step 3: Refactor + verify + commit

```bash
cd D:\code\novel_read ; pnpm build 2>&1 | Select-Object -Last 5
git -c core.autocrlf=false add src/pages/settings/useServerControl.ts src/pages/settings/SettingsOther.tsx src/pages/Settings.tsx
git -c core.autocrlf=false commit -m "refactor(settings): extract SettingsOther + useServerControl"
```

---

## Task 9: Refactor `Settings.tsx` to router wrapper + add `SettingsSidebar`

**Files:**
- Create: `src/pages/settings/SettingsSidebar.tsx`
- Create: `src/pages/settings/index.ts`
- Rewrite: `src/pages/Settings.tsx` (now ≤ 90 lines)

### Step 1: Create the sidebar

`src/pages/settings/SettingsSidebar.tsx` (≈70 lines): 5 `<NavLink>` entries (阅读/备份/批量导入/服务/其它). 200px wide, vertical list, active state has 3px green left border + bold text.

### Step 2: Create `index.ts` re-exports

`src/pages/settings/index.ts` (≈10 lines): re-export all 5 components + 4 hooks for clean imports.

### Step 3: Rewrite `Settings.tsx`

`src/pages/Settings.tsx` (≤ 90 lines):
- Keep the `useUiMode()` import.
- Add `Routes, Route, Navigate, useLocation, NavLink` from `react-router-dom`.
- At the top, read `location.hash` and apply the 5-line hash-anchor fallback shim (`#appearance` → `reader`, `#webdav` → `backup`).
- Branch on `isMobileUi`:
  - **Mobile:** render `<Routes>` with 5 child routes (`''` → mobile home with 4 category tiles, `reader` → `SettingsReader`, `backup` → `SettingsBackup`, `bulk-import` → `SettingsBulkImport`, `other` → `SettingsOther`).
  - **Desktop:** render a flex container with `SettingsSidebar` (200px) + main panel containing `<Routes>` with 5 child routes (`''` → `Navigate to="reader" replace`, `reader` / `backup` / `bulk-import` / `server` / `other` → respective components).
- The mobile home (`SettingsHome` inline for now) is a tile grid: 4 cards (主题/备份/批量导入/其它) + the existing 我的 profile header. The existing 4 mine tiles (`#appearance` / `#webdav` / `/book-sources` / `/config-market`) stay on the home page (they're the "data" category tiles), but the `#appearance` and `#webdav` ones become real `<Link to="/settings/reader">` and `<Link to="/settings/backup">`.

### Step 4: Verify + commit

```bash
cd D:\code\novel_read ; pnpm build 2>&1 | Select-Object -Last 5
git -c core.autocrlf=false add src/pages/Settings.tsx src/pages/settings/SettingsSidebar.tsx src/pages/settings/index.ts
git -c core.autocrlf=false commit -m "refactor(settings): convert Settings.tsx to thin router + add sidebar"
```

---

## Task 10: Build APK + device verification

### Step 1: Cross-compile Rust

```bash
cd D:\code\novel_read
cargo tauri android build --debug
```

The symlink step will fail on Windows — that's expected. Copy the `.so` manually:

```powershell
Copy-Item `
  "src-tauri\target\aarch64-linux-android\debug\liblegado_desktop_lib.so" `
  "src-tauri\gen\android\app\src\main\jniLibs\arm64-v8a\liblegado_desktop_lib.so" `
  -Force
```

### Step 2: Build APK

```powershell
cd src-tauri\gen\android
.\gradlew.bat assembleDebug `
  -x app:rustBuildArm64Debug `
  -x app:rustBuildArmDebug `
  -x app:rustBuildX86_64Debug `
  -x app:rustBuildX86Debug `
  -x app:rustBuildUniversalDebug
```

Output: `src-tauri/gen/android/app/build/outputs/apk/arm64/debug/app-arm64-debug.apk`.

### Step 3: Install on Xiaomi 23049RAD8C

```powershell
& pwsh scripts/install-android.ps1 -ApkPath "src-tauri\gen\android\app\build\outputs\apk\arm64\debug\app-arm64-debug.apk"
```

### Step 4: Visual verification

Connect CDP:
```powershell
$adb = "D:\code\novel_read\.android-tools\sdk\platform-tools\adb.exe"
& $adb -s 8e33ff99 forward tcp:9222 localabstract:webview_devtools_remote_$(adb shell pidof io.legado.desktop)
```

Then use `cdp-inject.mjs` / `cdp-frame.mjs` to:

- **Mobile "我的" page**:
  - Confirm 4 category tiles appear (主题/备份/批量导入/其它).
  - Tap each → confirm sub-page opens.
  - Press back → confirm return to home.
- **Mobile sub-pages**:
  - 阅读: font/theme/tts/line/paragraph + searchConcurrency all present and functional.
  - 备份: WebDAV form, test/backup/restore buttons.
  - 批量导入: bulk import with all controls.
  - 其它: language toggle + tools links + reset + server + about.
- **Desktop `/settings`**:
  - Redirects to `/settings/reader`.
  - Sidebar shows 5 entries.
  - Click each → main area updates.
  - Reload `/settings/backup` directly → loads.
- **Hash fallback**:
  - Open `/settings#appearance` → redirects to `/settings/reader`.
  - Open `/settings#webdav` → redirects to `/settings/backup`.

### Step 5: Regression checks

- `pnpm build` passes (the 4 pre-existing errors in `ConfigMarket.tsx` and `Home.tsx` are out of scope).
- `pnpm lint` reports no new errors.
- `cd src-tauri && cargo test` — 87 lib tests + 5 book_source_summaries + 3 refresh_rule_sub + 3 p0 + 2 p2_pool_stress + 2 p2_pragmas_recycled = 102 tests pass.
- The 8 separate-route pages (`/book-sources`, `/about`, `/debug`, `/txt-toc-rules`, `/replace-rules`, `/dict-rules`, `/bookmarks`, `/stats`, `/file-manager`) still load and behave identically.

### Step 6: Commit verification artifacts (if any)

If CDP screenshots are taken for visual regression: save under `dev/screenshots/settings-categorization/` (gitignored).

---

## Out-of-scope (future work)

These are real but not part of this revised plan:
- Add the missing Legado-style preferences that the original spec enumerated (theme colors, font scale, status bar, navbar, 30+ debug prefs). When added, they slot into `SettingsOther` (mobile) or `SettingsGeneral`/`SettingsAdvanced` (desktop).
- `useSettingsPrefs` hook with `prefString` / `prefBool` / `prefNumber` helpers (the original spec's foundation). Needed only when many more prefs are added.
- A "search within settings" type-ahead filter.
- Settings export/import.
- Per-user profile / sync.

The current `useReaderPrefs` / `useWebDav` / `useBulkImport` / `useServerControl` pattern scales to ~20 hooks without a generic abstraction. Re-evaluate at ~30 hooks.
