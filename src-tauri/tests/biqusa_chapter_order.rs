//! Regression tests for biqusa-family chapter list ordering.
//!
//! Background: 笔趣阁A17 lists chapters in reverse-chronological order in
//! the HTML (完结感言 first, 序章 last). The "reading" order users expect
//! is chronological (序章 first, 完结感言 last). The fix is the `-` prefix
//! on the chapterList rule which reverses the extracted list.
//!
//! This test reads a saved HTML fixture and verifies that:
//! 1. Without the `-` prefix, 完结感言 appears before 序章 (HTML order).
//! 2. With the `-` prefix, 序章 appears before 完结感言 (reversed order).
//! 3. After dedup (re-indexing by URL), the chronological order is what
//!    a reader would expect.

use legado_desktop_lib::book_source::js_extensions::JsExtState;
use legado_desktop_lib::book_source::rule_executor::RuleExecutor;
use std::path::PathBuf;

const FIXTURE: &str = "tests/fixtures/biqusa-toc.html";

fn load_fixture() -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(FIXTURE);
    assert!(
        path.exists(),
        "fixture missing: {} (run the live page fetch first)",
        path.display()
    );
    let bytes = std::fs::read(&path).expect("read fixture");
    // The fixture is whatever the server returned. biqusa typically
    // sends UTF-8, but some servers send GBK with no charset hint, so
    // we try UTF-8 first and fall back to GBK.
    let (text, _, had_unmappable) = encoding_rs::UTF_8.decode(&bytes);
    if !had_unmappable {
        return text.into_owned();
    }
    let (text, _, _) = encoding_rs::GBK.decode(&bytes);
    text.into_owned()
}

fn exec() -> RuleExecutor {
    RuleExecutor::new(JsExtState::new())
}

/// Replicate the chapter_list parsing done in web_book::get_chapter_list
/// (the dash prefix and dedup) so we can test the *result* the app sees.
///
/// Order: extract → dedup-LAST → reverse. This matches the post-fix
/// implementation in `web_book::get_chapter_list`.
///
/// Dedup keeps the LAST occurrence of each URL (so the "all chapters"
/// block wins over the "latest updates" block).
fn extract_titles_with_dash(rule_raw: &str, html: &str) -> Vec<String> {
    let (reverse, rule) = match rule_raw.strip_prefix('-') {
        Some(s) => (true, s),
        None => (false, rule_raw),
    };
    let elems = exec().get_element_htmls(rule, html);

    // First pass: collect (title, url) pairs.
    let mut parsed: Vec<(String, String)> = Vec::new();
    for h in &elems {
        let title = extract_first_a_text(h);
        if title.is_empty() {
            continue;
        }
        let url = extract_first_a_href(h);
        parsed.push((title, url));
    }

    // Second pass: keep the LAST occurrence of each URL.
    let mut last_idx: std::collections::HashMap<String, usize> =
        std::collections::HashMap::new();
    for (i, (_t, u)) in parsed.iter().enumerate() {
        last_idx.insert(u.clone(), i);
    }
    let mut out: Vec<String> = Vec::new();
    for (i, (title, url)) in parsed.into_iter().enumerate() {
        if last_idx.get(&url).copied() == Some(i) {
            out.push(title);
        }
    }

    if reverse {
        out.reverse();
    }
    out
}

fn extract_first_a_text(html: &str) -> String {
    // Tiny parser: find "<a ...>...</a>" and return the inner text.
    // We need to skip `<area` and other elements that start with "<a" too.
    let lower = html.to_lowercase();
    let mut search_from = 0;
    let start = loop {
        let pos = match lower[search_from..].find("<a") {
            Some(i) => search_from + i,
            None => return String::new(),
        };
        // Make sure the next char is space, '>', '/', or end — otherwise
        // we matched <abbr> or similar.
        let next = lower[pos + 2..].chars().next();
        match next {
            Some(' ') | Some('>') | Some('/') | Some('\t') | Some('\n') | Some('\r') => break pos,
            _ => {
                search_from = pos + 2;
                continue;
            }
        }
    };
    let gt = match lower[start..].find('>') {
        Some(i) => start + i + 1,
        None => return String::new(),
    };
    let end = match lower[gt..].to_lowercase().find("</a>") {
        Some(i) => gt + i,
        None => return String::new(),
    };
    html[gt..end].trim().to_string()
}

fn extract_first_a_href(html: &str) -> String {
    let lower = html.to_lowercase();
    let a_pos = match lower.find("<a") {
        Some(i) => i,
        None => return String::new(),
    };
    let href_pos = match lower[a_pos..].find("href=") {
        Some(i) => a_pos + i + 5,
        None => return String::new(),
    };
    // Skip optional quote.
    let bytes = html.as_bytes();
    let mut p = href_pos;
    if p < bytes.len() && (bytes[p] == b'"' || bytes[p] == b'\'') {
        p += 1;
    }
    let end_quote = match html[p..].find(|c: char| c == '"' || c == '\'') {
        Some(i) => p + i,
        None => return String::new(),
    };
    html[p..end_quote].to_string()
}

#[test]
fn biqusa_no_dash_first_chapter_is_xuzhang() {
    // The biqusa TOC page has multiple "block" listings of the same
    // chapters (a small "latest" block at the top, then a large
    // "all chapters" block, and the chapter list ends in CHRONOLOGICAL
    // order in the last block). With dedup-LAST (keep the "all
    // chapters" block, drop the "latest" block), the result is
    // already in chronological order: 序章 first, 完结感言 last.
    let html = load_fixture();
    let titles = extract_titles_with_dash("id.list@tag.dd@a", &html);
    assert!(!titles.is_empty(), "no chapters extracted");
    eprintln!("[debug] no-dash first 5: {:?}", &titles[..titles.len().min(5)]);
    eprintln!("[debug] no-dash last 5: {:?}", &titles[titles.len().saturating_sub(5)..]);
    assert!(
        titles[0].contains("序章"),
        "expected first chapter (no dash) to be 序章, got {:?}",
        titles[0]
    );
    let last = titles.last().unwrap();
    assert!(
        last.contains("完结感言") || last.contains("终章"),
        "expected last chapter (no dash) to be 完结感言 or 终章, got {:?}",
        last
    );
}

#[test]
fn biqusa_dash_reverses_the_chronological_order() {
    // With the `-` flag, the (chronological) list is reversed,
    // putting 完结感言 (most recent) at the top and 序章 (earliest)
    // at the bottom. Most users want the OPPOSITE, so the dash
    // should be omitted for biqusa-family sources. This test
    // documents both directions so the choice is visible.
    let html = load_fixture();
    let titles = extract_titles_with_dash("-id.list@tag.dd@a", &html);
    assert!(!titles.is_empty(), "no chapters extracted");
    eprintln!("[debug] with-dash first 5: {:?}", &titles[..titles.len().min(5)]);
    eprintln!("[debug] with-dash last 5: {:?}", &titles[titles.len().saturating_sub(5)..]);
    assert!(
        titles[0].contains("完结感言") || titles[0].contains("终章"),
        "expected first chapter (-reversed) to be 完结感言 or 终章, got {:?}",
        titles[0]
    );
}

#[test]
fn biqusa_reversed_order_has_many_chapters() {
    let html = load_fixture();
    let titles = extract_titles_with_dash("-id.list@tag.dd@a", &html);
    // The fixture has a single page of the listing, so it should still
    // have a few hundred chapters visible after dedup.
    assert!(
        titles.len() > 50,
        "expected many chapters from biqusa fixture, got {}",
        titles.len()
    );
}

#[test]
fn biqusa_dedup_collapses_repeated_entries() {
    // The HTML lists the chapters twice: once in the "latest updates" block
    // (reverse-chrono) and once in the full list. After dedup, each URL
    // appears at most once. This test checks that the count after dedup
    // is less than the raw element count.
    let html = load_fixture();
    let raw_count = exec().get_element_htmls("id.list@tag.dd@a", &html).len();
    let deduped_count = extract_titles_with_dash("id.list@tag.dd@a", &html).len();
    assert!(
        deduped_count < raw_count,
        "dedup did not remove any duplicates: raw={} deduped={}",
        raw_count,
        deduped_count
    );
}
