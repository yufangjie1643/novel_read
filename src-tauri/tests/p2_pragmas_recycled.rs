//! P2 regression: verify that connection-scoped PRAGMAs survive
//! `deadpool::managed::Pool` recycling. The pre-P2 default manager
//! only re-validated connections on recycle, which meant the
//! connection-scoped settings (`synchronous`, `busy_timeout`,
//! `temp_store`, `cache_size`, `mmap_size`, `foreign_keys`) were
//! silently lost the first time a connection was checked back in
//! and re-issued. `PragmaManager` re-applies the full PRAGMA set on
//! every `create` and `recycle`.
//!
//! These tests are the regression that would have caught that bug.
//!
//! Important: each test builds a fresh `current_thread` tokio runtime
//! and runs every `pool.get()` / `drop(connection)` inside the runtime's
//! `block_on` scope. `SyncWrapper::drop` schedules a background
//! `tokio::task::spawn_blocking` for the inner `Connection::close`,
//! which panics with "no reactor running" if the runtime isn't
//! current. This pattern is the same one `tests/p1_app_state.rs`
//! uses for its `pool_size_is_eight` test.

use std::env;
use std::fs;
use std::path::PathBuf;

use legado_desktop_lib::db::build_pool;
use rusqlite::Connection;

fn fresh_db_path(name: &str) -> PathBuf {
    let mut path = env::temp_dir();
    path.push(format!("legado_p2_pragmas_{}.db", name));
    let _ = fs::remove_file(&path);
    let _ = fs::remove_file(path.with_extension("db-wal"));
    let _ = fs::remove_file(path.with_extension("db-shm"));
    path
}

fn assert_sticky_pragmas(conn: &Connection) {
    // Sticky (DB-file scoped).
    let mode: String = conn
        .query_row("PRAGMA journal_mode", [], |r| r.get(0))
        .unwrap();
    assert_eq!(mode.to_lowercase(), "wal", "journal_mode must remain WAL");

    // Connection-scoped.
    assert_eq!(
        conn.query_row("PRAGMA synchronous", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1,
        "synchronous must stay NORMAL (1) across recycle"
    );
    assert_eq!(
        conn.query_row("PRAGMA busy_timeout", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        5000,
        "busy_timeout must stay 5000ms across recycle"
    );
    assert_eq!(
        conn.query_row("PRAGMA foreign_keys", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1,
        "foreign_keys must stay ON across recycle"
    );
    assert_eq!(
        conn.query_row("PRAGMA temp_store", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        2,
        "temp_store must stay MEMORY (2) across recycle"
    );
    assert_eq!(
        conn.query_row("PRAGMA cache_size", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        -20000,
        "cache_size must stay -20000 (≈20MB) across recycle"
    );
    let mmap: i64 = conn
        .query_row("PRAGMA mmap_size", [], |r| r.get::<_, i64>(0))
        .unwrap();
    assert!(
        mmap > 0,
        "mmap_size must stay > 0 across recycle, got {}",
        mmap
    );
}

fn tokio_block_on<F: std::future::Future>(fut: F) -> F::Output {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    rt.block_on(fut)
}

#[test]
fn pragmas_stick_on_first_two_pool_checkouts() {
    let path = fresh_db_path("first_two");
    tokio_block_on(async {
        let pool = build_pool(path.clone()).expect("build pool");
        let _first = pool.get().await.expect("first conn");
        let recycled = pool.get().await.expect("recycled conn");
        recycled
            .interact(|conn| -> rusqlite::Result<()> {
                assert_sticky_pragmas(conn);
                Ok(())
            })
            .await
            .expect("interact")
            .expect("pragma check on recycled conn");
    });
}

#[test]
fn pragmas_stick_after_repeated_checkouts() {
    // Force the pool to churn through its internal Object pool. Each
    // `pool.get()` may create a new connection or recycle an existing
    // one; in either case all connection-scoped PRAGMAs must be
    // observable on the returned connection.
    let path = fresh_db_path("repeated");
    tokio_block_on(async {
        let pool = build_pool(path.clone()).expect("build pool");
        for i in 0..8 {
            let conn = pool.get().await.expect("check-out");
            let res: Result<(), _> = conn
                .interact(|c| -> rusqlite::Result<()> {
                    assert_sticky_pragmas(c);
                    let _: i64 = c.query_row("SELECT 1", [], |r| r.get(0))?;
                    Ok(())
                })
                .await
                .map(|_| ());
            res.unwrap_or_else(|e| panic!("check #{}: interact error: {}", i, e));
            // `conn` drops at end of this loop iteration, INSIDE
            // `block_on`, so `SyncWrapper::drop` finds the runtime
            // current and can schedule its background cleanup.
        }
    });
}
