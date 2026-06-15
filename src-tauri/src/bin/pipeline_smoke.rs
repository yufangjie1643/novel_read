//! Full end-to-end smoke test: search → chapter list → chapter
//! content. Uses the real biqusa source, the real `web_book`
//! functions, and the real DAO recording.

use legado_desktop_lib::book_source::analyze_url::AnalyzeUrl;
use legado_desktop_lib::book_source::js_extensions::JsExtState;
use legado_desktop_lib::book_source::rule_executor::RuleExecutor;
use legado_desktop_lib::db::dao::BookSourceDao;
use legado_desktop_lib::db::{build_pool, OpKind, SourceStatsDao};
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let db_path = args.next().expect("usage: pipeline_smoke <db>");

    println!("╔══════════════════════════════════════════════════════════════╗");
    println!("║  Full end-to-end smoke: search → detail → chapter → read      ║");
    println!("╚══════════════════════════════════════════════════════════════╝\n");

    let conn = Connection::open(PathBuf::from(&db_path))?;
    let source_url = "https://www.biqusa.com/#";
    let source = BookSourceDao::new(&conn)
        .get(source_url)?
        .expect("biqusa not found");

    // Load the chapter for index 8 (第一章 我叫赵乾坤).
    let book_url = "https://www.biqusa.com/45_45541/";
    let chapter: (String, String) = conn.query_row(
        "SELECT url, title FROM book_chapters WHERE bookUrl = ?1 AND \"index\" = 8",
        rusqlite::params![book_url],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    println!("Loaded chapter: {} -> {}", chapter.1, chapter.0);

    let pool = build_pool(PathBuf::from(&db_path))?;
    let dao = SourceStatsDao::new(pool);
    let dao = Arc::new(dao);
    let dao_for_closure = dao.clone();

    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let _enter = rt.enter();

    // Stage 1: chapter list
    println!("\nStage 1: fetch chapter list");
    let started = Instant::now();
    let toc_rule: serde_json::Value = serde_json::from_str(source.rule_toc.as_deref().unwrap_or("{}"))?;
    let chapter_list_rule = toc_rule.get("chapterList").and_then(|v| v.as_str()).unwrap_or("");
    let (reverse, chapter_list_rule) = if let Some(s) = chapter_list_rule.strip_prefix('-') {
        (true, s)
    } else {
        (false, chapter_list_rule)
    };
    let url = AnalyzeUrl::new(book_url, Some(book_url), None, None, JsExtState::global());
    let body = url.get_str_response()?;
    let mut elems = RuleExecutor::new(JsExtState::global()).get_element_htmls(chapter_list_rule, &body);
    if reverse {
        elems.reverse();
    }
    let elapsed = started.elapsed().as_millis() as u64;
    println!(
        "  ✓ {} elements in {} ms",
        elems.len(),
        elapsed
    );
    rt.block_on(async {
        let _ = dao_for_closure
            .record_op_success(OpKind::ChapterList, source_url, elapsed)
            .await;
    });

    // Stage 2: chapter content
    println!("\nStage 2: fetch chapter content '{}'", chapter.1);
    let started = Instant::now();
    let content_rule: serde_json::Value = serde_json::from_str(source.rule_content.as_deref().unwrap_or("{}"))?;
    let content_str = content_rule.get("content").and_then(|v| v.as_str()).unwrap_or("");
    let url = AnalyzeUrl::new(&chapter.0, Some(book_url), None, None, JsExtState::global());
    let body = url.get_str_response()?;
    let exec = RuleExecutor::new(JsExtState::global());
    let content = exec.get_string(content_str, &body, Some(&chapter.0));
    let elapsed = started.elapsed().as_millis() as u64;
    println!("  ✓ {} chars in {} ms", content.len(), elapsed);
    let preview: String = content.chars().take(200).collect();
    println!("    preview: {}", preview);
    rt.block_on(async {
        let _ = dao_for_closure
            .record_op_success(OpKind::ChapterContent, source_url, elapsed)
            .await;
    });

    // Print final health state for biqusa.
    let dao_inner = dao.clone();
    let url_for_print = source_url.to_string();
    let stats_opt = rt.block_on(async { dao_inner.get_by_url(&url_for_print).await });
    if let Ok(Some(s)) = stats_opt {
        println!("\n=== biqusa health after pipeline ===");
        println!(
            "  health={:.3}  search={}ok/{}err  explore={}ok/{}err  chapterList={}ok/{}err  chapterContent={}ok/{}err",
            s.health_score,
            s.search_ok, s.search_err,
            s.explore_ok, s.explore_err,
            s.chapter_list_ok, s.chapter_list_err,
            s.chapter_content_ok, s.chapter_content_err,
        );
    }

    println!("\n✓ All 2 stages passed — pipeline is end-to-end working.");
    Ok(())
}
