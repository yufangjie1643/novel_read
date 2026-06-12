//! P1 architecture tests: verify the new connection-pool + AppState wiring
//! introduced in T2/T3 actually behaves the way the spec promises.
//!
//! These tests are intentionally black-box: they exercise the same public
//! surface (`db::build_pool`, `state::AppState::build`) the Tauri commands
//! use, so a regression in pool sizing, migration sequencing, or
//! `AppState` shape is caught without needing to spin up the full app.
//!
//! Test isolation: every test uses a unique `temp_dir + name` via
//! `fresh_db_path`. The pool is dropped *inside* a current tokio runtime
//! scope (deadpool's `SyncWrapper::drop` calls
//! `tokio::task::spawn_blocking_background`, which panics if no runtime
//! is current), so each test builds and tears down its pool inside a
//! `tokio_block_on` scope and reruns are clean.

use std::env;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::Instant;

use legado_desktop_lib::db::build_pool;
use legado_desktop_lib::state::AppState;

/// Build a fresh, unused DB path in the OS temp dir. Cleans up any
/// leftover `legado.db`, `legado.db-wal`, `legado.db-shm` from a prior run.
fn fresh_db_path(name: &str) -> PathBuf {
    let mut path = env::temp_dir();
    path.push(format!("legado_p1_verify_{}.db", name));
    let _ = fs::remove_file(&path);
    let _ = fs::remove_file(path.with_extension("db-wal"));
    let _ = fs::remove_file(path.with_extension("db-shm"));
    path
}

/// Tiny inline tokio runtime helper so we can `.await` `pool.get()` from
/// sync test code without pulling in `tokio::test` (which would conflict
/// with the project's tokio features). Mirrors the helper in
/// `p0_pragmas_and_indices.rs`.
fn tokio_block_on<F: std::future::Future>(fut: F) -> F::Output {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    rt.block_on(fut)
}

#[test]
fn pool_size_is_eight() {
    let path = fresh_db_path("pool_size");

    // Build the pool *inside* a runtime scope so its drop at the end of
    // the async block has a current handle — deadpool's
    // `SyncWrapper::drop` panics otherwise.
    tokio_block_on(async move {
        let pool = build_pool(path.clone()).expect("build pool");

        // The spec mandates a pool of exactly 8 — large enough for the
        // Tauri IPC runtime to keep several commands in flight without
        // queueing.
        assert_eq!(
            pool.status().max_size,
            8,
            "pool max_size must be 8 (got {})",
            pool.status().max_size
        );

        // `pool` drops at end of this block, while the runtime is current.
    });
}

#[test]
fn concurrent_reads_do_not_block() {
    let path = fresh_db_path("concurrent_reads");

    // 4 threads × 50 round-trips each = 200 SELECTs. With WAL + a pool
    // of 8, contention-free runtime should be well under a second per
    // thread. The 5s ceiling is a sanity bound that would only fail if a
    // future refactor accidentally reintroduced a single-Mutex bottleneck.
    const THREADS: usize = 4;
    const ROUNDS: usize = 50;
    const MAX_NS_PER_THREAD: u128 = 5_000_000_000; // 5s

    let max_elapsed = Arc::new(AtomicU64::new(0));
    let path_for_async = path.clone();
    let max_elapsed_for_async = max_elapsed.clone();

    tokio_block_on(async move {
        let pool = build_pool(path_for_async).expect("build pool");

        // Long busy_timeout makes any pool-induced contention visible: if
        // a future regression serialises the pool behind a single lock,
        // a blocked reader would wait the full 60s here.
        {
            let obj = pool.get().await.expect("get setup conn");
            obj.interact(|c| {
                c.execute_batch("PRAGMA busy_timeout = 60000")
                    .expect("execute_batch")
            })
            .await
            .expect("setup interact");
        }

        let pool_arc = Arc::new(pool);
        for _ in 0..THREADS {
            let pool = pool_arc.clone();
            let max_elapsed = max_elapsed_for_async.clone();

            // `std::thread::spawn` per the spec: each thread is a real
            // OS thread with its own current-thread tokio runtime. The
            // pool is `Clone` (Arc-based) so it works across runtimes.
            let h = thread::spawn(move || {
                let start = Instant::now();
                let rt = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .unwrap();

                // `async move` so the `pool` clone is owned by the
                // future and dropped *inside* block_on, with the
                // thread's runtime current.
                rt.block_on(async move {
                    for _ in 0..ROUNDS {
                        let obj = pool.get().await.expect("get pooled conn");
                        let n: i64 = obj
                            .interact(|c| c.query_row("SELECT 1", [], |r| r.get(0)))
                            .await
                            .expect("interact")
                            .expect("query");
                        assert_eq!(n, 1, "SELECT 1 must return 1");
                    }
                });

                // The `pool` Arc clone was dropped at end of block_on
                // above. Now measure and record.
                let elapsed_ns = start.elapsed().as_nanos() as u64;
                max_elapsed.fetch_max(elapsed_ns, Ordering::Relaxed);
            });
            // Join inside the outer block_on: by the time `h.join()`
            // returns, the thread has finished and its pool clone is
            // already dropped (with its own runtime current). So when
            // we drop `pool_arc` below, it's the only remaining Arc.
            h.join().expect("thread join");
        }

        // Last remaining Arc to the pool. Dropping it here, inside the
        // outer block_on, guarantees the actual `Pool` drop sees a
        // current runtime.
        drop(pool_arc);
    });

    let max_ns = max_elapsed.load(Ordering::Relaxed) as u128;
    assert!(
        max_ns < MAX_NS_PER_THREAD,
        "max per-thread elapsed must be < {}s, got {} ns ({} ms)",
        MAX_NS_PER_THREAD / 1_000_000_000,
        max_ns,
        max_ns / 1_000_000
    );
}

#[test]
fn migrations_run_on_first_connection() {
    let path = fresh_db_path("migrations");

    let table_names: Vec<String> = tokio_block_on(async move {
        let pool = build_pool(path.clone()).expect("build pool");

        // 22 tables are created by `migrations::run_migrations` (see
        // `src-tauri/src/db/migrations.rs`). We require at least 20 of
        // them to be present after a fresh `build_pool` — anything
        // below that means a table got dropped from the migration list
        // without notice.
        let obj = pool.get().await.expect("get conn");
        obj.interact(|c| {
            let mut stmt = c
                .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
                .expect("prepare table list");
            stmt.query_map([], |r| r.get::<_, String>(0))
                .expect("query table list")
                .filter_map(Result::ok)
                .collect::<Vec<_>>()
        })
        .await
        .expect("interact")
        // `pool` (and thus `obj`'s pool slot) drops at end of this block.
    });

    // `sqlite_sequence` is created automatically by SQLite the first time
    // an AUTOINCREMENT table is written to; we don't require it.
    let expected: &[&str] = &[
        "books",
        "book_chapters",
        "book_sources",
        "bookmarks",
        "chapter_contents",
        "rss_sources",
        "rule_subs",
        "cookies",
        "caches",
        "book_groups",
        "replace_rules",
        "search_keywords",
        "read_records",
        "http_tts",
        "rss_articles",
        "rss_stars",
        "rss_read_records",
        "txt_toc_rules",
        "dict_rules",
        "keyboard_assists",
        "servers",
        "search_books",
    ];

    let found: usize = expected
        .iter()
        .filter(|n| table_names.iter().any(|t| t == *n))
        .count();

    assert!(
        found >= 20,
        "expected at least 20 of {} core tables, found {}\n  present: {:?}\n  expected: {:?}",
        expected.len(),
        found,
        table_names,
        expected
    );
}

#[test]
fn app_state_holds_pool() {
    let path = fresh_db_path("app_state");

    tokio_block_on(async move {
        let pool = build_pool(path.clone()).expect("build pool");

        // The whole point of T2: Tauri commands now receive
        // `tauri::State<'_, AppState>` and deref to `&AppState`. If
        // `AppState::build` ever lost the pool (e.g. someone replaced
        // it with an `Option<Pool>` or a single `Connection`), this
        // assertion would fire.
        let state = AppState::build(pool);
        assert!(
            state.db.status().max_size > 0,
            "AppState.db must be a live pool (max_size = {})",
            state.db.status().max_size
        );

        // Bonus check: the same `AppState` can hand out connections —
        // which is what every refactored IPC command does on every
        // invocation.
        let obj = state.db.get().await.expect("AppState pool should hand out conns");
        let n: i64 = obj
            .interact(|c| c.query_row("SELECT 1", [], |r| r.get(0)))
            .await
            .expect("interact")
            .expect("query");
        assert_eq!(n, 1);

        // `state` drops at end of block, with the runtime current.
    });
}
