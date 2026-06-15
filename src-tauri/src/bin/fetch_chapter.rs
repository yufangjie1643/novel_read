use legado_desktop_lib::book_source::analyze_url::AnalyzeUrl;
use legado_desktop_lib::book_source::js_extensions::JsExtState;
use legado_desktop_lib::book_source::rule_executor::RuleExecutor;
use legado_desktop_lib::book_source::web_book::ContentRule;
use legado_desktop_lib::db::dao::BookSourceDao;
use rusqlite::Connection;
use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let db_path = args.next().expect("usage: fetch_chapter <db> <book_url> <chapter_index>");
    let book_url = args.next().expect("missing book_url");
    let chapter_index: i32 = args
        .next()
        .expect("missing chapter_index")
        .parse()
        .expect("chapter_index must be int");

    let conn = Connection::open(PathBuf::from(&db_path))?;

    // Look up the book (use raw SELECT to avoid Book struct mismatch).
    let (name, origin, toc_url): (String, String, String) = {
        let mut stmt = conn.prepare("SELECT name, origin, tocUrl FROM books WHERE bookUrl = ?1")?;
        let mut rows = stmt.query(rusqlite::params![book_url])?;
        if let Some(row) = rows.next()? {
            (row.get(0)?, row.get(1)?, row.get(2)?)
        } else {
            panic!("book not found: {}", book_url);
        }
    };
    println!("book.name = {}", name);
    println!("book.toc_url = {}", toc_url);
    println!("book.origin = {}", origin);

    let source = BookSourceDao::new(&conn).get(&origin)?
        .expect("source not found");
    println!("source.book_source_name = {}", source.book_source_name);
    println!("source.rule_content = {}", source.rule_content.as_deref().unwrap_or(""));
    println!();

    // Look up the chapter.
    let (chapter_url, chapter_title): (String, String) = {
        let mut stmt = conn.prepare("SELECT url, title FROM book_chapters WHERE bookUrl = ?1 AND \"index\" = ?2")?;
        let mut rows = stmt.query(rusqlite::params![book_url, chapter_index])?;
        if let Some(row) = rows.next()? {
            (row.get(0)?, row.get(1)?)
        } else {
            panic!("chapter {} not found", chapter_index);
        }
    };
    println!("chapter.index = {}", chapter_index);
    println!("chapter.title = {}", chapter_title);
    println!("chapter.url = {}", chapter_url);
    println!();

    // Fetch the chapter page.
    let state = JsExtState::global();
    let url = AnalyzeUrl::new(&chapter_url, Some(&toc_url), None, None, state);
    let body = url.get_str_response()?;
    println!("body length = {}", body.len());
    // Write body to a file for inspection.
    let body_dump = "C:/Users/pc/AppData/Local/Temp/opencode/body_dump.html";
    std::fs::write(body_dump, &body).expect("write body");
    println!("body written to: {}", body_dump);
    println!("body first 300 chars:");
    println!("{}", body.chars().take(300).collect::<String>());
    println!();

    // Also re-fetch with reqwest directly and save the raw bytes
    // (no decode) to compare against what `get_str_response` saw.
    use reqwest::blocking::Client as BClient;
    let client2 = BClient::new();
    let resp2 = client2.get(&chapter_url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
        .send()
        .expect("raw fetch");
    let headers2 = resp2.headers().clone();
    let raw = resp2.bytes().expect("bytes");
    let raw_dump = "C:/Users/pc/AppData/Local/Temp/opencode/raw_dump.html";
    std::fs::write(raw_dump, &raw).expect("write raw");
    println!("raw bytes written to: {} ({} bytes)", raw_dump, raw.len());
    println!("raw Content-Type: {:?}", headers2.get("content-type").map(|v| v.to_str().unwrap_or("?")));

    // Inspect the actual bytes the server sent.
    use reqwest::blocking::Client;
    let client = Client::new();
    let resp = client.get(&chapter_url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
        .send()
        .expect("raw fetch");
    let headers = resp.headers().clone();
    let raw = resp.bytes().expect("bytes");
    println!("raw byte length = {}", raw.len());
    println!("raw first 30 bytes: {:?}", &raw[..30]);
    // Find the title region.
    if let Some(pos) = raw.windows(7).position(|w| w == b"<title>") {
        let end = raw[pos..].windows(8).position(|w| w == b"</title>").unwrap_or(50);
        println!("title region bytes (pos {}):", pos);
        println!("  {:?}", &raw[pos..pos + end + 8]);
    }
    println!("Content-Type header: {:?}", headers.get("content-type").map(|v| v.to_str().unwrap_or("?")));
    println!("Content-Encoding header: {:?}", headers.get("content-encoding").map(|v| v.to_str().unwrap_or("?")));
    let (utf8_decoded, _, had_errors_utf8) = encoding_rs::UTF_8.decode(&raw);
    println!("UTF-8 decode had_errors: {}, contains \\u{{FFFD}}: {}",
        had_errors_utf8,
        utf8_decoded.contains('\u{FFFD}'));
    let (gbk_decoded, _, had_unmappable_gbk) = encoding_rs::GBK.decode(&raw);
    println!("GBK decode had_unmappable: {}, contains 金刚骷髅: {}",
        had_unmappable_gbk,
        gbk_decoded.contains("金刚骷髅"));
    let (gbk_decoded_truncated, _, _) = encoding_rs::GBK.decode(&raw[..1000]);
    println!("GBK first 200 chars:");
    println!("{}", gbk_decoded_truncated.chars().take(200).collect::<String>());
    println!();

    // Apply content rule.
    let content_rule: ContentRule = serde_json::from_str(source.rule_content.as_deref().unwrap_or("{}"))?;
    let content_str = content_rule.content.as_deref().unwrap_or("");
    let exec = RuleExecutor::new(JsExtState::global());
    let content = exec.get_string(content_str, &body, Some(&chapter_url));
    println!("content rule: {}", content_str);
    println!("extracted content length = {}", content.len());
    println!("extracted content first 200 chars:");
    println!("{}", content.chars().take(200).collect::<String>());

    // Try the rule with @text (just text) instead of @textNodes.
    let alt_rule = content_str.replace("@textNodes", "@text");
    let alt_content = exec.get_string(&alt_rule, &body, Some(&chapter_url));
    println!("alt rule: {}", alt_rule);
    println!("alt extracted content length = {}", alt_content.len());
    println!("alt extracted content first 200 chars:");
    println!("{}", alt_content.chars().take(200).collect::<String>());

    Ok(())
}
