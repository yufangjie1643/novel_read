use legado_desktop_lib::book_source::analyze_url::AnalyzeUrl;
use legado_desktop_lib::book_source::js_extensions::JsExtState;
use legado_desktop_lib::book_source::rule_executor::RuleExecutor;
use legado_desktop_lib::book_source::web_book::{ContentRule, TocRule, WebBook};
use rusqlite::Connection;
use std::path::PathBuf;
use std::time::Instant;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let db_path = args.next().expect("usage: e2e_smoke <db> <source_url> <book_url> <chapter_url>");
    let source_url = args.next().expect("missing source_url");
    let book_url = args.next().expect("missing book_url");
    let chapter_url = args.next().expect("missing chapter_url");

    let conn = Connection::open(PathBuf::from(&db_path))?;

    // 1. Load the source
    let (name, rule_toc_json, rule_content_json): (String, Option<String>, Option<String>) =
        conn.query_row(
            "SELECT bookSourceName, ruleToc, ruleContent
             FROM book_sources WHERE bookSourceUrl = ?1",
            rusqlite::params![source_url],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )?;
    let toc_url: Option<String> = None; // not stored on source row, passed as book.toc_url
    let rule_toc_json = rule_toc_json.ok_or("missing ruleToc")?;
    println!("=== Source: {} ===", name);

    let toc_rule: TocRule = serde_json::from_str(&rule_toc_json)?;
    let chapter_list_rule = toc_rule.chapter_list.as_deref().unwrap_or("");
    let (reverse, chapter_list_rule) = if let Some(s) = chapter_list_rule.strip_prefix('-') {
        (true, s)
    } else {
        (false, chapter_list_rule)
    };
    println!("chapterList rule: {} (reverse={})", chapter_list_rule, reverse);

    // 2. Fetch chapter list
    println!("\n=== Stage 1: chapter list ===");
    let state = JsExtState::global();
    let url = AnalyzeUrl::new(&book_url, toc_url.as_deref(), None, None, state);
    let started = Instant::now();
    let body = url.get_str_response()?;
    let elapsed = started.elapsed().as_millis();
    println!("fetched body: {} chars in {} ms", body.len(), elapsed);

    let mut elems = RuleExecutor::new(JsExtState::global()).get_element_htmls(chapter_list_rule, &body);
    if reverse {
        elems.reverse();
    }
    println!("found {} chapter elements", elems.len());

    // 3. Fetch chapter content
    println!("\n=== Stage 2: chapter content ===");
    let rule_content: ContentRule = serde_json::from_str(rule_content_json.as_deref().unwrap_or("{}"))?;
    let content_str = rule_content.content.as_deref().unwrap_or("");
    println!("content rule: {}", content_str);

    let url = AnalyzeUrl::new(&chapter_url, Some(&book_url), None, None, JsExtState::global());
    let started = Instant::now();
    let body = url.get_str_response()?;
    let elapsed = started.elapsed().as_millis();
    println!("fetched body: {} chars in {} ms", body.len(), elapsed);

    let exec = RuleExecutor::new(JsExtState::global());
    let content = exec.get_string(content_str, &body, Some(&chapter_url));
    println!("extracted content: {} chars", content.len());
    println!("first 100 chars: {}", content.chars().take(100).collect::<String>());

    Ok(())
}
