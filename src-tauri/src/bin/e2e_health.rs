//! End-to-end health-recording test that drives each stage of a
//! book-source pipeline (search → explore → chapter list → chapter
//! content) through the real `AnalyzeUrl` HTTP path and the real
//! `SourceStatsDao` recording path, and prints the resulting
//! per-operation counters so we can confirm:
//!
//! 1. The "search broken" stage shows search_err > 0, others = 0
//! 2. The "chapter list broken" stage shows chapter_list_err > 0
//! 3. The "chapter content broken" stage shows chapter_content_err > 0
//! 4. The "all stages broken" case (unreachable host) shows everything
//!    failing

use legado_desktop_lib::book_source::analyze_url::AnalyzeUrl;
use legado_desktop_lib::book_source::js_extensions::JsExtState;
use legado_desktop_lib::db::{build_pool, OpKind, SourceStatsDao};
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

static COUNTER: AtomicU64 = AtomicU64::new(0);

fn fresh_db() -> PathBuf {
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let tmp = std::env::temp_dir().join(format!(
        "legado_e2e_stages_{}_{}_{}.db",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis(),
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

fn rt() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
}

fn run(dao: &SourceStatsDao, op: OpKind, src: &str, url: &str) {
    let started = Instant::now();
    let res = AnalyzeUrl::new(url, None, None, None, JsExtState::global()).get_str_response();
    let elapsed = started.elapsed().as_millis() as u64;
    let r = rt();
    r.block_on(async {
        match res {
            Ok(body) => {
                println!("  ok ({} chars, {} ms)", body.len(), elapsed);
                let _ = dao.record_op_success(op, src, elapsed).await;
            }
            Err(e) => {
                let msg = e.to_string();
                let is_timeout = msg.contains("timed out") || msg.contains("timeout");
                println!("  err: {} ({} ms)", msg, elapsed);
                if is_timeout {
                    let _ = dao.record_op_timeout(op, src, elapsed).await;
                } else {
                    let _ = dao.record_op_error(op, src, &msg, elapsed).await;
                }
            }
        }
    });
}

fn print_state(dao: &SourceStatsDao, src: &str) {
    let r = rt();
    if let Ok(Some(s)) = r.block_on(async { dao.get_by_url(src).await }) {
        let row = format!(
            "health={:.3}  search={}ok/{}err  explore={}ok/{}err  chapterList={}ok/{}err  chapterContent={}ok/{}err",
            s.health_score,
            s.search_ok, s.search_err,
            s.explore_ok, s.explore_err,
            s.chapter_list_ok, s.chapter_list_err,
            s.chapter_content_ok, s.chapter_content_err,
        );
        println!("  {row}");
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let tmp = fresh_db();
    let pool = build_pool(tmp.clone()).expect("pool");
    let dao = SourceStatsDao::new(pool);

    let biqusa = "https://www.biqusa.com/#";
    let bad_host = "https://nonexistent-host-zzz.invalid/";
    let biqusa_book = "https://www.biqusa.com/45_45541/";
    let biqusa_chapter = "https://www.biqusa.com/45_45541/42296888.html";

    println!("╔══════════════════════════════════════════════════════════════╗");
    println!("║  End-to-end source health: 5 scenarios, 4 stages each      ║");
    println!("╚══════════════════════════════════════════════════════════════╝\n");

    // Scenario 1: everything works (biqusa).
    println!("Scenario 1: biqusa is fully reachable (all stages ok)");
    println!("  search        →"); run(&dao, OpKind::Search, biqusa, biqusa_book);
    println!("  explore       →"); run(&dao, OpKind::Explore, biqusa, biqusa_book);
    println!("  chapter list  →"); run(&dao, OpKind::ChapterList, biqusa, biqusa_book);
    println!("  chapter body  →"); run(&dao, OpKind::ChapterContent, biqusa, biqusa_chapter);
    print!("  → state: "); print_state(&dao, biqusa);

    // Scenario 2: web unreachable (everything fails).
    println!("\nScenario 2: web host unreachable (all stages err)");
    println!("  search        →"); run(&dao, OpKind::Search, bad_host, bad_host);
    println!("  explore       →"); run(&dao, OpKind::Explore, bad_host, bad_host);
    println!("  chapter list  →"); run(&dao, OpKind::ChapterList, bad_host, bad_host);
    println!("  chapter body  →"); run(&dao, OpKind::ChapterContent, bad_host, bad_host);
    print!("  → state: "); print_state(&dao, bad_host);

    // Scenario 3: a source where search works but chapter list is broken
    // (simulated by hitting a page that has 0 chapter-list elements).
    println!("\nScenario 3: search ok, chapter list shows 0 results");
    println!("  search        →"); run(&dao, OpKind::Search, biqusa, "https://www.biqusa.com/");
    println!("  chapter list  → ERR (simulated: empty list)");
    let r = rt();
    r.block_on(async {
        let _ = dao
            .record_op_error(
                OpKind::ChapterList,
                biqusa,
                "0 chapters extracted from id.list@tag.dd@a",
                100,
            )
            .await;
    });
    print!("  → state: "); print_state(&dao, biqusa);

    // Scenario 4: search ok, chapter list ok, chapter content broken
    // (e.g. the rule returns empty after the dedup/strip).
    println!("\nScenario 4: search ok, chapter list ok, chapter content broken");
    println!("  chapter content → ERR (simulated: rule extracted 0 chars)");
    r.block_on(async {
        let _ = dao
            .record_op_error(
                OpKind::ChapterContent,
                biqusa,
                "0 chars extracted from id.content@text",
                250,
            )
            .await;
    });
    print!("  → state: "); print_state(&dao, biqusa);

    println!("\n╔══════════════════════════════════════════════════════════════╗");
    println!("║  Summary                                                      ║");
    println!("╚══════════════════════════════════════════════════════════════╝");
    println!("biqusa (real)   :"); print_state(&dao, biqusa);
    println!("bad_host (fake) :"); print_state(&dao, bad_host);

    let _ = std::fs::remove_file(&tmp);
    Ok(())
}
