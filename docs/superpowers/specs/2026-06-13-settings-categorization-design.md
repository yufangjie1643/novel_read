# Settings Page Categorization — Design

> **For agents:** This design restructures the monolithic `Settings.tsx` (1693 lines, 50+ preference rows) into 5 sub-pages with dedicated routes. Mobile mirrors the original Legado fork's 4-category structure; desktop gets a fresh sidebar-nav layout. The 8 existing separate-route pages (`/book-sources`, `/txt-toc-rules`, `/replace-rules`, `/dict-rules`, `/bookmarks`, `/stats`, `/file-manager`, `/about`, `/debug`) are untouched.

**Date:** 2026-06-13
**Scope:** Frontend-only refactor (single subsystem — settings page structure)
**Status:** Design approved by user; awaiting user review of written spec

---

## Problem

`Settings.tsx` is 1693 lines and handles the entire settings experience in a single file. It suffers from three concrete UX problems on the mobile path:

1. **No clear categorization.** The mobile home page dumps 13 entries in two sections labeled with the page title `settings.title` and the cryptic `settings.other` — both are reused strings that don't describe what's inside.
2. **The "other" detail page is a junk drawer.** `#other` (the hash-based sub-page in mobile mode) renders 50+ preference rows in one flat list, mixing `prefTextRow` for `local_password` next to `prefSwitchRow` for `process_text` next to `mobilePreferenceAction` for `cleanCache`. Nothing groups them.
3. **The categorization is a hash, not a URL.** The current pattern (`/settings#theme-mode`, `/settings#backup`, etc.) is hash-anchored — no browser history entries, no shareable URLs, no SEO, no proper React Router page transitions.

The desktop page has the same flatness with `sectionStyle` cards but is functional — the change there is cosmetic (sidebar nav).

The original Legado Android app solves (1) and (2) by giving the user a "我的" tab with category cards and 4 distinct sub-pages: 主题, 备份, 其它, 关于. This design copies that structure for mobile and adapts it to a desktop sidebar.

## Goals

1. **Split mobile settings into 4 sub-pages** matching Legado's 主题/备份/其它/关于 categories.
2. **Split desktop settings into 5 sub-pages** (主题/备份/通用/高级/关于) with a sidebar nav.
3. **Use real React Router routes** (no more hash anchors).
4. **Decompose `Settings.tsx` from 1693 lines into 5 sub-components** + a small router wrapper, each file ≤ 350 lines.
5. **Add nav cards to the existing "我的" mobile home page** so the 4 sub-page categories are discoverable.
6. **Zero behavior change** for the 8 existing separate-route pages (`/book-sources`, etc.) and the existing 4 hash sub-pages (which become real routes with the same content).

## Non-Goals

- No new settings, no removed settings. The 50+ prefs are reorganized, not deleted.
- No backend IPC changes. All `pref*` helpers stay in the same shared module.
- No i18n string rewrites of the existing keys (only 5 new category labels are added).
- No new visual design language — the mobile keeps the existing `android-pref-*` styles; the desktop keeps `sectionStyle` cards.
- No settings data migration. All `prefString` / `prefBool` / `prefNumber` keys (e.g., `theme_mode`, `bar_elevation`) are preserved.
- No removal of the hash-anchor fallback. Old links like `/settings#theme-mode` will continue to work — see [Migration & Rollout](#migration--rollout).

---

## Architecture

### Route map

| Old (current)             | New                                          | Source component       |
|---------------------------|----------------------------------------------|------------------------|
| `/settings` (mobile home) | `/settings` (mobile home, unchanged content) | `SettingsHome` (mobile)|
| `/settings#theme-mode`    | `/settings/theme`                            | `SettingsTheme`        |
| `/settings#backup`        | `/settings/backup`                            | `SettingsBackup`       |
| `/settings#theme-setting` | `/settings/theme` (merged into theme page)   | `SettingsTheme`        |
| `/settings#other`         | `/settings/other` (split into 通用/高级 in desktop) | `SettingsOther` (mobile) / `SettingsGeneral` + `SettingsAdvanced` (desktop) |
| `/about`                  | `/about` (unchanged)                          | `About.tsx`            |
| `/debug`                  | `/debug` (unchanged)                          | `DebugPage.tsx`        |
| `/book-sources`           | `/book-sources` (unchanged)                   | `Sources.tsx`          |
| `/txt-toc-rules`          | `/txt-toc-rules` (unchanged)                  | `TxtTocRules.tsx`      |
| `/replace-rules`          | `/replace-rules` (unchanged)                  | `ReplaceRules.tsx`     |
| `/dict-rules`             | `/dict-rules` (unchanged)                     | `DictRules.tsx`        |
| `/bookmarks`              | `/bookmarks` (unchanged)                      | `Bookmarks.tsx`        |
| `/stats`                  | `/stats` (unchanged)                          | `ReadStats.tsx`        |
| `/file-manager`           | `/file-manager` (unchanged)                    | `FileManager.tsx`      |

### Mobile structure (Legado-mirrored)

```
┌──────────────────────────────────────┐
│  [←]    我的                         │  ← title bar (existing)
├──────────────────────────────────────┤
│  ┌────────┐ ┌────────┐ ┌────────┐    │
│  │ 书源   │ │ TXT  │ │ 替换   │    │  ← existing direct-route tiles
│  └────────┘ └────────┘ └────────┘    │
│  ┌────────┐ ┌────────┐ ┌────────┐    │
│  │ 词典   │ │ Web   │ │ 主题   │    │  ← existing + 主题 tile added
│  └────────┘ └────────┘ └────────┘    │
│                                      │
│  ───── 设置 ──────                  │  ← section header
│  ┌────────┐ ┌────────┐                │
│  │  主题  │ │  备份  │                │  ← new category cards
│  └────────┘ └────────┘                │
│  ┌────────┐ ┌────────┐                │
│  │  其它  │ │ 关于  │                │
│  └────────┘ └────────┘                │
│                                      │
│  ───── 数据 ──────                  │  ← existing section
│  ┌────────┐ ┌────────┐                │
│  │ 书签   │ │ 统计   │                │
│  └────────┘ └────────┘                │
│  ┌────────┐ ┌────────┐                │
│  │ 文件   │ │ 关于   │                │
│  └────────┘ └────────┘                │
└──────────────────────────────────────┘
```

The new 4 category cards (主题/备份/其它/关于) are full-width tiles inside the "设置" section. They navigate to `/settings/theme`, `/settings/backup`, `/settings/other`, `/settings/about`.

Each sub-page uses the existing `android-pref-page` / `android-pref-category` / `android-preference-list` styles — no new mobile styles needed.

### Desktop structure (independent design)

```
┌──────────────┬──────────────────────────────────────────┐
│ 主题     [•]  │  主题设置                                │  ← h1
│ 备份        │  ─── 主题模式 ───                         │
│ 通用     [ ] │  [theme_mode select]                    │
│ 高级     [ ] │  ─── 颜色（白天）───                     │
│ 关于     [ ] │  [color_primary]   [color_accent]      │
│              │  [color_background][navbar_color]       │
│              │  ─── 颜色（夜间）───                     │
│              │  [color_primary_night] ...              │
└──────────────┴──────────────────────────────────────────┘
```

Sidebar: 200px wide, vertical button list, current selection highlighted with 3px green left border + bold text. Main panel: 600-800px content area, `sectionStyle` cards, all 4 sub-pages' content rendered in one scroll.

Sidebar shows 5 entries (主题/备份/通用/高级/关于). "通用" and "高级" are split out from the mobile "其它" because desktop has the room.

### Why different content on mobile vs desktop

The user explicitly chose to design them separately: *"桌面段和手机段逻辑不一样分开设计"* (Desktop and mobile have different logic — design them separately). The categorization is intentionally different:

| Mobile (Legado-mirrored) | Desktop (independent)      | Reason                              |
|--------------------------|------------------------------|--------------------------------------|
| 主题                    | 主题                        | Same on both — theme is theme       |
| 备份                    | 备份                        | Same on both — backup is backup     |
| 其它 (合併)              | 通用 + 高级 (split)         | Desktop has room; mobile keeps it compact |
| 关于                    | 关于                        | Same                                |

Within "其它" on mobile, the 50+ rows are kept in one flat list (matches Legado's 其它 page). On desktop, they're split into "通用" (user-facing prefs) and "高级" (debug/performance). The split criterion:

- **通用 (desktop only)**: language, homepage, auto-refresh, default-to-read, show-discovery, show-rss, replace-enable-default, media-button-on-exit, read-aloud-by-media-button, ignore-audio-focus, auto-clear-expired, show-add-to-shelf-alert
- **高级 (desktop only)**: local-password, user-agent, web-service-wake-lock, book-tree-uri, source-edit-max-line, check-source (action), upload-rule (action), cronet, anti-alias, bitmap-cache-size, image-retain-num, pre-download-num, web-port, clean-cache (action), clear-web-view-data (action), shrink-database (action), thread-count, process-text, record-log, record-heap-dump, show-manga-ui, update-to-variant

---

## File Structure

Decompose the 1693-line `Settings.tsx` into focused files. Each sub-component owns one page; the parent becomes a thin router wrapper.

| File                                              | Lines (est.) | Purpose                                           |
|---------------------------------------------------|--------------|---------------------------------------------------|
| `src/pages/Settings.tsx`                          | ~80          | Router wrapper: decides mobile vs desktop, renders the right sub-page or home |
| `src/pages/settings/SettingsHome.tsx`             | ~100         | Mobile home page (existing 我的 layout) + 4 new category tiles |
| `src/pages/settings/SettingsTheme.tsx`            | ~250         | Theme mode + day/night colors + font + status bar + navbar (both platforms) |
| `src/pages/settings/SettingsBackup.tsx`           | ~250         | WebDAV config + backup + restore (both platforms) |
| `src/pages/settings/SettingsOther.tsx`            | ~350         | Mobile: full 其它 page. (50+ rows flat list, matches Legado) |
| `src/pages/settings/SettingsGeneral.tsx`          | ~150         | Desktop only: 通用 page (user-facing prefs)       |
| `src/pages/settings/SettingsAdvanced.tsx`         | ~250         | Desktop only: 高级 page (debug, log, perf)        |
| `src/pages/settings/SettingsAbout.tsx`            | ~50          | About page (both platforms): version + exit       |
| `src/pages/settings/useSettingsPrefs.ts`         | ~80          | Shared hook: `prefString` / `prefBool` / `prefNumber` + `setStoredPref` (extracted from current Settings.tsx) |
| `src/pages/settings/index.ts`                     | ~10          | Re-exports for clean imports                      |

Net: 1693 lines → ~1570 lines (slightly less due to dead-code removal in the old `activeHash` pattern), but spread across 9 focused files each ≤ 350 lines.

---

## Data

No new state. No new IPC. No new types.

The existing `prefString` / `prefBool` / `prefNumber` keys (e.g., `theme_mode`, `bar_elevation`, `webdav_url`, `local_password`) are preserved — moved into the new sub-components without renames.

The only new i18n keys are 5 category labels:
- `settings.catTheme` (主题)
- `settings.catBackup` (备份)
- `settings.catOther` (其它)
- `settings.catGeneral` (通用 — desktop only)
- `settings.catAdvanced` (高级 — desktop only)
- `settings.catAbout` (关于)
- `settings.settingsNav` (设置 — section header on mobile)

Total: **7 new i18n keys** in `zh.json` + `en.json`.

---

## Component Design

### `useSettingsPrefs` (shared hook)

Extracts the existing `pref*` helpers from the bottom of `Settings.tsx`. Single source of truth for "how to read/write a pref to localStorage":

```ts
// src/pages/settings/useSettingsPrefs.ts
export function useSettingsPrefs() {
  const setStoredPref = useCallback((key: string, value: string | number | boolean) => {
    // … same as current Settings.tsx setStoredPref
  }, []);
  const prefString = useCallback((key: string, fallback = '') => {
    // … same as current prefString
  }, []);
  const prefBool = useCallback((key: string, fallback = false) => {
    // … same as current prefBool
  }, []);
  const prefNumber = useCallback((key: string, fallback = 0) => {
    // … same as current prefNumber
  }, []);
  return { setStoredPref, prefString, prefBool, prefNumber };
}
```

### `SettingsHome` (mobile)

Renders the existing 我的 page (the 6-tile grid: 书源管理, TXT 目录规则, 替换规则, 词典规则, 主题模式, Web 服务) + the 3 设置 sub-page tiles (备份与恢复, 主题设置, 其它设置) — but the last 3 become real `<Link to="/settings/theme">` etc. instead of `#hash`. Adds 4 new section tiles for the 4 categories (主题/备份/其它/关于) inside a new "设置" `android-pref-category` section.

### `SettingsTheme` (both platforms)

Renders the existing `theme-mode` + `theme-setting` content from `Settings.tsx:662-810` (mobile) and `:1055-1183` (desktop). The two existing sub-pages merge into one. The desktop view is wrapped in `sectionStyle` cards with the sidebar nav.

### `SettingsBackup` (both platforms)

Renders the existing `backup` content from `Settings.tsx:672-746` (mobile) and `:670-735` (desktop). The WebDAV config + backup/restore actions.

### `SettingsOther` (mobile only)

Renders the existing `other` mobile content from `Settings.tsx:812-927`. 50+ rows in a flat list. No reorganization — matches Legado's "其它" page convention.

### `SettingsGeneral` + `SettingsAdvanced` (desktop only)

Split the 50+ rows of `other` into two groups. The split is:
- **General**: ~12 user-facing prefs (language, homepage, auto-refresh, etc.)
- **Advanced**: ~30 debug/performance/cleanup prefs (cronet, anti-alias, log recording, etc.)

The split criterion is the same as the table in [Why different content on mobile vs desktop](#why-different-content-on-mobile-vs-desktop) above.

### `SettingsAbout` (both platforms)

Renders the existing `/about` page content (from `About.tsx` if it's worth merging) or just shows version + exit. Probably the lightest of the sub-pages.

### `Settings.tsx` (router wrapper)

The 80-line orchestrator:

```ts
// src/pages/Settings.tsx
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { isMobileUi } from '...';
import SettingsHome from './settings/SettingsHome';
import SettingsTheme from './settings/SettingsTheme';
// … etc

export default function Settings() {
  if (isMobileUi) {
    return (
      <Routes>
        <Route path="" element={<SettingsHome />} />
        <Route path="theme" element={<SettingsTheme />} />
        <Route path="backup" element={<SettingsBackup />} />
        <Route path="other" element={<SettingsOther />} />
        <Route path="about" element={<SettingsAbout />} />
        <Route path="*" element={<Navigate to="" replace />} />
      </Routes>
    );
  }
  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
      <SettingsSidebar />
      <main style={{ flex: 1, minWidth: 0 }}>
        <Routes>
          <Route path="" element={<Navigate to="theme" replace />} />
          <Route path="theme" element={<SettingsTheme />} />
          <Route path="backup" element={<SettingsBackup />} />
          <Route path="general" element={<SettingsGeneral />} />
          <Route path="advanced" element={<SettingsAdvanced />} />
          <Route path="about" element={<SettingsAbout />} />
          <Route path="*" element={<Navigate to="theme" replace />} />
        </Routes>
      </main>
    </div>
  );
}
```

`SettingsSidebar` is a desktop-only component rendered inline in `Settings.tsx`. It's a thin 200px nav with 5 `<NavLink>` entries.

### Hash-anchor fallback

`/settings#theme-mode`, `/settings#backup`, etc. should keep working for any users with saved bookmarks. `App.tsx` has a catch-all route for `/settings` — we add a small redirect at the top of `Settings.tsx`:

```ts
// at the top of the Settings component, before the route matching
const hash = useLocation().hash.replace(/^#/, '');
const hashRedirect: Record<string, string> = {
  'theme-mode': 'theme',
  'theme-setting': 'theme',
  'backup': 'backup',
  'other': isMobileUi ? 'other' : 'general',
};
if (hash && hashRedirect[hash]) {
  return <Navigate to={hashRedirect[hash]} replace />;
}
```

This is a 5-line shim. After 1-2 release cycles it can be removed.

---

## Data Flow

User taps "备份" tile on mobile home:
1. `Link to="/settings/backup"` → React Router navigates
2. `Settings.tsx` `Routes` matches `/settings/backup` → renders `SettingsBackup`
3. `SettingsBackup` calls `useSettingsPrefs()`, reads/writes prefs via the existing localStorage-backed helpers
4. No IPC, no async — same as the current hash sub-page

User clicks "高级" in the desktop sidebar:
1. `NavLink to="/settings/advanced"` → React Router navigates (no full page reload)
2. `Settings.tsx` `Routes` matches `/settings/advanced` → renders `SettingsAdvanced`
3. The sidebar's active class updates from React Router's `useLocation()`
4. Same `useSettingsPrefs()` hook reads/writes prefs

No data flow changes. The "state" stays in localStorage (via `setStoredPref`) just like today.

---

## Error Handling

No new error paths. The existing handlers (`cleanCache`, `clearWebViewData`, `shrinkDatabase`, `webdavTest`, `webdavBackup`, `webdavRestore`) move into the appropriate sub-component (`SettingsAdvanced` for the first three, `SettingsBackup` for the WebDAV three). The `pendingAction` helper that `alert()`s "this is a stub" stays — it's an existing pattern, not new error handling.

The `Navigate` with `replace` prop in the wildcard routes means "URL didn't match any sub-page → send to the most appropriate default". This is a navigation redirect, not an error display.

The hash-anchor fallback silently redirects to the new route. No error shown for old bookmarks.

---

## Testing

### Visual / device verification

1. Rebuild dev APK: `cargo tauri android build --debug` → copy `.so` → `gradlew assembleDebug -x app:rustBuild*` → `adb install -r`.
2. Launch on the Xiaomi 23049RAD8C device.
3. **Mobile 我的 page**:
   - Open `我的` tab → confirm the new "设置" section appears with 4 tiles (主题/备份/其它/关于).
   - Tap each tile → confirm the corresponding sub-page opens.
   - Each sub-page's title bar shows the category name.
   - Press back → confirm return to 我的.
4. **Mobile sub-pages**:
   - 主题: confirm 主题模式 + 白天/夜间颜色 + 字体/状态栏/导航栏/图标 都还在
   - 备份: confirm WebDAV + 同步 + 自动检测 都还在
   - 其它: confirm 50+ 项都还在（顺序和文案不变）
   - 关于: 显示版本号 + 退出按钮
5. **Desktop**:
   - Open `/settings` → should redirect to `/settings/theme` (mobile redirects to `/settings` home).
   - Sidebar shows 5 entries.
   - Click each → main area updates.
   - Reload `/settings/general` directly → loads correctly.
6. **Hash fallback**:
   - Open `/settings#theme-mode` → should redirect to `/settings/theme`.
   - Open `/settings#backup` → should redirect to `/settings/backup`.

### i18n

- All 7 new keys present in `zh.json` AND `en.json`.
- No existing key renames.

### Regression

- `pnpm build` (tsc + vite) passes.
- `pnpm lint` reports no new errors.
- 87 lib tests + 5 book_source_summaries tests + 3 refresh_rule_sub tests + 3 p0 + 2 p2_pool_stress + 2 p2_pragmas_recycled = 102 tests pass. (The 3 pre-existing errors in `ConfigMarket.tsx` and the 1 in `Home.tsx` are out of scope.)
- The 8 unchanged routes (`/book-sources`, `/about`, etc.) still load and behave identically.
- `cargo build --lib` still passes (no Rust changes).

### Manual diff

- `git diff` on `Settings.tsx` should show ~80 lines net (from 1693 to ~80).
- `git diff --stat` on the new `settings/` directory should show ~1570 lines added across 9 files.
- The 50+ `prefString` / `prefBool` / `prefNumber` keys are unchanged (no DB migration, no localStorage version bump).

---

## Migration & Rollout

- No DB migration.
- No localStorage schema change. All keys preserved.
- No feature flag. This is a refactor with strictly better UX and zero behavior change.
- Old `#hash` links keep working via the 5-line redirect shim in `Settings.tsx`. Remove the shim after 1-2 release cycles when most users have updated bookmarks.
- Rollback: revert the commit. The 8 unchanged routes and all `pref*` keys stay in place; only the new `settings/` directory goes away. No data loss.

---

## File Inventory

| File | Change | Purpose |
|---|---|---|
| `src/pages/Settings.tsx` | -1613 / +80 | Thin router wrapper |
| `src/pages/settings/SettingsHome.tsx` | Create (~100) | Mobile home (我的) + 4 category tiles |
| `src/pages/settings/SettingsTheme.tsx` | Create (~250) | Theme + colors + font + system bars |
| `src/pages/settings/SettingsBackup.tsx` | Create (~250) | WebDAV + backup + restore |
| `src/pages/settings/SettingsOther.tsx` | Create (~350) | Mobile 其它 (50+ rows flat list) |
| `src/pages/settings/SettingsGeneral.tsx` | Create (~150) | Desktop 通用 |
| `src/pages/settings/SettingsAdvanced.tsx` | Create (~250) | Desktop 高级 |
| `src/pages/settings/SettingsAbout.tsx` | Create (~50) | About + version + exit |
| `src/pages/settings/useSettingsPrefs.ts` | Create (~80) | Shared pref read/write hook |
| `src/pages/settings/index.ts` | Create (~10) | Re-exports |
| `src/i18n/locales/zh.json` | +7 keys | Category labels |
| `src/i18n/locales/en.json` | +7 keys | Category labels |
| `src/App.tsx` | 0 (existing `/settings` route) | Routes unchanged; Settings.tsx is a self-contained router |

Total: 1 heavily-shrunken file + 9 new files + 2 i18n touches.

---

## Spec Self-Review

- **Placeholder scan:** No TBD/TODO. All 7 sub-components have well-defined content.
- **Internal consistency:** Architecture, file inventory, and data flow all agree. Route map is consistent throughout.
- **Scope check:** Single subsystem (settings structure). Frontend-only. Single implementation plan can deliver it.
- **Ambiguity check:**
  - "其它 (mobile) vs 通用+高级 (desktop)" split — explicit table with 30+ rows categorized.
  - Hash-anchor fallback — explicit 5-line shim spec'd.
  - Sidebar nav width 200px — explicit.
  - "Main activity" stays inside 其它 on mobile (matches Legado).

---

## Out-of-Scope (Future Iterations)

These are real but not part of this design:
- Search within settings (type-ahead filter on the preference list).
- User profiles / per-user settings sync.
- Settings export/import.
- Settings undo history.
- Drag-to-reorder preference rows.
- Compact "summary card" view for a setting's current value (like the existing "currentThemeLabel" pattern, but everywhere).
