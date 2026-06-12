# Spec: P2 — Drain the Database Shim + Fix Recycled-Connection PRAGMAs

> Status: ✅ approved (execution in progress)
> Phase: P2 of the [performance roadmap](../AGENTS.md)
> Supersedes: P1's `Database` OnceLock shim and the 88 commands it kept compiling.

## Objective

Eliminate the `Database` OnceLock shim from `db/mod.rs` (the single-`Mutex<Connection>` carry-over from before the pool existed) and migrate every remaining call site to the real connection pool. As a side effect, fix a latent correctness bug: connection-scoped PRAGMAs (`synchronous`, `busy_timeout`, `temp_store`, `cache_size`, `mmap_size`, `foreign_keys`) are only applied on the bootstrap connection today — they are silently lost when deadpool recycles a connection. P2 introduces a custom `Manager` that re-applies the full PRAGMA set on every `create` and `recycle`.

**No IPC protocol changes.** Frontend requires zero changes (same as P1).

## Scope (in / out)

| In | Out (deferred) |
|---|---|
| Custom `PragmaManager` so recycled connections inherit all PRAGMAs | Removing `ApiResponse<T>` in favor of `Result<T, ApiError>` |
| Migrating **68** sync `db().as_conn()` calls in `commands.rs` to `async fn` + `db_op` | Virtualized lists, route lazy-split, Channel-streamed chapter content |
| Migrating `server.rs` and `local_book/mod.rs` to take a `&Pool` | `moka` network cache |
| Migrating 1 async command (`debug_book_source`) + refactoring 1 already-pooled command (`fetch_rss_articles`) to use `db_op` consistently | |
| **Deleting** `pub struct Database` / `pub fn db()` / `pub fn db_path()` from `db/mod.rs` | |
| 13 P2 commands that are pure network/parse (e.g. `import_*_from_url/json`, `fetch_import_*`, `parse_source_links_from_html`) — **no DB migration needed** but confirmed still in scope for documentation sweep | |
| 5 P3-scope commands (`start_web_server`, `stop_web_server`, `get_web_server_status`, `test_webdav_connection`, `backup_to_webdav`, `restore_from_webdav`) — left for P3 to convert when the WebDAV/server code is async-ified | |

## Tech Stack

| Item | Before (P1) | After (P2) |
|---|---|---|
| `db/mod.rs` shim | `Database { Mutex<Connection> }` + `OnceLock<Database>` + `unsafe as_conn/as_mut_conn` | **Removed** |
| Pool manager | `deadpool_sqlite::Manager` (default — PRAGMAs lost on recycle) | Custom `PragmaManager` (PRAGMAs applied on every `create` and `recycle`) |
| 68 sync `pub fn` DB commands | `db().as_conn()` | `pub async fn` + `db_op(app_handle, ...)` |
| `server.rs` / `local_book/mod.rs` | `db().as_conn()` | `&Pool` parameter (caller passes from `db_op` closure) |
| 1 async command `debug_book_source` | spawn_blocking + inner + `db().as_conn()` | spawn_blocking + inner + `db_op` |

## Commands (verification)

```bash
cd src-tauri
cargo build                                       # 0 errors
cargo test --lib                                  # 66 unit
cargo test --test p0_pragmas_and_indices          # 3 P0 regression
cargo test --test p1_app_state                    # 4 P1 regression
cargo test --test p2_pragmas_recycled             # NEW: verify PRAGMAs stick on recycled conns
cargo test --test p2_app_state_stress             # NEW: high-concurrency read burst on the new pool
cd .. && pnpm build && pnpm lint                  # Frontend untouched
```

## Project Structure

```
src-tauri/
├── Cargo.toml                     # (no new deps; deadpool = "0.13" already)
├── src/
│   ├── state.rs                    # unchanged
│   ├── lib.rs                      # build_pool() now uses PragmaManager
│   ├── commands.rs                 # 68 sync → async + db_op; 2 already-async to db_op
│   ├── db/
│   │   ├── mod.rs                  # build_pool uses PragmaManager; Database shim DELETED
│   │   ├── seed.rs                 # (no change)
│   │   ├── dao.rs                  # (no change; P1 already migrated)
│   │   └── migrations.rs           # (no change)
│   ├── local_book/
│   │   └── mod.rs                  # import_txt_bytes / import_epub_content take &Pool
│   ├── server.rs                   # start_server/stop_server/is_server_running take &Pool
│   └── book_source/                # (no change; P1 left it alone)
└── tests/
    ├── p0_pragmas_and_indices.rs   # (extend with recycled-conn case)
    ├── p1_app_state.rs             # (no change)
    ├── p2_pragmas_recycled.rs      # NEW: build pool, get conn, get another conn (recycled),
    │                                #       verify journal_mode=synchronous=busy_timeout=foreign_keys
    │                                #       all still set on the second conn.
    └── p2_app_state_stress.rs      # NEW: 16 threads x 100 SELECTs via the pool, max latency < 1s.
```

## Code Style (target shape)

```rust
// db/mod.rs — PragmaManager
struct PragmaManager { config: Config, runtime: Runtime }

impl PoolManager for PragmaManager {
    type Type = SyncWrapper<Connection>;
    type Error = rusqlite::Error;

    async fn create(&self) -> Result<Self::Type, Self::Error> {
        SyncWrapper::new(self.runtime, move || {
            let conn = Connection::open(self.config.path.clone())?;
            conn.execute_batch(PRAGMAS)?;
            Ok(conn)
        }).await
    }

    async fn recycle(&self, conn: &mut Self::Type, _: &Metrics) -> RecycleResult<Self::Error> {
        if conn.is_mutex_poisoned() {
            return Err(RecycleError::Message("mutex poisoned".into()));
        }
        let n = self.recycle_count.fetch_add(1, Ordering::Relaxed);
        conn.interact(move |c| {
            c.execute_batch(PRAGMAS)?;
            let current: isize = c.query_row("SELECT $1", [n], |row| row.get(0))?;
            if current == n { Ok(()) } else { Err(rusqlite::Error::InvalidQuery) }
        })
        .await
        .map_err(|e| RecycleError::message(format!("{e}")))?
        .map_err(|e| RecycleError::message(format!("{e}")))?;
        Ok(())
    }
}
```

```rust
// commands.rs — the new shape
#[tauri::command]
pub async fn add_book_group(
    app_handle: tauri::AppHandle,
    group: BookGroup,
) -> ApiResponse<()> {
    db_op(app_handle, move |conn| {
        BookGroupDao::new(conn).insert(&group).map(|_| ())
    }).await
}
```

```rust
// local_book/mod.rs — clean break
pub fn import_txt_content(
    conn: &Connection,
    content: &str,
    file_name: &str,
) -> Result<(Book, usize), ImportError> {
    // same body, takes &Connection from db_op's closure
}
```

## Testing Strategy

| Test file | Cases |
|---|---|
| `cargo test --lib` | 66 existing unit tests — no regressions |
| `tests/p0_pragmas_and_indices.rs` | Extend with one new case: `pragmas_stick_on_recycled_connection` — open a pool, get 2 connections in sequence, assert that **connection-scoped** PRAGMAs (synchronous, busy_timeout, temp_store, cache_size, mmap_size, foreign_keys) are still set on the second one. |
| `tests/p1_app_state.rs` | No change |
| `tests/p2_pragmas_recycled.rs` (NEW) | `pragmas_on_recycled_via_pool_get` — explicitly force pool churn by spawning 8 threads that each take a connection, then verify a 9th thread's connection has all PRAGMAs. |
| `tests/p2_app_state_stress.rs` (NEW) | `high_concurrency_throughput` — 16 std::thread::spawn closures, each takes 100 connections in a loop, runs `SELECT 1`. Asserts max per-thread latency < 1s. |
| `pnpm build && pnpm lint` | 0 errors (frontend untouched) |

## Boundaries

### Always do
- All DB work goes through `db_op(app_handle, |conn| { ... })`.
- Transactions use the same connection from `db_op` (no separate connection acquisition).
- `import_txt_content` and `import_epub_content` accept `&Connection` (auto-deref from `&mut Connection`).
- `server::start_server` / `stop_server` / `is_server_running` accept `&Pool` so the caller (P2 command) can pass the pool from `db_op`'s closure.
- New connection-scoped PRAGMA values are applied on every `create` and `recycle` via the custom `PragmaManager`.
- After every `commands.rs` migration sub-batch, `cargo build` + `cargo test --lib` must pass before the next batch.

### Ask first
- Adding a new `r2d2`-style async runtime dependency (not currently needed).
- Re-introducing a global `OnceLock` for any new purpose.
- Changing the `ApiResponse<T>` IPC envelope.

### Never do
- Re-introduce the `Database` OnceLock shim.
- Hold a `Connection` reference across an `.await` point in async code.
- `std::mem::forget(guard)` on a `MutexGuard` to bypass locks.
- Publicly expose the pool `Object<Manager>` (callers should always go through `db_op` or `&Pool` for sync helpers).
- Break frontend IPC: command names and arg shapes are 1:1 preserved.

## Success Criteria

| Criterion | Measurement |
|---|---|
| Compile clean | `cargo build` 0 errors, 0 new warnings (the 2 pre-existing `unused variable: e` in `db/mod.rs:89,93` get fixed by removing the shim) |
| No `db()` shim | `grep -r "fn db()\|struct Database" src/` returns no hits |
| All 68 sync DB commands migrated | `grep -c "pub async fn" src-tauri/src/commands.rs` >= P1's count + 68 |
| All tests pass | 66 + 3 + 4 + 3-5 new = 76-78 green |
| PRAGMAs on recycled conns | New `p2_pragmas_recycled` test passes; explicit assertion on 9th connection's `synchronous`/`busy_timeout`/`foreign_keys` |
| Concurrency safety | 16-thread stress test completes with max per-thread latency < 1s |
| Frontend 0 changes | `pnpm build && pnpm lint` pass |

## Open Questions

| Question | Current decision | Notes |
|---|---|---|
| Should `import_txt_content` and `import_epub_content` take `&Connection` or `&Pool`? | `&Connection` (passes through `db_op`) | Keeps DAO signature uniform. Sync helper. |
| Should server.rs take `&Pool` for parity, or stay free of DB? | `&Pool` for parity (even though they don't use it) | Lets the caller pass the pool uniformly; type cost is one extra param. |
| 13 pure-network P2 commands | No migration needed (no DB), but verify signatures unchanged. | If any of them want to become async for consistency, that's a P3 thing. |
| 5 server/webdav P3-scope commands | Leave for P3. | `start_web_server` etc. currently are sync; no DB access; no P2 work. |

---

# Plan: Implementation Order

```
T1 (1 commit)
  Custom PragmaManager + tests
  └── fixes PRAGMAs on recycled conns

T2-T9 (8 commits, 1 per resource)
  Migrate 68 sync commands in 8 sub-batches:
    T2  book_group       + replace_rule         (8 cmds)
    T3  search_keyword   + cookie      + cache  (9 cmds)
    T4  bookmark         + read_record         (7 cmds)
    T5  http_tts         + rss_source + rss_article (10 cmds)
    T6  txt_toc_rule     + rule_sub            (8 cmds)
    T7  dict_rule        + keyboard_assist     (8 cmds)
    T8  server           + rss_star + rss_read_record (10 cmds)
    T9  list_app_files   + get_bookmarks + get_read_records + get_search_keywords (6 cmds)

T10 (1 commit)
  Migrate server.rs + local_book/mod.rs to take &Pool
  + the 2 already-async commands (debug_book_source, fetch_rss_articles)

T11 (1 commit)
  Delete Database shim from db/mod.rs
  + the 2 pre-existing `unused variable: e` warnings go away

T12 (1 commit)
  tests/p2_pragmas_recycled.rs + tests/p2_app_state_stress.rs
  + docs/p2-spec.md
  + frontend smoke (pnpm build && pnpm lint)
```

Total: **12 commits** for P2.

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `PragmaManager::recycle` Send issue (T2 encountered) | Low | Med | Use `SyncWrapper::interact(...)` (the official way); proven by deadpool-sqlite's own example. |
| Transaction semantics lost in helpers (`import_txt_*`) | Low | Med | Document in code; the new `&Connection` version doesn't call `transaction()`. If atomicity is later needed, add `conn.transaction()?` in the helper. |
| `server::start_server` needs thread spawn for sync `tiny_http` | Low | Low | Document that `start_server` blocks the calling thread (a few ms at most); `db_op`'s closure runs on a deadpool worker, so the Tauri runtime is unaffected. |
| Forgetting one of 68 commands in any sub-batch | Med | Med | Each sub-batch's `cargo build && cargo test --lib` is the gate. If a command is still sync `pub fn` and uses `db()`, the build will fail (no shim anymore after T11). |
| `&Pool` parameter pollution | Low | Low | Only `server::start_server/stop_server/is_server_running` and `local_book::import_txt_content/import_epub_content` get the new param. Other helpers in those modules stay unchanged. |

---

# Tasks

## T1 — PragmaManager + recycled-connection test

- [ ] **Add `PragmaManager` to `db/mod.rs` and switch `build_pool` to use it**
  - **Acceptance**: new struct `PragmaManager` impls `deadpool::managed::Manager`; both `create` and `recycle` apply the full PRAGMA set; `build_pool` uses it; 0 `unsafe`.
  - **Verify**: `cargo build`; `cargo test --test p0_pragmas_and_indices` (extend to cover recycled case); new test file `tests/p2_pragmas_recycled.rs` passes.
  - **Files**: `src-tauri/src/db/mod.rs`, `src-tauri/tests/p0_pragmas_and_indices.rs` (extend), `src-tauri/tests/p2_pragmas_recycled.rs` (new).

## T2-T9 — Migrate 68 sync commands in 8 sub-batches

For each sub-batch:
- [ ] **Migrate commands in this batch**
  - **Acceptance**: every command in the batch is `pub async fn`, takes `app_handle: tauri::AppHandle`, and routes DB work through `db_op(app_handle, |conn| { ... })`. No `db()` reference remains. No `as_conn`/`as_mut_conn` reference.
  - **Verify**: `cargo build && cargo test --lib && cargo test --test p1_app_state && cargo test --test p2_pragmas_recycled` all pass.
  - **Files**: `src-tauri/src/commands.rs`.

Sub-batches:
  - T2: `add_book_group`, `update_book_group`, `delete_book_group`, `get_book_groups`, `get_replace_rules`, `add_replace_rule`, `update_replace_rule`, `delete_replace_rule` (8 cmds)
  - T3: `add_search_keyword`, `get_search_keywords`, `clear_search_keywords`, `set_cookie`, `get_cookie`, `delete_cookie`, `set_cache`, `get_cache`, `delete_cache` (9 cmds)
  - T4: `add_bookmark`, `update_bookmark`, `delete_bookmark`, `get_bookmarks`, `add_read_record`, `get_read_records`, `delete_read_record` (7 cmds)
  - T5: `get_http_tts_list`, `add_http_tts`, `update_http_tts`, `delete_http_tts`, `get_rss_sources`, `add_rss_source`, `update_rss_source`, `delete_rss_source`, `get_rss_articles`, `add_rss_articles` (10 cmds)
  - T6: `get_txt_toc_rules`, `add_txt_toc_rule`, `update_txt_toc_rule`, `delete_txt_toc_rule`, `get_rule_subs`, `add_rule_sub`, `update_rule_sub`, `delete_rule_sub` (8 cmds)
  - T7: `get_dict_rules`, `add_dict_rule`, `update_dict_rule`, `delete_dict_rule`, `get_keyboard_assists`, `add_keyboard_assist`, `update_keyboard_assist`, `delete_keyboard_assist` (8 cmds)
  - T8: `get_servers`, `add_server`, `update_server`, `delete_server`, `get_rss_stars`, `add_rss_star`, `delete_rss_star`, `mark_rss_read`, `is_rss_read`, `get_rss_read_article_ids` (10 cmds)
  - T9: `list_app_files`, `create_app_folder`, `delete_app_file` (FS, not DB — likely trivial pass-through); re-verify final batch list at execution time.

## T10 — server.rs / local_book/mod.rs clean break

- [ ] **`local_book::import_txt_content` and `import_epub_content` accept `&Connection` instead of calling `db()`**
  - **Acceptance**: signatures changed to `pub fn import_txt_content(conn: &Connection, content: &str, file_name: &str) -> Result<...>`. All internal `db().as_conn()` / `db().as_mut_conn()` references gone.
  - **Verify**: `cargo build`; the corresponding P2 commands `import_txt_book` and `import_epub_book` now do `db_op(app_handle, move |conn| import_txt_content(conn, &data, &file_name).map(...))`.
  - **Files**: `src-tauri/src/local_book/mod.rs`, `src-tauri/src/commands.rs` (update 2 commands).

- [ ] **`server::start_server`, `stop_server`, `is_server_running` accept `&Pool`**
  - **Acceptance**: signatures take `&Pool`. The 2 corresponding P2 commands (`start_web_server`, `stop_web_server`, plus the no-DB `get_web_server_status`) pass the pool from `db_op` even though they don't use it (clean break).
  - **Verify**: `cargo build && cargo test --lib`.
  - **Files**: `src-tauri/src/server.rs`, `src-tauri/src/commands.rs` (update commands).

- [ ] **Refactor `debug_book_source` and `fetch_rss_articles` to use `db_op` consistently**
  - **Acceptance**: both use `db_op(app_handle, |conn| { ... })` instead of the ad-hoc `app_handle.state() + pool.get().await + interact(...)` boilerplate. Behavior unchanged.
  - **Verify**: `cargo build && cargo test --lib`.
  - **Files**: `src-tauri/src/commands.rs`.

## T11 — Delete Database shim

- [ ] **Remove `pub struct Database` / `pub fn db()` / `pub fn db_path()` from `db/mod.rs`**
  - **Acceptance**: the entire shim is gone. The 2 pre-existing `unused variable: e` warnings in `db/mod.rs:89,93` also disappear. `grep -r "fn db()\|struct Database" src/` returns no hits.
  - **Verify**: `cargo build --message-format=short | grep warning` shows 0 warnings; all tests pass.
  - **Files**: `src-tauri/src/db/mod.rs`.

## T12 — Tests + docs + frontend smoke

- [ ] **Add `tests/p2_pragmas_recycled.rs`** and **`tests/p2_app_state_stress.rs`**.
  - **Verify**: both pass; total test count: 66 + 3 + 4 + 3-4 = 76-77 green.
  - **Files**: `src-tauri/tests/p2_pragmas_recycled.rs` (new), `src-tauri/tests/p2_app_state_stress.rs` (new).

- [ ] **Add `docs/p2-spec.md`** (this document).
  - **Verify**: file exists, links to `docs/p1-spec.md`.
  - **Files**: `docs/p2-spec.md` (new).

- [ ] **Frontend smoke**: `cd .. && pnpm build && pnpm lint`
  - **Verify**: 0 errors. Frontend untouched.
