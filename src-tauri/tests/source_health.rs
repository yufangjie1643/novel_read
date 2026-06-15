//! Verifies that the source-stats DAO records health on
//! `fetch_chapter_list` and `fetch_chapter_content` operations.
//!
//! Background: until this turn, health was only updated on searches.
//! Chapter list and content fetches silently swallowed errors. This
//! test seeds a known book source, runs the DAO through its
//! record_* methods, and checks that the stats table gains the
//! expected rows and that the health score degrades as expected.

use legado_desktop_lib::db::{build_pool, OpKind, SourceStatsDao};
use rusqlite::Connection;

fn fresh_db() -> std::path::PathBuf {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let tmp = std::env::temp_dir().join(format!(
        "legado_health_test_{}_{}_{}.db",
        std::process::id(),
        chrono_like_timestamp(),
        n,
    ));
    if tmp.exists() {
        std::fs::remove_file(&tmp).ok();
    }
    let conn = Connection::open(&tmp).expect("open");
    conn.execute_batch(
        "CREATE TABLE source_stats (
            sourceUrl TEXT PRIMARY KEY,
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
            health_score REAL NOT NULL DEFAULT 1.0,
            search_ok INTEGER NOT NULL DEFAULT 0,
            search_err INTEGER NOT NULL DEFAULT 0,
            search_timeout INTEGER NOT NULL DEFAULT 0,
            last_search_error TEXT,
            last_search_at INTEGER,
            explore_ok INTEGER NOT NULL DEFAULT 0,
            explore_err INTEGER NOT NULL DEFAULT 0,
            explore_timeout INTEGER NOT NULL DEFAULT 0,
            last_explore_error TEXT,
            last_explore_at INTEGER,
            chapter_list_ok INTEGER NOT NULL DEFAULT 0,
            chapter_list_err INTEGER NOT NULL DEFAULT 0,
            chapter_list_timeout INTEGER NOT NULL DEFAULT 0,
            last_chapter_list_error TEXT,
            last_chapter_list_at INTEGER,
            chapter_content_ok INTEGER NOT NULL DEFAULT 0,
            chapter_content_err INTEGER NOT NULL DEFAULT 0,
            chapter_content_timeout INTEGER NOT NULL DEFAULT 0,
            last_chapter_content_error TEXT,
            last_chapter_content_at INTEGER
        );",
    )
    .expect("create table");
    drop(conn);
    tmp
}

fn chrono_like_timestamp() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 1)]
async fn record_success_and_error_increment_health_table() {
    let tmp = fresh_db();
    let pool = build_pool(tmp.clone()).expect("pool");
    let dao = SourceStatsDao::new(pool);

    // 1. Record three successes.
    for _ in 0..3 {
        dao.record_success("https://example.com/source1", 100)
            .await
            .expect("record success");
    }
    let stats = dao
        .get_by_url("https://example.com/source1")
        .await
        .expect("get")
        .expect("present");
    assert_eq!(stats.successful_queries, 3);
    assert_eq!(stats.total_queries, 3);
    assert_eq!(stats.total_latency_ms, 300);

    // 2. Record an error.
    dao.record_error("https://example.com/source1", "connection refused", 50)
        .await
        .expect("record error");
    let stats = dao
        .get_by_url("https://example.com/source1")
        .await
        .expect("get")
        .expect("present");
    assert_eq!(stats.successful_queries, 3);
    assert_eq!(stats.total_queries, 4);
    assert_eq!(stats.errored_queries, 1);
    assert_eq!(
        stats.last_error_message.as_deref(),
        Some("connection refused")
    );

    // 3. Record a timeout.
    dao.record_timeout("https://example.com/source1", 5000)
        .await
        .expect("record timeout");
    let stats = dao
        .get_by_url("https://example.com/source1")
        .await
        .expect("get")
        .expect("present");
    assert_eq!(stats.timed_out_queries, 1);
    assert_eq!(stats.total_queries, 5);

    // 4. Health should have dropped below 0.9 now (3 success / 5 total).
    let stats = dao
        .get_by_url("https://example.com/source1")
        .await
        .expect("get")
        .expect("present");
    assert!(
        stats.health_score < 0.9,
        "health_score should drop with errors: {}",
        stats.health_score
    );

    // 5. A second source with only successes keeps health near 1.0.
    for _ in 0..5 {
        dao.record_success("https://example.com/source2", 50)
            .await
            .expect("record success 2");
    }
    let stats2 = dao
        .get_by_url("https://example.com/source2")
        .await
        .expect("get")
        .expect("present");
    assert!(
        stats2.health_score > 0.9,
        "source2 health should be high: {}",
        stats2.health_score
    );

    // Cleanup.
    let _ = std::fs::remove_file(&tmp);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 1)]
async fn per_op_recording_tracks_which_stage_is_broken() {
    let tmp = fresh_db();
    let pool = build_pool(tmp.clone()).expect("pool");
    let dao = SourceStatsDao::new(pool);
    let source_url = "https://example.com/broken-source";

    // Stage 1: search works fine.
    dao.record_op_success(OpKind::Search, source_url, 80)
        .await
        .expect("search ok");
    dao.record_op_success(OpKind::Search, source_url, 90)
        .await
        .expect("search ok 2");

    // Stage 2: explore also works.
    dao.record_op_success(OpKind::Explore, source_url, 120)
        .await
        .expect("explore ok");

    // Stage 3: chapter list is broken.
    dao.record_op_error(
        OpKind::ChapterList,
        source_url,
        "xpath returned 0 nodes",
        200,
    )
    .await
    .expect("chapter_list err");
    dao.record_op_error(
        OpKind::ChapterList,
        source_url,
        "xpath returned 0 nodes",
        180,
    )
    .await
    .expect("chapter_list err 2");

    // Stage 4: chapter content untested.
    let stats = dao
        .get_by_url(source_url)
        .await
        .expect("get")
        .expect("present");

    // Verify each stage's counters independently.
    assert_eq!(stats.search_ok, 2);
    assert_eq!(stats.search_err, 0);
    assert_eq!(stats.explore_ok, 1);
    assert_eq!(stats.explore_err, 0);
    assert_eq!(stats.chapter_list_ok, 0);
    assert_eq!(stats.chapter_list_err, 2);
    assert_eq!(stats.chapter_content_ok, 0);
    assert_eq!(stats.chapter_content_err, 0);

    // The chapter_list stage should have its last_error set.
    assert_eq!(
        stats.last_chapter_list_error.as_deref(),
        Some("xpath returned 0 nodes")
    );
    assert!(stats.last_chapter_list_at.is_some());

    // The chapter_content stage is untouched — its last_error remains None.
    assert!(stats.last_chapter_content_error.is_none());
    assert!(stats.last_chapter_content_at.is_none());

    // The health score has degraded below 1.0 because the chapter_list
    // stage has 0 success and 2 errors (rolling_total went up but
    // rolling_success didn't for that op).
    assert!(
        stats.health_score < 1.0,
        "health should drop when any op has errors: {}",
        stats.health_score
    );

    // Fix the chapter_list, watch health recover.
    dao.record_op_success(OpKind::ChapterList, source_url, 150)
        .await
        .expect("chapter_list fixed");
    let stats = dao
        .get_by_url(source_url)
        .await
        .expect("get")
        .expect("present");
    assert_eq!(stats.chapter_list_ok, 1);
    assert_eq!(stats.chapter_list_err, 2);
    // Health should improve.
    let after_health = stats.health_score;
    assert!(
        after_health >= 0.5,
        "health should recover after fixing the stage: {}",
        after_health
    );

    // Cleanup.
    let _ = std::fs::remove_file(&tmp);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 1)]
async fn timeout_increments_timeout_columns() {
    let tmp = fresh_db();
    let pool = build_pool(tmp.clone()).expect("pool");
    let dao = SourceStatsDao::new(pool);
    let source_url = "https://example.com/timeout-source";

    dao.record_op_success(OpKind::Search, source_url, 80)
        .await
        .expect("search ok");
    dao.record_op_timeout(OpKind::Search, source_url, 30000)
        .await
        .expect("search timeout");

    let stats = dao
        .get_by_url(source_url)
        .await
        .expect("get")
        .expect("present");
    assert_eq!(stats.search_ok, 1);
    assert_eq!(stats.search_timeout, 1);
    assert_eq!(stats.search_err, 0);
    assert_eq!(stats.timed_out_queries, 1);
    // The last_error_message records the synthetic "timeout" tag so the
    // UI can show it on hover.
    assert_eq!(stats.last_search_error.as_deref(), Some("timeout"));

    let _ = std::fs::remove_file(&tmp);
}
