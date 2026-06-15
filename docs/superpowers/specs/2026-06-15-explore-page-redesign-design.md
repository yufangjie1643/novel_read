# Explore Page Redesign — Two-Stage Layout Aligned With Upstream Legado

**Date:** 2026-06-15
**Status:** Design (brainstormed, awaiting user review)
**Owner:** novel_read desktop
**Reference:** Android Legado `ExploreFragment` + `ExploreAdapter` + `ExploreShowActivity` in `D:/code/biqvge/legado/app/src/main/java/io/legado/app/ui/main/explore/`

## Background

`src/pages/Explore.tsx` (desktop) currently renders a flat chip list of explore items, where clicking a chip replaces the page content with a 200px-grid book list for that single item. This is a "single-stage" model: every item is a top-level entry, and selecting one immediately fetches its books.

The upstream Android Legado project uses a **two-stage** model:

1. **Main `ExploreFragment`** — a list of `BookSourcePart` rows. Each row is a folded group. Tapping a row **expands** it to reveal `FlexboxLayout` of `ExploreKind` chips (sub-categories derived from the source's `exploreUrl`).
2. **`ExploreShowActivity`** — opened only when the user taps one of the `ExploreKind` chips. Renders the actual book list as a grid with infinite scroll.

The desktop page should adopt the same two-stage model so users get the same mental model across platforms, and the source-of-truth (`exploreUrl`) is rendered as the source author intended (groups → kinds) rather than flattened.

## Goals

- Match upstream's two-stage navigation: groups first, kinds second, books third.
- Preserve desktop's strengths: keyboard-driven search, lazy loading, mobile/desktop layout switch.
- Reuse the existing `ResultCard` (currently embedded in `Home.tsx`) so search results and explore results look identical.
- Zero backend changes — `get_explore_kinds` and `explore_books` are already exposed.

## Non-Goals

- Source edit / source add UI changes.
- A new sub-page for the book list beyond `ExploreShow.tsx` (no tabs, no filters).
- Changing the explore pipeline (still uses `rule_explore` + `analyze_url`).
- Replacing the Android FlexboxLayout with a JS library — we will use a CSS flexbox container in React instead.

## Architecture

### New / Changed Files

| Path | Change | Why |
|------|--------|-----|
| `src/pages/Explore.tsx` | Rewrite | Move from flat chip + grid to source-grouped list |
| `src/pages/ExploreShow.tsx` | New | Sub-page that renders the kind's book grid + infinite scroll |
| `src/components/explore/BookSourceGroup.tsx` | New | Single source row: name + expand arrow + loading spinner + child flexbox |
| `src/components/explore/ExploreKindChip.tsx` | New | One round-cornered button for one `ExploreKind` |
| `src/components/explore/BookSourceMenu.tsx` | New | Long-press popup menu (6 items) for one source |
| `src/components/search/ResultCard.tsx` | New (extracted from `Home.tsx`) | Shared card used by Home + ExploreShow |
| `src/pages/Home.tsx` | Refactor | Import `ResultCard` from the new location; no behavior change |
| `src/App.tsx` or router file | Modify | Add `/explore/show` route |
| `src/i18n/locales/{zh,en}.json` | Extend | New keys for the explore page |
| `src/hooks/useLongPress.ts` | New (or reuse existing) | 500ms long-press trigger |

### Backend Surface (no changes required)

| Command | Status | Use |
|---------|--------|-----|
| `get_explore_items` | Exists | List of all `ExploreItem` — still used to populate the page, then client groups by `source_url` |
| `get_explore_kinds(source_url)` | Exists (`src-tauri/src/commands.rs:429`) | Lazy-load sub-categories for an expanded source |
| `explore_books(source, url, page)` | Exists | Used by `ExploreShow` for infinite-scroll pages |
| `get_book_source_summaries` | Exists | Used to look up `hasLoginUrl`, `bookSourceName` for the menu |
| `top_book_source` | Exists (`src-tauri/src/commands.rs:392`) | "Pin to top" menu action; uses `min_order() - 1` |
| `delete_book_source` | Exists | "Delete" menu action |

**Note:** "Refresh explore" in the menu clears the client-side `kindsBySource[url]` cache. There is no persistent server-side cache to clear (the Android `clearExploreKindsCache` operates on the Android `ACache` shared prefs).

## Data Flow

### Main Page (`Explore.tsx`)

```
mount
  └─ invoke get_explore_items(offset=0, limit=300)        // 一次性拉满（300 cap）
       └─ group by source_url → BookSourceGroup[]
       └─ auto-expand first group
            └─ invoke get_explore_kinds(source_url) → ExploreKind[]
            └─ render chips in flexbox

user taps group row
  └─ toggle expandedSourceUrls
  └─ if newly expanded and kinds not loaded → get_explore_kinds
  └─ if already loaded → just toggle

user taps chip (ExploreKind)
  └─ navigate(/explore/show?source=&url=&title=)

user long-presses group row
  └─ open BookSourceMenu (6 items)

user types in search
  └─ client-side filter groups (case-insensitive on bookSourceName + label)
  └─ special: prefix "group:xxx" filters by bookSourceGroup
```

### Sub Page (`ExploreShow.tsx`)

```
mount with ?source=&url=&title=
  └─ invoke explore_books(source, url, page=1)
  └─ render grid (auto-fill minmax(200px, 1fr))
  └─ attach scroll listener:
       if (scrollY + innerHeight + 200 >= scrollHeight) → load next page
  └─ footer with state: "加载中…" / "点击加载更多" / "已无更多"
```

## State Model (`Explore.tsx`)

```ts
interface ExplorePageState {
  groups: BookSourceGroup[];                    // ordered by customOrder
  searchKey: string;                            // includes "group:" prefix support
  expanded: Record<SourceKey, true>;            // which sources are expanded
  kindsBySource: Record<SourceKey, KindsState>; // per-source sub-cat state
  menuOpenFor: SourceKey | null;                // which source's long-press menu is showing
  sourcesLoading: boolean;
  menuLoadingSource: SourceKey | null;          // loading kinds via long-press refresh
  error: string | null;
}

type KindsState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; kinds: ExploreKind[] }
  | { kind: 'error'; message: string };

interface BookSourceGroup {
  sourceUrl: string;
  sourceName: string;
  sourceGroup: string | null;        // bookSourceGroup
  hasLoginUrl: boolean;              // controls menu visibility
  weight: number;
  customOrder: number;
}
```

## State Model (`ExploreShow.tsx`)

```ts
interface ExploreShowState {
  source: BookSource;
  title: string;        // ExploreKind.title — shown in page title
  url: string;          // ExploreKind.url — explore URL
  books: SearchBook[];
  page: number;         // next page to load; starts at 2 after first fetch
  isLoading: boolean;
  error: string | null;
  hasMore: boolean;     // false when the previous page returned 0 books
}
```

## Components

### `BookSourceGroup.tsx`

Props: `{ group: BookSourceGroup; kindsState: KindsState; isExpanded: boolean; onToggle(): void; onMenuOpen(): void; onChipClick(kind: ExploreKind): void; onRetryKinds(): void; }`

Layout:
- Outer `div` with `padding: 10px 16px 0 16px` (matches upstream `item_find_book.xml`).
- Title row (`ll_title` equivalent):
  - Left: `sourceName` text
  - Right: spinner (20×20, accent color) when `kindsState.kind === 'loading'`; arrow `▸` (collapsed) / `▾` (expanded) otherwise
- Children container: `flex flex-wrap gap-8px padding: 8px` — hidden when collapsed
  - Renders `ExploreKindChip` for each kind, or an error retry message if `kindsState.kind === 'error'`, or an empty state if `kindsState.kind === 'ok' && kinds.length === 0`
- Long-press: 500ms; emits `onMenuOpen`
- Click row: emits `onToggle`

### `ExploreKindChip.tsx`

Props: `{ kind: ExploreKind; onClick(): void; }`

Layout: matches `item_fillet_text.xml` — pill-shaped button:
- `border-radius: 999px`
- `padding: 4px 12px`
- `background: #f5f7fa` (idle) / `#1976d2` (hover) / `#e0e0e0` (disabled)
- `color: #555` (idle) / `#fff` (hover)
- `font-size: 13px`, `font-weight: 500`
- If `kind.title.startsWith('ERROR:')` → on click open `TextDialog` showing `kind.url` (which holds the stack trace)
- If `kind.url` is null/empty → disabled (greyed out, no onClick)

### `BookSourceMenu.tsx`

Props: `{ group: BookSourceGroup; anchorEl: HTMLElement; onClose(): void; onAction(action: BookSourceAction): void; }`

Renders a fixed-position panel anchored to the long-pressed row (use `getBoundingClientRect()` to position). Uses the same ConfirmDialog/TextDialog style as the RSS page (existing `refactor(rss): use ConfirmDialog + PromptDialog` pattern). Six items:

| Action | Backend / Router call | Confirm? |
|--------|------------------------|----------|
| `edit` | `navigate('/sources')` + pass focus to sourceUrl | No |
| `top` | `invoke('top_book_source', { url })` | No |
| `login` (only if `hasLoginUrl`) | Read `bookSource.login_url` from the cached source and call `openUrl(loginUrl)` directly | No |
| `searchThis` | `navigate('/', { state: { sourceScope: sourceUrl } })` (Home page reads this and pre-selects) | No |
| `refresh` | Set `kindsBySource[url] = { kind: 'loading' }` and re-invoke `get_explore_kinds` | No |
| `delete` | `ConfirmDialog` → `invoke('delete_book_source', { url })` | Yes |

### `ResultCard.tsx` (extracted from `Home.tsx`)

Pure presentational component identical to the current `Home.tsx` inline definition. Same `isMobileUi` boolean prop. Same `onClick` prop. Used by both `Home.tsx` (search results) and `ExploreShow.tsx` (explore grid). No new behavior — just deduplication.

## Routing

Add to `App.tsx` (or wherever the router lives):

```tsx
<Route path="/explore/show" element={<ExploreShow />} />
```

`ExploreShow` reads `searchParams` to get `source`, `url`, `title`, and decodes `source` from JSON before passing to `explore_books`.

## Search Behavior (Main Page)

- Plain text (no `group:` prefix): client-side case-insensitive `includes` match against `sourceName` and the `label` of any `ExploreItem` belonging to that source.
- `group:xxx` prefix: filter to sources where `sourceGroup` contains `xxx`.
- `deferredFilter` pattern (already in use) — keeps typing responsive.
- The existing `get_explore_items(filter=...)` server call is **dropped** in favor of a one-shot full list + client-side filtering, because:
  - The list is bounded (300 item cap, single page on first load).
  - The user is filtering visual groupings, not a flat list.
  - It removes the 500ms debounce that currently exists and feels laggy on small lists.

## Error Handling

| Failure | UI | Recovery |
|---------|----|---------|
| `get_explore_items` fails | Centered red error card on main page | Retry button (re-invoke) |
| `get_explore_kinds(url)` fails | Inside the group: red text "子分类加载失败" + retry button | Re-invokes `get_explore_kinds(url)` |
| `explore_books` first page fails | Sub-page centered error card | Retry button (re-invokes page 1) |
| `explore_books` next page fails | Footer shows "加载更多（点击重试）" | Re-invokes same page |
| Empty `ExploreKind[]` | Inside the group: muted text "该书源没有发现分类" | — |
| Empty `SearchBook[]` on sub-page | Centered "未找到书籍" | — |
| `kind.title.startsWith('ERROR:')` | `TextDialog` modal with stack trace from `kind.url` | Close button |

## i18n Keys

Add to `src/i18n/locales/zh.json` and `en.json` under `explore`:

| Key | zh | en |
|---|---|---|
| `explore.searchPlaceholder` | 搜索发现源（支持 `group:xxx`） | Search sources (try `group:xxx`) |
| `explore.emptyKinds` | 该书源没有发现分类 | This source has no explore categories |
| `explore.kindsFailed` | 子分类加载失败 | Failed to load categories |
| `explore.kindsRetry` | 重试 | Retry |
| `explore.expand` | 展开 | Expand |
| `explore.collapse` | 收起 | Collapse |
| `explore.menu.edit` | 编辑书源 | Edit source |
| `explore.menu.top` | 置顶 | Pin to top |
| `explore.menu.login` | 登录 | Login |
| `explore.menu.searchThis` | 搜索该书源 | Search this source |
| `explore.menu.refresh` | 刷新分类 | Refresh categories |
| `explore.menu.delete` | 删除书源 | Delete source |
| `explore.menu.deleteConfirm` | 确定要删除 `{name}` 吗？ | Delete `{name}`? |
| `explore.show.titlePrefix` | 发现 / | Explore / |
| `explore.show.loadMore` | 点击加载更多 | Tap to load more |
| `explore.show.loading` | 加载中… | Loading… |
| `explore.show.noMore` | 已显示全部 | No more results |
| `explore.show.empty` | 未找到书籍 | No books found |
| `explore.error.load` | 加载发现列表失败 | Failed to load explore list |
| `explore.error.explore` | 加载发现分类失败 | Failed to load explore categories |
| `explore.errorDialog.title` | 分类错误 | Category error |

Keep the existing keys (`explore.title`, `explore.filterPlaceholder`, `explore.noExploreSources`, `explore.noFilterResults`, `explore.loadMore`, `explore.renderedCount`, `explore.foundBooks`, `explore.failed`, `explore.sourceNotFound`) and deprecate the ones that no longer apply:
- `explore.filterPlaceholder` → replaced by `explore.searchPlaceholder`
- `explore.noFilterResults` → replaced by inline "no kinds" / "no books" per page
- `explore.loadMore` → replaced by `explore.show.loadMore`
- `explore.renderedCount` → removed (the new layout doesn't have offset/limit)

## Testing Strategy

### Unit (vitest)

1. **`Explore.tsx` reducer / hook tests**:
   - Grouping: given a flat list of `ExploreItem`, produces groups keyed by `sourceUrl` preserving order.
   - Filter (plain text): case-insensitive `includes` on `sourceName` and `label`.
   - Filter (`group:` prefix): filters by `sourceGroup`.
   - `kindsBySource` reducer: handles `loading` → `ok` and `loading` → `error` transitions, ignores stale `ok` results.
2. **`ExploreShow.tsx` reducer**:
   - Page append: `page=1` replaces, `page>1` appends.
   - `hasMore` flips to `false` when a page returns an empty list.
   - Error: re-enables retry without resetting already-loaded books.
3. **`useLongPress`** hook (extracted):
   - Fires after 500ms; does not fire on quick taps or drag-end.
   - Cleans up timers on unmount.

### Smoke / E2E

- Reuse the existing `pipeline_smoke` / `e2e_smoke` fixtures: validate that `get_explore_kinds` returns at least one `ExploreKind` for a configured source and that the URL round-trips through `explore_books`.
- Manual: dev server → `/explore` → expand a group → tap a chip → scroll the sub-page → verify book grid loads.

## Rollout

- Single PR containing all changes.
- The existing `Explore.tsx` behavior is fully replaced. No feature flag — the new design is the only behavior.
- If a regression is reported, revert the PR (no migration concerns because the only persisted state was the `customOrder` in the book source, which the long-press menu still respects).

## Open Questions

None — all decisions resolved during brainstorming. If implementation reveals a need to revisit (e.g., backend doesn't have `update_book_source_order`), the implementer should ask before adding scope.
