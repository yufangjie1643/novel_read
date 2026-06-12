//! P0 regression: verify that `db::build_pool` actually applies the tuned
//! PRAGMAs and that `run_migrations` creates the expected secondary indices.
//!
//! These checks let us catch silent regressions (e.g. a stray edit dropping
//! `journal_mode = WAL` or removing an index) without needing to launch the
//! full Tauri app and crack open the DB with the sqlite3 CLI.

use std::env;
use std::fs;
use std::time::Duration;

use legado_desktop_lib::db::{build_pool, migrations};
use rusqlite::Connection;

fn fresh_db_path(name: &str) -> std::path::PathBuf {
    let mut path = env::temp_dir();
    path.push(format!("legado_p0_verify_{}.db", name));
    let _ = fs::remove_file(&path);
    let _ = fs::remove_file(path.with_extension("db-wal"));
    let _ = fs::remove_file(path.with_extension("db-shm"));
    path
}

fn index_names(conn: &Connection) -> Vec<String> {
    let mut stmt = conn
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name")
        .expect("prepare index list");
    stmt.query_map([], |row| row.get::<_, String>(0))
        .expect("query index list")
        .filter_map(Result::ok)
        .collect()
}

#[test]
fn pragmas_are_tuned_on_pool() {
    let path = fresh_db_path("pragmas");

    // Build, query, AND drop the pool inside a single Tokio runtime context.
    // `pool.get()`, `obj.interact()`, and `SyncWrapper::drop` (invoked when
    // the pool is dropped) all use `tokio::task::spawn_blocking` under the
    // hood and panic if no runtime is current. Keeping the pool inside the
    // async block guarantees the runtime is still alive when the pool drops.
    let path_for_async = path.clone();
    let pooled_mode: String = tokio_test_block_on(async move {
        let pool = build_pool(path_for_async).expect("build pool");
        let obj = pool.get().await.expect("get pooled conn");
        obj.interact(|c| c.query_row("PRAGMA journal_mode", [], |r| r.get::<_, String>(0)))
            .await
            .expect("interact")
            .expect("query")
    });
    assert_eq!(
        pooled_mode.to_lowercase(),
        "wal",
        "journal_mode must be WAL on pooled connection"
    );

    // Cross-check via a raw `Connection::open` — same result, confirming
    // WAL is sticky on the DB file and not just on the bootstrap connection.
    let raw = Connection::open(&path).expect("raw open");
    let raw_mode: String = raw
        .query_row("PRAGMA journal_mode", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        raw_mode.to_lowercase(),
        "wal",
        "journal_mode must be WAL on raw open"
    );

    // NOTE: Connection-scoped PRAGMAs (`synchronous`, `busy_timeout`,
    // `temp_store`, `cache_size`, `mmap_size`, `foreign_keys`) are applied
    // by `bootstrap_first_conn` on the bootstrap connection only, which is
    // then dropped. Pooled connections opened later via the default
    // deadpool-sqlite Manager do NOT re-apply them. A future P-cycle should
    // wire a `post_create` hook on the pool builder so these PRAGMAs stick
    // on every pooled connection; at that point, additional assertions
    // belong here.
}

#[test]
fn p0_indices_are_created() {
    let path = fresh_db_path("indices");
    let _pool = build_pool(path.clone()).expect("build pool");

    let conn = Connection::open(&path).expect("raw open");
    let indices = index_names(&conn);

    let required = [
        "idx_chapters_book",
        "idx_chapters_book_idx",
        "idx_chapter_contents_book",
        "idx_bookmarks_book",
        "idx_read_records_name",
        "idx_book_sources_enabled",
        "idx_book_sources_group",
        "idx_books_group",
        "idx_rss_articles_origin",
        "idx_rss_read_records_origin",
        "idx_caches_deadline",
    ];

    for name in required {
        assert!(
            indices.iter().any(|i| i == name),
            "expected index `{}` to be created, got: {:?}",
            name,
            indices
        );
    }
}

#[test]
fn chapters_lookup_uses_index() {
    let path = fresh_db_path("plan");
    let _pool = build_pool(path.clone()).expect("build pool");

    // Make sure the table exists with the index by running migrations on a
    // fresh connection (matches what build_pool does internally).
    {
        let mut c = Connection::open(&path).expect("raw open");
        migrations::run_migrations(&mut c).expect("migrations");
    }
    let conn = Connection::open(&path).expect("raw open");
    let plan: String = conn
        .query_row(
            "EXPLAIN QUERY PLAN SELECT * FROM book_chapters WHERE bookUrl = ?1",
            ["http://example.com/book/1"],
            |row| row.get::<_, String>(3),
        )
        .expect("explain query plan");

    assert!(
        plan.contains("idx_chapters_book"),
        "query plan should use idx_chapters_book, got: {}",
        plan
    );
}

/// Tiny inline tokio runtime helper so we can `.await` `pool.get()` from
/// sync test code without pulling in `tokio::test` (which would conflict
/// with the project's tokio features).
fn tokio_test_block_on<F: std::future::Future>(
    fut: F,
) -> F::Output {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    rt.block_on(fut)
}

// Mark the helper as "used" so the linter doesn't complain when no test
// currently calls it (some tests use it; this keeps the file self-contained).
#[allow(dead_code)]
const _: Duration = Duration::from_secs(0);
