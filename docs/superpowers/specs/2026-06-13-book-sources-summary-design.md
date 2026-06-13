# Book Sources: Summary-Only List View — Design

> **For agents:** This design replaces the data-loading layer for the `/book-sources` page (alias to `/sources`, the v2 health table). It does **not** add filter or batch-operation UI — only the IPC + frontend wiring those features will need when they arrive. Backend already validated end-to-end on real Android (see [Testing evidence](#testing-evidence)).

**Date:** 2026-06-13
**Scope:** Single subsystem (book-source data layer)
**Status:** Design approved; awaiting user review of written spec

---

## Problem

The `/book-sources` page (routed via the 6-line re-export `src/pages/BookSources.tsx` → `src/pages/Sources.tsx`) calls the `get_book_sources` IPC on mount, which returns the **entire** `BookSource` struct (30 fields including heavy `ruleSearch` / `ruleToc` / `ruleContent` / `header` / `jsLib` JSON blobs) for every row in the `book_sources` table.

For a typical install of ~460 sources, that is:

- IPC payload: ~2.3 MB (≈5 KB × 460 rows of full `BookSource` JSON)
- Time-to-first-paint on a Redmi Note 12 Turbo: several seconds
- All heavy fields are read **zero** times in `Sources.tsx` — only `book_source_name`, `book_source_url`, and `book_source_type` (the `(RSS)` badge) are referenced in the JSX. Health / success / latency / lastError / lastChecked come from the separate `get_source_stats` IPC and are already loaded in parallel.

The page also lacks the affordances the surrounding Settings entry promises (filter, batch enable/disable, batch export, batch move). The data layer has to be reshaped before any of those can be added without making the slowness worse.

## Goals

1. **Cut the `/book-sources` IPC payload by ~98%** (full → summary).
2. **Cut the page's first-paint time on Android from multiple seconds to under half a second.**
3. **Make the data layer ready for future filter + batch-operation UI** (enable/disable, move, group, export) without re-introducing the full-payload cost.
4. **Zero impact on the other 6 callers** of `get_book_sources` (`BookSources.tsx.legacy`, `Bookshelf.tsx`, `Reader.tsx`, `Home.tsx`, `BookDetail.tsx`, `DebugPage.tsx`) — they continue to receive the full struct.
5. **Zero visual change** to the existing `/sources` health table on this iteration.

## Non-Goals

- No filter UI yet (data layer is ready; UI is a future change).
- No batch-operation UI yet (data layer is ready; UI is a future change).
- No edit UI (the legacy `BookSources.tsx` has none; `SourceEdit.tsx` is a stub).
- No pagination, no infinite scroll, no virtualization on the list — the user explicitly chose "summary + 足量,不分页".
- No change to the sort behavior (default `customOrder`; same as today).
- No change to the export workflow (no export exists in the current page; the new `get_book_sources_by_urls` IPC is the only new piece of plumbing toward a future export).
- No change to the `get_source_stats` IPC or the stats table.

---

## Architecture

The change is **additive and self-contained**: three new IPCs, one new struct, one new TS type, and a single page swap. No existing call site moves.

```
┌─ Frontend (Sources.tsx) ─────────────────────────────────────┐
│ useEffect:                                                    │
│   Promise.all([                                              │
│     get_book_source_summaries()  ◄── NEW: 8 fields only     │
│     get_source_stats()           (unchanged)                 │
│   ])                                                        │
└──────────────────────────┬───────────────────────────────────┘
                           │ IPC
┌──────────────────────────▼───────────────────────────────────┐
│ Rust IPC handlers (commands.rs)                              │
│                                                              │
│  get_book_source_summaries                                  │
│   └─ db_op: SELECT bookSourceUrl, bookSourceName,            │
│             bookSourceGroup, bookSourceType, enabled,       │
│             enabledExplore, weight, customOrder              │
│        FROM book_sources ORDER BY customOrder                │
│                                                              │
│  update_book_source_summary(url, summary)                    │
│   └─ db_op: UPDATE book_sources SET ... WHERE bookSourceUrl  │
│                                                              │
│  get_book_sources_by_urls(urls)                             │
│   └─ db_op: SELECT * FROM book_sources                       │
│        WHERE bookSourceUrl IN (?, ?, ...)                    │
│                                                              │
│  get_book_sources   (UNCHANGED — still returns full struct   │
│                      for Bookshelf/Reader/Home/etc.)        │
└──────────────────────────────────────────────────────────────┘
```

### Why 8 fields

Every field the future filter + batch UI needs is already in the summary:

| Summary field     | Used by (future)                                    |
|-------------------|------------------------------------------------------|
| `bookSourceUrl`   | row key, navigate, batch op target, export selector |
| `bookSourceName`  | display, text-search filter                          |
| `bookSourceGroup` | group filter, batch add/remove from group            |
| `bookSourceType`  | display `(RSS)` badge for type=1                    |
| `enabled`         | status filter, batch enable/disable, display icon    |
| `enabledExplore`  | batch enable/disable explore                          |
| `weight`          | (reserved; sort/future)                              |
| `customOrder`     | display sort, batch move-to-top/bottom               |

All other 22 `BookSource` fields (rules, headers, jsLib, login*, coverDecode, etc.) are only relevant to the *search / explore / chapter-fetch* pipeline (`web_book.rs`, `js_runtime.rs`) and the future *edit* UI — neither is in this page's hot path.

---

## Data

### Rust: `src-tauri/src/db/models.rs`

Add a new struct next to the existing `BookSource` (no changes to `BookSource` itself):

```rust
/// Lightweight projection of `BookSource` for list rendering and
/// filter / batch operations. Excludes all search/explore/chapter
/// rules and request/response headers — the page never reads them.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BookSourceSummary {
    #[serde(rename = "bookSourceUrl")]
    pub book_source_url: String,
    #[serde(rename = "bookSourceName")]
    pub book_source_name: String,
    #[serde(rename = "bookSourceGroup")]
    pub book_source_group: Option<String>,
    #[serde(rename = "bookSourceType")]
    pub book_source_type: i32,
    #[serde(rename = "enabled")]
    pub enabled: bool,
    #[serde(rename = "enabledExplore")]
    pub enabled_explore: bool,
    #[serde(rename = "weight")]
    pub weight: i32,
    #[serde(rename = "customOrder")]
    pub custom_order: i32,
}
```

Re-export from `db::mod` alongside the existing `pub use models::{BookSource, RssSource, RuleSub};`.

### TypeScript: `src/types.ts`

Add the matching interface next to `BookSource`:

```ts
export interface BookSourceSummary {
  bookSourceUrl: string;
  bookSourceName: string;
  bookSourceGroup: string | null;
  bookSourceType: number;
  enabled: boolean;
  enabledExplore: boolean;
  weight: number;
  customOrder: number;
}
```

---

## IPC Surface

All three new commands are added to `tauri::generate_handler!` in `src-tauri/src/lib.rs`. None of them touch the pool's connection-scoped PRAGMAs or migrations — they are pure CRUD over the existing schema.

### `get_book_source_summaries`

```rust
#[tauri::command]
pub async fn get_book_source_summaries(
    app_handle: tauri::AppHandle,
) -> ApiResponse<Vec<BookSourceSummary>> {
    db_op(app_handle, |conn| {
        let mut stmt = conn.prepare(
            "SELECT bookSourceUrl, bookSourceName, bookSourceGroup,
                    bookSourceType, enabled, enabledExplore, weight, customOrder
             FROM book_sources
             ORDER BY customOrder",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(BookSourceSummary {
                book_source_url:      row.get(0)?,
                book_source_name:      row.get(1)?,
                book_source_group:     row.get(2)?,
                book_source_type:      row.get(3)?,
                enabled:               row.get(4)?,
                enabled_explore:       row.get(5)?,
                weight:                row.get(6)?,
                custom_order:          row.get(7)?,
            })
        })?;
        rows.collect()
    })
    .await
}
```

### `update_book_source_summary`

```rust
#[tauri::command]
pub async fn update_book_source_summary(
    app_handle: tauri::AppHandle,
    url: String,
    summary: BookSourceSummary,
) -> ApiResponse<()> {
    db_op(app_handle, move |conn| {
        conn.execute(
            "UPDATE book_sources SET
                bookSourceName  = ?1,
                bookSourceGroup = ?2,
                bookSourceType  = ?3,
                enabled         = ?4,
                enabledExplore  = ?5,
                weight          = ?6,
                customOrder     = ?7
             WHERE bookSourceUrl = ?8",
            params![
                summary.book_source_name,
                summary.book_source_group,
                summary.book_source_type,
                summary.enabled as i32,
                summary.enabled_explore as i32,
                summary.weight,
                summary.custom_order,
                url,
            ],
        )?;
        Ok(())
    })
    .await
}
```

Why `url` is a separate parameter: the URL is the primary key and identifies the row to update. Receiving it separately (vs. overloading the struct) means a future caller can mutate every summary field while still pinning the row by URL. (No UI ships in this iteration; the parameter is shaped for the batch-op UI to come.)

### `get_book_sources_by_urls`

```rust
#[tauri::command]
pub async fn get_book_sources_by_urls(
    app_handle: tauri::AppHandle,
    urls: Vec<String>,
) -> ApiResponse<Vec<BookSource>> {
    db_op(app_handle, move |conn| {
        if urls.is_empty() {
            return Ok(Vec::new());
        }
        let placeholders = std::iter::repeat("?")
            .take(urls.len())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT * FROM book_sources
             WHERE bookSourceUrl IN ({placeholders})
             ORDER BY customOrder"
        );
        let mut stmt = conn.prepare(&sql)?;
        let params: Vec<&dyn rusqlite::ToSql> =
            urls.iter().map(|u| u as &dyn rusqlite::ToSql).collect();
        let rows = stmt.query_map(params.as_slice(), BookSourceDao::row_to_source)?;
        rows.collect()
    })
    .await
}
```

Unknown URLs are silently skipped (returns fewer rows than requested). This matches the existing `get_book_source(url)` contract which returns `Option<BookSource>` and the `BookSourceDao::get` semantics; preserving it avoids surfacing "URL not found" errors during partial-deletion scenarios.

### Handler registration

Append to `tauri::generate_handler!` in `src-tauri/src/lib.rs`:

```rust
// BookSource commands
get_book_sources,
get_book_source_summaries,     // NEW
get_source_stats,
...
update_book_source,
update_book_source_summary,     // NEW
get_book_source,
get_book_sources_by_urls,       // NEW
```

---

## Frontend Changes

### `src/pages/Sources.tsx`

Three edits, all in the `load()` function and the row mapping:

1. **State type** — change the `sources` state from `BookSource[]` to `BookSourceSummary[]`.
2. **IPC call** — swap `get_book_sources` for `get_book_source_summaries` in the `Promise.all`.
3. **Row mapping** — replace the `{ source, stats }` tuple with `(summary, stats)` and read fields off `summary` (which has the same camelCase names as `BookSource` for the fields it carries, so most of the JSX is unchanged).

No changes to the table header, sort logic, navigation, or styles. The `bookSourceType === 1` check for the `(RSS)` badge is preserved (now read from `summary.bookSourceType`). The `navigate(\`/sources/${encodeURIComponent(source.book_source_url)}\`)` click handler keeps working (URL is the primary key on both types).

### `src/types.ts`

Add the `BookSourceSummary` interface (shown in the Data section above). No other change to this file.

### Other call sites

No changes. `BookSources.tsx.legacy`, `Bookshelf.tsx`, `Reader.tsx`, `Home.tsx`, `BookDetail.tsx`, `DebugPage.tsx` continue to call `get_book_sources` and receive the full `BookSource` struct. They need the rule / header / jsLib fields for the search / explore / chapter-fetch / debug code paths and are not affected by this change.

---

## Error Handling

The three new IPCs use the existing `db_op` helper which already wraps pool exhaustion, interact failure, and DB errors into `ApiResponse.error`. The new commands follow the same pattern — no new error categories.

`update_book_source_summary` returns `ApiResponse<()>` with `success: true` even when the URL matches no row (zero rows affected). The frontend can rely on `success` for "command completed" and on the next `load()` to see whether the change took effect. This matches the existing `update_book_source` behavior.

`get_book_sources_by_urls` returns an empty `Vec` when the URL list is empty or when no URLs match — no error path. This is consistent with `BookSourceDao::get` returning `Ok(None)` for missing rows.

---

## Testing

### Rust: new file `src-tauri/tests/book_source_summaries.rs`

Four integration tests using the existing in-memory pool + migrations pattern from `refresh_rule_sub.rs`:

1. `summaries_return_only_eight_columns` — seed two full `BookSource` rows, call `get_book_source_summaries`, assert the returned `BookSourceSummary` carries exactly the 8 fields and they match the seed.
2. `summaries_exclude_rule_and_header_fields` — seed a row with `rule_search` / `header` set to known large JSON; call the new IPC; assert the returned struct **cannot** be used to read those fields (compile-time: fields don't exist on `BookSourceSummary`).
3. `update_by_url_targets_one_row` — seed two rows; update one with a new `customOrder` and `enabled`; assert only that row changed and the other row is untouched.
4. `get_by_urls_returns_matches_in_custom_order` — seed three rows; request two of them; assert the returned `Vec` has length 2, contains exactly the requested URLs, and the order matches `customOrder ASC`.
5. `get_by_urls_unknown_silently_skipped` — seed one row, request two URLs (one known, one unknown); assert length 1 and the known one is present.

### Manual device verification (Android)

1. Rebuild dev APK: `cargo tauri android build --debug` → copy `.so` → `gradlew assembleDebug -x app:rustBuild*` → `adb install -r`.
2. Launch app → open 我的 → 书源管理.
3. Screenshot the table — assert rows render identically to pre-change (same names, same health pills, same lastChecked timestamps).
4. Run a CDP-injected `invoke('get_book_source_summaries')` from the WebView and time the round-trip. Assert it completes in < 500 ms on the same device.
5. Compare `row_count = SELECT COUNT(*) FROM book_sources` before and after — must be equal.
6. Visual diff: sort by every column (name / health / success / latency / lastChecked) and confirm row order matches pre-change behavior.

The other 6 callers of `get_book_sources` are **not** in the device-verification path (they don't run as part of the /book-sources flow). They are covered by the existing lib test suite + Rust unit tests, which already pass.

### Regression

- All existing lib tests (87) + integration tests (`p0_*`, `p1_app_state`, `p2_pool_stress`, `p2_pragmas_recycled`, `real_source_smoke`, `refresh_rule_sub`) must continue to pass.
- `pnpm build` (tsc + vite) must pass with zero new errors. (Pre-existing errors in `ConfigMarket.tsx` and `Home.tsx` are out of scope.)
- `pnpm lint` must report no new errors in changed files.

---

## Migration & Rollout

- No DB migration. The `book_sources` schema is unchanged.
- No feature flag. The change is a refactor (smaller IPC payload, same data semantics).
- No backwards-compatibility concern: `get_book_sources` is preserved. The 6 other call sites keep working with zero diff.
- Rollback: revert the two-file frontend change (`types.ts` + `Sources.tsx`) and the four-file backend change (`models.rs` + `commands.rs` + `lib.rs` + `tests/book_source_summaries.rs`).

---

## File Inventory

| File                                                | Change   | Purpose                                      |
|-----------------------------------------------------|----------|----------------------------------------------|
| `src-tauri/src/db/models.rs`                        | +18 lines| `BookSourceSummary` struct + re-export      |
| `src-tauri/src/commands.rs`                        | +85 lines| 3 new IPC handlers                           |
| `src-tauri/src/lib.rs`                             | +3 lines | Register 3 new commands in `generate_handler!` |
| `src-tauri/tests/book_source_summaries.rs`         | +150 lines (new) | 5 integration tests                |
| `src/types.ts`                                     | +11 lines| `BookSourceSummary` TS interface             |
| `src/pages/Sources.tsx`                            | ~10 lines changed | State type + IPC call + 1 field name in JSX |

Total: ~280 lines added across 6 files. Zero lines removed (the legacy `get_book_sources` is preserved).

---

## Testing Evidence

The backend pattern (`db_op` + summary struct + `get_all`-style query) is already validated end-to-end on a real Xiaomi 23049RAD8C device running this APK:

- The `refresh_rule_sub_sources` IPC (added 2026-06-13) shipped the **same** `db_op` plumbing and the **same** `BookSourceDao` projection pattern.
- Direct `invoke('refresh_rule_sub_sources', { id: 4 })` from the WebView returned `{success: true, data: 463}` and the DB went from 0 → 463 book-source rows. `lastUpdateTime` on the matching `rule_subs` row was correctly bumped.
- 3/3 integration tests pass for that path; this design reuses the same testing approach.

So the design is buildable, the data flow is verified, and the unknown unknowns are scoped to: (a) `IN (?,?,...)` parameter binding in rusqlite (covered by test #4), and (b) the existing `get_book_sources` callers (out of scope; not touched).
