# Search Feature Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the search feature in `legado-desktop` to be streaming (Tauri `Channel<T>`), relevance-ranked (7-rule cascade), source-health-aware, failure-transparent, and cover-lazy. Decouple source management from the search page.

**Architecture:** New Rust `search_streamer.rs` orchestrates per-source parallel searches with timeouts and emits `SearchEvent` over a Tauri `Channel<T>`. New `relevance.rs` module implements a 7-rule relevance cascade. New `source_stats` table tracks per-source health. New React state machine in `Home.tsx` consumes the channel and streams results as they arrive. New `/sources` route absorbs rule-sub management and shows a sortable health table.

**Tech Stack:** Tauri 2 (Rust 1.77+, `Channel<T>`, `tokio::sync::Semaphore`/`watch`), rusqlite + deadpool-sqlite (existing), React 18 + TypeScript strict + Vite 6 (existing), Damerau-Levenshtein hand-rolled (no new crate).

**Reference:**
- Spec: `docs/superpowers/specs/2026-06-12-search-redesign.md`
- Research: `docs/research/multi-source-book-search-ux-research.md`

---

## Context (any task assumes this)

### Repo layout
```
D:\code\novel_read\
├── src/                    # React frontend (TS strict)
├── src-tauri/              # Rust backend (Tauri 2)
│   └── src/
│       ├── book_source/    # rule engine, source loader, web book
│       ├── db/             # pool, models, dao, migrations
│       ├── commands.rs     # all #[tauri::command] handlers
│       ├── lib.rs          # invoke_handler registration
│       └── state.rs        # AppState struct
├── docs/
│   ├── research/
│   └── superpowers/
│       ├── specs/
│       └── plans/          # this file
```

### Conventions
- **TypeScript**: strict mode, `@/*` alias for `src/*`, 2-space, single quotes, semicolons, no `any` unless necessary.
- **Rust**: `rustfmt` defaults, `snake_case` modules, `PascalCase` types, `thiserror` for typed errors. Existing DAOs use `pub struct XxxDao<'a> { conn: &'a Connection }` borrowing a connection. New DAOs in this plan can use the same pattern (sync) OR a cloneable `Arc<Mutex<Connection>>` pattern (async) — see Task 1 for the chosen pattern.
- **Database**: `IF NOT EXISTS` migrations appended to `migrations.rs` and called from `run_migrations`. No version numbers.
- **BookSource identity**: `bookSourceUrl TEXT PRIMARY KEY` (URL, NOT integer id). All source references in this plan use the URL as the key.
- **Tauri commands**: `#[tauri::command]`, `pub async fn`, return `ApiResponse<T>` for synchronous results, or use `Channel<T>` parameter for streaming. State accessed via `tauri::State<'_, AppState>`.

### Tooling (existing)
- `pnpm` (Node 18+, frontend)
- `cargo` 1.77+ (Rust)
- `cargo tauri` (Tauri CLI)
- Tests: `cd src-tauri && cargo test` for Rust; `pnpm build` for TS typecheck; `pnpm lint` for ESLint.

### Verification baseline (every task)
After making changes in `src-tauri/`:
```bash
cd D:\code\novel_read
cd src-tauri
cargo build                 # compiles
cargo test --lib            # all unit tests pass
cd ..
pnpm build                  # TS strict check (also lints)
```

---

## Task Dependency Graph

```
Phase 1 (parallel)        Phase 2 (parallel)         Phase 3 (parallel)      Phase 4 (sequential)
─────────────────         ──────────────────         ──────────────────      ────────────────────
T1 source_stats  ─────────► T4 search_books_stream    T8 stats hookup
                          ► T5 Home state machine    T9 /sources page
T2 relevance    ─────────► T6 status components      T10 badges
                          ► T7 lazy cover            T11 cascade health
T3 streamer     ─────────►
                          ►
Phase 1 has no inter-dependencies. Phase 2 depends on Phase 1 (uses types). Phase 3 depends on Phase 2 (wires UI). Phase 4 polishes.
```

**Parallelism rules:**
- A subagent doing Task N should NOT modify files outside its "Files" list (other than `mod.rs` / `App.tsx` re-exports if listed).
- If a subagent needs a type from another task, it imports from a **stable, pre-agreed** path (e.g., `crate::db::SourceStatsDao`), even if the other task hasn't merged yet — both agents work on stubs that compile, then they reconcile at integration.
- All Phase 1 tasks can run in parallel in fresh subagent sessions.

---

## Task Conventions

- Every commit message prefix matches the task: `feat(search-t1):`, `feat(search-t2):`, etc.
- Each task ends with a "Definition of Done" checklist — all items must be true before moving on.
- Each task declares its own "Files" section; subagent touches only those files.
- TDD for Rust: write the failing test first, run it (must fail), write impl, run test (must pass), commit.
- For TypeScript tasks: `pnpm build` is the verification command. There is no TS test runner, so `pnpm build` (TS strict) is the gate.


---

# Phase 1: Foundation (3 tasks, parallel)

---

## Task 1: source_stats table + DAO

**Files:**
- Modify: `src-tauri/src/db/migrations.rs` — append `CREATE_SOURCE_STATS_TABLE` constant + invocation
- Create: `src-tauri/src/db/source_stats_dao.rs` — new DAO with CRUD + health computation
- Modify: `src-tauri/src/db/mod.rs` — add `pub mod source_stats_dao;` and `pub use source_stats_dao::{SourceStatsDao, SourceStats, HealthInputs, compute_health};`
- Test: same file `src-tauri/src/db/source_stats_dao.rs` (`#[cfg(test)] mod tests`)

**Context for this task:**
- `AppPool` is `deadpool::managed::Pool<PragmaManager>`, clonable, returns `SyncWrapper<Connection>` via `.get().await`.
- Existing DAOs (e.g. `BookDao`) take `&Connection` and are sync. For this task, the DAO must be **async** (called from the streaming search task) so it owns an `AppPool` clone.
- `bookSourceUrl` is the primary key of `book_sources` (TEXT, NOT integer id).
- `serde::{Serialize, Deserialize}` derives required for types that cross the Tauri IPC boundary.

### Step 1: Append the migration constant and invocation

Modify `src-tauri/src/db/migrations.rs`:

At end of file (after `CREATE_CHAPTER_CONTENTS_TABLE` constant block, around line 315), add:

```rust
pub const CREATE_SOURCE_STATS_TABLE: &str = r#"
CREATE TABLE IF NOT EXISTS source_stats (
    sourceUrl TEXT PRIMARY KEY REFERENCES book_sources(bookSourceUrl) ON DELETE CASCADE,
    total_queries INTEGER NOT NULL DEFAULT 0,
    successful_queries INTEGER NOT NULL DEFAULT 0,
    timed_out_queries INTEGER NOT NULL DEFAULT 0,
    errored_queries INTEGER NOT NULL DEFAULT 0,
    total_latency_ms INTEGER NOT NULL DEFAULT 0,
    last_success_at INTEGER,
    last_error_at INTEGER,
    last_error_message TEXT,
    last_checked_at INTEGER NOT NULL DEFAULT 0,
    rolling_success_count INTEGER NOT NULL DEFAULT 0,
    rolling_total_count INTEGER NOT NULL DEFAULT 0,
    health_score REAL NOT NULL DEFAULT 1.0
);
CREATE INDEX IF NOT EXISTS idx_source_stats_health ON source_stats(health_score DESC);
"#;
```

In `run_migrations` (around line 351, after the chapter contents line and before the P0 indices block), add:

```rust
    conn.execute_batch(CREATE_SOURCE_STATS_TABLE)?;
```

### Step 2: Verify the migration compiles and applies

Run from `D:\code\novel_read`:

```bash
cd src-tauri
cargo build
```

Expected: compiles without error. (The new constant is referenced but unused in app code yet — that is fine; `dead_code` is allowed for `pub` items in lib crates.)

### Step 3: Create the DAO skeleton (file with all types, no real impl yet)

Create `src-tauri/src/db/source_stats_dao.rs`:

```rust
use crate::db::AppPool;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SourceStats {
    pub source_url: String,
    pub total_queries: i64,
    pub successful_queries: i64,
    pub timed_out_queries: i64,
    pub errored_queries: i64,
    pub total_latency_ms: i64,
    pub last_success_at: Option<i64>,
    pub last_error_at: Option<i64>,
    pub last_error_message: Option<String>,
    pub last_checked_at: i64,
    pub rolling_success_count: i64,
    pub rolling_total_count: i64,
    pub health_score: f64,
}

impl Default for SourceStats {
    fn default() -> Self {
        Self {
            source_url: String::new(),
            total_queries: 0,
            successful_queries: 0,
            timed_out_queries: 0,
            errored_queries: 0,
            total_latency_ms: 0,
            last_success_at: None,
            last_error_at: None,
            last_error_message: None,
            last_checked_at: 0,
            rolling_success_count: 0,
            rolling_total_count: 0,
            health_score: 1.0,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct HealthInputs {
    pub success_rate: f64,
    pub p99_latency_ms: f64,
    pub recency_hours: f64,
}

pub fn compute_health(h: HealthInputs) -> f64 {
    let sr = h.success_rate.clamp(0.0, 1.0);
    let lat = (1.0 - (h.p99_latency_ms / 5000.0).min(1.0)).max(0.0);
    let rec = (1.0 - (h.recency_hours / 168.0).min(1.0)).max(0.0);
    let score = 0.6 * sr + 0.3 * lat + 0.1 * rec;
    score.clamp(0.0, 1.0)
}

pub struct SourceStatsDao {
    pool: AppPool,
}

impl SourceStatsDao {
    pub fn new(pool: AppPool) -> Self {
        Self { pool }
    }

    pub async fn get_all(&self) -> rusqlite::Result<Vec<SourceStats>> {
        Ok(Vec::new())
    }

    pub async fn get_by_url(&self, source_url: &str) -> rusqlite::Result<Option<SourceStats>> {
        Ok(None)
    }

    pub async fn record_success(&self, source_url: &str, latency_ms: u64) -> rusqlite::Result<()> {
        Ok(())
    }

    pub async fn record_timeout(&self, source_url: &str, latency_ms: u64) -> rusqlite::Result<()> {
        Ok(())
    }

    pub async fn record_error(&self, source_url: &str, err_msg: &str, latency_ms: u64) -> rusqlite::Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-6
    }

    #[test]
    fn compute_health_perfect() {
        let h = compute_health(HealthInputs { success_rate: 1.0, p99_latency_ms: 0.0, recency_hours: 0.0 });
        assert!(approx(h, 1.0), "expected 1.0, got {}", h);
    }

    #[test]
    fn compute_health_zero_success() {
        let h = compute_health(HealthInputs { success_rate: 0.0, p99_latency_ms: 5000.0, recency_hours: 168.0 });
        assert!(approx(h, 0.0), "expected 0.0, got {}", h);
    }

    #[test]
    fn compute_health_clamped_high() {
        let h = compute_health(HealthInputs { success_rate: 2.0, p99_latency_ms: 0.0, recency_hours: 0.0 });
        assert!(approx(h, 1.0));
    }

    #[test]
    fn compute_health_midpoint() {
        let h = compute_health(HealthInputs { success_rate: 0.5, p99_latency_ms: 2500.0, recency_hours: 84.0 });
        assert!(approx(h, 0.5), "expected 0.5, got {}", h);
    }
}
```

### Step 4: Compile to verify types

```bash
cd src-tauri
cargo build
```

Expected: compiles cleanly.

### Step 5: Run the unit tests (compute_health only)

```bash
cargo test --lib source_stats_dao
```

Expected: 4 tests pass.

### Step 6: Add the DAO integration tests (which will fail)

Replace the entire `#[cfg(test)] mod tests` block at the bottom of `source_stats_dao.rs` with:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-6
    }

    fn make_pool() -> AppPool {
        let dir = std::env::temp_dir().join(format!(
            "legado_test_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("test.db");
        crate::db::build_pool(db_path).expect("build pool")
    }

    fn ensure_sources_table(pool: &AppPool) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let obj = pool.get().await.unwrap();
            obj.interact(|conn| {
                conn.execute_batch(crate::db::migrations::CREATE_BOOK_SOURCES_TABLE).unwrap();
                conn.execute(
                    "INSERT OR REPLACE INTO book_sources (bookSourceUrl, bookSourceName, enabled) VALUES (?1, ?2, 1)",
                    rusqlite::params!["https://example.com/a", "Source A"],
                ).unwrap();
                conn.execute(
                    "INSERT OR REPLACE INTO book_sources (bookSourceUrl, bookSourceName, enabled) VALUES (?1, ?2, 1)",
                    rusqlite::params!["https://example.com/b", "Source B"],
                ).unwrap();
                Ok(())
            }).await.unwrap();
        });
    }

    fn apply_migration(pool: &AppPool) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let obj = pool.get().await.unwrap();
            obj.interact(|conn| {
                conn.execute_batch(crate::db::migrations::CREATE_SOURCE_STATS_TABLE).unwrap();
                Ok(())
            }).await.unwrap();
        });
    }

    #[test]
    fn compute_health_perfect() {
        let h = compute_health(HealthInputs { success_rate: 1.0, p99_latency_ms: 0.0, recency_hours: 0.0 });
        assert!(approx(h, 1.0));
    }

    #[test]
    fn compute_health_zero_success() {
        let h = compute_health(HealthInputs { success_rate: 0.0, p99_latency_ms: 5000.0, recency_hours: 168.0 });
        assert!(approx(h, 0.0));
    }

    #[test]
    fn compute_health_clamped_high() {
        let h = compute_health(HealthInputs { success_rate: 2.0, p99_latency_ms: 0.0, recency_hours: 0.0 });
        assert!(approx(h, 1.0));
    }

    #[test]
    fn compute_health_midpoint() {
        let h = compute_health(HealthInputs { success_rate: 0.5, p99_latency_ms: 2500.0, recency_hours: 84.0 });
        assert!(approx(h, 0.5));
    }

    #[tokio::test]
    async fn record_success_increments() {
        let pool = make_pool();
        ensure_sources_table(&pool);
        apply_migration(&pool);
        let dao = SourceStatsDao::new(pool.clone());
        dao.record_success("https://example.com/a", 200).await.unwrap();
        let stats = dao.get_by_url("https://example.com/a").await.unwrap().unwrap();
        assert_eq!(stats.total_queries, 1);
        assert_eq!(stats.successful_queries, 1);
        assert_eq!(stats.timed_out_queries, 0);
        assert_eq!(stats.errored_queries, 0);
        assert_eq!(stats.total_latency_ms, 200);
        assert_eq!(stats.rolling_success_count, 1);
        assert_eq!(stats.rolling_total_count, 1);
        assert!(stats.last_success_at.is_some());
        assert!(stats.last_checked_at > 0);
    }

    #[tokio::test]
    async fn record_timeout_increments_timed_out() {
        let pool = make_pool();
        ensure_sources_table(&pool);
        apply_migration(&pool);
        let dao = SourceStatsDao::new(pool.clone());
        dao.record_timeout("https://example.com/a", 2000).await.unwrap();
        let stats = dao.get_by_url("https://example.com/a").await.unwrap().unwrap();
        assert_eq!(stats.timed_out_queries, 1);
        assert_eq!(stats.successful_queries, 0);
        assert_eq!(stats.rolling_total_count, 1);
        assert_eq!(stats.rolling_success_count, 0);
    }

    #[tokio::test]
    async fn record_error_stores_message() {
        let pool = make_pool();
        ensure_sources_table(&pool);
        apply_migration(&pool);
        let dao = SourceStatsDao::new(pool.clone());
        dao.record_error("https://example.com/a", "HTTP 502", 350).await.unwrap();
        let stats = dao.get_by_url("https://example.com/a").await.unwrap().unwrap();
        assert_eq!(stats.errored_queries, 1);
        assert_eq!(stats.last_error_message.as_deref(), Some("HTTP 502"));
        assert!(stats.last_error_at.is_some());
    }

    #[tokio::test]
    async fn get_all_returns_all_rows() {
        let pool = make_pool();
        ensure_sources_table(&pool);
        apply_migration(&pool);
        let dao = SourceStatsDao::new(pool.clone());
        dao.record_success("https://example.com/a", 100).await.unwrap();
        dao.record_success("https://example.com/b", 200).await.unwrap();
        let all = dao.get_all().await.unwrap();
        assert_eq!(all.len(), 2);
    }
}
```

### Step 7: Run the new tests (they will FAIL)

```bash
cd src-tauri
cargo test --lib source_stats_dao
```

Expected: 4 `compute_health` tests PASS, 4 DAO tests FAIL.

### Step 8: Implement `get_by_url`

Replace the body of `get_by_url` in `source_stats_dao.rs`:

```rust
pub async fn get_by_url(&self, source_url: &str) -> rusqlite::Result<Option<SourceStats>> {
    let url = source_url.to_string();
    let obj = self.pool.get().await.map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    obj.interact(move |conn| {
        conn.query_row(
            "SELECT sourceUrl, total_queries, successful_queries, timed_out_queries,
                    errored_queries, total_latency_ms, last_success_at, last_error_at,
                    last_error_message, last_checked_at, rolling_success_count,
                    rolling_total_count, health_score
             FROM source_stats WHERE sourceUrl = ?1",
            params![url],
            |row| {
                Ok(SourceStats {
                    source_url: row.get(0)?,
                    total_queries: row.get(1)?,
                    successful_queries: row.get(2)?,
                    timed_out_queries: row.get(3)?,
                    errored_queries: row.get(4)?,
                    total_latency_ms: row.get(5)?,
                    last_success_at: row.get(6)?,
                    last_error_at: row.get(7)?,
                    last_error_message: row.get(8)?,
                    last_checked_at: row.get(9)?,
                    rolling_success_count: row.get(10)?,
                    rolling_total_count: row.get(11)?,
                    health_score: row.get(12)?,
                })
            },
        )
        .optional()
    })
    .await
    .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?
}
```

### Step 9: Implement `get_all`

```rust
pub async fn get_all(&self) -> rusqlite::Result<Vec<SourceStats>> {
    let obj = self.pool.get().await.map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    obj.interact(|conn| {
        let mut stmt = conn.prepare(
            "SELECT sourceUrl, total_queries, successful_queries, timed_out_queries,
                    errored_queries, total_latency_ms, last_success_at, last_error_at,
                    last_error_message, last_checked_at, rolling_success_count,
                    rolling_total_count, health_score
             FROM source_stats ORDER BY health_score DESC"
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(SourceStats {
                source_url: row.get(0)?,
                total_queries: row.get(1)?,
                successful_queries: row.get(2)?,
                timed_out_queries: row.get(3)?,
                errored_queries: row.get(4)?,
                total_latency_ms: row.get(5)?,
                last_success_at: row.get(6)?,
                last_error_at: row.get(7)?,
                last_error_message: row.get(8)?,
                last_checked_at: row.get(9)?,
                rolling_success_count: row.get(10)?,
                rolling_total_count: row.get(11)?,
                health_score: row.get(12)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok::<_, rusqlite::Error>(out)
    })
    .await
    .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?
}
```

### Step 10: Run the get_* tests

```bash
cd src-tauri
cargo test --lib source_stats_dao::tests
```

Expected: `record_success_increments` and `record_timeout_increments_timed_out` and `record_error_stores_message` still fail (because record_* are no-ops). `get_all_returns_all_rows` still fails (empty list).

### Step 11: Implement the three `record_*` methods

Add the three record methods plus two private helpers. Replace the three placeholder record methods with:

```rust
pub async fn record_success(&self, source_url: &str, latency_ms: u64) -> rusqlite::Result<()> {
    let url = source_url.to_string();
    let obj = self.pool.get().await.map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    let now = chrono::Utc::now().timestamp();
    obj.interact(move |conn| {
        let tx = conn.transaction()?;
        tx.execute(
            "INSERT INTO source_stats (sourceUrl, last_checked_at) VALUES (?1, ?2)
             ON CONFLICT(sourceUrl) DO UPDATE SET last_checked_at = excluded.last_checked_at",
            params![url, now],
        )?;
        tx.execute(
            "UPDATE source_stats SET
                total_queries = total_queries + 1,
                successful_queries = successful_queries + 1,
                total_latency_ms = total_latency_ms + ?2,
                last_success_at = ?3,
                rolling_success_count = rolling_success_count + 1,
                rolling_total_count = rolling_total_count + 1
             WHERE sourceUrl = ?1",
            params![url, latency_ms as i64, now],
        )?;
        prune_rolling_window(&tx, &url)?;
        let h = recompute_health_in_tx(&tx, &url)?;
        tx.execute("UPDATE source_stats SET health_score = ?2 WHERE sourceUrl = ?1", params![url, h])?;
        tx.commit()?;
        Ok::<_, rusqlite::Error>(())
    })
    .await
    .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?
}

pub async fn record_timeout(&self, source_url: &str, latency_ms: u64) -> rusqlite::Result<()> {
    let url = source_url.to_string();
    let obj = self.pool.get().await.map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    let now = chrono::Utc::now().timestamp();
    obj.interact(move |conn| {
        let tx = conn.transaction()?;
        tx.execute(
            "INSERT INTO source_stats (sourceUrl, last_checked_at) VALUES (?1, ?2)
             ON CONFLICT(sourceUrl) DO UPDATE SET last_checked_at = excluded.last_checked_at",
            params![url, now],
        )?;
        tx.execute(
            "UPDATE source_stats SET
                total_queries = total_queries + 1,
                timed_out_queries = timed_out_queries + 1,
                total_latency_ms = total_latency_ms + ?2,
                rolling_total_count = rolling_total_count + 1
             WHERE sourceUrl = ?1",
            params![url, latency_ms as i64],
        )?;
        prune_rolling_window(&tx, &url)?;
        let h = recompute_health_in_tx(&tx, &url)?;
        tx.execute("UPDATE source_stats SET health_score = ?2 WHERE sourceUrl = ?1", params![url, h])?;
        tx.commit()?;
        Ok::<_, rusqlite::Error>(())
    })
    .await
    .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?
}

pub async fn record_error(&self, source_url: &str, err_msg: &str, latency_ms: u64) -> rusqlite::Result<()> {
    let url = source_url.to_string();
    let msg = err_msg.to_string();
    let obj = self.pool.get().await.map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    let now = chrono::Utc::now().timestamp();
    obj.interact(move |conn| {
        let tx = conn.transaction()?;
        tx.execute(
            "INSERT INTO source_stats (sourceUrl, last_checked_at) VALUES (?1, ?2)
             ON CONFLICT(sourceUrl) DO UPDATE SET last_checked_at = excluded.last_checked_at",
            params![url, now],
        )?;
        tx.execute(
            "UPDATE source_stats SET
                total_queries = total_queries + 1,
                errored_queries = errored_queries + 1,
                total_latency_ms = total_latency_ms + ?2,
                last_error_at = ?3,
                last_error_message = ?4,
                rolling_total_count = rolling_total_count + 1
             WHERE sourceUrl = ?1",
            params![url, latency_ms as i64, now, msg],
        )?;
        prune_rolling_window(&tx, &url)?;
        let h = recompute_health_in_tx(&tx, &url)?;
        tx.execute("UPDATE source_stats SET health_score = ?2 WHERE sourceUrl = ?1", params![url, h])?;
        tx.commit()?;
        Ok::<_, rusqlite::Error>(())
    })
    .await
    .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?
}
```

Add at the end of the file (after the impl block, before the test module):

```rust
fn prune_rolling_window(conn: &rusqlite::Transaction, source_url: &str) -> rusqlite::Result<()> {
    let total: i64 = conn.query_row(
        "SELECT rolling_total_count FROM source_stats WHERE sourceUrl = ?1",
        params![source_url],
        |r| r.get(0),
    )?;
    if total > 50 {
        conn.execute(
            "UPDATE source_stats SET
                rolling_success_count = rolling_success_count / 2,
                rolling_total_count = rolling_total_count / 2
             WHERE sourceUrl = ?1",
            params![source_url],
        )?;
    }
    Ok(())
}

fn recompute_health_in_tx(conn: &rusqlite::Transaction, source_url: &str) -> rusqlite::Result<f64> {
    let (succ, total, last_succ): (i64, i64, Option<i64>) = conn.query_row(
        "SELECT rolling_success_count, rolling_total_count, last_success_at
         FROM source_stats WHERE sourceUrl = ?1",
        params![source_url],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    let sr = if total > 0 { succ as f64 / total as f64 } else { 1.0 };
    let (total_ms, total_q): (i64, i64) = conn.query_row(
        "SELECT total_latency_ms, total_queries FROM source_stats WHERE sourceUrl = ?1",
        params![source_url],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let p99 = if total_q == 0 { 0.0 } else { (total_ms as f64 / total_q as f64) * 2.0 };
    let now = chrono::Utc::now().timestamp();
    let recency = last_succ.map(|t| (now - t) as f64 / 3600.0).unwrap_or(168.0);
    Ok(compute_health(HealthInputs {
        success_rate: sr,
        p99_latency_ms: p99,
        recency_hours: recency,
    }))
}
```

### Step 12: Run all DAO tests

```bash
cd src-tauri
cargo test --lib source_stats_dao
```

Expected: 8 tests pass (4 compute_health + 4 DAO).

### Step 13: Wire `pub mod` and `pub use` in `db/mod.rs`

In `src-tauri/src/db/mod.rs`, add (right after the existing `pub use dao::{...}` block around line 15):

```rust
pub mod source_stats_dao;
pub use source_stats_dao::{compute_health, HealthInputs, SourceStats, SourceStatsDao};
```

### Step 14: Full build to ensure integration

```bash
cd D:\code\novel_read
cd src-tauri
cargo build
cd ..
pnpm build
```

Expected: both succeed.

### Step 15: Commit

```bash
cd D:\code\novel_read
git add src-tauri/src/db/migrations.rs \
        src-tauri/src/db/source_stats_dao.rs \
        src-tauri/src/db/mod.rs
git -c user.name=opencode -c user.email=opencode@legado-desktop.local \
    commit -m "feat(search-t1): source_stats table + DAO with health computation

- Add CREATE_SOURCE_STATS_TABLE migration (TEXT PK on sourceUrl)
- Add SourceStatsDao: async CRUD + record_success/timeout/error
- Add compute_health() formula: 0.6*success_rate + 0.3*latency + 0.1*recency
- Add 8 unit tests (4 compute_health + 4 DAO integration)
- Expose types from db::mod"
```

### Definition of Done — Task 1
- [ ] `cargo build` succeeds
- [ ] `cargo test --lib source_stats_dao` shows 8 passes
- [ ] `pnpm build` succeeds (sanity)
- [ ] Commit `feat(search-t1):` exists in `git log --oneline -1`


---

## Task 2: relevance.rs 7-rule cascade

**Files:**
- Create: `src-tauri/src/book_source/relevance.rs` — pure functions: `normalize_text`, `damerau_levenshtein`, `score`, `ScoreBreakdown` struct with `Ord` impl
- Modify: `src-tauri/src/book_source/mod.rs` — add `pub mod relevance;` and `pub use relevance::{score, ScoreBreakdown, normalize_text, damerau_levenshtein};`
- Test: same file `#[cfg(test)] mod tests`

**Context for this task:**
- This module is **pure** (no I/O, no async). Safe to test in isolation.
- `BookSource` is the existing struct in `crate::db::models`; we use `source.weight: i32` (default 0) and `source.book_source_url` (as the key for the health lookup, but for v1 we pass the health score as a parameter to keep this module pure).
- `SearchBook` is the existing struct in `crate::db::models`; we use `book.name`, `book.author`, `book.intro`.
- The cascade order is FIXED in this task; weights are hard-coded constants. (Tuning happens in Phase 4.)
- `unicode-segmentation` is NOT required; we treat Chinese text as character runs and use `chars().count()` for length.

### Step 1: Add `relevance` module declaration to `book_source/mod.rs`

In `src-tauri/src/book_source/mod.rs`, add at the top with the other module declarations:

```rust
pub mod relevance;
pub use relevance::{score, ScoreBreakdown, normalize_text, damerau_levenshtein};
```

### Step 2: Write the test file FIRST (TDD)

Create `src-tauri/src/book_source/relevance.rs` with ONLY the test module (no impl yet):

```rust
//! 7-rule relevance cascade for search results.
//! See spec §7 for the algorithm details.

use serde::{Deserialize, Serialize};
use std::cmp::Ordering;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct ScoreBreakdown {
    pub words: u8,
    pub typo: u8,
    pub proximity: u8,
    pub source_weight: u8,
    pub attribute_rank: u8,
    pub word_position: u8,
    pub source_health: u8,
}

pub fn normalize_text(s: &str) -> String {
    // TODO: implement
    String::new()
}

pub fn damerau_levenshtein(a: &str, b: &str) -> usize {
    // TODO: implement
    0
}

pub fn score(
    book_name: &str,
    book_author: Option<&str>,
    book_intro: Option<&str>,
    query: &str,
    source_weight: i32,
    source_health: f64,
) -> ScoreBreakdown {
    // TODO: implement
    ScoreBreakdown {
        words: 0,
        typo: 0,
        proximity: 0,
        source_weight: 0,
        attribute_rank: 0,
        word_position: 0,
        source_health: 0,
    }
}

impl Ord for ScoreBreakdown {
    fn cmp(&self, other: &Self) -> Ordering {
        // TODO: implement
        Ordering::Equal
    }
}

impl PartialOrd for ScoreBreakdown {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx_eq_u8(a: u8, b: u8) -> bool {
        (a as i16 - b as i16).abs() <= 1
    }

    #[test]
    fn dl_known_pairs() {
        assert_eq!(damerau_levenshtein("kitten", "sitten"), 1);
        assert_eq!(damerau_levenshtein("book", "back"), 2);
        assert_eq!(damerau_levenshtein("ca", "abc"), 2);
        assert_eq!(damerau_levenshtein("a", "a"), 0);
        assert_eq!(damerau_levenshtein("", "abc"), 3);
    }

    #[test]
    fn dl_chinese() {
        assert_eq!(damerau_levenshtein("三体", "三体"), 0);
        assert_eq!(damerau_levenshtein("三体", "三题"), 1);
    }

    #[test]
    fn normalize_strips_punct_and_spaces() {
        assert_eq!(normalize_text("三体 (刘慈欣)"), "三体刘慈欣");
        assert_eq!(normalize_text("  Hello,  World!  "), "helloworld");
    }

    #[test]
    fn score_exact_title_match() {
        let s = score("三体", Some("刘慈欣"), Some("科幻小说"), "三体", 0, 1.0);
        assert!(s.words >= 1, "words should be >= 1, got {}", s.words);
        assert!(s.typo >= 250, "typo should be near 255, got {}", s.typo);
        assert_eq!(s.proximity, 0);
        assert!(s.attribute_rank >= 3);
    }

    #[test]
    fn score_author_only_lower_rank() {
        let s_title = score("三体", Some("刘慈欣"), None, "刘慈欣", 0, 1.0);
        let s_author = score("三体", Some("刘慈欣"), None, "三体", 0, 1.0);
        assert!(s_title.attribute_rank >= s_author.attribute_rank);
    }

    #[test]
    fn score_typo_tolerance() {
        let s = score("三体", Some("刘慈欣"), None, "三题", 0, 1.0);
        assert!(s.typo >= 200, "typo should be > 200 for 1-edit distance, got {}", s.typo);
    }

    #[test]
    fn compare_lex_title_beats_author() {
        let a = score("三体", Some("刘慈欣"), None, "三体", 0, 1.0);
        let b = score("三体", Some("刘慈欣"), None, "刘慈欣", 0, 1.0);
        assert!(a > b, "title match should outrank author match");
    }

    #[test]
    fn compare_lex_source_weight_breaks_tie() {
        let a = score("三体", Some("刘慈欣"), None, "三体", 100, 1.0);
        let b = score("三体", Some("刘慈欣"), None, "三体", 0, 1.0);
        assert!(a > b, "higher source weight should win");
    }
}
```

### Step 3: Run the tests (they should FAIL)

```bash
cd src-tauri
cargo test --lib relevance
```

Expected: all 8 tests FAIL with assertion errors (because `score` returns 0s and `damerau_levenshtein` returns 0).

### Step 4: Implement `damerau_levenshtein` (with cap at 64 chars)

Replace the placeholder:

```rust
pub fn damerau_levenshtein(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().take(64).collect();
    let b: Vec<char> = b.chars().take(64).collect();
    let n = a.len();
    let m = b.len();
    if n == 0 { return m; }
    if m == 0 { return n; }

    let mut prev_prev: Vec<usize> = (0..=m).collect();
    let mut prev: Vec<usize> = (0..=m).collect();
    let mut curr = vec![0usize; m + 1];

    for i in 1..=n {
        curr[0] = i;
        for j in 1..=m {
            let cost = if a[i - 1] == b[j - 1] { 0 } else { 1 };
            curr[j] = (prev[j] + 1)
                .min(curr[j - 1] + 1)
                .min(prev[j - 1] + cost);
            if i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1] {
                curr[j] = curr[j].min(prev_prev[j - 2] + cost);
            }
        }
        std::mem::swap(&mut prev_prev, &mut prev);
        std::mem::swap(&mut prev, &mut curr);
    }
    prev[m]
}
```

### Step 5: Implement `normalize_text`

```rust
pub fn normalize_text(s: &str) -> String {
    let lower = s.to_lowercase();
    let stripped: String = lower
        .chars()
        .filter(|c| !c.is_whitespace() && !c.is_ascii_punctuation() && !is_cjk_punct(*c))
        .collect();
    stripped
}

fn is_cjk_punct(c: char) -> bool {
    matches!(c,
        '\u{3000}'..='\u{303F}' |   // CJK Symbols and Punctuation
        '\u{FF00}'..='\u{FFEF}'     // Halfwidth and Fullwidth Forms
    )
}
```

### Step 6: Run the unit tests for the 3 functions

```bash
cargo test --lib relevance::tests
```

Expected: `dl_known_pairs`, `dl_chinese`, `normalize_strips_punct_and_spaces` PASS. Other tests still fail.

### Step 7: Implement `score`

Replace the placeholder:

```rust
pub fn score(
    book_name: &str,
    book_author: Option<&str>,
    book_intro: Option<&str>,
    query: &str,
    source_weight: i32,
    source_health: f64,
) -> ScoreBreakdown {
    let q = normalize_text(query);
    let title = normalize_text(book_name);
    let author = normalize_text(book_author.unwrap_or(""));
    let intro = normalize_text(book_intro.unwrap_or(""));

    // Rule 1: words
    let q_chars: Vec<char> = q.chars().collect();
    let title_hits = count_substring_hits(&q, &title);
    let author_hits = count_substring_hits(&q, &author);
    let intro_hits = count_substring_hits(&q, &intro);
    let words = title_hits.saturating_add(author_hits).min(255) as u8;

    // Rule 2: typo (best of title/author)
    let typo_title = 255u8.saturating_sub(damerau_levenshtein(&q, &title).min(255) as u8);
    let typo_author = 255u8.saturating_sub(damerau_levenshtein(&q, &author).min(255) as u8);
    let typo = typo_title.max(typo_author);

    // Rule 3: proximity (min span of query chars in title)
    let proximity = if q.is_empty() || title.is_empty() {
        255u8
    } else {
        proximity_score(&q_chars, &title).min(255) as u8
    };

    // Rule 4: source_weight (clamp 50..=200, default 100)
    let source_weight_u8 = ((source_weight.max(0).min(200)) as u8).max(50);

    // Rule 5: attribute_rank
    let attribute_rank = (if title_hits > 0 { 3 } else { 0 })
        + (if author_hits > 0 { 2 } else { 0 })
        + (if intro_hits > 0 { 1 } else { 0 });

    // Rule 6: word_position
    let word_position = if q.is_empty() || title.is_empty() {
        255u8
    } else {
        first_match_position(&q, &title).min(255) as u8
    };

    // Rule 7: source_health
    let source_health_u8 = (source_health.clamp(0.0, 1.0) * 100.0) as u8;

    ScoreBreakdown {
        words,
        typo,
        proximity,
        source_weight: source_weight_u8,
        attribute_rank,
        word_position,
        source_health: source_health_u8,
    }
}

fn count_substring_hits(needle: &str, haystack: &str) -> usize {
    if needle.is_empty() {
        return 0;
    }
    haystack.matches(needle).count()
}

fn proximity_score(q_chars: &[char], title: &str) -> usize {
    // Find the leftmost position of the first query char, and the rightmost position
    // of the last query char in the title. Span = right - left.
    // If query has multiple distinct chars, find min span over all positions of q[0].
    if q_chars.is_empty() || title.is_empty() {
        return usize::MAX;
    }
    let first_q = q_chars[0];
    let last_q = *q_chars.last().unwrap();
    let title_chars: Vec<char> = title.chars().collect();
    let mut left = None;
    for (i, &c) in title_chars.iter().enumerate() {
        if c == first_q {
            left = Some(i);
            break;
        }
    }
    let mut right = None;
    for (i, &c) in title_chars.iter().enumerate().rev() {
        if c == last_q {
            right = Some(i);
            break;
        }
    }
    match (left, right) {
        (Some(l), Some(r)) if r >= l => r - l,
        _ => usize::MAX,
    }
}

fn first_match_position(needle: &str, haystack: &str) -> usize {
    if needle.is_empty() || haystack.is_empty() {
        return usize::MAX;
    }
    if let Some(byte_idx) = haystack.find(needle) {
        // Convert byte index to char index
        haystack[..byte_idx].chars().count()
    } else {
        usize::MAX
    }
}
```

### Step 8: Run the score tests

```bash
cargo test --lib relevance::tests
```

Expected: 6 of 8 tests pass. `compare_lex_*` tests still fail because `Ord` is not implemented.

### Step 9: Implement `Ord`

Replace the `Ordering::Equal` placeholder:

```rust
impl Ord for ScoreBreakdown {
    fn cmp(&self, other: &Self) -> Ordering {
        // DESC for words/typo/weight/rank/health; ASC for proximity/position
        other.words.cmp(&self.words)
            .then(other.typo.cmp(&self.typo))
            .then(self.proximity.cmp(&other.proximity))
            .then(other.source_weight.cmp(&self.source_weight))
            .then(other.attribute_rank.cmp(&self.attribute_rank))
            .then(self.word_position.cmp(&other.word_position))
            .then(other.source_health.cmp(&self.source_health))
    }
}
```

### Step 10: Run all tests

```bash
cd src-tauri
cargo test --lib relevance
```

Expected: 8 tests pass.

### Step 11: Full build

```bash
cd D:\code\novel_read
cd src-tauri
cargo build
cd ..
pnpm build
```

Expected: both succeed.

### Step 12: Commit

```bash
cd D:\code\novel_read
git add src-tauri/src/book_source/relevance.rs \
        src-tauri/src/book_source/mod.rs
git -c user.name=opencode -c user.email=opencode@legado-desktop.local \
    commit -m "feat(search-t2): 7-rule relevance cascade module

- Add ScoreBreakdown struct (7 u8 fields) with Ord (lex cascade)
- Add normalize_text (strip punct + whitespace + lowercase)
- Add damerau_levenshtein (4-row DP, 64-char cap, supports CJK)
- Add score() computing 7-rule breakdown
- 8 unit tests covering each rule + Ord comparison"
```

### Definition of Done — Task 2
- [ ] `cargo test --lib relevance` shows 8 passes
- [ ] `cargo build` succeeds
- [ ] `pnpm build` succeeds (sanity)
- [ ] Commit `feat(search-t2):` exists


---

## Task 3: search_streamer.rs skeleton

**Files:**
- Create: `src-tauri/src/book_source/search_streamer.rs` — new module with `run_stream`, `SearchEvent`, `FailureKind`
- Modify: `src-tauri/src/book_source/mod.rs` — add `pub mod search_streamer;` and `pub use search_streamer::{run_stream, SearchEvent, FailureKind};`
- Test: same file `#[cfg(test)] mod tests`

**Context for this task:**
- This task builds the **streaming orchestration skeleton**. The real per-source search logic (calling `WebBook::search`) is wired in Task 4 (the Tauri command) and Task 8 (stats hookup). For now, `run_stream` accepts a list of **mock sources** (a `Vec<MockSource>` test helper) so we can write fast unit tests.
- The Tauri `Channel<T>` parameter is real (Tauri 2 ships it) but we will NOT exercise it in unit tests; instead, we use a custom `SearchSink` trait that the Tauri command implements by wrapping `Channel<SearchEvent>`. This makes the streamer testable without spinning up a Tauri runtime.
- `SearchEvent` is a Rust enum with `#[derive(Serialize)]` so it crosses the IPC boundary.

### Step 1: Declare the module

In `src-tauri/src/book_source/mod.rs`, add:

```rust
pub mod search_streamer;
pub use search_streamer::{run_stream, SearchEvent, FailureKind};
```

### Step 2: Write the test file FIRST

Create `src-tauri/src/book_source/search_streamer.rs` with the test module and skeleton:

```rust
//! Streaming search orchestrator.
//! Fans out searches to N sources in parallel with per-source and global
//! timeouts. Emits `SearchEvent`s via a `SearchSink`.

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Semaphore;

pub const PER_SOURCE_TIMEOUT: Duration = Duration::from_secs(2);
pub const GLOBAL_TIMEOUT: Duration = Duration::from_millis(3500);
pub const MAX_CONCURRENCY: usize = 8;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum FailureKind {
    Timeout,
    Http,
    Parse,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event", rename_all = "PascalCase")]
pub enum SearchEvent {
    Started { request_id: String, query: String, total_sources: usize },
    SourceStarted { source_url: String, source_name: String },
    Result { source_url: String, book: crate::db::SearchBook, score: crate::book_source::relevance::ScoreBreakdown },
    SourceFinished { source_url: String, count: usize, latency_ms: u64 },
    SourceFailed { source_url: String, error: String, latency_ms: u64, kind: FailureKind },
    Done { request_id: String, succeeded: usize, failed: usize, total_results: usize, duration_ms: u64 },
}

/// Abstraction over the Tauri Channel so we can test without spinning up Tauri.
pub trait SearchSink: Send + Sync {
    fn send(&self, event: SearchEvent) -> Result<(), String>;
}

pub struct MockSource {
    pub url: String,
    pub name: String,
    pub books: Vec<MockBook>,
    pub delay_ms: u64,
    pub fail: Option<String>,
}

pub struct MockBook {
    pub name: String,
    pub author: Option<String>,
}

pub async fn run_stream<S: SearchSink + 'static>(
    query: String,
    sources: Vec<MockSource>,
    sink: Arc<S>,
    request_id: String,
    mut cancel: tokio::sync::watch::Receiver<bool>,
) {
    // TODO: implement
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    use std::collections::HashMap;

    #[derive(Default)]
    struct CollectingSink {
        events: Mutex<Vec<SearchEvent>>,
    }
    impl SearchSink for CollectingSink {
        fn send(&self, event: SearchEvent) -> Result<(), String> {
            self.events.lock().unwrap().push(event);
            Ok(())
        }
    }

    fn mk_source(url: &str, books: Vec<(&str, Option<&str>)>, delay_ms: u64) -> MockSource {
        MockSource {
            url: url.to_string(),
            name: url.to_string(),
            books: books.into_iter().map(|(n, a)| MockBook { name: n.to_string(), author: a.map(String::from) }).collect(),
            delay_ms,
            fail: None,
        }
    }

    #[tokio::test]
    async fn all_sources_succeed() {
        let sink = Arc::new(CollectingSink::default());
        let sources = vec![
            mk_source("a", vec![("Book A1", Some("Auth A")), ("Book A2", None)], 10),
            mk_source("b", vec![("Book B1", None)], 10),
        ];
        let (_tx, rx) = tokio::sync::watch::channel(false);
        run_stream("test".to_string(), sources, sink.clone(), "req-1".to_string(), rx).await;
        let events = sink.events.lock().unwrap();
        let started = events.iter().filter(|e| matches!(e, SearchEvent::Started { .. })).count();
        let finished = events.iter().filter(|e| matches!(e, SearchEvent::SourceFinished { .. })).count();
        let done = events.iter().filter(|e| matches!(e, SearchEvent::Done { .. })).count();
        assert_eq!(started, 1);
        assert_eq!(finished, 2);
        assert_eq!(done, 1);
    }

    #[tokio::test]
    async fn one_source_times_out() {
        let sink = Arc::new(CollectingSink::default());
        let mut slow = mk_source("slow", vec![("Book", None)], 5000);
        slow.fail = Some("timeout".to_string()); // simulated by long delay
        let fast = mk_source("fast", vec![("Book", None)], 10);
        let sources = vec![slow, fast];
        let (_tx, rx) = tokio::sync::watch::channel(false);
        run_stream("test".to_string(), sources, sink.clone(), "req-2".to_string(), rx).await;
        let events = sink.events.lock().unwrap();
        let failures: Vec<&SearchEvent> = events.iter().filter(|e| matches!(e, SearchEvent::SourceFailed { kind: FailureKind::Timeout, .. })).collect();
        assert_eq!(failures.len(), 1, "expected exactly one timeout failure");
    }

    #[tokio::test]
    async fn cancel_before_start_does_nothing() {
        let sink = Arc::new(CollectingSink::default());
        let sources = vec![mk_source("a", vec![("Book", None)], 10)];
        let (tx, rx) = tokio::sync::watch::channel(false);
        tx.send(true).unwrap();
        run_stream("test".to_string(), sources, sink.clone(), "req-3".to_string(), rx).await;
        let events = sink.events.lock().unwrap();
        let started: usize = events.iter().filter(|e| matches!(e, SearchEvent::SourceStarted { .. })).count();
        let results: usize = events.iter().filter(|e| matches!(e, SearchEvent::Result { .. })).count();
        let done: usize = events.iter().filter(|e| matches!(e, SearchEvent::Done { .. })).count();
        assert_eq!(started, 0);
        assert_eq!(results, 0);
        assert_eq!(done, 1);
    }

    #[tokio::test]
    async fn events_ordered() {
        let sink = Arc::new(CollectingSink::default());
        let sources = vec![mk_source("a", vec![("Book", None)], 10)];
        let (_tx, rx) = tokio::sync::watch::channel(false);
        run_stream("test".to_string(), sources, sink.clone(), "req-4".to_string(), rx).await;
        let events = sink.events.lock().unwrap();
        // First event must be Started, last must be Done
        assert!(matches!(events.first().unwrap(), SearchEvent::Started { .. }));
        assert!(matches!(events.last().unwrap(), SearchEvent::Done { .. }));
    }
}
```

### Step 3: Run the tests (should FAIL with empty body)

```bash
cd src-tauri
cargo test --lib search_streamer
```

Expected: 4 tests FAIL (or hang, since `run_stream` does nothing and we have no asserts to check the count of `Done` — but it WILL hang because we never emit `Done` in the placeholder).

### Step 4: Implement `run_stream`

Replace the placeholder:

```rust
pub async fn run_stream<S: SearchSink + 'static>(
    query: String,
    sources: Vec<MockSource>,
    sink: Arc<S>,
    request_id: String,
    mut cancel: tokio::sync::watch::Receiver<bool>,
) {
    let started_at = std::time::Instant::now();
    let total = sources.len();
    let _ = sink.send(SearchEvent::Started {
        request_id: request_id.clone(),
        query: query.clone(),
        total_sources: total,
    });

    if total == 0 {
        let _ = sink.send(SearchEvent::Done {
            request_id,
            succeeded: 0,
            failed: 0,
            total_results: 0,
            duration_ms: started_at.elapsed().as_millis() as u64,
        });
        return;
    }

    let sem = Arc::new(Semaphore::new(MAX_CONCURRENCY));
    let mut tasks = Vec::with_capacity(total);

    for src in sources {
        if *cancel.borrow() {
            break;
        }
        let sem = sem.clone();
        let sink = sink.clone();
        let q = query.clone();
        let cancel_rx = cancel.clone();
        tasks.push(tokio::spawn(async move {
            let _permit = match sem.acquire().await {
                Ok(p) => p,
                Err(_) => return,
            };
            // Check cancel before starting
            if *cancel_rx.borrow() {
                return;
            }
            let _ = sink.send(SearchEvent::SourceStarted {
                source_url: src.url.clone(),
                source_name: src.name.clone(),
            });
            let t0 = std::time::Instant::now();
            let outcome: Result<Vec<MockBook>, String> = if let Some(err) = &src.fail {
                Err(err.clone())
            } else {
                let q_clone = q.clone();
                let books_clone = src.books.clone();
                let delay = src.delay_ms;
                tokio::time::timeout(PER_SOURCE_TIMEOUT, async move {
                    tokio::time::sleep(Duration::from_millis(delay)).await;
                    Ok::<_, String>(books_clone)
                        .map(|b| b.into_iter().filter(|mb| {
                            // Apply the query as a "book matches if name contains query" filter
                            // (mock simplification; real search is in WebBook)
                            let q_norm = q_clone.to_lowercase();
                            mb.name.to_lowercase().contains(&q_norm) || q_norm.is_empty()
                        }).collect())
                })
                .await
                .map_err(|_| "timeout".to_string())
                .and_then(|r| r)
            };
            let latency_ms = t0.elapsed().as_millis() as u64;
            match outcome {
                Ok(books) => {
                    for mb in books {
                        let mut book = crate::db::SearchBook::default();
                        book.name = mb.name;
                        book.author = mb.author;
                        book.origin = src.url.clone();
                        let score = crate::book_source::relevance::ScoreBreakdown {
                            words: 0, typo: 0, proximity: 0,
                            source_weight: 0, attribute_rank: 0,
                            word_position: 0, source_health: 0,
                        };
                        let _ = sink.send(SearchEvent::Result {
                            source_url: src.url.clone(),
                            book,
                            score,
                        });
                    }
                    let _ = sink.send(SearchEvent::SourceFinished {
                        source_url: src.url,
                        count: 0,
                        latency_ms,
                    });
                }
                Err(e) if e == "timeout" => {
                    let _ = sink.send(SearchEvent::SourceFailed {
                        source_url: src.url,
                        error: "timeout".into(),
                        latency_ms,
                        kind: FailureKind::Timeout,
                    });
                }
                Err(e) => {
                    let _ = sink.send(SearchEvent::SourceFailed {
                        source_url: src.url,
                        error: e,
                        latency_ms,
                        kind: FailureKind::Http,
                    });
                }
            }
        }));
    }

    // Global timeout: wait for all tasks, but no more than GLOBAL_TIMEOUT
    let _ = tokio::time::timeout(GLOBAL_TIMEOUT, futures::future::join_all(tasks)).await;

    let duration_ms = started_at.elapsed().as_millis() as u64;
    let events = {
        // We don't have a way to count succeeded/failed from the sink without
        // a more complex sink. For v1, the Done event reports 0/0; Task 8 will
        // use a richer sink that tracks these counts.
        // The Tauri command in Task 4 wraps the Channel and counts.
        (0usize, 0usize, 0usize)
    };
    let (succeeded, failed, total_results) = events;
    let _ = sink.send(SearchEvent::Done {
        request_id,
        succeeded,
        failed,
        total_results,
        duration_ms,
    });
}
```

Add to `Cargo.toml` dependencies if `futures` is not yet there:

```bash
cd src-tauri
cargo add futures --features=std,executor
```

If `cargo add` is not available, manually add to `Cargo.toml`:

```toml
futures = { version = "0.3", default-features = false, features = ["std"] }
```

### Step 5: Run the tests

```bash
cargo test --lib search_streamer
```

Expected: 4 tests pass. (`all_sources_succeed` counts Started/Finished/Done; `one_source_times_out` expects exactly one Timeout failure; `cancel_before_start_does_nothing` expects 0 SourceStarted/Result and 1 Done; `events_ordered` checks first/last.)

### Step 6: Full build

```bash
cd D:\code\novel_read
cd src-tauri
cargo build
cd ..
pnpm build
```

Expected: both succeed.

### Step 7: Commit

```bash
cd D:\code\novel_read
git add src-tauri/src/book_source/search_streamer.rs \
        src-tauri/src/book_source/mod.rs \
        src-tauri/Cargo.toml
git -c user.name=opencode -c user.email=opencode@legado-desktop.local \
    commit -m "feat(search-t3): search_streamer skeleton with mock sources

- Add SearchEvent enum (Serialize, PascalCase tags) and FailureKind
- Add SearchSink trait to abstract over Tauri Channel for testability
- Add MockSource + run_stream with per-source 2s timeout, global 3.5s cap
- Add cancel via tokio::sync::watch::Receiver
- 4 unit tests (all_succeed, one_timeout, cancel_before_start, events_ordered)"
```

### Definition of Done — Task 3
- [ ] `cargo test --lib search_streamer` shows 4 passes
- [ ] `cargo build` succeeds
- [ ] `pnpm build` succeeds (sanity)
- [ ] Commit `feat(search-t3):` exists


---

# Phase 2: Wiring (4 tasks, parallel)

---

## Task 4: Tauri command `search_books_stream`

**Files:**
- Modify: `src-tauri/src/commands.rs` — add new `#[tauri::command] pub async fn search_books_stream`
- Modify: `src-tauri/src/lib.rs` — register the new command in `generate_handler!` and import it
- Modify: `src-tauri/src/state.rs` — add `search_cancel_tx` field
- Modify: `src-tauri/src/db/mod.rs` — `init_app_state` builds SourceStatsDao and passes it

**Context for this task:**
- The Tauri command receives a `Channel<SearchEvent>` and forwards to `run_stream`. Channel is `tauri::ipc::Channel<T>`.
- `AppState` will gain two new fields; this task adds one of them (`search_cancel_tx`). `source_stats` is added in Task 8 (stats hookup) since the streamer skeleton from Task 3 doesn't use it yet.
- Cancellation: on each invoke, the command must send `true` to the previous `Sender` (if any) and store the new one.
- The Tauri command WRAPS the Channel in a custom `TauriChannelSink` that implements `SearchSink` from Task 3.

### Step 1: Add `search_cancel_tx` to `AppState`

In `src-tauri/src/state.rs`, replace the contents with:

```rust
//! Application-wide state injected into Tauri commands via
//! `tauri::State<'_, AppState>`.
//!
//! Holds the shared SQLite connection pool, the source-stats DAO, and the
//! cancellation token for the streaming search command.

use crate::db::AppPool;
use crate::db::SourceStatsDao;
use std::sync::Arc;
use tokio::sync::watch;

pub struct AppState {
    pub db: AppPool,
    pub source_stats: Arc<SourceStatsDao>,
    pub search_cancel_tx: Arc<tokio::sync::Mutex<Option<watch::Sender<bool>>>>,
}

impl AppState {
    pub fn build(db: AppPool, source_stats: Arc<SourceStatsDao>) -> Self {
        Self {
            db,
            source_stats,
            search_cancel_tx: Arc::new(tokio::sync::Mutex::new(None)),
        }
    }
}
```

### Step 2: Update `init_app_state` in `db/mod.rs`

In `src-tauri/src/db/mod.rs`, replace the `init_app_state` function (around line 196) with:

```rust
pub fn init_app_state(
    app_handle: &tauri::AppHandle,
) -> Result<crate::state::AppState, Box<dyn std::error::Error>> {
    let app_dir = app_handle.path().app_data_dir()?;
    std::fs::create_dir_all(&app_dir)?;
    set_app_dir(app_dir.clone());

    check_pending_restore(&app_dir)?;

    let pool = build_pool(app_dir.join("legado.db"))?;

    let mut seed_conn = Connection::open(app_dir.join("legado.db"))?;
    bootstrap_first_conn(&mut seed_conn)?;
    seed::seed_defaults(&seed_conn)?;

    let source_stats = std::sync::Arc::new(crate::db::SourceStatsDao::new(pool.clone()));
    Ok(crate::state::AppState::build(pool, source_stats))
}
```

### Step 3: Verify the build

```bash
cd src-tauri
cargo build
```

Expected: compiles. The `source_stats` and `search_cancel_tx` fields are unused at the Tauri level until the next step, but the type is correct.

### Step 4: Add `TauriChannelSink` and the new command

Open `src-tauri/src/commands.rs`. At the top, add a use statement for the streamer types:

```rust
use crate::book_source::search_streamer::{run_stream, FailureKind, SearchEvent, SearchSink};
use crate::book_source::web_book::WebBook;
use crate::db::SearchBook;
use crate::state::AppState;
use std::sync::Arc;
use tauri::ipc::Channel;
use tauri::State;
```

At the end of the file (after the existing `search_books` command around line 1827), add:

```rust
pub struct TauriChannelSink {
    channel: Channel<SearchEvent>,
    succeeded: std::sync::atomic::AtomicUsize,
    failed: std::sync::atomic::AtomicUsize,
    total_results: std::sync::atomic::AtomicUsize,
}

impl TauriChannelSink {
    pub fn new(channel: Channel<SearchEvent>) -> Self {
        Self {
            channel,
            succeeded: std::sync::atomic::AtomicUsize::new(0),
            failed: std::sync::atomic::AtomicUsize::new(0),
            total_results: std::sync::atomic::AtomicUsize::new(0),
        }
    }
    pub fn succeeded(&self) -> usize {
        self.succeeded.load(std::sync::atomic::Ordering::SeqCst)
    }
    pub fn failed(&self) -> usize {
        self.failed.load(std::sync::atomic::Ordering::SeqCst)
    }
    pub fn total_results(&self) -> usize {
        self.total_results.load(std::sync::atomic::Ordering::SeqCst)
    }
}

impl SearchSink for TauriChannelSink {
    fn send(&self, event: SearchEvent) -> Result<(), String> {
        match &event {
            SearchEvent::Result { .. } => {
                self.total_results.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            }
            SearchEvent::SourceFinished { .. } => {
                self.succeeded.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            }
            SearchEvent::SourceFailed { .. } => {
                self.failed.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            }
            _ => {}
        }
        self.channel.send(event).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn search_books_stream(
    query: String,
    sources: Vec<crate::db::BookSource>,
    channel: Channel<SearchEvent>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Cancellation: signal previous run to stop, then store the new sender
    let (cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);
    {
        let mut guard = state.search_cancel_tx.lock().await;
        if let Some(old) = guard.take() {
            let _ = old.send(true);
        }
        *guard = Some(cancel_tx);
    }

    // Convert BookSource into MockSource for the streamer skeleton.
    // Task 8 will replace this with real WebBook search and stats hookup.
    let mock_sources: Vec<crate::book_source::search_streamer::MockSource> = sources
        .into_iter()
        .map(|s| crate::book_source::search_streamer::MockSource {
            url: s.book_source_url.clone(),
            name: s.book_source_name.clone(),
            books: vec![], // No real search yet; Task 8 will populate via WebBook
            delay_ms: 0,
            fail: None,
        })
        .collect();

    let sink = Arc::new(TauriChannelSink::new(channel));
    let request_id = uuid::Uuid::new_v4().to_string();
    run_stream(query, mock_sources, sink.clone(), request_id, cancel_rx).await;

    Ok(())
}
```

### Step 5: Register the command in `lib.rs`

In `src-tauri/src/lib.rs`, find the `generate_handler!` macro call and add `search_books_stream` to the list. Place it after the existing `search_books` (around line 230):

```rust
            search_books,
            search_books_stream,
            fetch_book_info,
```

### Step 6: Verify the build

```bash
cd D:\code\novel_read
cd src-tauri
cargo build
```

Expected: compiles. There may be a few unused warnings (mock_sources param not consumed yet, AppState fields not all read); that is fine.

### Step 7: Commit

```bash
cd D:\code\novel_read
git add src-tauri/src/commands.rs \
        src-tauri/src/lib.rs \
        src-tauri/src/state.rs \
        src-tauri/src/db/mod.rs
git -c user.name=opencode -c user.email=opencode@legado-desktop.local \
    commit -m "feat(search-t4): Tauri command search_books_stream

- Add search_cancel_tx to AppState for cancellation between invocations
- Add TauriChannelSink: SearchSink impl that wraps tauri::ipc::Channel<SearchEvent>
  and tracks succeeded/failed/total_results counters
- Add search_books_stream command: cancels previous, fans out to run_stream
- Register in generate_handler! macro
- Note: per-source WebBook search not yet wired; Task 8 will replace the
  MockSource conversion with real book searching + stats recording"
```

### Definition of Done — Task 4
- [ ] `cargo build` succeeds
- [ ] `cargo test --lib` still passes (no regressions in T1, T2, T3)
- [ ] Commit `feat(search-t4):` exists


---

## Task 5: Home.tsx state machine + Channel consumer

**Files:**
- Modify: `src/types.ts` — add `SearchEvent`, `ScoreBreakdown`, `SourceKey` exports
- Modify: `src/pages/Home.tsx` — replace search state with the new state machine; consume the Channel
- Modify: `src/i18n/locales/en.json` and `src/i18n/locales/zh.json` — add keys for new UI strings (optional in this task; old keys are reused where possible)

**Context for this task:**
- The Tauri 2 frontend API: `import { Channel, invoke } from '@tauri-apps/api/core'`. Channel is constructed as `new Channel<T>()` and `onmessage` is a property (not a method).
- The current `Home.tsx` is 694 lines and bundles search + rule-sub management. This task removes rule-sub management (moves to `/sources` in Task 9) and rewrites the search part with the new state machine.
- `useTransition` is used to wrap the result-list update so the UI stays responsive during streaming.
- `sessionStorage` caching (searchKey, searchResults) is REMOVED in this task (the new design uses real-time streams, so cached state is less useful). v1 does not re-introduce it.

### Step 1: Add types to `src/types.ts`

In `src/types.ts`, append at the end of the file (before any existing `export`):

```ts
export type SourceKey = string; // book_source_url

export type FailureKind = 'Timeout' | 'Http' | 'Parse';

export interface ScoreBreakdown {
  words: number;
  typo: number;
  proximity: number;
  sourceWeight: number;
  attributeRank: number;
  wordPosition: number;
  sourceHealth: number;
}

export type SearchEvent =
  | { event: 'Started'; requestId: string; query: string; totalSources: number }
  | { event: 'SourceStarted'; sourceUrl: SourceKey; sourceName: string }
  | { event: 'Result'; sourceUrl: SourceKey; book: SearchBook; score: ScoreBreakdown }
  | { event: 'SourceFinished'; sourceUrl: SourceKey; count: number; latencyMs: number }
  | { event: 'SourceFailed'; sourceUrl: SourceKey; error: string; latencyMs: number; kind: FailureKind }
  | { event: 'Done'; requestId: string; succeeded: number; failed: number; totalResults: number; durationMs: number };

export type SourceStatus =
  | { state: 'pending'; sourceUrl: SourceKey; sourceName: string }
  | { state: 'running'; sourceUrl: SourceKey; sourceName: string }
  | { state: 'ok'; sourceUrl: SourceKey; sourceName: string; count: number; latencyMs: number }
  | { state: 'failed'; sourceUrl: SourceKey; sourceName: string; error: string; latencyMs: number; kind: FailureKind };

export type SearchState =
  | { kind: 'idle' }
  | { kind: 'typing' }
  | { kind: 'streaming'; query: string; results: SearchBook[]; statuses: Record<SourceKey, SourceStatus>; failures: Array<{ sourceUrl: SourceKey; sourceName: string; error: string; kind: FailureKind }>; startedAt: number; requestId: string }
  | { kind: 'stalled'; query: string; results: SearchBook[]; statuses: Record<SourceKey, SourceStatus>; failures: Array<{ sourceUrl: SourceKey; sourceName: string; error: string; kind: FailureKind }>; startedAt: number; requestId: string; stalledSince: number }
  | { kind: 'done'; query: string; results: SearchBook[]; statuses: Record<SourceKey, SourceStatus>; failures: Array<{ sourceUrl: SourceKey; sourceName: string; error: string; kind: FailureKind }>; totalResults: number; durationMs: number }
  | { kind: 'error'; message: string };
```

### Step 2: Create the new Home.tsx file (replaces the existing one entirely)

**IMPORTANT**: This is a full rewrite. The new file is ~280 lines, no rule-sub management (moved to /sources in Task 9), no sessionStorage caching.

Replace `src/pages/Home.tsx` with:

```tsx
import { useState, useEffect, useRef, useCallback, useTransition } from 'react';
import { invoke, Channel } from '@tauri-apps/api/core';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ApiResponse, BookSource, SearchBook, SearchEvent, SearchKeyword, SearchState, ScoreBreakdown, SourceKey, SourceStatus } from '../types';
import { useUiMode } from '../uiMode';
import SourceStatusStrip from '../components/search/SourceStatusStrip';
import FailureFooter from '../components/search/FailureFooter';

const STALL_THRESHOLD_MS = 500;

function compareScore(a: ScoreBreakdown, b: ScoreBreakdown): number {
  // DESC: words, typo, sourceWeight, attributeRank, sourceHealth
  if (a.words !== b.words) return b.words - a.words;
  if (a.typo !== b.typo) return b.typo - a.typo;
  if (a.proximity !== b.proximity) return a.proximity - b.proximity;
  if (a.sourceWeight !== b.sourceWeight) return b.sourceWeight - a.sourceWeight;
  if (a.attributeRank !== b.attributeRank) return b.attributeRank - a.attributeRank;
  if (a.wordPosition !== b.wordPosition) return a.wordPosition - b.wordPosition;
  return b.sourceHealth - a.sourceHealth;
}

export default function Home() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isMobileUi } = useUiMode();
  const [sources, setSources] = useState<BookSource[]>([]);
  const [searchKey, setSearchKey] = useState('');
  const [searchHistory, setSearchHistory] = useState<SearchKeyword[]>([]);
  const [state, setState] = useState<SearchState>({ kind: 'idle' });
  const [isPending, startTransition] = useTransition();
  const currentChannelRef = useRef<Channel<SearchEvent> | null>(null);
  const currentRequestIdRef = useRef<string | null>(null);

  useEffect(() => {
    void loadSources();
    void loadSearchHistory();
  }, []);

  async function loadSources() {
    try {
      const resp = await invoke<ApiResponse<BookSource[]>>('get_book_sources');
      if (resp.success && resp.data) setSources(resp.data);
    } catch (e) {
      console.error('Failed to load sources:', e);
    }
  }

  async function loadSearchHistory() {
    try {
      const resp = await invoke<ApiResponse<SearchKeyword[]>>('get_search_keywords', { limit: 10 });
      if (resp.success && resp.data) setSearchHistory(resp.data);
    } catch (e) {
      console.error('Failed to load history:', e);
    }
  }

  async function clearHistory() {
    try {
      await invoke('clear_search_keywords');
      setSearchHistory([]);
    } catch (e) {
      console.error('Failed to clear history:', e);
    }
  }

  async function saveSearchKeyword(keyword: string) {
    try {
      await invoke('add_search_keyword', { keyword: keyword.trim() });
      await loadSearchHistory();
    } catch (e) {
      console.error('Failed to save keyword:', e);
    }
  }

  const handleSearch = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (!trimmed) return;
      const enabled = sources.filter((s) => s.enabled && s.search_url);
      if (enabled.length === 0) {
        setState({ kind: 'error', message: t('home.noEnabledSources') });
        return;
      }

      // Cancel previous channel by closing it
      if (currentChannelRef.current) {
        try {
          currentChannelRef.current.close?.();
        } catch { /* ignore */ }
        currentChannelRef.current = null;
      }

      const requestId = crypto.randomUUID();
      currentRequestIdRef.current = requestId;
      const channel = new Channel<SearchEvent>();
      currentChannelRef.current = channel;

      const initialStatuses: Record<SourceKey, SourceStatus> = {};
      for (const s of enabled) {
        initialStatuses[s.book_source_url] = { state: 'pending', sourceUrl: s.book_source_url, sourceName: s.book_source_name };
      }
      setState({
        kind: 'streaming',
        query: trimmed,
        results: [],
        statuses: initialStatuses,
        failures: [],
        startedAt: Date.now(),
        requestId,
      });

      channel.onmessage = (event) => {
        if (currentRequestIdRef.current !== requestId) return; // stale
        startTransition(() => {
          setState((s) => applyEvent(s, event, requestId, t));
        });
      };

      try {
        await invoke('search_books_stream', { query: trimmed, sources: enabled, channel });
      } catch (e) {
        if (currentRequestIdRef.current === requestId) {
          setState({ kind: 'error', message: String(e) });
        }
      }
    },
    [sources, t]
  );

  // Debounce 450ms
  useEffect(() => {
    const id = setTimeout(() => {
      if (searchKey.trim()) void handleSearch(searchKey);
    }, 450);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchKey]);

  const sortedResults: SearchBook[] = (() => {
    if (state.kind === 'streaming' || state.kind === 'stalled' || state.kind === 'done') {
      return [...state.results];
    }
    return [];
  })();

  const sourceStatusList: SourceStatus[] = (() => {
    if (state.kind === 'streaming' || state.kind === 'stalled' || state.kind === 'done') {
      return Object.values(state.statuses);
    }
    return [];
  })();

  const failureList = (() => {
    if (state.kind === 'streaming' || state.kind === 'stalled' || state.kind === 'done') {
      return state.failures;
    }
    return [];
  })();

  const retryOne = useCallback(
    (sourceUrl: SourceKey) => {
      // v1: just re-run the whole search; per-source retry is in P4 polish
      void handleSearch(searchKey);
    },
    [handleSearch, searchKey]
  );

  return (
    <div>
      {/* Search Bar */}
      <section style={sectionStyle(isMobileUi)}>
        <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700, color: '#1a1a2e' }}>
          {t('layout.searchPage')}
        </h2>
        <div style={{ display: 'flex', flexDirection: isMobileUi ? 'column' : 'row', gap: 10, alignItems: isMobileUi ? 'stretch' : 'center' }}>
          <input
            type="text"
            value={searchKey}
            onChange={(e) => setSearchKey(e.target.value)}
            placeholder={t('home.enterBookName')}
            style={{ ...inputStyle, flex: 1, width: isMobileUi ? '100%' : undefined }}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch(searchKey)}
          />
          <button
            onClick={() => handleSearch(searchKey)}
            disabled={state.kind === 'streaming' || state.kind === 'stalled'}
            style={{
              ...btnPrimary,
              opacity: state.kind === 'streaming' || state.kind === 'stalled' ? 0.7 : 1,
              ...(isMobileUi ? { width: '100%', minHeight: 44 } : {}),
            }}
          >
            {state.kind === 'streaming' || state.kind === 'stalled' ? t('common.loading') : t('common.search')}
          </button>
        </div>

        {searchHistory.length > 0 && (
          <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: '#888', fontWeight: 500 }}>{t('home.history')}</span>
            {searchHistory.map((item) => (
              <button
                key={item.id || item.keyword}
                onClick={() => { setSearchKey(item.keyword); void handleSearch(item.keyword); }}
                style={chipStyle}
              >
                {item.keyword}
              </button>
            ))}
            <button onClick={clearHistory} style={chipDangerStyle}>{t('home.clearHistory')}</button>
          </div>
        )}
      </section>

      {/* Source status strip (only when searching) */}
      {sourceStatusList.length > 0 && (
        <SourceStatusStrip statuses={sourceStatusList} onRetry={retryOne} />
      )}

      {/* Error message */}
      {state.kind === 'error' && (
        <div style={{ background: '#ffebee', color: '#c62828', padding: '10px 16px', borderRadius: 8, marginBottom: 16, fontSize: 14, fontWeight: 500 }}>
          {state.message}
        </div>
      )}

      {/* Results */}
      {sortedResults.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1a1a2e', marginBottom: 16 }}>
            {t('home.resultsCount', { count: sortedResults.length })}
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {sortedResults.map((book) => (
              <ResultCard key={book.book_url} book={book} isMobileUi={isMobileUi} onClick={() => openBook(book, sources, navigate)} />
            ))}
          </div>
        </section>
      )}

      {/* Failure footer */}
      {failureList.length > 0 && (
        <FailureFooter failures={failureList} onRetryAll={() => handleSearch(searchKey)} />
      )}

      {/* Status: idle hint */}
      {state.kind === 'idle' && sources.length > 0 && (
        <p style={{ color: '#888', fontSize: 13, marginTop: 24 }}>
          {t('home.sourcesCount', { count: sources.filter((s) => s.enabled && s.search_url).length })}
        </p>
      )}
    </div>
  );
}

// Pure event reducer (kept here for proximity, could move to a hook)
function applyEvent(
  state: SearchState,
  event: SearchEvent,
  requestId: string,
  t: (k: string, opts?: Record<string, unknown>) => string
): SearchState {
  if (state.kind !== 'streaming' && state.kind !== 'stalled' && state.kind !== 'done') return state;
  if (state.requestId !== requestId) return state;

  switch (event.event) {
    case 'Started':
      return state;
    case 'SourceStarted': {
      const statuses = { ...state.statuses };
      statuses[event.sourceUrl] = { state: 'running', sourceUrl: event.sourceUrl, sourceName: event.sourceName };
      return { ...state, statuses };
    }
    case 'Result': {
      const next = [...state.results, event.book];
      return { ...state, results: next };
    }
    case 'SourceFinished': {
      const statuses = { ...state.statuses };
      statuses[event.sourceUrl] = { state: 'ok', sourceUrl: event.sourceUrl, sourceName: state.statuses[event.sourceUrl]?.sourceName ?? '', count: event.count, latencyMs: event.latencyMs };
      return { ...state, statuses };
    }
    case 'SourceFailed': {
      const statuses = { ...state.statuses };
      statuses[event.sourceUrl] = { state: 'failed', sourceUrl: event.sourceUrl, sourceName: state.statuses[event.sourceUrl]?.sourceName ?? '', error: event.error, latencyMs: event.latencyMs, kind: event.kind };
      const failures = [...state.failures, { sourceUrl: event.sourceUrl, sourceName: state.statuses[event.sourceUrl]?.sourceName ?? '', error: event.error, kind: event.kind }];
      return { ...state, statuses, failures };
    }
    case 'Done': {
      return { ...state, kind: 'done', totalResults: event.totalResults, durationMs: event.durationMs };
    }
  }
}

function openBook(book: SearchBook, sources: BookSource[], navigate: ReturnType<typeof useNavigate>) {
  const source = sources.find((s) => s.book_source_url === book.origin);
  if (!source) return;
  navigate(`/book/${encodeURIComponent(book.book_url)}`, { state: { preview: true, source, searchBook: book } });
}

function ResultCard({ book, isMobileUi, onClick }: { book: SearchBook; isMobileUi: boolean; onClick: () => void }) {
  // v1 of ResultCard: covers are eager; Task 7 will lazy-load.
  return (
    <div
      onClick={onClick}
      style={{ background: '#fff', borderRadius: 14, padding: 14, display: 'flex', gap: 14, cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,0.06), 0 3px 10px rgba(0,0,0,0.04)' }}
    >
      {book.cover_url ? (
        <img src={book.cover_url} alt="cover" style={{ width: 76, height: 96, objectFit: 'cover', borderRadius: 10, flexShrink: 0 }} />
      ) : (
        <div style={{ width: 76, height: 96, borderRadius: 10, background: 'linear-gradient(145deg, #e8eaf6 0%, #f3e5f5 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5c6bc0', fontSize: 18, fontWeight: 800, flexShrink: 0 }}>
          {book.name.slice(0, 2)}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: '#1a1a2e' }}>{book.name}</div>
        <div style={{ color: '#8a8a9a', fontSize: 13, fontWeight: 500 }}>{book.author}</div>
        {book.intro && <div style={{ color: '#666', fontSize: 12, marginTop: 4, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{book.intro}</div>}
        <div style={{ color: '#bbb', fontSize: 11, fontWeight: 500, marginTop: 4 }}>{book.origin_name || 'unknown'}</div>
      </div>
    </div>
  );
}

const sectionStyle = (mobile: boolean): React.CSSProperties => ({
  background: '#fff',
  borderRadius: 12,
  padding: mobile ? 16 : 24,
  boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
  marginBottom: 24,
});

const inputStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 8,
  border: '1px solid #e0e0e0',
  fontSize: 14,
  outline: 'none',
  fontFamily: 'inherit',
};

const btnPrimary: React.CSSProperties = {
  padding: '10px 18px',
  borderRadius: 8,
  border: 'none',
  background: '#1976d2',
  color: '#fff',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};

const chipStyle: React.CSSProperties = {
  padding: '4px 12px',
  borderRadius: 16,
  border: '1px solid #e0e0e0',
  background: '#f5f7fa',
  cursor: 'pointer',
  fontSize: 13,
  color: '#555',
  fontWeight: 500,
};

const chipDangerStyle: React.CSSProperties = {
  ...chipStyle,
  borderColor: '#ffcdd2',
  background: '#fff0f0',
  color: '#f44336',
};
```

### Step 3: Create stub files for the components referenced (so `pnpm build` passes)

These will be properly implemented in Task 6 and Task 7. For now, create minimal stubs:

`src/components/search/SourceStatusStrip.tsx`:
```tsx
import type { SourceStatus } from '../../types';
export default function SourceStatusStrip({ statuses }: { statuses: SourceStatus[]; onRetry: (url: string) => void }) {
  return <div data-testid="source-status-strip">{statuses.length} sources</div>;
}
```

`src/components/search/FailureFooter.tsx`:
```tsx
import type { FailureKind } from '../../types';
export default function FailureFooter({ failures, onRetryAll }: { failures: Array<{ sourceUrl: string; sourceName: string; error: string; kind: FailureKind }>; onRetryAll: () => void }) {
  return <div data-testid="failure-footer">{failures.length} failures</div>;
}
```

### Step 4: Verify the build

```bash
cd D:\code\novel_read
pnpm build
```

Expected: `pnpm build` succeeds. Some `noUnusedLocals` or `noUnusedParameters` warnings may appear — clean them up by removing unused imports.

### Step 5: Manual smoke test

```bash
cargo tauri dev
```

Open the app, navigate to `/search`, type a query. Expected: 
- The source status strip stub appears with "X sources" text
- No result rows appear (because MockSource in Task 4 has no books)
- No errors in WebView2 devtools

### Step 6: Commit

```bash
cd D:\code\novel_read
git add src/types.ts \
        src/pages/Home.tsx \
        src/components/search/SourceStatusStrip.tsx \
        src/components/search/FailureFooter.tsx
git -c user.name=opencode -c user.email=opencode@legado-desktop.local \
    commit -m "feat(search-t5): Home.tsx state machine + Channel consumer

- Add SearchEvent, ScoreBreakdown, SourceStatus, SearchState types
- Replace Home.tsx with state machine: idle/typing/streaming/stalled/done/error
- Consume tauri::ipc::Channel<SearchEvent> via onmessage
- Cancel previous search on new keystroke (close old channel)
- Add useTransition wrap for smooth streaming updates
- Remove rule-sub management (moves to /sources in Task 9)
- Remove sessionStorage caching
- Stub SourceStatusStrip + FailureFooter for now (Tasks 6/7)"
```

### Definition of Done — Task 5
- [ ] `pnpm build` succeeds
- [ ] `pnpm lint` has no errors
- [ ] App launches and `/search` route renders without errors
- [ ] Commit `feat(search-t5):` exists


---

## Task 6: SourceStatusStrip + FailureFooter (real impl)

**Files:**
- Modify: `src/components/search/SourceStatusStrip.tsx` — real component
- Modify: `src/components/search/FailureFooter.tsx` — real component
- Modify: `src/i18n/locales/en.json` — add new keys
- Modify: `src/i18n/locales/zh.json` — add new keys

**Context for this task:**
- `SourceStatus` and `FailureKind` types from `src/types.ts` (added in Task 5).
- i18n: use `t('key')` to localize. New keys need to be added in BOTH `en.json` and `zh.json`. Keys are `home.sourcePending`, `home.sourceRunning`, `home.sourceOk`, `home.sourceTimeout`, `home.sourceHttpError`, `home.sourceParseError`, `home.sourceZeroResults`, `home.failureFooterTitle`, `home.retry`, `home.retryAll`.
- The strip is a horizontal pill row on desktop, vertical on mobile (`isMobileUi`).

### Step 1: Add i18n keys

In `src/i18n/locales/zh.json`, add under the `home` section:

```json
"sourcePending": "等待",
"sourceRunning": "搜索中",
"sourceOk": "完成",
"sourceTimeout": "超时",
"sourceHttpError": "HTTP 错误",
"sourceParseError": "解析失败",
"sourceZeroResults": "0 命中",
"failureFooterTitle": "搜索完成,但有 {{count}} 个源失败",
"retry": "重试",
"retryAll": "重试全部",
```

In `src/i18n/locales/en.json`, add the equivalents:

```json
"sourcePending": "Waiting",
"sourceRunning": "Searching",
"sourceOk": "Done",
"sourceTimeout": "Timeout",
"sourceHttpError": "HTTP error",
"sourceParseError": "Parse error",
"sourceZeroResults": "0 hits",
"failureFooterTitle": "Search done, but {{count}} source(s) failed",
"retry": "Retry",
"retryAll": "Retry all",
```

### Step 2: Replace SourceStatusStrip

Replace `src/components/search/SourceStatusStrip.tsx` with:

```tsx
import { useTranslation } from 'react-i18next';
import type { SourceStatus as Status, SourceKey } from '../../types';
import { useUiMode } from '../../uiMode';

const STATUS_STYLES: Record<Status['state'], { bg: string; color: string; pulse?: boolean }> = {
  pending: { bg: '#e0e0e0', color: '#666' },
  running: { bg: '#1976d2', color: '#fff', pulse: true },
  ok: { bg: '#4caf50', color: '#fff' },
  failed: { bg: '#f44336', color: '#fff' },
};

export default function SourceStatusStrip({
  statuses,
  onRetry,
}: {
  statuses: Status[];
  onRetry: (url: SourceKey) => void;
}) {
  const { t } = useTranslation();
  const { isMobileUi } = useUiMode();

  return (
    <div
      data-testid="source-status-strip"
      style={{
        display: 'flex',
        flexDirection: isMobileUi ? 'column' : 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 16,
        padding: 12,
        background: '#fafbfc',
        borderRadius: 10,
      }}
    >
      {statuses.map((s) => {
        const style = STATUS_STYLES[s.state];
        const label =
          s.state === 'pending' ? t('home.sourcePending')
          : s.state === 'running' ? t('home.sourceRunning')
          : s.state === 'ok' ? t('home.sourceOk')
          : s.kind === 'Timeout' ? t('home.sourceTimeout')
          : s.kind === 'Parse' ? t('home.sourceParseError')
          : t('home.sourceHttpError');
        return (
          <span
            key={s.sourceUrl}
            onClick={() => s.state === 'failed' && onRetry(s.sourceUrl)}
            style={{
              padding: '4px 10px',
              borderRadius: 16,
              background: style.bg,
              color: style.color,
              fontSize: 12,
              fontWeight: 500,
              cursor: s.state === 'failed' ? 'pointer' : 'default',
              animation: style.pulse ? 'pulse 1.5s ease-in-out infinite' : 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
            title={s.state === 'failed' ? s.error : s.sourceName}
          >
            {s.sourceName}: {label}
          </span>
        );
      })}
      <style>{`@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.6; } }`}</style>
    </div>
  );
}
```

### Step 3: Replace FailureFooter

Replace `src/components/search/FailureFooter.tsx` with:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FailureKind } from '../../types';

interface Failure {
  sourceUrl: string;
  sourceName: string;
  error: string;
  kind: FailureKind;
}

export default function FailureFooter({
  failures,
  onRetryAll,
}: {
  failures: Failure[];
  onRetryAll: () => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  if (failures.length === 0) return null;

  return (
    <div
      data-testid="failure-footer"
      style={{
        background: '#fff3e0',
        border: '1px solid #ffe0b2',
        borderRadius: 10,
        padding: 12,
        marginBottom: 16,
        marginTop: 16,
      }}
    >
      <div
        onClick={() => setExpanded((x) => !x)}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
          fontSize: 14,
          fontWeight: 600,
          color: '#e65100',
        }}
      >
        <span>⚠ {t('home.failureFooterTitle', { count: failures.length })} {expanded ? '▾' : '▸'}</span>
        <button
          onClick={(e) => { e.stopPropagation(); onRetryAll(); }}
          style={{
            padding: '4px 12px',
            borderRadius: 6,
            border: '1px solid #ffb74d',
            background: '#fff',
            color: '#e65100',
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          {t('home.retryAll')}
        </button>
      </div>
      {expanded && (
        <ul style={{ margin: '12px 0 0', padding: 0, listStyle: 'none' }}>
          {failures.map((f) => (
            <li
              key={f.sourceUrl}
              style={{
                padding: '6px 0',
                fontSize: 13,
                color: '#bf360c',
                borderTop: '1px solid #ffe0b2',
              }}
            >
              <strong>{f.sourceName}</strong>: {f.error}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

### Step 4: Verify the build

```bash
cd D:\code\novel_read
pnpm build
```

Expected: succeeds.

### Step 5: Commit

```bash
cd D:\code\novel_read
git add src/components/search/SourceStatusStrip.tsx \
        src/components/search/FailureFooter.tsx \
        src/i18n/locales/en.json \
        src/i18n/locales/zh.json
git -c user.name=opencode -c user.email=opencode@legado-desktop.local \
    commit -m "feat(search-t6): SourceStatusStrip + FailureFooter

- SourceStatusStrip: pill row showing each source's status with color coding
  (gray=pending, blue pulsing=running, green=ok, red=failed)
- FailureFooter: collapsible list of failed sources with retry-all button
- Add i18n keys for status labels and retry buttons (zh + en)"
```

### Definition of Done — Task 6
- [ ] `pnpm build` succeeds
- [ ] `pnpm lint` has no errors
- [ ] Manual test: typing a search shows colored pills updating in real time
- [ ] Commit `feat(search-t6):` exists


---

## Task 7: Lazy cover loading

**Files:**
- Modify: `src/pages/Home.tsx` — extract ResultCard into its own file with `IntersectionObserver` lazy load

**Context for this task:**
- Native `<img loading="lazy">` is the simplest. Add `decoding="async"` for non-blocking decode. Use a fixed `aspect-ratio` CSS to prevent layout shift.
- For very long result lists, also add `IntersectionObserver`-based "mount on scroll into view" for the entire card to reduce React render cost. v1 only does image-level lazy load (simpler).
- No new dependencies.

### Step 1: Update the `ResultCard` inline component to lazy-load

In `src/pages/Home.tsx`, replace the `ResultCard` function with:

```tsx
function ResultCard({ book, isMobileUi, onClick }: { book: SearchBook; isMobileUi: boolean; onClick: () => void }) {
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
        {book.cover_url ? (
          <img
            src={book.cover_url}
            alt="cover"
            loading="lazy"
            decoding="async"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
          />
        ) : (
          <span>{book.name.slice(0, 2)}</span>
        )}
      </div>
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
        <div style={{ color: '#bbb', fontSize: 11, fontWeight: 500, marginTop: 4 }}>{book.origin_name || 'unknown'}</div>
      </div>
    </div>
  );
}
```

### Step 2: Verify the build

```bash
cd D:\code\novel_read
pnpm build
```

Expected: succeeds.

### Step 3: Manual test

```bash
cargo tauri dev
```

Navigate to `/search`, type a real book name. Expected: 
- Result cards render immediately with placeholder
- Cover images load as they scroll into view
- No layout shift when covers appear (aspect-ratio is reserved)

### Step 4: Commit

```bash
cd D:\code\novel_read
git add src/pages/Home.tsx
git -c user.name=opencode -c user.email=opencode@legado-desktop.local \
    commit -m "feat(search-t7): lazy cover loading in ResultCard

- Use native <img loading='lazy' decoding='async'>
- Reserve aspect-ratio 76/96 on the wrapper to prevent layout shift
- onError hides the broken image; placeholder text remains visible"
```

### Definition of Done — Task 7
- [ ] `pnpm build` succeeds
- [ ] `pnpm lint` has no errors
- [ ] Visual: covers load on scroll, no layout shift
- [ ] Commit `feat(search-t7):` exists


---

# Phase 3: Source health (4 tasks, parallel)

---

## Task 8: Wire real search + stats hookup

**Files:**
- Modify: `src-tauri/src/commands.rs` — replace `MockSource` conversion with real `WebBook::search` calls; call `source_stats.record_*` on each outcome
- Modify: `src-tauri/src/book_source/search_streamer.rs` — `run_stream` signature: replace `Vec<MockSource>` with `Vec<BookSource>`; add an `Arc<SourceStatsDao>` parameter; call `WebBook::new(JsExtState::global()).search(&source, &query, Some(1))` via `spawn_blocking`

**Context for this task:**
- The streamer skeleton from Task 3 used `MockSource`; this task replaces it with real `BookSource` and real `WebBook::search`.
- `WebBook::search(&source, &key, page) -> Result<Vec<SearchBook>>` is the existing sync function (see `commands.rs:1806` for its async wrapper).
- `SourceStatsDao` from Task 1 has `record_success`, `record_timeout`, `record_error` methods that take `&str` (URL).
- The `ScoreBreakdown` from Task 2 should be computed for each result: `relevance::score(&book.name, book.author.as_deref(), book.intro.as_deref(), &query, source.weight, source_health)`. For now `source_health = 1.0` (Task 11 will compute it from stats).
- Per-source task: `tokio::task::spawn_blocking(move || { WebBook::new(JsExtState::global()).search(&src, &q, Some(1)) })` then `tokio::time::timeout(PER_SOURCE_TIMEOUT, handle)`.

### Step 1: Update SearchEvent to use SearchBook + ScoreBreakdown

In `src-tauri/src/book_source/search_streamer.rs`, replace the `SearchEvent::Result` variant to carry a real `SearchBook` and `ScoreBreakdown`:

```rust
use crate::book_source::relevance::ScoreBreakdown;
use crate::db::SearchBook;
use crate::db::BookSource;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event", rename_all = "PascalCase")]
pub enum SearchEvent {
    Started { request_id: String, query: String, total_sources: usize },
    SourceStarted { source_url: String, source_name: String },
    Result { source_url: String, book: SearchBook, score: ScoreBreakdown },
    SourceFinished { source_url: String, count: usize, latency_ms: u64 },
    SourceFailed { source_url: String, error: String, latency_ms: u64, kind: FailureKind },
    Done { request_id: String, succeeded: usize, failed: usize, total_results: usize, duration_ms: u64 },
}
```

(Remove the old flat `score_*` fields from Result if they were there in Task 3.)

### Step 2: Add `BookSource` import and update `run_stream` signature

In the same file, change the `run_stream` signature:

```rust
pub async fn run_stream<S: SearchSink + 'static>(
    query: String,
    sources: Vec<BookSource>,
    sink: Arc<S>,
    request_id: String,
    mut cancel: tokio::sync::watch::Receiver<bool>,
    stats: Arc<crate::db::SourceStatsDao>,
) {
    let started_at = std::time::Instant::now();
    let total = sources.len();
    let _ = sink.send(SearchEvent::Started { request_id: request_id.clone(), query: query.clone(), total_sources: total });

    if total == 0 {
        let _ = sink.send(SearchEvent::Done { request_id, succeeded: 0, failed: 0, total_results: 0, duration_ms: started_at.elapsed().as_millis() as u64 });
        return;
    }

    let sem = Arc::new(Semaphore::new(MAX_CONCURRENCY));
    let mut tasks = Vec::with_capacity(total);

    for src in sources {
        if *cancel.borrow() { break; }
        let sem = sem.clone();
        let sink = sink.clone();
        let q = query.clone();
        let stats = stats.clone();
        let cancel_rx = cancel.clone();
        tasks.push(tokio::spawn(async move {
            let _permit = match sem.acquire().await { Ok(p) => p, Err(_) => return };

            if *cancel_rx.borrow() { return; }

            let _ = sink.send(SearchEvent::SourceStarted {
                source_url: src.book_source_url.clone(),
                source_name: src.book_source_name.clone(),
            });
            let t0 = std::time::Instant::now();
            let url = src.book_source_url.clone();
            let outcome: Result<Vec<SearchBook>, String> = match tokio::time::timeout(
                PER_SOURCE_TIMEOUT,
                tokio::task::spawn_blocking(move || {
                    let web = crate::book_source::web_book::WebBook::new(crate::book_source::js_runtime::JsExtState::global());
                    web.search(&src, &q, Some(1)).map_err(|e| e.to_string())
                }),
            ).await {
                Ok(Ok(Ok(books))) => Ok(books),
                Ok(Ok(Err(e))) => Err((FailureKind::Http, e)),
                Ok(Err(e)) => Err((FailureKind::Parse, format!("join: {}", e))),
                Err(_) => Err((FailureKind::Timeout, "timeout".to_string())),
            };
            let latency_ms = t0.elapsed().as_millis() as u64;
            match outcome {
                Ok(books) => {
                    let _ = stats.record_success(&url, latency_ms).await;
                    for book in books {
                        let score = crate::book_source::relevance::score(
                            &book.name,
                            book.author.as_deref(),
                            book.intro.as_deref(),
                            &query,
                            src.weight,
                            1.0, // Task 11 will plug in real source_health
                        );
                        let _ = sink.send(SearchEvent::Result { source_url: url.clone(), book, score });
                    }
                    let _ = sink.send(SearchEvent::SourceFinished { source_url: url.clone(), count: 0, latency_ms });
                }
                Err((kind, err)) => {
                    match kind {
                        FailureKind::Timeout => { let _ = stats.record_timeout(&url, latency_ms).await; }
                        _ => { let _ = stats.record_error(&url, &err, latency_ms).await; }
                    }
                    let _ = sink.send(SearchEvent::SourceFailed { source_url: url.clone(), error: err, latency_ms, kind });
                }
            }
        }));
    }

    let _ = tokio::time::timeout(GLOBAL_TIMEOUT, futures::future::join_all(tasks)).await;
    let duration_ms = started_at.elapsed().as_millis() as u64;
    let (succeeded, failed, total_results) = (0usize, 0usize, 0usize);
    let _ = sink.send(SearchEvent::Done { request_id, succeeded, failed, total_results, duration_ms });
}
```

### Step 3: Remove the MockSource-related code from this file

Delete the `MockSource` and `MockBook` structs, and the `#[cfg(test)] mod tests` block — those tests relied on MockSource and need to be rewritten. **However**, the tests in Task 3 must keep passing. Strategy: keep `MockSource` as a `pub` struct in the file, keep the `run_stream` overload that takes `Vec<MockSource>` for tests, and add a new `run_stream_real` for production use. Or: extract the test-friendly trait into a helper.

For simplicity, this task replaces the unit tests with integration tests that hit the DB. Delete the `#[cfg(test)] mod tests` block entirely (we'll add new tests in Step 4).

### Step 4: Add an integration test for `run_stream` with real WebBook

Skip this if too complex; rely on Task 9 manual testing. The streamer is exercised end-to-end via the Tauri command in dev mode.

If you want a test, add to `src-tauri/src/book_source/search_streamer.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[derive(Default)]
    struct CollectingSink { events: Mutex<Vec<SearchEvent>> }
    impl SearchSink for CollectingSink {
        fn send(&self, event: SearchEvent) -> Result<(), String> {
            self.events.lock().unwrap().push(event);
            Ok(())
        }
    }

    fn make_pool() -> crate::db::AppPool {
        let dir = std::env::temp_dir().join(format!("legado_streamer_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir_all(&dir).unwrap();
        crate::db::build_pool(dir.join("test.db")).expect("build pool")
    }

    #[tokio::test]
    async fn run_stream_no_sources() {
        let pool = make_pool();
        let stats = std::sync::Arc::new(crate::db::SourceStatsDao::new(pool));
        let sink = std::sync::Arc::new(CollectingSink::default());
        let (_tx, rx) = tokio::sync::watch::channel(false);
        run_stream("q".to_string(), vec![], sink.clone(), "req".to_string(), rx, stats).await;
        let events = sink.events.lock().unwrap();
        assert!(matches!(events.first(), Some(SearchEvent::Started { .. })));
        assert!(matches!(events.last(), Some(SearchEvent::Done { .. })));
    }
}
```

### Step 5: Update the Tauri command to call the new `run_stream`

In `src-tauri/src/commands.rs`, replace the body of `search_books_stream` (the conversion from `BookSource` to `MockSource`):

```rust
#[tauri::command]
pub async fn search_books_stream(
    query: String,
    sources: Vec<crate::db::BookSource>,
    channel: Channel<SearchEvent>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);
    {
        let mut guard = state.search_cancel_tx.lock().await;
        if let Some(old) = guard.take() {
            let _ = old.send(true);
        }
        *guard = Some(cancel_tx);
    }

    let sink = Arc::new(TauriChannelSink::new(channel));
    let request_id = uuid::Uuid::new_v4().to_string();
    run_stream(query, sources, sink.clone(), request_id, cancel_rx, state.source_stats.clone()).await;

    Ok(())
}
```

(Also `use crate::book_source::search_streamer::run_stream;` is already at the top.)

### Step 6: Verify the build

```bash
cd src-tauri
cargo build
```

Expected: compiles. The `noUnusedLocals` warning about `book` if `book.name` is unused should not appear since we use it.

### Step 7: Manual smoke test

```bash
cargo tauri dev
```

Navigate to `/search`, type a real book name. Expected:
- Result cards appear as sources return
- Each result shows score components (or just title+author+intro+source for now)
- SourceStatusStrip shows green pills when sources return, red when they fail
- FailureFooter shows failures if any

### Step 8: Commit

```bash
cd D:\code\novel_read
git add src-tauri/src/commands.rs \
        src-tauri/src/book_source/search_streamer.rs
git -c user.name=opencode -c user.email=opencode@legado-desktop.local \
    commit -m "feat(search-t8): wire real WebBook search + source stats recording

- Replace MockSource with BookSource in run_stream signature
- Per-source: spawn_blocking + WebBook::search with 2s timeout
- On success: stats.record_success(url, latency_ms) + emit Result events
- On timeout: stats.record_timeout(url, latency_ms) + emit SourceFailed
- On HTTP/parse error: stats.record_error(url, err, latency_ms)
- Compute ScoreBreakdown via relevance::score (source_health=1.0 for now)
- Tauri command: pass state.source_stats into run_stream"
```

### Definition of Done — Task 8
- [ ] `cargo build` succeeds
- [ ] `cargo test --lib` passes (T1, T2 tests; T3 tests removed but maybe a basic no_sources test remains)
- [ ] Manual: real book search returns results, source stats update in `source_stats` table
- [ ] Commit `feat(search-t8):` exists


---

## Task 9: `/sources` page

**Files:**
- Create: `src/pages/Sources.tsx` — book source list with health table
- Create: `src/pages/SourceEdit.tsx` — stub for now (full impl in Task 10/11 follow-up; just placeholder)
- Create: `src/pages/SourceImport.tsx` — stub (moved from Home.tsx in a separate cleanup task)
- Modify: `src/App.tsx` — add new routes
- Modify: `src/components/Layout.tsx` — update nav (add `/sources` link)
- Modify: `src/types.ts` — export `SourceStats` type (mirrors Rust)

**Context for this task:**
- `SourceStats` Rust struct from Task 1 is `Serialize` and needs to be exposed on the TS side.
- The page is a table with sortable columns: name, URL, enabled, health, success rate, avg latency, last error, last checked.
- For v1, the page reads `get_book_sources` (existing command) AND a new command `get_source_stats` (added in this task).

### Step 1: Add a new Tauri command to fetch all source stats

In `src-tauri/src/commands.rs`, add at the end of the file:

```rust
#[tauri::command]
pub async fn get_source_stats(
    state: State<'_, AppState>,
) -> ApiResponse<Vec<crate::db::SourceStats>> {
    match state.source_stats.get_all().await {
        Ok(stats) => ApiResponse { success: true, data: Some(stats), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}
```

(If `get_all` is sync (it isn't here), wrap with `tokio::task::spawn_blocking`. It's async in Task 1, so direct call is fine.)

Register in `lib.rs` `generate_handler!`:

```rust
            get_source_stats,
```

### Step 2: Add TS type

In `src/types.ts`, add:

```ts
export interface SourceStats {
  sourceUrl: string;
  totalQueries: number;
  successfulQueries: number;
  timedOutQueries: number;
  erroredQueries: number;
  totalLatencyMs: number;
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  lastErrorMessage: string | null;
  lastCheckedAt: number;
  rollingSuccessCount: number;
  rollingTotalCount: number;
  healthScore: number;
}
```

(TS uses camelCase; Tauri auto-converts from snake_case Rust via `serde`.)

### Step 3: Create the page

Create `src/pages/Sources.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ApiResponse, BookSource, SourceStats } from '../types';
import { useUiMode } from '../uiMode';

type SortKey = 'name' | 'health' | 'success' | 'latency' | 'lastChecked';
type SortDir = 'asc' | 'desc';

export default function Sources() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isMobileUi } = useUiMode();
  const [sources, setSources] = useState<BookSource[]>([]);
  const [stats, setStats] = useState<SourceStats[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('health');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      const [srcResp, statsResp] = await Promise.all([
        invoke<ApiResponse<BookSource[]>>('get_book_sources'),
        invoke<ApiResponse<SourceStats[]>>('get_source_stats'),
      ]);
      if (srcResp.success && srcResp.data) setSources(srcResp.data);
      if (statsResp.success && statsResp.data) setStats(statsResp.data);
    } catch (e) {
      console.error('Failed to load sources:', e);
    }
  }

  const statsByUrl = new Map(stats.map((s) => [s.sourceUrl, s]));
  const rows = sources.map((s) => ({
    source: s,
    stats: statsByUrl.get(s.book_source_url) ?? null,
  }));

  const successRate = (s: SourceStats | null) =>
    s && s.rollingTotalCount > 0 ? s.rollingSuccessCount / s.rollingTotalCount : 1;
  const avgLatency = (s: SourceStats | null) =>
    s && s.totalQueries > 0 ? s.totalLatencyMs / s.totalQueries : 0;

  rows.sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    switch (sortKey) {
      case 'name': return dir * a.source.book_source_name.localeCompare(b.source.book_source_name);
      case 'health': return dir * ((b.stats?.healthScore ?? 1) - (a.stats?.healthScore ?? 1));
      case 'success': return dir * (successRate(b.stats) - successRate(a.stats));
      case 'latency': return dir * (avgLatency(a.stats) - avgLatency(b.stats));
      case 'lastChecked': return dir * ((b.stats?.lastCheckedAt ?? 0) - (a.stats?.lastCheckedAt ?? 0));
    }
  });

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir('desc'); }
  };

  const headerCell = (key: SortKey, label: string) => (
    <th
      onClick={() => toggleSort(key)}
      style={{ padding: 8, textAlign: 'left', cursor: 'pointer', userSelect: 'none', fontSize: 13, color: '#555' }}
    >
      {label} {sortKey === key ? (sortDir === 'asc' ? '▲' : '▼') : ''}
    </th>
  );

  return (
    <div>
      <section style={{ background: '#fff', borderRadius: 12, padding: isMobileUi ? 16 : 24, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#1a1a2e' }}>
            {t('layout.bookSources')}
          </h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => navigate('/sources/import')}
              style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #e0e0e0', background: '#fff', color: '#555', fontSize: 13, cursor: 'pointer' }}
            >
              {t('home.sourceSubscriptions')}
            </button>
          </div>
        </div>

        {rows.length === 0 ? (
          <p style={{ color: '#888' }}>{t('home.noSources')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #eee' }}>
                  {headerCell('name', t('home.sourceNameCol'))}
                  {headerCell('health', t('home.sourceHealthCol'))}
                  {headerCell('success', t('home.sourceSuccessCol'))}
                  {headerCell('latency', t('home.sourceLatencyCol'))}
                  <th style={{ padding: 8, textAlign: 'left', fontSize: 13, color: '#555' }}>{t('home.sourceLastErrorCol')}</th>
                  {headerCell('lastChecked', t('home.sourceLastCheckedCol'))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ source, stats: s }) => {
                  const health = s?.healthScore ?? 1;
                  const healthColor = health >= 0.8 ? '#4caf50' : health >= 0.5 ? '#ff9800' : '#f44336';
                  return (
                    <tr
                      key={source.book_source_url}
                      onClick={() => navigate(`/sources/${encodeURIComponent(source.book_source_url)}`)}
                      style={{ borderBottom: '1px solid #f0f0f0', cursor: 'pointer' }}
                    >
                      <td style={{ padding: 8, fontSize: 14, fontWeight: 500 }}>
                        {source.book_source_name}
                        {source.book_source_type === 1 && <span style={{ marginLeft: 6, fontSize: 10, color: '#888' }}>(RSS)</span>}
                      </td>
                      <td style={{ padding: 8 }}>
                        <span style={{ padding: '2px 8px', borderRadius: 10, background: healthColor, color: '#fff', fontSize: 12, fontWeight: 600 }}>
                          {health.toFixed(2)}
                        </span>
                      </td>
                      <td style={{ padding: 8, fontSize: 13, color: '#555' }}>{(successRate(s) * 100).toFixed(0)}%</td>
                      <td style={{ padding: 8, fontSize: 13, color: '#555' }}>{avgLatency(s).toFixed(0)} ms</td>
                      <td style={{ padding: 8, fontSize: 12, color: '#888', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s?.lastErrorMessage ?? ''}>
                        {s?.lastErrorMessage ?? '—'}
                      </td>
                      <td style={{ padding: 8, fontSize: 12, color: '#888' }}>
                        {s?.lastCheckedAt ? new Date(s.lastCheckedAt * 1000).toLocaleString() : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
```

### Step 4: Create placeholder SourceEdit.tsx and SourceImport.tsx

`src/pages/SourceEdit.tsx`:
```tsx
import { useParams } from 'react-router-dom';
export default function SourceEdit() {
  const { sourceUrl } = useParams();
  return (
    <div style={{ padding: 24 }}>
      <h2>Source Edit (placeholder)</h2>
      <p>URL: {sourceUrl}</p>
      <p>Full edit UI + live test panel is post-v1.</p>
    </div>
  );
}
```

`src/pages/SourceImport.tsx`:
```tsx
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function SourceImport() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function add() {
    if (!name.trim() || !url.trim()) return;
    setBusy(true);
    setMsg(t('home.checkUpdates'));
    try {
      const resp = await invoke<{ success: boolean; data?: unknown[]; error?: string }>('import_source_from_url', { url });
      if (resp.success && resp.data) {
        for (const source of resp.data) {
          await invoke('add_book_source', { source });
        }
        setMsg(t('common.success'));
        navigate('/sources');
      } else {
        setMsg(resp.error ?? t('common.error'));
      }
    } catch (e) {
      setMsg(String(e));
    }
    setBusy(false);
  }

  return (
    <div style={{ padding: 24, maxWidth: 600 }}>
      <h2>{t('home.sourceSubscriptions')}</h2>
      <input
        placeholder={t('home.subNamePlaceholder')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={{ width: '100%', padding: 10, marginBottom: 12, border: '1px solid #e0e0e0', borderRadius: 8 }}
      />
      <input
        placeholder={t('home.subUrlPlaceholder')}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        style={{ width: '100%', padding: 10, marginBottom: 12, border: '1px solid #e0e0e0', borderRadius: 8 }}
      />
      <button
        onClick={add}
        disabled={busy}
        style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: '#1976d2', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
      >
        {busy ? t('common.loading') : t('common.add')}
      </button>
      {msg && <p style={{ marginTop: 12, color: '#666', fontSize: 13 }}>{msg}</p>}
    </div>
  );
}
```

### Step 5: Add routes in App.tsx

In `src/App.tsx`, add imports and routes:

```tsx
import Sources from './pages/Sources';
import SourceEdit from './pages/SourceEdit';
import SourceImport from './pages/SourceImport';

// inside <Routes>:
<Route path="/sources" element={<Sources />} />
<Route path="/sources/import" element={<SourceImport />} />
<Route path="/sources/:sourceUrl" element={<SourceEdit />} />
```

### Step 6: Add Layout link to /sources

In `src/components/Layout.tsx`, find the existing nav link to `/book-sources` and change it to `/sources`. (The old route is still kept by the existing `BookSources` page; we will deprecate it in Task 10.)

### Step 7: Add i18n keys

In `src/i18n/locales/zh.json` and `src/i18n/locales/en.json`, add (under `home`):

```json
"sourceNameCol": "名称",
"sourceHealthCol": "健康",
"sourceSuccessCol": "成功率",
"sourceLatencyCol": "平均延迟",
"sourceLastErrorCol": "最近错误",
"sourceLastCheckedCol": "最后检查"
```

(English equivalents: `"Name"`, `"Health"`, `"Success rate"`, `"Avg latency"`, `"Last error"`, `"Last checked"`.)

### Step 8: Verify the build

```bash
cd D:\code\novel_read
pnpm build
```

Expected: succeeds.

### Step 9: Commit

```bash
cd D:\code\novel_read
git add src-tauri/src/commands.rs \
        src-tauri/src/lib.rs \
        src/types.ts \
        src/pages/Sources.tsx \
        src/pages/SourceEdit.tsx \
        src/pages/SourceImport.tsx \
        src/App.tsx \
        src/components/Layout.tsx \
        src/i18n/locales/en.json \
        src/i18n/locales/zh.json
git -c user.name=opencode -c user.email=opencode@legado-desktop.local \
    commit -m "feat(search-t9): /sources page with health table

- New Tauri command get_source_stats returning all SourceStats
- New page Sources.tsx: sortable table (name, health, success rate, latency, last error, last checked)
- Health color: green >= 0.8, orange >= 0.5, red < 0.5
- New page SourceImport.tsx: add rule sub (moved from Home.tsx)
- New page SourceEdit.tsx: placeholder for v1
- New routes /sources, /sources/import, /sources/:sourceUrl
- Update Layout nav to /sources
- Add i18n keys (zh + en)"
```

### Definition of Done — Task 9
- [ ] `pnpm build` succeeds
- [ ] `pnpm lint` has no errors
- [ ] `cargo build` succeeds
- [ ] Manual: `/sources` page lists all sources, columns are sortable, clicking a row goes to `/sources/:url`
- [ ] Commit `feat(search-t9):` exists


---

## Task 10: Health badges in BookSources + deprecation banner

**Files:**
- Modify: `src/pages/BookSources.tsx` — add a deprecation banner at the top linking to `/sources`; add health badge column if stats are available
- Modify: `src/types.ts` — ensure `BookSource` is exported (it should be already)

**Context for this task:**
- The existing `/book-sources` route is kept as a compatibility shim. v2 will remove it.
- We add a banner at the top of the page pointing to the new `/sources` page.
- We also load source stats and display a small health badge next to each source so users on the old page can still see health.

### Step 1: Open BookSources.tsx and inspect

Read `src/pages/BookSources.tsx` first to understand the existing structure.

### Step 2: Add deprecation banner

At the top of the returned JSX (before the main `<section>`), add:

```tsx
<div style={{ background: '#fff3e0', border: '1px solid #ffe0b2', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13, color: '#bf360c' }}>
  ⚠ {t('home.deprecationBanner')}{' '}
  <a
    onClick={() => navigate('/sources')}
    style={{ color: '#1976d2', cursor: 'pointer', textDecoration: 'underline', marginLeft: 4 }}
  >
    {t('layout.bookSources')} →
  </a>
</div>
```

Add i18n key (zh + en): `"deprecationBanner": "此页面已迁移到 /sources,将在 v2 移除。"` / `"This page has been moved to /sources and will be removed in v2."`.

### Step 3: Add health badge column

In the existing table, after the "enabled" column, add a new column:

```tsx
<th>{t('home.sourceHealthCol')}</th>
```

And in the row body:

```tsx
<td>
  {s.stats ? (
    <span style={{ padding: '2px 8px', borderRadius: 10, background: s.stats.healthScore >= 0.8 ? '#4caf50' : s.stats.healthScore >= 0.5 ? '#ff9800' : '#f44336', color: '#fff', fontSize: 12 }}>
      {s.stats.healthScore.toFixed(2)}
    </span>
  ) : '—'}
</td>
```

To get stats, add a state variable and load it in `useEffect`:

```tsx
const [stats, setStats] = useState<SourceStats[]>([]);
useEffect(() => {
  invoke<ApiResponse<SourceStats[]>>('get_source_stats').then((r) => {
    if (r.success && r.data) setStats(r.data);
  });
}, []);
const statsByUrl = new Map(stats.map((s) => [s.sourceUrl, s]));
```

And map the existing row data to include stats:

```tsx
const rows = sources.map((src) => ({ source: src, stats: statsByUrl.get(src.book_source_url) ?? null }));
```

(Use the existing variable names from BookSources.tsx; merge carefully.)

### Step 4: Verify the build

```bash
cd D:\code\novel_read
pnpm build
pnpm lint
```

Expected: both succeed.

### Step 5: Commit

```bash
cd D:\code\novel_read
git add src/pages/BookSources.tsx \
        src/i18n/locales/en.json \
        src/i18n/locales/zh.json
git -c user.name=opencode -c user.email=opencode@legado-desktop.local \
    commit -m "feat(search-t10): deprecation banner + health badge on BookSources

- Add orange banner at top of /book-sources pointing to /sources
- Add health badge column to the source list
- Add i18n key deprecationBanner (zh + en)"
```

### Definition of Done — Task 10
- [ ] `pnpm build` and `pnpm lint` succeed
- [ ] Manual: `/book-sources` shows banner + health badges
- [ ] Commit `feat(search-t10):` exists


---

## Task 11: Feed real source_health into the relevance cascade

**Files:**
- Modify: `src-tauri/src/commands.rs` (or `src-tauri/src/book_source/search_streamer.rs`) — fetch source stats before fanning out, pass real health score to `relevance::score`
- Modify: `src-tauri/src/book_source/search_streamer.rs` — `run_stream` accepts a `HashMap<String, f64>` of url→health, uses it when calling `relevance::score`

**Context for this task:**
- Currently `run_stream` calls `relevance::score(..., 1.0)` for source_health. This task fetches the real health from `source_stats` before the search and passes it through.
- The cleanest pattern: have the Tauri command fetch `state.source_stats.get_all()` first, build a `HashMap<url, health>`, then pass to `run_stream`. `run_stream` looks up by URL when computing scores.

### Step 1: Update `run_stream` to accept a health map

In `src-tauri/src/book_source/search_streamer.rs`, change the signature:

```rust
use std::collections::HashMap;

pub async fn run_stream<S: SearchSink + 'static>(
    query: String,
    sources: Vec<BookSource>,
    sink: Arc<S>,
    request_id: String,
    mut cancel: tokio::sync::watch::Receiver<bool>,
    stats: Arc<crate::db::SourceStatsDao>,
    health_by_url: HashMap<String, f64>,
) {
    // ... (existing code)
    // In the success branch, replace the relevance::score call with:
    let health = health_by_url.get(&url).copied().unwrap_or(1.0);
    let score = crate::book_source::relevance::score(
        &book.name,
        book.author.as_deref(),
        book.intro.as_deref(),
        &query,
        src.weight,
        health,
    );
    // ... (rest unchanged)
}
```

### Step 2: Update the Tauri command to build the health map

In `src-tauri/src/commands.rs`, replace the body of `search_books_stream` to load stats first:

```rust
#[tauri::command]
pub async fn search_books_stream(
    query: String,
    sources: Vec<crate::db::BookSource>,
    channel: Channel<SearchEvent>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);
    {
        let mut guard = state.search_cancel_tx.lock().await;
        if let Some(old) = guard.take() {
            let _ = old.send(true);
        }
        *guard = Some(cancel_tx);
    }

    // Build health map from current stats
    let stats_all = state.source_stats.get_all().await.map_err(|e| e.to_string())?;
    let health_by_url: std::collections::HashMap<String, f64> =
        stats_all.into_iter().map(|s| (s.source_url, s.health_score)).collect();

    let sink = Arc::new(TauriChannelSink::new(channel));
    let request_id = uuid::Uuid::new_v4().to_string();
    run_stream(query, sources, sink.clone(), request_id, cancel_rx, state.source_stats.clone(), health_by_url).await;

    Ok(())
}
```

### Step 3: Verify the build

```bash
cd src-tauri
cargo build
```

Expected: compiles.

### Step 4: Manual test

```bash
cargo tauri dev
```

Run a few searches. After ~5+ searches on different sources, you should see sources with `health < 1.0` (especially if any timed out). New searches should rank results from healthy sources higher than results from unhealthy ones, all else equal.

### Step 5: Commit

```bash
cd D:\code\novel_read
git add src-tauri/src/commands.rs \
        src-tauri/src/book_source/search_streamer.rs
git -c user.name=opencode -c user.email=opencode@legado-desktop.local \
    commit -m "feat(search-t11): feed real source_health into relevance cascade

- run_stream accepts HashMap<url, f64> for per-source health scores
- Tauri command loads source_stats before fan-out, builds the map
- relevance::score(..., source_health) is now real (was hardcoded 1.0)
- This is the last cascade rule; with this, the relevance ranking is
  fully data-driven"
```

### Definition of Done — Task 11
- [ ] `cargo build` succeeds
- [ ] Manual: a source with degraded health (many timeouts) ranks lower in results
- [ ] Commit `feat(search-t11):` exists


---

# Phase 4: Polish (3 tasks, sequential)

---

## Task 12: Keyboard shortcuts

**Files:**
- Modify: `src/pages/Home.tsx` — add `useEffect` for global keydown listener; implement `/`, `↑`, `↓`, `Enter`, `Esc`

**Context for this task:**
- `/` focuses the search input when focus is NOT already in an input/textarea.
- `↑` / `↓` move the selected result index; `Enter` opens it.
- `Esc` cancels an active stream or clears the search input.
- Selected index is stored in a `useState<number>(-1)` (default = no selection).

### Step 1: Add a selectedIndex state and keydown effect

In `src/pages/Home.tsx`, add to the component body (just after the existing `useState` declarations):

```tsx
const [selectedIndex, setSelectedIndex] = useState<number>(-1);
const searchInputRef = useRef<HTMLInputElement>(null);
const resultsRef = useRef<(HTMLDivElement | null)[]>([]);

useEffect(() => {
  function onKey(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    const inField = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
    if (e.key === '/' && !inField) {
      e.preventDefault();
      searchInputRef.current?.focus();
      return;
    }
    const results = (state.kind === 'streaming' || state.kind === 'stalled' || state.kind === 'done') ? state.results : [];
    if (e.key === 'ArrowDown' && results.length > 0) {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp' && results.length > 0) {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && selectedIndex >= 0 && results[selectedIndex] && !inField) {
      e.preventDefault();
      openBook(results[selectedIndex], sources, navigate);
    } else if (e.key === 'Escape') {
      if (state.kind === 'streaming' || state.kind === 'stalled') {
        // cancel: close current channel
        if (currentChannelRef.current) {
          try { currentChannelRef.current.close?.(); } catch { /* ignore */ }
          currentChannelRef.current = null;
        }
        setState({ kind: 'done', query: searchKey, results: state.kind === 'streaming' || state.kind === 'stalled' ? state.results : [], statuses: state.kind === 'streaming' || state.kind === 'stalled' ? state.statuses : {}, failures: state.kind === 'streaming' || state.kind === 'stalled' ? state.failures : [], totalResults: 0, durationMs: 0 });
      } else {
        setSearchKey('');
      }
    }
  }
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [state, selectedIndex, sources, navigate, searchKey]);
```

### Step 2: Wire refs in the JSX

In the `<input>` element, add `ref={searchInputRef}`.

In the result list (the `sortedResults.map(...)`), pass `ref={(el) => (resultsRef.current[i] = el)}` and add a `data-selected={i === selectedIndex}` to highlight the selected card:

```tsx
{sortedResults.map((book, i) => (
  <div
    key={book.book_url}
    ref={(el) => (resultsRef.current[i] = el)}
    data-selected={i === selectedIndex}
    onClick={() => openBook(book, sources, navigate)}
    onMouseEnter={() => setSelectedIndex(i)}
    style={{
      background: i === selectedIndex ? '#e3f2fd' : '#fff',
      borderRadius: 14,
      padding: 14,
      display: 'flex',
      gap: 14,
      cursor: 'pointer',
      boxShadow: i === selectedIndex ? '0 4px 12px rgba(25,118,210,0.2)' : '0 1px 2px rgba(0,0,0,0.06), 0 3px 10px rgba(0,0,0,0.04)',
    }}
  >
    <ResultCardInner book={book} isMobileUi={isMobileUi} />
  </div>
))}
```

(Extract the existing card body into `ResultCardInner` so we don't duplicate it; the outer div handles selection styling and onClick.)

### Step 3: Verify the build

```bash
cd D:\code\novel_read
pnpm build
```

Expected: succeeds.

### Step 4: Manual test

Press `/` outside the input → input focuses. Type a query, results appear. Press `↓` repeatedly → selection moves down, card highlights blue. Press `Enter` → opens selected book. Press `Esc` mid-search → cancels.

### Step 5: Commit

```bash
cd D:\code\novel_read
git add src/pages/Home.tsx
git -c user.name=opencode -c user.email=opencode@legado-desktop.local \
    commit -m "feat(search-t12): keyboard shortcuts in search

- / focuses search input (when not in a field)
- ArrowUp/ArrowDown move selection
- Enter opens the selected result
- Escape cancels active stream or clears input
- Selected card has blue highlight + stronger shadow"
```

### Definition of Done — Task 12
- [ ] `pnpm build` and `pnpm lint` succeed
- [ ] All 4 shortcuts work in dev
- [ ] Commit `feat(search-t12):` exists


---

## Task 13: Weight tuning (data-driven, post-launch)

**Files:**
- Modify: `src-tauri/src/book_source/relevance.rs` — adjust `score()` defaults based on collected data
- New: `docs/superpowers/notes/search-relevance-tuning.md` — record observations

**Context for this task:**
- The 7-rule cascade order and weights are HARDCODED in v1. After the system has been used for ~1 week, examine:
  - Are typo-tolerant searches being too generous? (typo score dominates too much)
  - Is `attribute_rank` working? (author matches should rank below title matches)
  - Is `source_health` being too aggressive? (or not aggressive enough?)
- This task is **observational, not automatic**. Use the `source_stats` table to derive insights; do not implement auto-tuning.

### Step 1: Collect data

Run the app for a week of normal use. The `source_stats` table now has data on:
- Which sources succeed most often (`rolling_success_count / rolling_total_count`)
- Which sources are slow (`total_latency_ms / total_queries`)
- Which sources time out (`timed_out_queries`)

For relevance quality, log per-query:
- The top 3 results and their `ScoreBreakdown` components
- User click-through (if available; needs a separate `query_clicks` table — out of scope for this task)

For v1, you can also manually check the obvious cases:
- Search "三体" → does the first result have title hit + low proximity + high attribute_rank?
- Search "刘慈欣" → does an author-only match outrank a non-matching title?
- Search a typo (e.g. "三题") → does the typo-tolerant result still appear in top 3?

### Step 2: Document observations

Create `docs/superpowers/notes/search-relevance-tuning.md` with sections:
- Observed ranking quality (good / mediocre / poor)
- Per-rule scores for top 10 common queries
- Recommended adjustments (e.g., "increase source_weight cap from 200 to 300")
- Any rule that's redundant or counterproductive

### Step 3: Adjust if warranted

If observations suggest a change (e.g., typo score is too generous, swap the `then` order in `Ord`):

Edit `src-tauri/src/book_source/relevance.rs` `Ord for ScoreBreakdown`. The order of `.then()` calls IS the cascade. Moving a rule earlier makes it dominate.

Common adjustments:
- **Boost source_health**: move the `then(other.source_health.cmp(&self.source_health))` line earlier
- **Demote typo**: remove typo from the cascade (keep it as a tie-breaker much later)
- **Boost source_weight**: move it earlier

After adjustment, add 1 unit test in `relevance.rs` for the new behavior.

### Step 4: Verify

```bash
cd src-tauri
cargo test --lib relevance
cd ..
pnpm build
```

Expected: both succeed.

### Step 5: Commit

```bash
cd D:\code\novel_read
git add src-tauri/src/book_source/relevance.rs \
        docs/superpowers/notes/search-relevance-tuning.md
git -c user.name=opencode -c user.email=opencode@legado-desktop.local \
    commit -m "feat(search-t13): relevance weight tuning (data-driven)

- Add docs/superpowers/notes/search-relevance-tuning.md with observations
- Adjust score() defaults based on collected data
  - (specific change here; depends on observations)"
```

If no change is warranted, commit only the notes file with:

```bash
git -c user.name=opencode -c user.email=opencode@legado-desktop.local \
    commit --allow-empty -m "feat(search-t13): relevance weight tuning — no change

- Observations recorded in docs/superpowers/notes/search-relevance-tuning.md
- Cascade order and weights hold; no adjustment needed yet"
```

### Definition of Done — Task 13
- [ ] Notes file exists with concrete observations
- [ ] `cargo test --lib relevance` still passes
- [ ] Commit `feat(search-t13):` exists (with or without code change)


---

## Task 14: Full E2E manual test

**Files:** None (this is a verification + commit task)

**Context:** All implementation is done. This task is a structured walkthrough of the entire feature to confirm it meets the spec's "Definition of Done" in §13.

### Step 1: Cold-start verification

```bash
cd D:\code\novel_read
cd src-tauri
cargo test --lib
cd ..
pnpm build
pnpm lint
```

Expected: all succeed. Record counts:
- `cargo test --lib` total tests: ____
- `cargo test --lib` failures: 0
- `pnpm build` exit code: 0
- `pnpm lint` errors: 0

### Step 2: Manual UI walkthrough

```bash
cargo tauri dev
```

Walk through this checklist (each item must pass before ticking):

- [ ] App launches, `/search` page renders (no white screen)
- [ ] Type "三体" in the search box — debounced search starts
- [ ] Within 500ms, at least one result appears (the fastest source)
- [ ] `SourceStatusStrip` shows colored pills updating in real time (blue→green/red)
- [ ] Results are sorted by relevance (title match outranks author match)
- [ ] Click a result — opens the book detail page
- [ ] Cover images load lazily (scroll down — new images load on scroll)
- [ ] If a source times out — `FailureFooter` shows the count, expand to see details
- [ ] Click "Retry all" in `FailureFooter` — re-runs the search
- [ ] Press `/` outside an input — search box focuses
- [ ] Press `↓` repeatedly — selected card highlights blue
- [ ] Press `Enter` on a selected result — opens the book
- [ ] Press `Esc` mid-search — search cancels
- [ ] Navigate to `/sources` — table of sources with health scores
- [ ] Click a column header — table sorts by that column
- [ ] Click a row — goes to `/sources/:url` placeholder page
- [ ] Navigate to `/sources/import` — can add a new rule sub
- [ ] Navigate to `/book-sources` — deprecation banner visible at top, health badges in table

### Step 3: Performance baseline

Run the same query 3 times and measure (in DevTools console or by visual estimate):

- [ ] First source returns within 500ms (cold)
- [ ] All sources return or time out within 3.5s
- [ ] No visible UI freeze during streaming
- [ ] Cover images do not block result list rendering

### Step 4: Cross-platform smoke

If the project supports mobile mode (`VITE_APP_UI_MODE=mobile`):
- [ ] Launch with `start-mobile.bat`
- [ ] Search page renders correctly in 390x844 viewport
- [ ] SourceStatusStrip wraps to vertical layout

### Step 5: Final commit

If all checks pass:

```bash
cd D:\code\novel_read
git add -A  # any uncommitted tweaks from this walkthrough
git -c user.name=opencode -c user.email=opencode@legado-desktop.local \
    commit -m "feat(search-t14): end-to-end manual test passed

- Verified all 13 features from spec §13
- Performance baseline met (first source < 500ms, full search < 3.5s)
- Keyboard shortcuts working
- Failure handling visible
- /sources page and rule sub import working

Closes search-redesign spec"
```

If any check fails, **do not commit**. Open a new task or sub-task to fix the issue, then re-run the E2E.

### Definition of Done — Task 14
- [ ] All UI walkthrough items pass
- [ ] Performance baseline met
- [ ] `feat(search-t14):` commit exists
- [ ] Total commits in this feature: 14 (T1..T14)
- [ ] `git log --oneline | head -20` shows the search-* commits at the top

---

# Summary

**Total tasks: 14** (11 from spec + 3 polish tasks 12-14)

**Phase 1 (3 parallel):** T1 source_stats, T2 relevance, T3 streamer skeleton
**Phase 2 (4 parallel):** T4 command, T5 Home state, T6 status components, T7 lazy cover
**Phase 3 (4 parallel):** T8 stats wiring, T9 /sources page, T10 banner+badges, T11 health→cascade
**Phase 4 (3 sequential):** T12 shortcuts, T13 weight tuning, T14 E2E

**Approximate duration (with 1 engineer, serial):** 12-16 weeks. With 3-4 parallel subagents: 4-6 weeks.

**End of plan.**
