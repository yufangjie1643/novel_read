# Spec: P1 — Connection Pool + AppState + Async IPC

> Status: ✅ approved (execution in progress)
> Phase: P1 of the [performance roadmap](../AGENTS.md)
> Supersedes: P0 (WAL, indices, shared HTTP, shared JsExtState)

## Objective

Replace the legado-desktop backend's "single Mutex + sync IPC" bottleneck with a
**concurrent connection pool + async IPC + Tauri State injection** model. After
P1, the database no longer serialises all reads behind one connection, and
frequent DB commands no longer block the Tauri runtime thread.

**No IPC protocol changes.** Frontend requires zero changes.

## Scope (in / out)

| In | Out (deferred) |
|---|---|
| Connection pool (deadpool-sqlite 0.13) | WebBook / AnalyzeUrl async reqwest |
| `AppState` injected via `tauri::State` | The 88 non-book/chapter/source commands |
| 26 book/chapter/source/fetch commands: sync → async + spawn_blocking | Removal of `ApiResponse<T>` shell |
| DAO constructors: `&Database` → `&Connection` | `JsExtState::global()` removal (WebBook still uses it) |
| WAL / indices / PRAGMAs from P0 preserved (regression tests still pass) | `http::*_client()` rework (P3) |

## Tech Stack

| Item | Before | After |
|---|---|---|
| `rusqlite` | `0.32` (bundled, chrono) | `0.38` (bundled, chrono) |
| Connection pool | `Mutex<Connection>` | `deadpool-sqlite 0.13` (max 8) |
| State injection | `OnceLock<Database>` + `db()` | `tauri::State<'_, AppState>` |
| Async commands | 20 of 26 book/chapter/source commands were sync | All 26 are `async fn` + `spawn_blocking` |

## Commands (verification)

```bash
cd src-tauri
cargo build                                    # build
cargo test --lib                               # 66 unit tests
cargo test --test p0_pragmas_and_indices       # 3 P0 regression tests
cargo test --test p1_app_state                 # 3-5 P1 new tests
cargo clippy --no-deps                         # lint
# Frontend (no changes expected, but verify):
cd .. && pnpm build && pnpm lint
```

## Project Structure

```
src-tauri/
├── Cargo.toml                 # +deadpool-sqlite; rusqlite 0.32→0.38
├── src/
│   ├── lib.rs                 # setup → app.manage(AppState)
│   ├── state.rs               # NEW: AppState { db: Pool }
│   ├── commands.rs            # 26 commands refactored
│   ├── db/
│   │   ├── mod.rs             # Database struct removed; build_pool() added
│   │   ├── dao.rs             # Dao::new(&Connection)
│   │   ├── seed.rs            # NEW: default rule_sub / rss_source seeds
│   │   └── migrations.rs      # unchanged
└── tests/
    └── p1_app_state.rs        # NEW
```

## Code Style (target shape)

```rust
// src-tauri/src/state.rs
use deadpool_sqlite::Pool;
pub struct AppState { pub db: Pool }

// Typical command (sync → async)
#[tauri::command]
pub async fn get_books(state: State<'_, AppState>) -> ApiResponse<Vec<Book>> {
    let pool = state.db.clone();
    let join = tauri::async_runtime::spawn_blocking(move || {
        let conn = pool.get().expect("pool exhausted");
        BookDao::new(&conn).get_all()
    }).await;
    match join {
        Ok(Ok(books)) => ok(books),
        Ok(Err(e))    => err(e.to_string()),
        Err(e)        => err(format!("join error: {e}")),
    }
}
```

## Boundaries

- **Always** — pool.get() inside the spawn_blocking closure; never hold a connection across `.await`.
- **Always** — preserve P0 indices + PRAGMAs + foreign_keys.
- **Ask first** — changing any IPC command name, parameter shape, or `ApiResponse<T>` wrapper.
- **Never** — put `WebBook`/`AnalyzeUrl` into `AppState` (they hold non-Sync JS state).
- **Never** — delete `JsExtState::global()` (WebBook/AnalyzeUrl still use it; would break compile).

## Success Criteria

| Criterion | Measurement |
|---|---|
| Compile clean | `cargo build` 0 error, 0 new warning |
| All tests pass | 66 unit + 3 P0 + 3-5 P1 = 72-74 green |
| Frontend untouched | `pnpm build && pnpm lint` pass without changes |
| Pool sized correctly | `state.db.status().max_size == 8` |
| Concurrent reads parallel | 4 concurrent `get_books` P95 < 1.5× single-call latency |
| Write does not block read | Concurrent `get_books` during a 1s write completes < 200ms |
| IPC protocol preserved | 26 command names + arg shapes unchanged (frontend 0 diff) |

---

# Plan: Implementation Order

```
T1 (prereq)      T2 (core)         T3 (per-command, 5 sub-batches)   T4 (verify)
──────────       ──────────        ───────────────────────────       ──────────
bump rusqlite    AppState +        T3a book (6)  ──┐                 p1_app_state
add deadpool     Pool wiring       T3b source (11)─┤                 full regression
                 DAO ctor change   T3c chapter (3) ┤                 frontend build/lint
                                    T3d fetch (5)  ─┤
                                    T3e batch (2)  ─┘
```

# Tasks

> All tasks are single-session scoped, ≤5 files each.

## T1 — Dependencies & baseline

- [ ] **Upgrade rusqlite to 0.38, add deadpool-sqlite 0.13**
  - Files: `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`
  - Verify: `cargo build && cargo test --lib && cargo test --test p0_pragmas_and_indices` (all green)
  - Risk: rusqlite API drift — fix small warnings if any

## T2 — AppState + Pool + DAO wiring

- [ ] **Create `src-tauri/src/state.rs` with `AppState { db: Pool }`**
  - Files: `src-tauri/src/state.rs` (new), `src-tauri/src/lib.rs`
  - Verify: compiles only after T3 progresses
- [ ] **Replace `Database::open`/`init_db` with `build_pool(path) -> Result<Pool>` + seed module**
  - Files: `src-tauri/src/db/mod.rs`, `src-tauri/src/db/seed.rs` (new)
  - Verify: PRAGMAs + indices + seed defaults still applied (P0 test + new check)
- [ ] **Migrate 12 DAOs from `&Database` to `&rusqlite::Connection`**
  - Files: `src-tauri/src/db/dao.rs`
  - Verify: compiles only after T3 progresses
- [ ] **Wire `app.manage(AppState::build(pool))` in `lib.rs`**
  - Files: `src-tauri/src/lib.rs`
  - Verify: `cargo build` succeeds after T3a

## T3 — Refactor 26 IPC commands (5 sub-batches)

- [ ] **T3a — 6 book_ commands** (get_books, add_book, update_book, delete_book, clear_book_cache, migrate_book_source)
- [ ] **T3b — 11 source_ commands** (get_book_sources, get_enabled_book_sources, get_explore_book_sources, get_explore_items, get_book_source, add_book_source, update_book_source, delete_book_source, top_book_source, get_book_source_groups, get_explore_kinds)
- [ ] **T3c — 3 chapter_ commands** (get_chapters, add_chapters, delete_chapters)
- [ ] **T3d — 5 fetch_/search_/explore_ commands** (search_books, explore_books, fetch_book_info, fetch_chapter_list, fetch_chapter_content)
- [ ] **T3e — 2 batch/check_ commands** (check_book_update, batch_cache_chapters)

For each sub-batch:
- Files: `src-tauri/src/commands.rs`
- Verify per sub-batch: `cargo build && cargo test --lib`
- After T3a: also `cd .. && pnpm build && pnpm lint` (smoke-protect frontend IPC)

## T4 — P1 tests + full regression

- [ ] **Create `src-tauri/tests/p1_app_state.rs`**
  - Cases: pool size, migrations on first conn, WAL read-during-write, concurrent reads, State injects same Pool
- [ ] **Full regression sweep**
  - `cargo test` (everything except `real_source_smoke` which is fixture-missing)
  - `pnpm build && pnpm lint`

---

# Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| rusqlite 0.32→0.38 API drift | Low | Med | T1 isolated PR, compile before T2 |
| Pool exhaustion panic (`expect`) | Low | Med | Pool size 8 is large enough; document for P2 follow-up |
| Frontend IPC breakage | Very Low | High | Command names + arg shapes preserved; verify with `pnpm build` after T3a |
| `db()` callers we missed (DAO + init) | Med | Med | `grep` for `db()` before T2 merge; 12 DAOs + init_db = known set |
| Spawn_blocking closure captures &Connection | Low | High | Code review; pattern enforces connection only used inside closure |
| `AppState` type mismatches at runtime panic | Low | Med | Single `AppState` struct, only one Tauri-managed instance |

# Excluded (deferred)

- 88 non-book/chapter/source commands (rss, setting, server, cookie, cache, bookmark, read_record, http_tts, txt_toc_rule, rule_sub, dict_rule, keyboard_assist, rss_*, …) — same refactor pattern, left for P2 to avoid change-bomb
- `WebBook::new` accepting a `reqwest::Client` (keeps using `http::blocking_client()` for now)
- `JsExtState::global()` deletion
- `ApiResponse<T>` → `Result<T, E>` migration
- Configurable pool size
