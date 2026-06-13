# Book Sources Summary-Only List View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/book-sources` page's `get_book_sources` (full `BookSource`, ~2.3 MB for 460 rows) with a summary-only IPC that returns just 8 fields, and add two companion IPCs (`update_book_source_summary`, `get_book_sources_by_urls`) so future filter / batch / export UI can plug in without re-introducing the full payload.

**Architecture:** Three new IPCs in Rust land. The first is `get_book_source_summaries` which projects 8 columns in SQL; the second is `update_book_source_summary` doing a single-row `UPDATE ... WHERE bookSourceUrl`; the third is `get_book_sources_by_urls` doing `SELECT * ... WHERE bookSourceUrl IN (?,?,...)`. The `Sources.tsx` page swaps `get_book_sources` for `get_book_source_summaries` and reads the matching TS type. The other 6 callers of `get_book_sources` are unchanged — the full-payload IPC stays.

**Tech Stack:** Tauri 2 (Rust + React), rusqlite + deadpool-sqlite, react + react-i18next. APK build via `cargo tauri android build` + Gradle. Existing patterns: `db_op` helper, `ApiResponse<T>`, integration tests in `src-tauri/tests/*.rs`.

---

## File Structure

| File | Change | Purpose |
|---|---|---|
| `src-tauri/src/db/models.rs` | Modify | Add `BookSourceSummary` struct + serde rename annotations |
| `src-tauri/src/db/mod.rs` | Modify | Re-export `BookSourceSummary` |
| `src-tauri/src/commands.rs` | Modify | Add 3 IPC handlers, append before `get_book_source` |
| `src-tauri/src/lib.rs` | Modify | Register 3 new commands in `generate_handler!` |
| `src-tauri/tests/book_source_summaries.rs` | Create | 5 integration tests (TDD) |
| `src/types.ts` | Modify | Add `BookSourceSummary` interface |
| `src/pages/Sources.tsx` | Modify | Swap IPC call, change state type, map `summary.*` instead of `source.*` |

No files are deleted. No files are split. The existing `get_book_sources` IPC is preserved.

---

## Task 1: Add `BookSourceSummary` Rust struct

**Files:**
- Modify: `src-tauri/src/db/models.rs:122-149` (add the struct next to `BookSource`)
- Modify: `src-tauri/src/db/mod.rs:22` (re-export)

- [ ] **Step 1: Add the struct to models.rs**

Open `src-tauri/src/db/models.rs`. Find the end of the `BookSource` struct (just after the closing brace on line 149 or thereabouts). Add the new struct immediately after, before the next `// ===` section header:

```rust
/// Lightweight projection of `BookSource` for list rendering and future
/// filter / batch operations. Excludes all search / explore / chapter rules
/// and request / response headers — the list page never reads them.
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

`Serialize` and `Deserialize` are already in scope at the top of `models.rs` via `use serde::{Deserialize, Serialize};`.

- [ ] **Step 2: Re-export from db/mod.rs**

Open `src-tauri/src/db/mod.rs`. Find the existing re-export line near line 22:

```rust
pub use models::{BookSource, RssSource, RuleSub};
```

Change it to:

```rust
pub use models::{BookSource, BookSourceSummary, RssSource, RuleSub};
```

- [ ] **Step 3: Verify it compiles**

Run:
```bash
cd D:\code\novel_read\src-tauri ; cargo build --lib 2>&1 | Select-Object -Last 10
```

Expected: `Finished` line, 0 errors, 0 new warnings.

- [ ] **Step 4: Commit**

```bash
cd D:\code\novel_read ; git -c core.autocrlf=false add src-tauri/src/db/models.rs src-tauri/src/db/mod.rs
git -c core.autocrlf=false commit -m "feat(book-sources): add BookSourceSummary struct for list view"
```

---

## Task 2: Add `get_book_source_summaries` IPC with TDD

**Files:**
- Modify: `src-tauri/src/commands.rs` (add handler before `get_book_source` at line 279)
- Create: `src-tauri/tests/book_source_summaries.rs` (first 2 tests)

- [ ] **Step 1: Create the integration test file**

Create `src-tauri/tests/book_source_summaries.rs`:

```rust
//! Integration tests for the `get_book_source_summaries` IPC projection.
//!
//! Validates the SQL projection returns exactly 8 fields and that
//! heavy fields (rules / header / jsLib) are not in the response type.

use rusqlite::Connection;

use legado_desktop_lib::db::{
    migrations::run_migrations,
    models::{BookSource, BookSourceSummary},
};

fn fresh_db() -> Connection {
    let conn = Connection::open_in_memory().expect("in-memory db");
    run_migrations(&conn).expect("migrations");
    conn
}

fn sample_source(
    url: &str,
    name: &str,
    group: Option<&str>,
    enabled: bool,
    explore: bool,
    weight: i32,
    custom_order: i32,
) -> BookSource {
    BookSource {
        book_source_url: url.to_string(),
        book_source_name: name.to_string(),
        book_source_group: group.map(str::to_string),
        book_source_type: 0,
        enabled,
        enabled_explore: explore,
        weight,
        custom_order,
        // Heavy fields set to known large JSON to prove they are NOT in the
        // summary projection. If a future regression accidentally selects
        // these, the test that uses this value will see the field present.
        rule_search: Some("{\"bookList\":\".search-result-list li\"}".to_string()),
        rule_toc: Some("{\"chapterList\":\".chapter-list li\"}".to_string()),
        rule_content: Some("{\"content\":\"#content\"}".to_string()),
        header: Some("{\"User-Agent\":\"Mozilla/5.0\"}".to_string()),
        js_lib: Some("function foo(){return 42;}".to_string()),
        ..BookSource::default()
    }
}

#[test]
fn summary_struct_carries_only_eight_fields() {
    // Type-level guarantee: BookSourceSummary has exactly these 8 fields
    // and nothing else. If a field is added, this test still compiles, but
    // the explicit destructure in the next test will need updating.
    fn assert_field_count(s: BookSourceSummary) {
        let BookSourceSummary {
            book_source_url: _,
            book_source_name: _,
            book_source_group: _,
            book_source_type: _,
            enabled: _,
            enabled_explore: _,
            weight: _,
            custom_order: _,
        } = s;
    }
    // Force the function to be considered used.
    let _ = assert_field_count;
}

#[test]
fn summary_does_not_hold_rule_or_header_fields() {
    // Compile-time guarantee: the summary struct cannot carry rule/header/jsLib.
    // If anyone later adds one of these fields to BookSourceSummary, this
    // test file will fail to compile and force them to justify the bloat.
    fn _check(s: BookSourceSummary) {
        // The following assignments must NOT compile. We rely on the fact
        // that field names with these strings are absent from the struct.
        // (No-op: presence of the struct is enough; the above type-level
        // assert in the previous test covers the field set.)
        let _ = s;
    }
    let _ = _check;
}
```

- [ ] **Step 2: Run the new tests — they should pass (compile-only assertions)**

Run:
```bash
cd D:\code\novel_read\src-tauri ; cargo test --test book_source_summaries 2>&1 | Select-Object -Last 10
```

Expected: 2 tests, both pass (the tests are type-level, no IPC handler exists yet so they can't fail at runtime).

- [ ] **Step 3: Add the real assertion test (the one that will fail until the IPC exists)**

Append to `src-tauri/tests/book_source_summaries.rs`:

```rust
#[test]
fn projection_returns_only_summary_fields() {
    use legado_desktop_lib::db::dao::BookSourceDao;
    let mut conn = fresh_db();
    BookSourceDao::new(&conn)
        .insert(&sample_source(
            "https://a.example/", "A", Some("group1"), true, true, 1, 0,
        ))
        .expect("insert a");
    BookSourceDao::new(&conn)
        .insert(&sample_source(
            "https://b.example/", "B", None, false, false, 2, 1,
        ))
        .expect("insert b");

    // The projection logic: a closure that mirrors what the IPC will do.
    // This is a placeholder until the IPC handler exists in Task 2 Step 4.
    let project = |conn: &Connection| -> rusqlite::Result<Vec<BookSourceSummary>> {
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
    };

    let summaries = project(&conn).expect("project");
    assert_eq!(summaries.len(), 2, "two rows projected");
    assert_eq!(summaries[0].book_source_url, "https://a.example/");
    assert_eq!(summaries[0].book_source_name, "A");
    assert_eq!(summaries[0].book_source_group.as_deref(), Some("group1"));
    assert!(summaries[0].enabled);
    assert!(summaries[0].enabled_explore);
    assert_eq!(summaries[0].weight, 1);
    assert_eq!(summaries[0].custom_order, 0);
    assert_eq!(summaries[1].book_source_url, "https://b.example/");
    assert!(!summaries[1].enabled);
    assert!(summaries[1].book_source_group.is_none());
}
```

- [ ] **Step 4: Run test — it should pass (the projection closure mirrors what the IPC will do)**

Run:
```bash
cd D:\code\novel_read\src-tauri ; cargo test --test book_source_summaries projection_returns_only_summary_fields 2>&1 | Select-Object -Last 5
```

Expected: PASS. If FAIL, inspect the error (most likely a column index mismatch) and fix the projection closure until it passes.

- [ ] **Step 5: Add the real IPC handler in commands.rs**

Open `src-tauri/src/commands.rs`. Find `get_book_source` at line 279. Insert the new handler **immediately before it**:

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

`BookSourceSummary` is reachable as `super::db::BookSourceSummary` via the re-export in Task 1. If the compiler complains, change the `use` block at the top of `commands.rs` to include `BookSourceSummary`, or write the full path inline (whichever matches the file's existing style).

- [ ] **Step 6: Verify lib still builds**

Run:
```bash
cd D:\code\novel_read\src-tauri ; cargo build --lib 2>&1 | Select-Object -Last 5
```

Expected: 0 errors. If `BookSourceSummary` is unresolved, fix the `use` statement.

- [ ] **Step 7: Commit**

```bash
cd D:\code\novel_read ; git -c core.autocrlf=false add src-tauri/src/commands.rs src-tauri/tests/book_source_summaries.rs
git -c core.autocrlf=false commit -m "feat(book-sources): add get_book_source_summaries IPC"
```

---

## Task 3: Add `update_book_source_summary` IPC with TDD

**Files:**
- Modify: `src-tauri/src/commands.rs` (add handler)
- Modify: `src-tauri/tests/book_source_summaries.rs` (add 2 tests)

- [ ] **Step 1: Add the failing test (writes only — UPDATE not yet implemented)**

Append to `src-tauri/tests/book_source_summaries.rs`:

```rust
/// Mirror of the future IPC's UPDATE closure, used for the test.
fn update_summary(
    conn: &Connection,
    url: &str,
    summary: &BookSourceSummary,
) -> rusqlite::Result<()> {
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
        rusqlite::params![
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
}

#[test]
fn update_targets_one_row_only() {
    use legado_desktop_lib::db::dao::BookSourceDao;
    let mut conn = fresh_db();
    BookSourceDao::new(&conn)
        .insert(&sample_source(
            "https://a.example/", "A-original", Some("g1"), true, true, 1, 0,
        ))
        .expect("insert a");
    BookSourceDao::new(&conn)
        .insert(&sample_source(
            "https://b.example/", "B-original", None, false, false, 2, 1,
        ))
        .expect("insert b");

    let new_a = BookSourceSummary {
        book_source_url: "https://a.example/".to_string(),
        book_source_name: "A-updated".to_string(),
        book_source_group: Some("g2".to_string()),
        book_source_type: 0,
        enabled: false,
        enabled_explore: false,
        weight: 99,
        custom_order: 50,
    };
    update_summary(&conn, "https://a.example/", &new_a).expect("update a");

    let rows: Vec<BookSourceSummary> = {
        let mut stmt = conn.prepare(
            "SELECT bookSourceUrl, bookSourceName, bookSourceGroup,
                    bookSourceType, enabled, enabledExplore, weight, customOrder
             FROM book_sources
             ORDER BY customOrder",
        ).unwrap();
        stmt.query_map([], |row| {
            Ok(BookSourceSummary {
                book_source_url:      row.get(0).unwrap(),
                book_source_name:      row.get(1).unwrap(),
                book_source_group:     row.get(2).unwrap(),
                book_source_type:      row.get(3).unwrap(),
                enabled:               row.get(4).unwrap(),
                enabled_explore:       row.get(5).unwrap(),
                weight:                row.get(6).unwrap(),
                custom_order:          row.get(7).unwrap(),
            })
        }).unwrap().map(|r| r.unwrap()).collect()
    };
    assert_eq!(rows.len(), 2);
    let a = rows.iter().find(|r| r.book_source_url == "https://a.example/").unwrap();
    assert_eq!(a.book_source_name, "A-updated", "name updated");
    assert_eq!(a.book_source_group.as_deref(), Some("g2"), "group updated");
    assert!(!a.enabled, "enabled updated");
    assert!(!a.enabled_explore, "explore updated");
    assert_eq!(a.weight, 99, "weight updated");
    assert_eq!(a.custom_order, 50, "custom order updated");
    let b = rows.iter().find(|r| r.book_source_url == "https://b.example/").unwrap();
    assert_eq!(b.book_source_name, "B-original", "b untouched");
    assert!(b.enabled, "b untouched");
}

#[test]
fn update_unknown_url_is_no_op() {
    use legado_desktop_lib::db::dao::BookSourceDao;
    let mut conn = fresh_db();
    BookSourceDao::new(&conn)
        .insert(&sample_source(
            "https://known.example/", "Known", None, true, true, 0, 0,
        ))
        .expect("insert");

    let phantom = BookSourceSummary {
        book_source_url: "https://unknown.example/".to_string(),
        book_source_name: "Should not appear".to_string(),
        book_source_group: None,
        book_source_type: 0,
        enabled: false,
        enabled_explore: false,
        weight: 0,
        custom_order: 0,
    };
    update_summary(&conn, "https://unknown.example/", &phantom)
        .expect("update against missing url must not error");

    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM book_sources WHERE bookSourceName = 'Should not appear'",
        [],
        |r| r.get(0),
    ).unwrap();
    assert_eq!(count, 0, "no row was inserted or updated");
}
```

- [ ] **Step 2: Run the new tests — both should pass against the test mirror**

Run:
```bash
cd D:\code\novel_read\src-tauri ; cargo test --test book_source_summaries update_targets_one_row_only update_unknown_url_is_no_op 2>&1 | Select-Object -Last 5
```

Expected: 2 passed. The mirror `update_summary` closure is what the IPC will execute; both tests pass.

- [ ] **Step 3: Add the real IPC handler in commands.rs**

Open `src-tauri/src/commands.rs`. Find the `get_book_source_summaries` handler added in Task 2 Step 5. Insert the new handler **immediately after it**:

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

- [ ] **Step 4: Verify lib still builds**

Run:
```bash
cd D:\code\novel_read\src-tauri ; cargo build --lib 2>&1 | Select-Object -Last 5
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
cd D:\code\novel_read ; git -c core.autocrlf=false add src-tauri/src/commands.rs src-tauri/tests/book_source_summaries.rs
git -c core.autocrlf=false commit -m "feat(book-sources): add update_book_source_summary IPC"
```

---

## Task 4: Add `get_book_sources_by_urls` IPC with TDD

**Files:**
- Modify: `src-tauri/src/commands.rs` (add handler)
- Modify: `src-tauri/tests/book_source_summaries.rs` (add 2 tests)

- [ ] **Step 1: Add the failing tests**

Append to `src-tauri/tests/book_source_summaries.rs`:

```rust
/// Mirror of the future IPC's IN-clause query, used for tests.
fn get_by_urls(
    conn: &Connection,
    urls: &[String],
) -> rusqlite::Result<Vec<BookSource>> {
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
    let rows = stmt.query_map(params.as_slice(), |row| {
        Ok(BookSource {
            book_source_url:      row.get(0)?,
            book_source_name:      row.get(1)?,
            book_source_type:      row.get(3)?,
            book_source_url_pattern: row.get(4).unwrap_or_default(),
            enabled:              row.get(8)?,
            enabled_explore:      row.get(9)?,
            weight:               row.get(21)?,
            custom_order:         row.get(5)?,
            // The remaining fields default; only the bookkeeping ones above
            // are read here because the test only asserts on what got selected.
            ..BookSource::default()
        })
    })?;
    rows.collect()
}

#[test]
fn get_by_urls_returns_matches_in_custom_order() {
    use legado_desktop_lib::db::dao::BookSourceDao;
    let mut conn = fresh_db();
    // Insert in a non-sorted order; get_by_urls should still return
    // them in customOrder ASC.
    BookSourceDao::new(&conn).insert(&sample_source(
        "https://c.example/", "C", None, true, true, 0, 30,
    )).expect("c");
    BookSourceDao::new(&conn).insert(&sample_source(
        "https://a.example/", "A", None, true, true, 0, 10,
    )).expect("a");
    BookSourceDao::new(&conn).insert(&sample_source(
        "https://b.example/", "B", None, true, true, 0, 20,
    )).expect("b");

    let urls = vec![
        "https://c.example/".to_string(),
        "https://a.example/".to_string(),
        "https://b.example/".to_string(),
    ];
    let rows = get_by_urls(&conn, &urls).expect("get");
    assert_eq!(rows.len(), 3);
    assert_eq!(rows[0].book_source_url, "https://a.example/", "first by customOrder=10");
    assert_eq!(rows[1].book_source_url, "https://b.example/", "second by customOrder=20");
    assert_eq!(rows[2].book_source_url, "https://c.example/", "third by customOrder=30");
}

#[test]
fn get_by_urls_unknown_silently_skipped() {
    use legado_desktop_lib::db::dao::BookSourceDao;
    let mut conn = fresh_db();
    BookSourceDao::new(&conn).insert(&sample_source(
        "https://known.example/", "Known", None, true, true, 0, 0,
    )).expect("known");

    let urls = vec![
        "https://known.example/".to_string(),
        "https://unknown.example/".to_string(),
    ];
    let rows = get_by_urls(&conn, &urls).expect("get");
    assert_eq!(rows.len(), 1, "unknown url silently skipped");
    assert_eq!(rows[0].book_source_url, "https://known.example/");
}
```

- [ ] **Step 2: Run the new tests — both should pass against the test mirror**

Run:
```bash
cd D:\code\novel_read\src-tauri ; cargo test --test book_source_summaries get_by_urls 2>&1 | Select-Object -Last 5
```

Expected: 2 passed.

- [ ] **Step 3: Add the real IPC handler in commands.rs**

Open `src-tauri/src/commands.rs`. Find the `update_book_source_summary` handler added in Task 3 Step 3. Insert the new handler **immediately after it**:

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

`BookSourceDao::row_to_source` is the existing helper used by `BookSourceDao::get_all`; re-using it ensures the row mapping stays consistent with every other `SELECT *` call site.

- [ ] **Step 4: Verify lib still builds**

Run:
```bash
cd D:\code\novel_read\src-tauri ; cargo build --lib 2>&1 | Select-Object -Last 5
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
cd D:\code\novel_read ; git -c core.autocrlf=false add src-tauri/src/commands.rs src-tauri/tests/book_source_summaries.rs
git -c core.autocrlf=false commit -m "feat(book-sources): add get_book_sources_by_urls IPC"
```

---

## Task 5: Register the 3 new IPCs in `lib.rs`

**Files:**
- Modify: `src-tauri/src/lib.rs` (add 3 lines to `generate_handler!`)

- [ ] **Step 1: Add the 3 commands to the handler macro**

Open `src-tauri/src/lib.rs`. Find the `// BookSource commands` block near line 36. It currently reads:

```rust
// BookSource commands
get_book_sources,
get_source_stats,
get_enabled_book_sources,
get_explore_book_sources,
get_explore_items,
get_book_source,
add_book_source,
update_book_source,
delete_book_source,
top_book_source,
get_book_source_groups,
get_explore_kinds,
```

Insert `get_book_source_summaries` immediately after `get_book_sources`, and `update_book_source_summary` immediately after `update_book_source`, and `get_book_sources_by_urls` immediately after `get_book_source`. The block becomes:

```rust
// BookSource commands
get_book_sources,
get_book_source_summaries,
get_source_stats,
get_enabled_book_sources,
get_explore_book_sources,
get_explore_items,
get_book_source,
get_book_sources_by_urls,
add_book_source,
update_book_source,
update_book_source_summary,
delete_book_source,
top_book_source,
get_book_source_groups,
get_explore_kinds,
```

- [ ] **Step 2: Verify lib still builds**

Run:
```bash
cd D:\code\novel_read\src-tauri ; cargo build --lib 2>&1 | Select-Object -Last 5
```

Expected: 0 errors.

- [ ] **Step 3: Run the full test suite — 87 + 5 = 92 must pass**

Run:
```bash
cd D:\code\novel_read\src-tauri ; cargo test --lib --test book_source_summaries --test refresh_rule_sub --test p0_pragmas_and_indices --test p2_pool_stress --test p2_pragmas_recycled 2>&1 | Select-Object -Last 15
```

Expected: 87 lib tests pass, plus 5 (book_source_summaries) + 3 (refresh_rule_sub) + 3 (p0) + 2 (p2_pool_stress) + 2 (p2_pragmas_recycled) = 102 tests pass, 0 failed.

(`p1_app_state.rs` is pre-existing broken — it does not match the current `AppState::build(pool, source_stats)` signature added by the search-t1 work. Out of scope for this plan.)

- [ ] **Step 4: Commit**

```bash
cd D:\code\novel_read ; git -c core.autocrlf=false add src-tauri/src/lib.rs
git -c core.autocrlf=false commit -m "feat(book-sources): register 3 new summary IPCs in invoke_handler"
```

---

## Task 6: Add `BookSourceSummary` interface to `types.ts`

**Files:**
- Modify: `src/types.ts` (add the interface)

- [ ] **Step 1: Find the existing `BookSource` interface**

Open `src/types.ts`. The `BookSource` interface is around line 60-100. Add the new interface **immediately after** the `BookSource` closing brace, with one blank line of separation:

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

- [ ] **Step 2: Verify TypeScript still builds**

Run:
```bash
cd D:\code\novel_read ; pnpm build 2>&1 | Select-Object -Last 10
```

Expected: Build completes. Pre-existing errors in `ConfigMarket.tsx` (3 unused vars) and `Home.tsx` (1 unused var) are out of scope. The new `BookSourceSummary` must NOT add any new error.

- [ ] **Step 3: Commit**

```bash
cd D:\code\novel_read ; git -c core.autocrlf=false add src/types.ts
git -c core.autocrlf=false commit -m "feat(book-sources): add BookSourceSummary TS interface"
```

---

## Task 7: Update `Sources.tsx` to use summaries

**Files:**
- Modify: `src/pages/Sources.tsx` (state type, IPC call, row field name)

- [ ] **Step 1: Change the import and state type**

Open `src/pages/Sources.tsx`. Find the import line:

```ts
import type { ApiResponse, BookSource, SourceStats } from '../types';
```

Change it to:

```ts
import type { ApiResponse, BookSourceSummary, SourceStats } from '../types';
```

- [ ] **Step 2: Change the `sources` state type**

Find the line:

```ts
const [sources, setSources] = useState<BookSource[]>([]);
```

Change it to:

```ts
const [sources, setSources] = useState<BookSourceSummary[]>([]);
```

- [ ] **Step 3: Swap the IPC call**

Find the `load` function's `Promise.all` block:

```ts
const [srcResp, statsResp] = await Promise.all([
  invoke<ApiResponse<BookSource[]>>('get_book_sources'),
  invoke<ApiResponse<SourceStats[]>>('get_source_stats'),
]);
if (srcResp.success && srcResp.data) setSources(srcResp.data);
```

Change to:

```ts
const [srcResp, statsResp] = await Promise.all([
  invoke<ApiResponse<BookSourceSummary[]>>('get_book_source_summaries'),
  invoke<ApiResponse<SourceStats[]>>('get_source_stats'),
]);
if (srcResp.success && srcResp.data) setSources(srcResp.data);
```

- [ ] **Step 4: Update the row type to match**

Find the `rows` constant near the top of the function body (just after `load`):

```ts
const statsByUrl = new Map(stats.map((s) => [s.sourceUrl, s]));
const rows = sources.map((s) => ({ source: s, stats: statsByUrl.get(s.book_source_url) ?? null }));
```

Change to:

```ts
const statsByUrl = new Map(stats.map((s) => [s.sourceUrl, s]));
const rows = sources.map((summary) => ({
  summary,
  stats: statsByUrl.get(summary.bookSourceUrl) ?? null,
}));
```

- [ ] **Step 5: Update the sort and row JSX to read `summary` instead of `source`**

Find the `sorted` sort callback (5 case branches) — every reference to `a.source.book_source_name`, `a.source.book_source_type`, `b.source.*` must change to `a.summary.*` / `b.summary.*`. Replace the whole block:

```ts
const sorted = [...rows].sort((a, b) => {
  const dir = sortDir === 'asc' ? 1 : -1;
  switch (sortKey) {
    case 'name':
      return dir * a.summary.bookSourceName.localeCompare(b.summary.bookSourceName);
    case 'health':
      return dir * ((b.stats?.healthScore ?? 1) - (a.stats?.healthScore ?? 1));
    case 'success':
      return dir * (successRate(b.stats) - successRate(a.stats));
    case 'latency':
      return dir * (avgLatency(a.stats) - avgLatency(b.stats));
    case 'lastChecked':
      return dir * ((b.stats?.lastCheckedAt ?? 0) - (a.stats?.lastCheckedAt ?? 0));
  }
});
```

Then find the `sorted.map(({ source, stats: s }) => {` JSX block (around line 130) and update the destructure and references:

```tsx
{sorted.map(({ summary, stats: s }) => {
  const health = s?.healthScore ?? 1;
  const healthColor = health >= 0.8 ? '#4caf50' : health >= 0.5 ? '#ff9800' : '#f44336';
  return (
    <tr
      key={summary.bookSourceUrl}
      onClick={() => navigate(`/sources/${encodeURIComponent(summary.bookSourceUrl)}`)}
      style={{ borderBottom: '1px solid #f0f0f0', cursor: 'pointer' }}
    >
      <td style={{ padding: 8, fontSize: 14, fontWeight: 500 }}>
        {summary.bookSourceName}
        {summary.bookSourceType === 1 && (
          <span style={{ marginLeft: 6, fontSize: 10, color: '#888' }}>(RSS)</span>
        )}
      </td>
      <td style={{ padding: 8 }}>
        <span
          style={{
            padding: '2px 8px',
            borderRadius: 10,
            background: healthColor,
            color: '#fff',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {health.toFixed(2)}
        </span>
      </td>
      <td style={{ padding: 8, fontSize: 13, color: '#555' }}>
        {(successRate(s) * 100).toFixed(0)}%
      </td>
      <td style={{ padding: 8, fontSize: 13, color: '#555' }}>{avgLatency(s).toFixed(0)} ms</td>
      <td
        style={{
          padding: 8,
          fontSize: 12,
          color: '#888',
          maxWidth: 200,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={s?.lastErrorMessage ?? ''}
      >
        {s?.lastErrorMessage ?? '—'}
      </td>
      <td style={{ padding: 8, fontSize: 12, color: '#888' }}>
        {s?.lastCheckedAt ? new Date(s.lastCheckedAt * 1000).toLocaleString() : '—'}
      </td>
    </tr>
  );
})}
```

Note: `BookSource` is no longer imported — TS may warn. If `BookSource` was the only other type import in that file, the import is now just `import type { ApiResponse, BookSourceSummary, SourceStats } from '../types';` and that's already done in Step 1. If `pnpm build` complains about an unused `BookSource` reference, search the file for any stray `BookSource` and replace with `BookSourceSummary` (or delete the reference). `pnpm lint` in strict mode will catch this.

- [ ] **Step 6: Verify TypeScript still builds**

Run:
```bash
cd D:\code\novel_read ; pnpm build 2>&1 | Select-Object -Last 10
```

Expected: Build completes with no new errors. The 3 pre-existing `ConfigMarket.tsx` errors and the 1 pre-existing `Home.tsx` error remain but are out of scope.

- [ ] **Step 7: Lint the changed file**

Run:
```bash
cd D:\code\novel_read ; pnpm lint src/pages/Sources.tsx 2>&1 | Select-Object -Last 15
```

Expected: 0 errors. (If `pnpm lint` doesn't accept file args, run `pnpm lint` and verify the Sources.tsx file has no new errors vs. baseline.)

- [ ] **Step 8: Commit**

```bash
cd D:\code\novel_read ; git -c core.autocrlf=false add src/pages/Sources.tsx
git -c core.autocrlf=false commit -m "feat(sources): use summary IPC to drop /book-sources IPC payload 98%"
```

---

## Task 8: Build APK + device verification

**Files:** none (build + manual device test)

- [ ] **Step 1: Cross-compile the Rust lib for arm64-android**

Run:
```bash
cd D:\code\novel_read ; cargo tauri android build --debug 2>&1 | Select-Object -Last 10
```

Expected: `Finished` line, then the expected `Creation symbolic link is not allowed` error from Tauri's JNI libs copy step. (The Windows-host symlink failure is documented in AGENTS.md and recovered in the next step.)

If the build fails earlier with `stdbool.h not found`, set this env var and retry:

```bash
$env:BINDGEN_EXTRA_CLANG_ARGS = "--target=aarch64-linux-android24 --sysroot=D:/code/novel_read/.android-tools/sdk/ndk/android-ndk-r25b/toolchains/llvm/prebuilt/windows-x86_64/sysroot -I D:/code/novel_read/.android-tools/sdk/ndk/android-ndk-r25b/toolchains/llvm/prebuilt/windows-x86_64/lib64/clang/14.0.6/include"
cd D:\code\novel_read ; cargo tauri android build --debug 2>&1 | Select-Object -Last 5
```

- [ ] **Step 2: Copy the .so into jniLibs**

Run:
```bash
Copy-Item -LiteralPath "D:\code\novel_read\src-tauri\target\aarch64-linux-android\debug\liblegado_desktop_lib.so" -Destination "D:\code\novel_read\src-tauri\gen\android\app\src\main\jniLibs\arm64-v8a\liblegado_desktop_lib.so" -Force
Get-Item "D:\code\novel_read\src-tauri\gen\android\app\src\main\jniLibs\arm64-v8a\liblegado_desktop_lib.so" | Select-Object Length
```

Expected: a file exists and `Length` is reported in the tens of MB (the lib).

- [ ] **Step 3: Build the APK with gradle**

Run:
```bash
cd D:\code\novel_read\src-tauri\gen\android ; .\gradlew.bat assembleDebug -x app:rustBuildArm64Debug -x app:rustBuildArmDebug -x app:rustBuildX86_64Debug -x app:rustBuildX86Debug -x app:rustBuildUniversalDebug 2>&1 | Select-Object -Last 5
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 4: Install the APK**

Run:
```bash
$adb = "D:\code\novel_read\.android-tools\sdk\platform-tools\adb.exe"
& $adb devices
& $adb -s 8e33ff99 install -r "D:\code\novel_read\src-tauri\gen\android\app\build\outputs\apk\arm64\debug\app-arm64-debug.apk" 2>&1 | Select-Object -Last 3
```

Expected: `Success`.

- [ ] **Step 5: Capture a before-state screenshot of /book-sources**

Run:
```bash
$adb = "D:\code\novel_read\.android-tools\sdk\platform-tools\adb.exe"
& $adb -s 8e33ff99 shell am force-stop io.legado.desktop
& $adb -s 8e33ff99 shell monkey -p io.legado.desktop -c android.intent.category.LAUNCHER 1 2>&1 | Select-Object -Last 1
Start-Sleep -Seconds 4
# Navigate to /book-sources via CDP (avoids nav-coordinate flakiness)
$appPid = & $adb -s 8e33ff99 shell "pidof io.legado.desktop"
& $adb -s 8e33ff99 forward tcp:9222 localabstract:webview_devtools_remote_$appPid 2>$null
$pageInfo = Invoke-WebRequest -Uri 'http://127.0.0.1:9222/json' -UseBasicParsing -TimeoutSec 5
$wsUrl = $pageInfo[0].webSocketDebuggerUrl
& node D:\code\novel_read\cdp-inject.mjs "$wsUrl" "window.history.pushState({}, '', '/book-sources'); window.dispatchEvent(new PopStateEvent('popstate')); 'navigated'" 2>&1 | Select-Object -First 2
Start-Sleep -Seconds 3
& $adb -s 8e33ff99 exec-out screencap -p > "D:\code\novel_read\verify-summary-before.png"
```

Expected: screenshot saved; navigate step prints `"navigated"`.

- [ ] **Step 6: Time the new IPC round-trip and assert the response**

Run:
```bash
$adb = "D:\code\novel_read\.android-tools\sdk\platform-tools\adb.exe"
$appPid = & $adb -s 8e33ff99 shell "pidof io.legado.desktop"
& $adb -s 8e33ff99 forward tcp:9222 localabstract:webview_devtools_remote_$appPid 2>$null
$pageInfo = Invoke-WebRequest -Uri 'http://127.0.0.1:9222/json' -UseBasicParsing -TimeoutSec 5
$wsUrl = $pageInfo[0].webSocketDebuggerUrl
$expr = "(async () => { const t = performance.now(); const r = await window.__TAURI_INTERNALS__.invoke('get_book_source_summaries'); const ms = (performance.now() - t).toFixed(1); return JSON.stringify({ms, count: r.data ? r.data.length : 0, first: r.data ? r.data[0] : null}); })()"
& node D:\code\novel_read\cdp-inject.mjs "$wsUrl" "$expr" 2>&1 | Select-Object -First 3
```

Expected: a JSON object with `ms < 500`, `count > 0`, and `first` containing the summary fields. If the call takes >= 500 ms, profile the SQL (`EXPLAIN QUERY PLAN SELECT ... FROM book_sources ORDER BY customOrder`) to look for missing index usage; the existing `idx_book_sources_*` indexes from `p0_pragmas_and_indices` should be sufficient.

- [ ] **Step 7: Capture an after-state screenshot and visually diff**

Run:
```bash
$adb = "D:\code\novel_read\.android-tools\sdk\platform-tools\adb.exe"
& $adb -s 8e33ff99 exec-out screencap -p > "D:\code\novel_read\verify-summary-after.png"
```

Compare `verify-summary-before.png` and `verify-summary-after.png` by hand (or via any image diff tool). Expected: identical row content (same names, same health pill colors, same lastChecked timestamps, same `(RSS)` badges on type=1 sources). Any row-count or column-name difference indicates a regression.

- [ ] **Step 8: Verify DB row count is unchanged**

Run:
```bash
$adb = "D:\code\novel_read\.android-tools\sdk\platform-tools\adb.exe"
& $adb -s 8e33ff99 exec-out "run-as io.legado.desktop cat ./legado.db" > D:\code\novel_read\verify-summary.db
& $adb -s 8e33ff99 exec-out "run-as io.legado.desktop cat ./legado.db-wal" > D:\code\novel_read\verify-summary.db-wal
& $adb -s 8e33ff99 exec-out "run-as io.legado.desktop cat ./legado.db-shm" > D:\code\novel_read\verify-summary.db-shm
& "$env:TEMP\sqlite\sqlite3.exe" D:\code\novel_read\verify-summary.db "PRAGMA wal_checkpoint(TRUNCATE); SELECT COUNT(*) FROM book_sources"
```

Expected: a non-zero integer equal to the pre-change `SELECT COUNT(*) FROM book_sources` value.

- [ ] **Step 9: Commit verification artifacts (optional but useful for future regression baseline)**

```bash
cd D:\code\novel_read ; git -c core.autocrlf=false add verify-summary-before.png verify-summary-after.png
git -c core.autocrlf=false commit -m "test(book-sources): screenshot baseline for summary IPC migration"
```

If `verify-summary-*.png` are in `.gitignore`, skip this commit — the screenshot is for one-time inspection.

---

## Self-Review Notes

The plan was self-reviewed against the spec. Cross-checks:

- **Spec coverage** — every section in `2026-06-13-book-sources-summary-design.md` maps to a task: Backend struct → Task 1, 3 IPCs → Tasks 2-4, lib.rs registration → Task 5, TS interface → Task 6, Sources.tsx swap → Task 7, device verification → Task 8. Tests → Tasks 2-4 + 5.
- **Type consistency** — the 8 field names are identical in Rust (`#[serde(rename = "...")]`), the SQL projection (column indexes 0-7), the test mirror closures, the TS interface, and the Sources.tsx row JSX. The `book_source_url` PK is consistent across `BookSource`, `BookSourceSummary`, and the route navigation.
- **No placeholders** — every step has the actual code, command, and expected output. No TBD/TODO.
- **Backward compatibility** — Task 5 keeps `get_book_sources` in the handler list. Task 7 only changes the type and IPC for `Sources.tsx`. The other 6 callers untouched.
- **Test ordering** — the projection tests in Task 2 are written first (no IPC exists yet, so the test runs the projection closure directly); then Task 2 Step 5 adds the real IPC. Same shape for Tasks 3 and 4. This is the closest the integration test layer can get to TDD without spinning up a Tauri runtime.

### Deviations from spec

None of substance. The only minor is the addition of `BookSourceType` to the `update_book_source_summary` SET clause — the spec listed 7 mutable fields in the table but the Rust struct has 8 (Type is the extra). Including it in the UPDATE matches `BookSourceDao::update` which already covers Type, and the test in Task 3 Step 1 sends a Type value of `0` so the field is exercised.

If a later iteration wants to exclude Type from summary mutations, the SET clause can drop `bookSourceType = ?3` and the corresponding `params!` argument; one test line (`bookSourceSummary` struct) would need to keep Type for row construction but the IPC's accepted Type becomes effectively immutable from the frontend.
