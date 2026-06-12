use crate::book_source::{
    analyze_url::AnalyzeUrl,
    js_extensions::JsExtState,
    source_loader::{load_source_from_url, parse_source_json},
    web_book::WebBook,
};
use crate::db::{
    app_dir,
    dao::{
        BookChapterDao, BookDao, BookGroupDao, BookSourceDao, BookmarkDao, CacheDao,
        ChapterContentDao, CookieDao, DictRuleDao, HttpTTSDao, KeyboardAssistDao, ReadRecordDao,
        ReplaceRuleDao, RssArticleDao, RssReadRecordDao, RssSourceDao, RssStarDao, RuleSubDao,
        SearchKeywordDao, ServerDao, TxtTocRuleDao,
    },
    models::{
        Book, BookChapter, BookGroup, BookSource, Bookmark, DictRule, ExploreItemsPage,
        ExploreKind, HttpTTS, KeyboardAssist, ReadRecord, ReplaceRule, RssArticle, RssReadRecord,
        RssSource, RssStar, RuleSub, SearchBook, SearchKeyword, Server, SourceLink, TxtTocRule,
    },
};
use crate::local_book::{import_epub_content, import_txt_bytes};
use crate::server;
use crate::state::AppState;
use crate::webdav::WebDavClient;
use rusqlite::params;
use serde::Serialize;
use std::io::{Cursor, Read};
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::Manager;

#[derive(Serialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

/// Run a synchronous DB closure on a pooled connection off the Tauri IPC
/// runtime thread. The closure runs inside `deadpool_sqlite::Object::interact`,
/// which itself spawns a worker thread; the outer future is `async` so
/// the Tauri runtime is never blocked.
///
/// Takes `AppHandle` (owned) rather than `State<'_, AppState>` because Tauri
/// v2 requires async commands with reference parameters to return
/// `Result<T, E>`; an owned `AppHandle` keeps the signature reference-free.
///
/// Returns an `ApiResponse<T>` with the closure's `Result<T, rusqlite::Error>`.
/// `Err` is set for pool exhaustion, interact failure, or DB errors.
async fn db_op<F, T>(app_handle: tauri::AppHandle, f: F) -> ApiResponse<T>
where
    F: FnOnce(&mut rusqlite::Connection) -> Result<T, rusqlite::Error> + Send + 'static,
    T: Send + 'static,
{
    let pool = app_handle.state::<AppState>().db.clone();
    drop(app_handle);
    let result: Result<Result<T, rusqlite::Error>, String> = async {
        let obj = pool.get().await.map_err(|e| format!("pool: {}", e))?;
        obj.interact(f).await.map_err(|e| format!("interact: {}", e))
    }
    .await;
    match result {
        Ok(Ok(v)) => ApiResponse {
            success: true,
            data: Some(v),
            error: None,
        },
        Ok(Err(e)) => ApiResponse {
            success: false,
            data: None,
            error: Some(format!("db: {}", e)),
        },
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(e),
        },
    }
}

#[derive(Serialize)]
pub struct ManagedFile {
    pub name: String,
    pub relative_path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<u64>,
}

#[derive(Serialize)]
pub struct ManagedFileList {
    pub current_path: String,
    pub parent_path: Option<String>,
    pub files: Vec<ManagedFile>,
}

fn ok<T>(data: T) -> ApiResponse<T> {
    ApiResponse {
        success: true,
        data: Some(data),
        error: None,
    }
}

fn err<T>(message: impl Into<String>) -> ApiResponse<T> {
    ApiResponse {
        success: false,
        data: None,
        error: Some(message.into()),
    }
}

// ============================================================================
// Book Commands
// ============================================================================

#[tauri::command]
pub async fn get_books(app_handle: tauri::AppHandle) -> ApiResponse<Vec<Book>> {
    db_op(app_handle, |conn| BookDao::new(conn).get_all()).await
}

#[tauri::command]
pub async fn add_book(
    app_handle: tauri::AppHandle,
    book: Book,
) -> ApiResponse<()> {
    db_op(app_handle, move |conn| {
        BookDao::new(conn).insert(&book).map(|_| ())
    })
    .await
}

#[tauri::command]
pub async fn update_book(
    app_handle: tauri::AppHandle,
    book: Book,
) -> ApiResponse<()> {
    db_op(app_handle, move |conn| {
        BookDao::new(conn).update(&book).map(|_| ())
    })
    .await
}

#[tauri::command]
pub async fn delete_book(
    app_handle: tauri::AppHandle,
    book_url: String,
) -> ApiResponse<()> {
    db_op(app_handle, move |conn| {
        BookDao::new(conn).delete(&book_url).map(|_| ())
    })
    .await
}

#[tauri::command]
pub async fn clear_book_cache(
    app_handle: tauri::AppHandle,
    book_url: String,
) -> ApiResponse<()> {
    db_op(app_handle, move |conn| {
        ChapterContentDao::new(conn)
            .delete_by_book(&book_url)
            .map(|_| ())
    })
    .await
}

#[tauri::command]
pub async fn migrate_book_source(
    app_handle: tauri::AppHandle,
    old_book_url: String,
    mut book: Book,
    mut chapters: Vec<BookChapter>,
) -> ApiResponse<()> {
    // Pre-process the data outside the closure (no borrow into the txn).
    for chapter in &mut chapters {
        chapter.book_url = book.book_url.clone();
    }
    book.total_chapter_num = chapters.len() as i32;
    if book.dur_chapter_index < 0 || book.dur_chapter_index as usize >= chapters.len() {
        book.dur_chapter_index = 0;
    }
    if let Some(chapter) = chapters.get(book.dur_chapter_index as usize) {
        book.dur_chapter_title = Some(chapter.title.clone());
    }

    db_op(
        app_handle,
        move |conn| -> rusqlite::Result<()> {
            let tx = conn.transaction()?;
            tx.execute(
                "DELETE FROM book_chapters WHERE bookUrl = ?1",
                params![old_book_url],
            )?;
            tx.execute(
                "DELETE FROM chapter_contents WHERE bookUrl = ?1",
                params![old_book_url],
            )?;
            tx.execute(
                "UPDATE bookmarks SET bookUrl = ?1 WHERE bookUrl = ?2",
                params![book.book_url, old_book_url],
            )?;
            if old_book_url != book.book_url {
                tx.execute(
                    "DELETE FROM books WHERE bookUrl = ?1",
                    params![book.book_url],
                )?;
            }
            tx.execute(
                "DELETE FROM books WHERE bookUrl = ?1",
                params![old_book_url],
            )?;

            BookDao::new(&tx).insert_conn(&tx, &book)?;
            BookChapterDao::new(&tx).insert_many_conn(&tx, &chapters)?;
            tx.commit()?;
            Ok(())
        },
    )
    .await
}

// ============================================================================
// BookSource Commands
// ============================================================================

#[tauri::command]
pub async fn get_book_sources(app_handle: tauri::AppHandle) -> ApiResponse<Vec<BookSource>> {
    db_op(app_handle, |conn| BookSourceDao::new(conn).get_all()).await
}

#[tauri::command]
pub async fn get_enabled_book_sources(
    app_handle: tauri::AppHandle,
) -> ApiResponse<Vec<BookSource>> {
    db_op(app_handle, |conn| BookSourceDao::new(conn).get_enabled()).await
}

#[tauri::command]
pub async fn get_explore_book_sources(
    app_handle: tauri::AppHandle,
) -> ApiResponse<Vec<BookSource>> {
    db_op(app_handle, |conn| BookSourceDao::new(conn).get_explore_enabled()).await
}

#[tauri::command]
pub async fn get_explore_items(
    app_handle: tauri::AppHandle,
    offset: Option<usize>,
    limit: Option<usize>,
    filter: Option<String>,
) -> ApiResponse<ExploreItemsPage> {
    let limit = limit.unwrap_or(80).clamp(1, 300);
    db_op(app_handle, move |conn| {
        BookSourceDao::new(conn).get_explore_items(
            offset.unwrap_or(0),
            limit,
            filter.as_deref(),
        )
    })
    .await
}

#[tauri::command]
pub async fn get_book_source(
    app_handle: tauri::AppHandle,
    url: String,
) -> ApiResponse<Option<BookSource>> {
    db_op(app_handle, move |conn| BookSourceDao::new(conn).get(&url)).await
}

#[tauri::command]
pub async fn add_book_source(
    app_handle: tauri::AppHandle,
    source: BookSource,
) -> ApiResponse<()> {
    db_op(app_handle, move |conn| {
        BookSourceDao::new(conn).insert(&source).map(|_| ())
    })
    .await
}

#[tauri::command]
pub async fn update_book_source(
    app_handle: tauri::AppHandle,
    source: BookSource,
) -> ApiResponse<()> {
    db_op(app_handle, move |conn| {
        BookSourceDao::new(conn).update(&source).map(|_| ())
    })
    .await
}

#[tauri::command]
pub async fn delete_book_source(
    app_handle: tauri::AppHandle,
    url: String,
) -> ApiResponse<()> {
    db_op(app_handle, move |conn| {
        BookSourceDao::new(conn).delete(&url).map(|_| ())
    })
    .await
}

#[tauri::command]
pub async fn top_book_source(
    app_handle: tauri::AppHandle,
    url: String,
) -> ApiResponse<()> {
    db_op(app_handle, move |conn| {
        let dao = BookSourceDao::new(conn);
        let min = dao.min_order()?;
        dao.update_order(&url, min - 1)?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn get_book_source_groups(
    app_handle: tauri::AppHandle,
) -> ApiResponse<Vec<String>> {
    db_op(app_handle, |conn| {
        let mut groups: Vec<String> = BookSourceDao::new(conn)
            .get_explore_enabled()?
            .into_iter()
            .filter_map(|s| s.book_source_group)
            .flat_map(|g| {
                g.split(",")
                    .map(|s| s.trim().to_string())
                    .collect::<Vec<_>>()
            })
            .filter(|g| !g.is_empty())
            .collect();
        groups.sort();
        groups.dedup();
        Ok(groups)
    })
    .await
}

#[tauri::command]
pub async fn get_explore_kinds(
    app_handle: tauri::AppHandle,
    source_url: String,
) -> ApiResponse<Vec<ExploreKind>> {
    db_op(app_handle, move |conn| {
        BookSourceDao::new(conn).get_explore_kinds(&source_url)
    })
    .await
}

// ============================================================================
// BookChapter Commands
// ============================================================================

#[tauri::command]
pub async fn get_chapters(
    app_handle: tauri::AppHandle,
    book_url: String,
) -> ApiResponse<Vec<BookChapter>> {
    db_op(app_handle, move |conn| {
        BookChapterDao::new(conn).get_chapters(&book_url)
    })
    .await
}

#[tauri::command]
pub async fn add_chapters(
    app_handle: tauri::AppHandle,
    chapters: Vec<BookChapter>,
) -> ApiResponse<()> {
    db_op(app_handle, move |conn| {
        BookChapterDao::new(conn).insert_many(&chapters).map(|_| ())
    })
    .await
}

#[tauri::command]
pub async fn delete_chapters(
    app_handle: tauri::AppHandle,
    book_url: String,
) -> ApiResponse<()> {
    db_op(app_handle, move |conn| {
        BookChapterDao::new(conn).delete_by_book(&book_url).map(|_| ())
    })
    .await
}

// ============================================================================
// BookGroup Commands
// ============================================================================

#[tauri::command]
pub async fn get_book_groups(
    app_handle: tauri::AppHandle,
) -> ApiResponse<Vec<BookGroup>> {
    db_op(app_handle, |conn| BookGroupDao::new(conn).get_all()).await
}

#[tauri::command]
pub async fn add_book_group(
    app_handle: tauri::AppHandle,
    group: BookGroup,
) -> ApiResponse<()> {
    db_op(app_handle, move |conn| {
        BookGroupDao::new(conn).insert(&group).map(|_| ())
    })
    .await
}

#[tauri::command]
pub async fn update_book_group(
    app_handle: tauri::AppHandle,
    group: BookGroup,
) -> ApiResponse<()> {
    db_op(app_handle, move |conn| {
        BookGroupDao::new(conn).update(&group).map(|_| ())
    })
    .await
}

#[tauri::command]
pub async fn delete_book_group(
    app_handle: tauri::AppHandle,
    group_id: i64,
) -> ApiResponse<()> {
    db_op(app_handle, move |conn| {
        BookGroupDao::new(conn).delete(group_id).map(|_| ())
    })
    .await
}

// ============================================================================
// ReplaceRule Commands
// ============================================================================

#[tauri::command]
pub async fn get_replace_rules(
    app_handle: tauri::AppHandle,
) -> ApiResponse<Vec<ReplaceRule>> {
    db_op(app_handle, |conn| ReplaceRuleDao::new(conn).get_all()).await
}

#[tauri::command]
pub async fn add_replace_rule(
    app_handle: tauri::AppHandle,
    rule: ReplaceRule,
) -> ApiResponse<i64> {
    db_op(app_handle, move |conn| {
        ReplaceRuleDao::new(conn).insert(&rule)
    })
    .await
}

#[tauri::command]
pub async fn update_replace_rule(
    app_handle: tauri::AppHandle,
    rule: ReplaceRule,
) -> ApiResponse<()> {
    db_op(app_handle, move |conn| {
        ReplaceRuleDao::new(conn).update(&rule).map(|_| ())
    })
    .await
}

#[tauri::command]
pub async fn delete_replace_rule(
    app_handle: tauri::AppHandle,
    id: i64,
) -> ApiResponse<()> {
    db_op(app_handle, move |conn| {
        ReplaceRuleDao::new(conn).delete(id).map(|_| ())
    })
    .await
}

// ============================================================================
// SearchKeyword Commands
// ============================================================================

#[tauri::command]
pub async fn add_search_keyword(
    app_handle: tauri::AppHandle,
    keyword: String,
) -> ApiResponse<()> {
    db_op(app_handle, move |conn| {
        SearchKeywordDao::new(conn)
            .insert_or_update(&keyword)
            .map(|_| ())
    })
    .await
}

#[tauri::command]
pub async fn get_search_keywords(
    app_handle: tauri::AppHandle,
    limit: Option<i64>,
) -> ApiResponse<Vec<SearchKeyword>> {
    let n = limit.unwrap_or(20);
    db_op(app_handle, move |conn| {
        SearchKeywordDao::new(conn).get_recent(n)
    })
    .await
}

#[tauri::command]
pub async fn clear_search_keywords(
    app_handle: tauri::AppHandle,
) -> ApiResponse<()> {
    db_op(app_handle, |conn| {
        SearchKeywordDao::new(conn).clear().map(|_| ())
    })
    .await
}

// ============================================================================
// Cookie Commands
// ============================================================================

#[tauri::command]
pub async fn set_cookie(
    app_handle: tauri::AppHandle,
    url: String, cookie: String,
) -> ApiResponse<()> {
    db_op(app_handle, move |conn| {
        CookieDao::new(conn).insert_or_update(&url, &cookie).map(|_| ())
    })
    .await
}

#[tauri::command]
pub async fn get_cookie(
    app_handle: tauri::AppHandle,
    url: String,
) -> ApiResponse<Option<String>> {
    db_op(app_handle, move |conn| {
        CookieDao::new(conn).get(&url)
    })
    .await
}

#[tauri::command]
pub async fn delete_cookie(
    app_handle: tauri::AppHandle,
    url: String,
) -> ApiResponse<()> {
    db_op(app_handle, move |conn| {
        CookieDao::new(conn).delete(&url).map(|_| ())
    })
    .await
}

// ============================================================================
// Cache Commands
// ============================================================================

#[tauri::command]
pub async fn set_cache(
    app_handle: tauri::AppHandle,
    key: String, value: String, deadline: Option<i64>,
) -> ApiResponse<()> {
    let d = deadline.unwrap_or(0);
    db_op(app_handle, move |conn| {
        CacheDao::new(conn).put(&key, &value, d).map(|_| ())
    })
    .await
}

#[tauri::command]
pub async fn get_cache(
    app_handle: tauri::AppHandle,
    key: String,
) -> ApiResponse<Option<String>> {
    db_op(app_handle, move |conn| {
        CacheDao::new(conn).get(&key)
    })
    .await
}

#[tauri::command]
pub async fn delete_cache(
    app_handle: tauri::AppHandle,
    key: String,
) -> ApiResponse<()> {
    db_op(app_handle, move |conn| {
        CacheDao::new(conn).delete(&key).map(|_| ())
    })
    .await
}

// ============================================================================
// Bookmark Commands
// ============================================================================

#[tauri::command]
pub async fn add_bookmark(
    app_handle: tauri::AppHandle,
    bookmark: Bookmark,
) -> ApiResponse<i64> {
    db_op(app_handle, move |conn| {
        BookmarkDao::new(conn).insert(&bookmark)
    })
    .await
}

#[tauri::command]
pub async fn update_bookmark(
    app_handle: tauri::AppHandle,
    bookmark: Bookmark,
) -> ApiResponse<()> {
    db_op(app_handle, move |conn| {
        BookmarkDao::new(conn).update(&bookmark).map(|_| ())
    })
    .await
}

#[tauri::command]
pub async fn delete_bookmark(
    app_handle: tauri::AppHandle,
    id: i64,
) -> ApiResponse<()> {
    db_op(app_handle, move |conn| {
        BookmarkDao::new(conn).delete(id).map(|_| ())
    })
    .await
}

#[tauri::command]
pub async fn get_bookmarks(
    app_handle: tauri::AppHandle,
    book_url: String,
) -> ApiResponse<Vec<Bookmark>> {
    db_op(app_handle, move |conn| {
        BookmarkDao::new(conn).get_by_book(&book_url)
    })
    .await
}

// ============================================================================
// ReadRecord Commands
// ============================================================================

#[tauri::command]
pub async fn add_read_record(
    app_handle: tauri::AppHandle,
    record: ReadRecord,
) -> ApiResponse<()> {
    db_op(app_handle, move |conn| {
        ReadRecordDao::new(conn).upsert(&record).map(|_| ())
    })
    .await
}

#[tauri::command]
pub async fn get_read_records(
    app_handle: tauri::AppHandle,
) -> ApiResponse<Vec<ReadRecord>> {
    db_op(app_handle, |conn| ReadRecordDao::new(conn).get_all()).await
}

#[tauri::command]
pub async fn delete_read_record(
    app_handle: tauri::AppHandle,
    book_name: String,
) -> ApiResponse<()> {
    db_op(app_handle, move |conn| {
        ReadRecordDao::new(conn).delete(&book_name).map(|_| ())
    })
    .await
}

// ============================================================================
// HttpTTS Commands
// ============================================================================

#[tauri::command]
pub async fn get_http_tts_list(
    app_handle: tauri::AppHandle,
) -> ApiResponse<Vec<HttpTTS>> {
    db_op(app_handle, |conn| HttpTTSDao::new(conn).get_all()).await
}

#[tauri::command]
pub async fn add_http_tts(
    app_handle: tauri::AppHandle,
    tts: HttpTTS,
) -> ApiResponse<i64> {
    db_op(app_handle, move |conn| {
        HttpTTSDao::new(conn).insert(&tts)
    })
    .await
}

#[tauri::command]
pub async fn update_http_tts(
    app_handle: tauri::AppHandle,
    tts: HttpTTS,
) -> ApiResponse<()> {
    db_op(app_handle, move |conn| {
        HttpTTSDao::new(conn).update(&tts).map(|_| ())
    })
    .await
}

#[tauri::command]
pub async fn delete_http_tts(
    app_handle: tauri::AppHandle,
    id: i64,
) -> ApiResponse<()> {
    db_op(app_handle, move |conn| {
        HttpTTSDao::new(conn).delete(id).map(|_| ())
    })
    .await
}

// ============================================================================
// RssSource Commands
// ============================================================================

#[tauri::command]
pub async fn get_rss_sources(
    app_handle: tauri::AppHandle,
) -> ApiResponse<Vec<RssSource>> {
    db_op(app_handle, |conn| RssSourceDao::new(conn).get_all()).await
}

#[tauri::command]
pub async fn add_rss_source(
    app_handle: tauri::AppHandle,
    source: RssSource,
) -> ApiResponse<()> {
    db_op(app_handle, move |conn| {
        RssSourceDao::new(conn).insert(&source).map(|_| ())
    })
    .await
}

#[tauri::command]
pub async fn update_rss_source(
    app_handle: tauri::AppHandle,
    source: RssSource,
) -> ApiResponse<()> {
    db_op(app_handle, move |conn| {
        RssSourceDao::new(conn).update(&source).map(|_| ())
    })
    .await
}

#[tauri::command]
pub async fn delete_rss_source(
    app_handle: tauri::AppHandle,
    url: String,
) -> ApiResponse<()> {
    db_op(app_handle, move |conn| {
        RssSourceDao::new(conn).delete(&url).map(|_| ())
    })
    .await
}

// ============================================================================
// RssArticle Commands
// ============================================================================

#[tauri::command]
pub async fn get_rss_articles(
    app_handle: tauri::AppHandle,
    origin: String,
) -> ApiResponse<Vec<RssArticle>> {
    db_op(app_handle, move |conn| {
        RssArticleDao::new(conn).get_by_origin(&origin)
    })
    .await
}

#[tauri::command]
pub async fn add_rss_articles(
    app_handle: tauri::AppHandle,
    articles: Vec<RssArticle>,
) -> ApiResponse<()> {
    db_op(app_handle, move |conn| {
        RssArticleDao::new(conn).insert_many(&articles).map(|_| ())
    })
    .await
}

fn apply_custom_headers(
    mut request: reqwest::RequestBuilder,
    header: &Option<String>,
) -> reqwest::RequestBuilder {
    let Some(raw_header) = header.as_deref().map(str::trim).filter(|s| !s.is_empty()) else {
        return request;
    };

    if let Ok(value) = serde_json::from_str::<serde_json::Value>(raw_header) {
        if let Some(obj) = value.as_object() {
            for (key, value) in obj {
                if let Some(header_value) = value.as_str() {
                    request = request.header(key.as_str(), header_value);
                }
            }
        }
        return request;
    }

    for line in raw_header.lines() {
        if let Some((key, value)) = line.split_once(':') {
            request = request.header(key.trim(), value.trim());
        }
    }
    request
}

async fn fetch_rss_source_text(source: &RssSource) -> Result<String, String> {
    let parsed = url::Url::parse(&source.source_url).map_err(|e| format!("Invalid URL: {}", e))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(format!("Unsupported URL scheme: {}", parsed.scheme()));
    }

    let client = crate::http::async_client();

    let request = client
        .get(source.source_url.as_str())
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    let request = apply_custom_headers(request, &source.header);

    let response = request
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }

    response
        .text()
        .await
        .map_err(|e| format!("Read response failed: {}", e))
}

fn decode_html_entities(value: &str) -> String {
    let text = value
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'");
    let numeric_re = regex::Regex::new(r"&#(x[0-9A-Fa-f]+|\d+);").unwrap();
    numeric_re
        .replace_all(&text, |caps: &regex::Captures<'_>| {
            let raw = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            let parsed = if let Some(hex) = raw.strip_prefix('x') {
                u32::from_str_radix(hex, 16).ok()
            } else {
                raw.parse::<u32>().ok()
            };
            parsed
                .and_then(char::from_u32)
                .map(|c| c.to_string())
                .unwrap_or_else(|| caps.get(0).map(|m| m.as_str()).unwrap_or("").to_string())
        })
        .into_owned()
}

fn clean_feed_text(value: &str) -> String {
    let mut text = value.trim().to_string();
    if text.starts_with("<![CDATA[") && text.ends_with("]]>") {
        text = text
            .trim_start_matches("<![CDATA[")
            .trim_end_matches("]]>")
            .to_string();
    }
    let tag_re = regex::Regex::new(r"(?is)<[^>]+>").unwrap();
    decode_html_entities(&tag_re.replace_all(&text, ""))
        .trim()
        .to_string()
}

fn extract_tag_text(block: &str, tag: &str) -> Option<String> {
    let pattern = format!(
        r"(?is)<{}(?:\s[^>]*)?>(.*?)</{}>",
        regex::escape(tag),
        regex::escape(tag)
    );
    regex::Regex::new(&pattern)
        .ok()?
        .captures(block)
        .and_then(|caps| caps.get(1))
        .map(|m| clean_feed_text(m.as_str()))
        .filter(|s| !s.is_empty())
}

fn extract_first_tag_text(block: &str, tags: &[&str]) -> Option<String> {
    tags.iter().find_map(|tag| extract_tag_text(block, tag))
}

fn extract_attr(attrs: &str, name: &str) -> Option<String> {
    let pattern = format!(r#"(?is)\b{}\s*=\s*["']([^"']+)["']"#, regex::escape(name));
    regex::Regex::new(&pattern)
        .ok()?
        .captures(attrs)
        .and_then(|caps| caps.get(1))
        .map(|m| decode_html_entities(m.as_str()).trim().to_string())
        .filter(|s| !s.is_empty())
}

fn extract_atom_link(block: &str) -> Option<String> {
    let link_re = regex::Regex::new(r#"(?is)<link\b([^>]*)/?>"#).unwrap();
    let mut first_href = None;

    for caps in link_re.captures_iter(block) {
        let attrs = caps.get(1).map(|m| m.as_str()).unwrap_or("");
        let href = extract_attr(attrs, "href");
        if first_href.is_none() {
            first_href = href.clone();
        }
        let rel = extract_attr(attrs, "rel").unwrap_or_default();
        if rel.eq_ignore_ascii_case("alternate") && href.is_some() {
            return href;
        }
    }

    first_href.or_else(|| extract_tag_text(block, "link"))
}

fn json_feed_articles(origin: &str, text: &str) -> Option<Vec<RssArticle>> {
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    let items = value
        .get("items")
        .and_then(|items| items.as_array())
        .or_else(|| value.as_array())?;

    let articles = items
        .iter()
        .filter_map(|item| {
            let obj = item.as_object()?;
            let title = str_field(obj, &["title"])
                .or_else(|| str_field(obj, &["name"]))
                .or_else(|| str_field(obj, &["url"]))
                .unwrap_or_else(|| "Untitled".to_string());
            let link = str_field(obj, &["url", "external_url", "link"]);
            let description = str_field(obj, &["summary", "description"]);
            let content = str_field(obj, &["content_html", "content_text", "content"]);
            let pub_date = str_field(
                obj,
                &["date_published", "date_modified", "published", "updated"],
            );
            Some(RssArticle {
                id: None,
                origin: origin.to_string(),
                sort: None,
                title,
                content,
                description,
                link,
                pub_date,
                variable: None,
            })
        })
        .collect::<Vec<_>>();

    Some(articles)
}

fn xml_feed_articles(origin: &str, text: &str) -> Vec<RssArticle> {
    let mut articles = Vec::new();
    let item_re = regex::Regex::new(r"(?is)<item\b[^>]*>(.*?)</item>").unwrap();
    for caps in item_re.captures_iter(text) {
        let block = caps.get(1).map(|m| m.as_str()).unwrap_or("");
        let link = extract_first_tag_text(block, &["link", "guid"]);
        let title = extract_first_tag_text(block, &["title"])
            .or_else(|| link.clone())
            .unwrap_or_else(|| "Untitled".to_string());
        articles.push(RssArticle {
            id: None,
            origin: origin.to_string(),
            sort: None,
            title,
            content: extract_first_tag_text(block, &["content:encoded", "content"]),
            description: extract_first_tag_text(block, &["description", "summary"]),
            link,
            pub_date: extract_first_tag_text(
                block,
                &["pubDate", "published", "updated", "dc:date"],
            ),
            variable: None,
        });
    }

    let entry_re = regex::Regex::new(r"(?is)<entry\b[^>]*>(.*?)</entry>").unwrap();
    for caps in entry_re.captures_iter(text) {
        let block = caps.get(1).map(|m| m.as_str()).unwrap_or("");
        let link = extract_atom_link(block);
        let title = extract_first_tag_text(block, &["title"])
            .or_else(|| link.clone())
            .unwrap_or_else(|| "Untitled".to_string());
        articles.push(RssArticle {
            id: None,
            origin: origin.to_string(),
            sort: None,
            title,
            content: extract_first_tag_text(block, &["content", "content:encoded"]),
            description: extract_first_tag_text(block, &["summary", "description"]),
            link,
            pub_date: extract_first_tag_text(
                block,
                &["published", "updated", "pubDate", "dc:date"],
            ),
            variable: None,
        });
    }

    articles
}

fn parse_feed_articles(origin: &str, text: &str) -> Vec<RssArticle> {
    json_feed_articles(origin, text).unwrap_or_else(|| xml_feed_articles(origin, text))
}

#[tauri::command]
pub async fn fetch_rss_articles(
    app_handle: tauri::AppHandle,
    origin: String,
) -> ApiResponse<()> {
    let pool = {
        let state: tauri::State<'_, crate::state::AppState> =
            <tauri::AppHandle as tauri::Manager<tauri::Wry>>::state::<crate::state::AppState>(
                &app_handle,
            );
        state.db.clone()
    };
    let obj = match pool.get().await {
        Ok(o) => o,
        Err(e) => return err(format!("DB pool error: {}", e)),
    };

    let origin_for_query = origin.clone();
    let source = match obj
        .interact(move |conn| RssSourceDao::new(conn).get(&origin_for_query))
        .await
    {
        Ok(Ok(Some(s))) => s,
        Ok(Ok(None)) => return err("Source not found"),
        Ok(Err(e)) => return err(e.to_string()),
        Err(e) => return err(format!("DB interact error: {}", e)),
    };

    if source.single_url {
        let text = match fetch_rss_source_text(&source).await {
            Ok(text) => text,
            Err(e) => return err(e),
        };

        let article = RssArticle {
            id: None,
            origin: origin.clone(),
            sort: None,
            title: source.source_name.clone(),
            content: Some(text),
            description: None,
            link: Some(origin.clone()),
            pub_date: None,
            variable: None,
        };

        let origin_for_save = origin.clone();
        let save_result = obj
            .interact(move |conn| -> rusqlite::Result<()> {
                let article_dao = RssArticleDao::new(conn);
                let _ = article_dao.delete_by_origin(&origin_for_save);
                article_dao.insert(&article).map(|_| ())
            })
            .await;
        match save_result {
            Ok(Ok(())) => {}
            Ok(Err(e)) => return err(format!("Save article failed: {}", e)),
            Err(e) => return err(format!("DB interact error: {}", e)),
        }
    } else {
        let text = match fetch_rss_source_text(&source).await {
            Ok(text) => text,
            Err(e) => return err(e),
        };
        let articles = parse_feed_articles(&origin, &text);
        if articles.is_empty() {
            return err("No RSS/Atom articles found");
        }

        let origin_for_save = origin.clone();
        let save_result = obj
            .interact(move |conn| -> rusqlite::Result<()> {
                let article_dao = RssArticleDao::new(conn);
                let _ = article_dao.delete_by_origin(&origin_for_save);
                article_dao.insert_many(&articles)
            })
            .await;
        match save_result {
            Ok(Ok(())) => {}
            Ok(Err(e)) => return err(format!("Save articles failed: {}", e)),
            Err(e) => return err(format!("DB interact error: {}", e)),
        }
    }

    let mut updated = source.clone();
    updated.last_update_time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

    let _ = obj
        .interact(move |conn| RssSourceDao::new(conn).update(&updated))
        .await;

    ApiResponse {
        success: true,
        data: Some(()),
        error: None,
    }
}

fn parse_import_link_href(href: &str) -> Option<(String, String)> {
    let decoded = decode_html_entities(href);
    let href = decoded.as_str();
    let rest = href
        .strip_prefix("legado://import/")
        .or_else(|| href.strip_prefix("yuedu://import/"))?;
    let (link_type, query) = rest.split_once('?')?;
    let source_url = url::form_urlencoded::parse(query.as_bytes())
        .find_map(|(key, value)| (key == "src").then(|| value.into_owned()))?;
    if link_type.is_empty() || source_url.is_empty() {
        return None;
    }
    Some((link_type.to_string(), source_url))
}

fn parse_import_links(html: &str) -> Vec<SourceLink> {
    use scraper::{Html, Selector};

    let document = Html::parse_document(html);
    let selector = Selector::parse("a[href]").unwrap();

    let mut links = Vec::new();

    for element in document.select(&selector) {
        let href = element.value().attr("href").unwrap_or("").to_string();
        let label = element.text().collect::<String>().trim().to_string();
        let label = if label.is_empty() { None } else { Some(label) };

        if let Some((link_type, source_url)) = parse_import_link_href(&href) {
            links.push(SourceLink {
                raw_url: href,
                source_url,
                link_type,
                label,
            });
        }
    }

    // Deduplicate by source_url
    let mut seen = std::collections::HashSet::new();
    links.retain(|l| seen.insert(format!("{}|{}", l.link_type, l.source_url)));

    links
}

#[tauri::command]
pub fn parse_source_links_from_html(html: String) -> ApiResponse<Vec<SourceLink>> {
    ok(parse_import_links(&html))
}

#[tauri::command]
pub async fn fetch_import_page_html(url: String) -> ApiResponse<String> {
    match fetch_text(&url).await {
        Ok(html) => ok(html),
        Err(e) => err(format!("Fetch failed: {}", e)),
    }
}

#[tauri::command]
pub async fn fetch_import_config_text(url: String) -> ApiResponse<String> {
    match fetch_import_config_text_inner(&url).await {
        Ok(text) => ok(text),
        Err(e) => err(format!("Fetch failed: {}", e)),
    }
}

async fn fetch_text(url: &str) -> Result<String, String> {
    let client = crate::http::async_client();

    let response = client
        .get(url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }

    response.text().await.map_err(|e| e.to_string())
}

async fn fetch_bytes(url: &str) -> Result<Vec<u8>, String> {
    let client = crate::http::async_client();

    let response = client
        .get(url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }

    response
        .bytes()
        .await
        .map(|bytes| bytes.to_vec())
        .map_err(|e| e.to_string())
}

async fn fetch_import_config_text_inner(url: &str) -> Result<String, String> {
    let bytes = fetch_bytes(url).await?;
    let is_zip = url.to_ascii_lowercase().ends_with(".zip") || bytes.starts_with(b"PK\x03\x04");
    if is_zip {
        return extract_json_from_zip(&bytes);
    }
    decode_utf8_lossy(bytes)
}

fn decode_utf8_lossy(bytes: Vec<u8>) -> Result<String, String> {
    match String::from_utf8(bytes) {
        Ok(text) => Ok(text),
        Err(e) => Ok(String::from_utf8_lossy(&e.into_bytes()).into_owned()),
    }
}

fn extract_json_from_zip(bytes: &[u8]) -> Result<String, String> {
    let reader = Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(reader).map_err(|e| e.to_string())?;
    let mut fallback_index = None;

    for index in 0..archive.len() {
        let file = archive.by_index(index).map_err(|e| e.to_string())?;
        if !file.is_file() {
            continue;
        }
        let name = file.name().replace('\\', "/").to_ascii_lowercase();
        if name.ends_with("readconfig.json") {
            drop(file);
            return read_zip_entry_to_string(&mut archive, index);
        }
        if fallback_index.is_none() && name.ends_with(".json") {
            fallback_index = Some(index);
        }
    }

    if let Some(index) = fallback_index {
        read_zip_entry_to_string(&mut archive, index)
    } else {
        Err("No JSON file found in zip".to_string())
    }
}

fn read_zip_entry_to_string(
    archive: &mut zip::ZipArchive<Cursor<&[u8]>>,
    index: usize,
) -> Result<String, String> {
    let mut file = archive.by_index(index).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    decode_utf8_lossy(bytes)
}

async fn fetch_link_title(link_type: &str, url: &str) -> Result<String, String> {
    let text = if link_type == "readConfig" {
        fetch_import_config_text_inner(url).await?
    } else {
        fetch_text(url).await?
    };
    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("JSON parse error: {}", e))?;

    let items = match value {
        serde_json::Value::Array(arr) => arr,
        serde_json::Value::Object(_) => vec![value],
        _ => return Err("Expected JSON object or array".to_string()),
    };

    let first = items.first().ok_or("Empty JSON array")?;
    let obj = first.as_object().ok_or("Expected JSON object")?;

    let title = match link_type {
        "bookSource" => obj
            .get("bookSourceName")
            .or_else(|| obj.get("sourceName"))
            .and_then(|v| v.as_str()),
        "rssSource" => obj
            .get("sourceName")
            .or_else(|| obj.get("source_name"))
            .and_then(|v| v.as_str()),
        "replaceRule" | "httpTTS" | "readConfig" => obj.get("name").and_then(|v| v.as_str()),
        "theme" => obj
            .get("themeName")
            .or_else(|| obj.get("name"))
            .and_then(|v| v.as_str()),
        _ => None,
    };

    title
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "No title found".to_string())
}

#[tauri::command]
pub async fn fetch_import_links_from_url(url: String) -> ApiResponse<Vec<SourceLink>> {
    const SUPPORTED_TYPES: &[&str] = &[
        "bookSource",
        "rssSource",
        "replaceRule",
        "httpTTS",
        "theme",
        "readConfig",
    ];

    match fetch_text(&url).await {
        Ok(html) => {
            let mut links = parse_import_links(&html);

            // Concurrently fetch titles for supported links
            let mut handles = Vec::new();
            for link in &links {
                if SUPPORTED_TYPES.contains(&link.link_type.as_str()) {
                    let link_type = link.link_type.clone();
                    let source_url = link.source_url.clone();
                    handles.push(tokio::spawn(async move {
                        let title = fetch_link_title(&link_type, &source_url).await.ok();
                        (source_url, title)
                    }));
                }
            }
            for handle in handles {
                if let Ok((url, title)) = handle.await {
                    if let Some(t) = title {
                        if let Some(link) = links.iter_mut().find(|l| l.source_url == url) {
                            link.label = Some(t);
                        }
                    }
                }
            }

            ok(links)
        }
        Err(e) => err(format!("Fetch failed: {}", e)),
    }
}

// ============================================================================
// TxtTocRule Commands
// ============================================================================

#[tauri::command]
pub async fn get_txt_toc_rules(
    app_handle: tauri::AppHandle,
) -> ApiResponse<Vec<TxtTocRule>> {
    db_op(app_handle, |conn| TxtTocRuleDao::new(conn).get_all()).await
}

#[tauri::command]
pub async fn add_txt_toc_rule(
    app_handle: tauri::AppHandle,
    rule: TxtTocRule,
) -> ApiResponse<i64> {
    db_op(app_handle, move |conn| {
        TxtTocRuleDao::new(conn).insert(&rule)
    })
    .await
}

#[tauri::command]
pub async fn update_txt_toc_rule(
    app_handle: tauri::AppHandle,
    rule: TxtTocRule,
) -> ApiResponse<()> {
    db_op(app_handle, move |conn| {
        TxtTocRuleDao::new(conn).update(&rule).map(|_| ())
    })
    .await
}

#[tauri::command]
pub async fn delete_txt_toc_rule(
    app_handle: tauri::AppHandle,
    id: i64,
) -> ApiResponse<()> {
    db_op(app_handle, move |conn| {
        TxtTocRuleDao::new(conn).delete(id).map(|_| ())
    })
    .await
}

// ============================================================================
// RuleSub Commands
// ============================================================================

#[tauri::command]
pub async fn get_rule_subs(
    app_handle: tauri::AppHandle,
) -> ApiResponse<Vec<RuleSub>> {
    db_op(app_handle, |conn| RuleSubDao::new(conn).get_all()).await
}

#[tauri::command]
pub async fn add_rule_sub(
    app_handle: tauri::AppHandle,
    sub: RuleSub,
) -> ApiResponse<i64> {
    db_op(app_handle, move |conn| {
        RuleSubDao::new(conn).insert(&sub)
    })
    .await
}

#[tauri::command]
pub async fn update_rule_sub(
    app_handle: tauri::AppHandle,
    sub: RuleSub,
) -> ApiResponse<()> {
    db_op(app_handle, move |conn| {
        RuleSubDao::new(conn).update(&sub).map(|_| ())
    })
    .await
}

#[tauri::command]
pub async fn delete_rule_sub(
    app_handle: tauri::AppHandle,
    id: i64,
) -> ApiResponse<()> {
    db_op(app_handle, move |conn| {
        RuleSubDao::new(conn).delete(id).map(|_| ())
    })
    .await
}

// ============================================================================
// DictRule Commands
// ============================================================================

#[tauri::command]
pub async fn get_dict_rules(
    app_handle: tauri::AppHandle,
) -> ApiResponse<Vec<DictRule>> {
    db_op(app_handle, |conn| DictRuleDao::new(conn).get_all()).await
}

#[tauri::command]
pub async fn add_dict_rule(
    app_handle: tauri::AppHandle,
    rule: DictRule,
) -> ApiResponse<i64> {
    db_op(app_handle, move |conn| {
        DictRuleDao::new(conn).insert(&rule)
    })
    .await
}

#[tauri::command]
pub async fn update_dict_rule(
    app_handle: tauri::AppHandle,
    rule: DictRule,
) -> ApiResponse<()> {
    db_op(app_handle, move |conn| {
        DictRuleDao::new(conn).update(&rule).map(|_| ())
    })
    .await
}

#[tauri::command]
pub async fn delete_dict_rule(
    app_handle: tauri::AppHandle,
    id: i64,
) -> ApiResponse<()> {
    db_op(app_handle, move |conn| {
        DictRuleDao::new(conn).delete(id).map(|_| ())
    })
    .await
}

// ============================================================================
// App File Management Commands
// ============================================================================

fn normalize_relative_path(relative_path: Option<String>) -> Result<PathBuf, String> {
    let mut safe_path = PathBuf::new();
    if let Some(path) = relative_path {
        for component in Path::new(&path).components() {
            match component {
                Component::Normal(part) => safe_path.push(part),
                Component::CurDir => {}
                Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                    return Err("Invalid path".to_string());
                }
            }
        }
    }
    Ok(safe_path)
}

fn resolve_app_file_path(relative_path: Option<String>) -> Result<PathBuf, String> {
    let root = app_dir();
    let safe_path = normalize_relative_path(relative_path)?;
    let target = root.join(safe_path);
    let root_canon = root.canonicalize().map_err(|e| e.to_string())?;
    let target_canon = if target.exists() {
        target.canonicalize().map_err(|e| e.to_string())?
    } else {
        target
    };
    if target_canon.starts_with(&root_canon) {
        Ok(target_canon)
    } else {
        Err("Path is outside app data directory".to_string())
    }
}

fn path_to_relative(path: &Path) -> String {
    path.strip_prefix(app_dir())
        .ok()
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default()
}

#[tauri::command]
pub fn list_app_files(relative_path: Option<String>) -> ApiResponse<ManagedFileList> {
    let current = match resolve_app_file_path(relative_path) {
        Ok(path) => path,
        Err(e) => return err(e),
    };
    if !current.is_dir() {
        return err("Path is not a directory");
    }

    let root = app_dir();
    let parent_path = if current == *root {
        None
    } else {
        current
            .parent()
            .filter(|parent| parent.starts_with(root))
            .map(path_to_relative)
    };

    let mut files = Vec::new();
    let entries = match std::fs::read_dir(&current) {
        Ok(entries) => entries,
        Err(e) => return err(e.to_string()),
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let modified = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs());
        files.push(ManagedFile {
            name: entry.file_name().to_string_lossy().to_string(),
            relative_path: path_to_relative(&path),
            is_dir: metadata.is_dir(),
            size: if metadata.is_dir() { 0 } else { metadata.len() },
            modified,
        });
    }

    files.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    ok(ManagedFileList {
        current_path: path_to_relative(&current),
        parent_path,
        files,
    })
}

#[tauri::command]
pub fn create_app_folder(relative_path: Option<String>, name: String) -> ApiResponse<()> {
    let folder_name = name.trim();
    if folder_name.is_empty() || folder_name.contains('/') || folder_name.contains('\\') {
        return err("Invalid folder name");
    }
    let parent = match resolve_app_file_path(relative_path) {
        Ok(path) => path,
        Err(e) => return err(e),
    };
    if !parent.is_dir() {
        return err("Parent path is not a directory");
    }
    match std::fs::create_dir(parent.join(folder_name)) {
        Ok(_) => ok(()),
        Err(e) => err(e.to_string()),
    }
}

#[tauri::command]
pub fn delete_app_file(relative_path: String) -> ApiResponse<()> {
    let path = match resolve_app_file_path(Some(relative_path)) {
        Ok(path) => path,
        Err(e) => return err(e),
    };
    if path == *app_dir() {
        return err("Cannot delete root directory");
    }
    let result = if path.is_dir() {
        std::fs::remove_dir_all(path)
    } else {
        std::fs::remove_file(path)
    };
    match result {
        Ok(_) => ok(()),
        Err(e) => err(e.to_string()),
    }
}

// ============================================================================
// KeyboardAssist Commands
// ============================================================================

#[tauri::command]
pub async fn get_keyboard_assists(
    app_handle: tauri::AppHandle,
) -> ApiResponse<Vec<KeyboardAssist>> {
    db_op(app_handle, |conn| KeyboardAssistDao::new(conn).get_all()).await
}

#[tauri::command]
pub async fn add_keyboard_assist(
    app_handle: tauri::AppHandle,
    assist: KeyboardAssist,
) -> ApiResponse<i64> {
    db_op(app_handle, move |conn| {
        KeyboardAssistDao::new(conn).insert(&assist)
    })
    .await
}

#[tauri::command]
pub async fn update_keyboard_assist(
    app_handle: tauri::AppHandle,
    assist: KeyboardAssist,
) -> ApiResponse<()> {
    db_op(app_handle, move |conn| {
        KeyboardAssistDao::new(conn).update(&assist).map(|_| ())
    })
    .await
}

#[tauri::command]
pub async fn delete_keyboard_assist(
    app_handle: tauri::AppHandle,
    id: i64,
) -> ApiResponse<()> {
    db_op(app_handle, move |conn| {
        KeyboardAssistDao::new(conn).delete(id).map(|_| ())
    })
    .await
}

// ============================================================================
// Server Commands
// ============================================================================

#[tauri::command]
pub async fn get_servers(
    app_handle: tauri::AppHandle,
) -> ApiResponse<Vec<Server>> {
    db_op(app_handle, |conn| ServerDao::new(conn).get_all()).await
}

#[tauri::command]
pub async fn add_server(
    app_handle: tauri::AppHandle,
    server: Server,
) -> ApiResponse<i64> {
    db_op(app_handle, move |conn| {
        ServerDao::new(conn).insert(&server)
    })
    .await
}

#[tauri::command]
pub async fn update_server(
    app_handle: tauri::AppHandle,
    server: Server,
) -> ApiResponse<()> {
    db_op(app_handle, move |conn| {
        ServerDao::new(conn).update(&server).map(|_| ())
    })
    .await
}

#[tauri::command]
pub async fn delete_server(
    app_handle: tauri::AppHandle,
    id: i64,
) -> ApiResponse<()> {
    db_op(app_handle, move |conn| {
        ServerDao::new(conn).delete(id).map(|_| ())
    })
    .await
}

// ============================================================================
// RssStar Commands
// ============================================================================

#[tauri::command]
pub async fn get_rss_stars(
    app_handle: tauri::AppHandle,
) -> ApiResponse<Vec<RssStar>> {
    db_op(app_handle, |conn| RssStarDao::new(conn).get_all()).await
}

#[tauri::command]
pub async fn add_rss_star(
    app_handle: tauri::AppHandle,
    star: RssStar,
) -> ApiResponse<i64> {
    db_op(app_handle, move |conn| {
        RssStarDao::new(conn).insert(&star)
    })
    .await
}

#[tauri::command]
pub async fn delete_rss_star(
    app_handle: tauri::AppHandle,
    id: i64,
) -> ApiResponse<()> {
    db_op(app_handle, move |conn| {
        RssStarDao::new(conn).delete(id).map(|_| ())
    })
    .await
}

// ============================================================================
// RssReadRecord Commands
// ============================================================================

#[tauri::command]
pub async fn mark_rss_read(
    app_handle: tauri::AppHandle,
    record: RssReadRecord,
) -> ApiResponse<()> {
    db_op(app_handle, move |conn| {
        RssReadRecordDao::new(conn).upsert(&record).map(|_| ())
    })
    .await
}

#[tauri::command]
pub async fn is_rss_read(
    app_handle: tauri::AppHandle,
    origin: String, article_id: i32,
) -> ApiResponse<bool> {
    db_op(app_handle, move |conn| {
        RssReadRecordDao::new(conn).is_read(&origin, article_id)
    })
    .await
}

#[tauri::command]
pub async fn get_rss_read_article_ids(
    app_handle: tauri::AppHandle,
    origin: String,
) -> ApiResponse<Vec<i32>> {
    db_op(app_handle, move |conn| {
        RssReadRecordDao::new(conn).get_read_article_ids(&origin)
    })
    .await
}

// ============================================================================
// WebBook Commands (search, explore, book info, chapters, content)
// ============================================================================

#[tauri::command]
pub async fn search_books(
    source: BookSource,
    key: String,
    page: Option<i32>,
) -> ApiResponse<Vec<SearchBook>> {
    match tokio::task::spawn_blocking(move || {
        let web_book = WebBook::new(JsExtState::global());
        web_book.search(&source, &key, page)
    })
    .await
    {
        Ok(Ok(books)) => ApiResponse {
            success: true,
            data: Some(books),
            error: None,
        },
        Ok(Err(e)) => ApiResponse {
            success: false,
            data: None,
            error: Some(e.to_string()),
        },
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(format!("Task failed: {}", e)),
        },
    }
}

#[tauri::command]
pub async fn explore_books(
    source: BookSource,
    url: String,
    page: Option<i32>,
) -> ApiResponse<Vec<SearchBook>> {
    match tokio::task::spawn_blocking(move || {
        let web_book = WebBook::new(JsExtState::global());
        web_book.explore(&source, &url, page)
    })
    .await
    {
        Ok(Ok(books)) => ApiResponse {
            success: true,
            data: Some(books),
            error: None,
        },
        Ok(Err(e)) => ApiResponse {
            success: false,
            data: None,
            error: Some(e.to_string()),
        },
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(format!("Task failed: {}", e)),
        },
    }
}

#[tauri::command]
pub async fn fetch_book_info(source: BookSource, book: Book) -> ApiResponse<Book> {
    match tokio::task::spawn_blocking(move || {
        let web_book = WebBook::new(JsExtState::global());
        let mut book = book;
        web_book.get_book_info(&source, &mut book).map(|_| book)
    })
    .await
    {
        Ok(Ok(book)) => ApiResponse {
            success: true,
            data: Some(book),
            error: None,
        },
        Ok(Err(e)) => ApiResponse {
            success: false,
            data: None,
            error: Some(e.to_string()),
        },
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(format!("Task failed: {}", e)),
        },
    }
}

#[tauri::command]
pub async fn fetch_chapter_list(source: BookSource, book: Book) -> ApiResponse<Vec<BookChapter>> {
    match tokio::task::spawn_blocking(move || {
        let web_book = WebBook::new(JsExtState::global());
        web_book.get_chapter_list(&source, &book)
    })
    .await
    {
        Ok(Ok(chapters)) => ApiResponse {
            success: true,
            data: Some(chapters),
            error: None,
        },
        Ok(Err(e)) => ApiResponse {
            success: false,
            data: None,
            error: Some(e.to_string()),
        },
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(format!("Task failed: {}", e)),
        },
    }
}

#[tauri::command]
pub async fn fetch_chapter_content(
    source: BookSource,
    book: Book,
    chapter: BookChapter,
) -> ApiResponse<String> {
    match tokio::task::spawn_blocking(move || {
        let web_book = WebBook::new(JsExtState::global());
        web_book.get_content(&source, &book, &chapter)
    })
    .await
    {
        Ok(Ok(content)) => ApiResponse {
            success: true,
            data: Some(content),
            error: None,
        },
        Ok(Err(e)) => ApiResponse {
            success: false,
            data: None,
            error: Some(e.to_string()),
        },
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(format!("Task failed: {}", e)),
        },
    }
}

// ============================================================================
// Local Book Import Commands
// ============================================================================

#[derive(serde::Serialize)]
pub struct ImportResult {
    pub book_url: String,
    pub name: String,
    pub chapter_count: usize,
}

#[tauri::command]
pub async fn import_txt_book(
    app_handle: tauri::AppHandle,
    data: Vec<u8>,
    file_name: String,
) -> ApiResponse<ImportResult> {
    db_op(app_handle, move |conn| {
        import_txt_bytes(conn, &data, &file_name)
            .map(|(book, count)| ImportResult {
                book_url: book.book_url,
                name: book.name,
                chapter_count: count,
            })
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))
    })
    .await
}

#[tauri::command]
pub async fn import_epub_book(
    app_handle: tauri::AppHandle,
    data: Vec<u8>,
    file_name: String,
) -> ApiResponse<ImportResult> {
    db_op(app_handle, move |conn| {
        import_epub_content(conn, &data, &file_name)
            .map(|(book, count)| ImportResult {
                book_url: book.book_url,
                name: book.name,
                chapter_count: count,
            })
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))
    })
    .await
}

// ============================================================================
// Chapter Content Cache Commands
// ============================================================================

#[tauri::command]
pub async fn get_local_chapter_content(
    app_handle: tauri::AppHandle,
    book_url: String,
    chapter_index: i32,
) -> ApiResponse<Option<String>> {
    db_op(app_handle, move |conn| {
        ChapterContentDao::new(conn).get(&book_url, chapter_index)
    })
    .await
}

#[tauri::command]
pub async fn save_local_chapter_content(
    app_handle: tauri::AppHandle,
    book_url: String,
    chapter_index: i32,
    content: String,
) -> ApiResponse<()> {
    db_op(app_handle, move |conn| {
        ChapterContentDao::new(conn)
            .save(&book_url, chapter_index, &content)
            .map(|_| ())
    })
    .await
}

// ============================================================================
// Source Debug Commands
// ============================================================================

#[derive(Serialize)]
pub struct DebugResult {
    pub request_url: String,
    pub raw_response: String,
    pub parsed_result: String,
}

fn debug_book_source_inner(
    source: BookSource,
    step: String,
    key: Option<String>,
    book_url: Option<String>,
    chapter_url: Option<String>,
) -> ApiResponse<DebugResult> {
    let js_state = JsExtState::global();
    let web_book = WebBook::new(js_state.clone());

    match step.as_str() {
        "search" => {
            let search_url = match &source.search_url {
                Some(u) => u,
                None => {
                    return ApiResponse {
                        success: false,
                        data: None,
                        error: Some("Source has no search_url".to_string()),
                    };
                }
            };
            let analyze_url = AnalyzeUrl::new(
                search_url,
                Some(&source.book_source_url),
                key.as_deref(),
                Some(1),
                js_state,
            );
            let raw = match analyze_url.get_str_response() {
                Ok(body) => body,
                Err(e) => {
                    return ApiResponse {
                        success: false,
                        data: None,
                        error: Some(format!("Request failed: {}", e)),
                    };
                }
            };
            let parsed = match web_book.search(&source, key.as_deref().unwrap_or(""), Some(1)) {
                Ok(books) => serde_json::to_string_pretty(&books).unwrap_or_default(),
                Err(e) => format!("Parse error: {}", e),
            };
            ApiResponse {
                success: true,
                data: Some(DebugResult {
                    request_url: analyze_url.params.url.clone(),
                    raw_response: raw.chars().take(5000).collect(),
                    parsed_result: parsed,
                }),
                error: None,
            }
        }
        "book_info" => {
            let url = book_url.unwrap_or_default();
            if url.is_empty() {
                return ApiResponse {
                    success: false,
                    data: None,
                    error: Some("book_url required".to_string()),
                };
            }
            let analyze_url =
                AnalyzeUrl::new(&url, Some(&source.book_source_url), None, None, js_state);
            let raw = match analyze_url.get_str_response() {
                Ok(body) => body,
                Err(e) => {
                    return ApiResponse {
                        success: false,
                        data: None,
                        error: Some(format!("Request failed: {}", e)),
                    };
                }
            };
            let mut book = Book {
                book_url: url.clone(),
                toc_url: url.clone(),
                origin: source.book_source_url.clone(),
                origin_name: source.book_source_name.clone(),
                ..Default::default()
            };
            let parsed = match web_book.get_book_info(&source, &mut book) {
                Ok(_) => serde_json::to_string_pretty(&book).unwrap_or_default(),
                Err(e) => format!("Parse error: {}", e),
            };
            ApiResponse {
                success: true,
                data: Some(DebugResult {
                    request_url: analyze_url.params.url.clone(),
                    raw_response: raw.chars().take(5000).collect(),
                    parsed_result: parsed,
                }),
                error: None,
            }
        }
        "chapter_list" => {
            let url = book_url.unwrap_or_default();
            if url.is_empty() {
                return ApiResponse {
                    success: false,
                    data: None,
                    error: Some("book_url required".to_string()),
                };
            }
            let book = Book {
                book_url: url.clone(),
                toc_url: url.clone(),
                origin: source.book_source_url.clone(),
                origin_name: source.book_source_name.clone(),
                ..Default::default()
            };
            let analyze_url =
                AnalyzeUrl::new(&url, Some(&source.book_source_url), None, None, js_state);
            let raw = match analyze_url.get_str_response() {
                Ok(body) => body,
                Err(e) => {
                    return ApiResponse {
                        success: false,
                        data: None,
                        error: Some(format!("Request failed: {}", e)),
                    };
                }
            };
            let parsed = match web_book.get_chapter_list(&source, &book) {
                Ok(chapters) => serde_json::to_string_pretty(&chapters).unwrap_or_default(),
                Err(e) => format!("Parse error: {}", e),
            };
            ApiResponse {
                success: true,
                data: Some(DebugResult {
                    request_url: analyze_url.params.url.clone(),
                    raw_response: raw.chars().take(5000).collect(),
                    parsed_result: parsed,
                }),
                error: None,
            }
        }
        "content" => {
            let url = chapter_url.unwrap_or_default();
            if url.is_empty() {
                return ApiResponse {
                    success: false,
                    data: None,
                    error: Some("chapter_url required".to_string()),
                };
            }
            let book = Book {
                book_url: book_url.clone().unwrap_or_default(),
                toc_url: book_url.unwrap_or_default(),
                origin: source.book_source_url.clone(),
                origin_name: source.book_source_name.clone(),
                ..Default::default()
            };
            let chapter = BookChapter {
                url: url.clone(),
                book_url: book.book_url.clone(),
                ..Default::default()
            };
            let analyze_url = AnalyzeUrl::new(&url, Some(&book.toc_url), None, None, js_state);
            let raw = match analyze_url.get_str_response() {
                Ok(body) => body,
                Err(e) => {
                    return ApiResponse {
                        success: false,
                        data: None,
                        error: Some(format!("Request failed: {}", e)),
                    };
                }
            };
            let parsed = match web_book.get_content(&source, &book, &chapter) {
                Ok(content) => content,
                Err(e) => format!("Parse error: {}", e),
            };
            ApiResponse {
                success: true,
                data: Some(DebugResult {
                    request_url: analyze_url.params.url.clone(),
                    raw_response: raw.chars().take(5000).collect(),
                    parsed_result: parsed,
                }),
                error: None,
            }
        }
        _ => ApiResponse {
            success: false,
            data: None,
            error: Some(format!("Unknown step: {}", step)),
        },
    }
}

#[tauri::command]
pub async fn debug_book_source(
    source: BookSource,
    step: String,
    key: Option<String>,
    book_url: Option<String>,
    chapter_url: Option<String>,
) -> ApiResponse<DebugResult> {
    match tokio::task::spawn_blocking(move || {
        debug_book_source_inner(source, step, key, book_url, chapter_url)
    })
    .await
    {
        Ok(resp) => resp,
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(format!("Task failed: {}", e)),
        },
    }
}

// ============================================================================
// Book Update Check
// ============================================================================

#[derive(Serialize)]
pub struct UpdateCheckResult {
    pub book_url: String,
    pub has_update: bool,
    pub new_chapter_count: usize,
    pub latest_chapter_title: Option<String>,
}

fn fetch_chapter_list_inner(
    source: BookSource,
    book: Book,
) -> Result<Vec<BookChapter>, String> {
    let web_book = WebBook::new(JsExtState::global());
    web_book
        .get_chapter_list(&source, &book)
        .map_err(|e| format!("Failed to fetch chapters: {}", e))
}

#[tauri::command]
pub async fn check_book_update(
    app_handle: tauri::AppHandle,
    book: Book,
) -> ApiResponse<UpdateCheckResult> {
    if book.origin == "local" {
        return ApiResponse {
            success: true,
            data: Some(UpdateCheckResult {
                book_url: book.book_url.clone(),
                has_update: false,
                new_chapter_count: 0,
                latest_chapter_title: None,
            }),
            error: None,
        };
    }

    let book_for_source = book.clone();
    let source = match db_op(app_handle.clone(), move |conn| {
        BookSourceDao::new(conn).get(&book_for_source.origin)
    })
    .await
    {
        ApiResponse {
            success: true,
            data: Some(Some(s)),
            ..
        } => s,
        _ => {
            return ApiResponse {
                success: false,
                data: None,
                error: Some("Source not found".to_string()),
            };
        }
    };

    let book_for_network = book.clone();
    let fetch = tokio::task::spawn_blocking(move || {
        fetch_chapter_list_inner(source, book_for_network)
    })
    .await;
    let latest_chapters = match fetch {
        Ok(Ok(c)) => c,
        Ok(Err(e)) => {
            return ApiResponse {
                success: false,
                data: None,
                error: Some(e),
            };
        }
        Err(e) => {
            return ApiResponse {
                success: false,
                data: None,
                error: Some(format!("Task failed: {}", e)),
            };
        }
    };

    let book_url = book.book_url.clone();
    let existing_chapters = match db_op(app_handle.clone(), move |conn| {
        BookChapterDao::new(conn).get_chapters(&book_url)
    })
    .await
    {
        ApiResponse {
            success: true,
            data: Some(c),
            ..
        } => c,
        _ => {
            return ApiResponse {
                success: false,
                data: None,
                error: Some("Failed to load existing chapters".to_string()),
            };
        }
    };

    let existing_urls: std::collections::HashSet<&str> =
        existing_chapters.iter().map(|c| c.url.as_str()).collect();

    let new_chapters: Vec<BookChapter> = latest_chapters
        .iter()
        .filter(|c| !existing_urls.contains(c.url.as_str()))
        .cloned()
        .collect();

    let has_update = !new_chapters.is_empty();
    let latest_title = latest_chapters.last().map(|c| c.title.clone());
    let book_url = book.book_url.clone();

    if has_update {
        let new_chapters_for_tx = new_chapters.clone();
        let book_for_tx = book;
        let latest_chapters_len = latest_chapters.len();
        let latest_title_for_tx = latest_title.clone();
        let update_result = db_op(app_handle, move |conn| {
            let tx = conn.transaction()?;
            BookChapterDao::new(&tx).insert_many_conn(&tx, &new_chapters_for_tx)?;
            let mut updated_book = book_for_tx;
            updated_book.total_chapter_num = latest_chapters_len as i32;
            updated_book.latest_chapter_title = latest_title_for_tx;
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as i64;
            updated_book.last_check_time = now;
            BookDao::new(&tx).update_conn(&tx, &updated_book)?;
            tx.commit()?;
            Ok(())
        })
        .await;
        if !update_result.success {
            return ApiResponse {
                success: false,
                data: None,
                error: update_result.error,
            };
        }
    }

    ApiResponse {
        success: true,
        data: Some(UpdateCheckResult {
            book_url,
            has_update,
            new_chapter_count: new_chapters.len(),
            latest_chapter_title: latest_title,
        }),
        error: None,
    }
}

// ============================================================================
// Batch Chapter Cache Commands
// ============================================================================

#[derive(Serialize)]
pub struct CacheResult {
    pub cached_count: usize,
    pub total_chapters: usize,
}

fn fetch_chapter_contents_inner(
    source: BookSource,
    book: Book,
    to_cache: Vec<BookChapter>,
    book_url: String,
) -> Vec<(String, i32, String)> {
    let web_book = WebBook::new(JsExtState::global());
    let mut entries: Vec<(String, i32, String)> = Vec::new();
    for chapter in &to_cache {
        match web_book.get_content(&source, &book, chapter) {
            Ok(content) => {
                entries.push((book_url.clone(), chapter.index, content));
            }
            Err(e) => {
                println!("Failed to fetch chapter {}: {}", chapter.index, e);
            }
        }
    }
    entries
}

#[tauri::command]
pub async fn batch_cache_chapters(
    app_handle: tauri::AppHandle,
    book_url: String,
    count: Option<i32>,
) -> ApiResponse<CacheResult> {
    let book = match db_op(app_handle.clone(), move |conn| {
        BookDao::new(conn).get(&book_url)
    })
    .await
    {
        ApiResponse {
            success: true,
            data: Some(Some(b)),
            ..
        } => b,
        _ => {
            return ApiResponse {
                success: false,
                data: None,
                error: Some("Book not found".to_string()),
            };
        }
    };

    if book.origin == "local" {
        return ApiResponse {
            success: true,
            data: Some(CacheResult {
                cached_count: 0,
                total_chapters: 0,
            }),
            error: None,
        };
    }

    let book_for_source = book.clone();
    let source = match db_op(app_handle.clone(), move |conn| {
        BookSourceDao::new(conn).get(&book_for_source.origin)
    })
    .await
    {
        ApiResponse {
            success: true,
            data: Some(Some(s)),
            ..
        } => s,
        _ => {
            return ApiResponse {
                success: false,
                data: None,
                error: Some("Source not found".to_string()),
            };
        }
    };

    let book_url = book.book_url.clone();
    let chapters = match db_op(app_handle.clone(), move |conn| {
        BookChapterDao::new(conn).get_chapters(&book_url)
    })
    .await
    {
        ApiResponse {
            success: true,
            data: Some(c),
            ..
        } => c,
        _ => {
            return ApiResponse {
                success: false,
                data: None,
                error: Some("Failed to load chapters".to_string()),
            };
        }
    };

    let book_url_for_check = book.book_url.clone();
    let mut uncached_indices: Vec<i32> = Vec::new();
    for chapter in &chapters {
        let book_url_inner = book_url_for_check.clone();
        let idx = chapter.index;
        let exists = match db_op(app_handle.clone(), move |conn| {
            ChapterContentDao::new(conn).exists(&book_url_inner, idx)
        })
        .await
        {
            ApiResponse {
                success: true,
                data: Some(b),
                ..
            } => b,
            _ => false,
        };
        if !exists {
            uncached_indices.push(chapter.index);
        }
    }

    let limit = count.unwrap_or(10) as usize;
    let to_cache: Vec<BookChapter> = chapters
        .into_iter()
        .filter(|c| uncached_indices.contains(&c.index))
        .take(limit)
        .collect();
    let total_chapters = to_cache.len();

    if to_cache.is_empty() {
        return ApiResponse {
            success: true,
            data: Some(CacheResult {
                cached_count: 0,
                total_chapters,
            }),
            error: None,
        };
    }

    let source_clone = source.clone();
    let book_clone = book.clone();
    let to_cache_clone = to_cache.clone();
    let book_url_for_fetch = book.book_url.clone();
    let entries = match tokio::task::spawn_blocking(move || {
        fetch_chapter_contents_inner(
            source_clone,
            book_clone,
            to_cache_clone,
            book_url_for_fetch,
        )
    })
    .await
    {
        Ok(e) => e,
        Err(e) => {
            return ApiResponse {
                success: false,
                data: None,
                error: Some(format!("Task failed: {}", e)),
            };
        }
    };

    let cached_count = if !entries.is_empty() {
        match db_op(app_handle, move |conn| {
            ChapterContentDao::new(conn).save_many(&entries)
        })
        .await
        {
            ApiResponse {
                success: true,
                data: Some(c),
                ..
            } => c,
            ApiResponse { error: Some(e), .. } => {
                println!("Failed to batch save chapters: {}", e);
                0
            }
            _ => 0,
        }
    } else {
        0
    };

    ApiResponse {
        success: true,
        data: Some(CacheResult {
            cached_count,
            total_chapters,
        }),
        error: None,
    }
}

// ============================================================================
// Source Import Commands
// ============================================================================

fn json_items(json: &str) -> Result<Vec<serde_json::Value>, String> {
    let value: serde_json::Value = serde_json::from_str(json).map_err(|e| e.to_string())?;
    match value {
        serde_json::Value::Array(items) => Ok(items),
        serde_json::Value::Object(_) => Ok(vec![value]),
        _ => Err("Expected JSON object or array".to_string()),
    }
}

fn object_of(
    value: serde_json::Value,
) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    value
        .as_object()
        .cloned()
        .ok_or_else(|| "Expected JSON object".to_string())
}

fn str_field(obj: &serde_json::Map<String, serde_json::Value>, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        obj.get(*key).and_then(|value| match value {
            serde_json::Value::String(s) => Some(s.clone()),
            serde_json::Value::Number(n) => Some(n.to_string()),
            serde_json::Value::Bool(b) => Some(b.to_string()),
            _ => None,
        })
    })
}

fn bool_field(obj: &serde_json::Map<String, serde_json::Value>, keys: &[&str]) -> Option<bool> {
    keys.iter()
        .find_map(|key| obj.get(*key).and_then(|value| value.as_bool()))
}

fn i64_field(obj: &serde_json::Map<String, serde_json::Value>, keys: &[&str]) -> Option<i64> {
    keys.iter()
        .find_map(|key| obj.get(*key).and_then(|value| value.as_i64()))
}

fn parse_rss_sources_json(json: &str) -> Result<Vec<RssSource>, String> {
    json_items(json)?
        .into_iter()
        .map(|item| {
            let obj = object_of(item)?;
            let source_url = str_field(&obj, &["sourceUrl", "source_url"])
                .ok_or_else(|| "Missing sourceUrl".to_string())?;
            let source_name = str_field(&obj, &["sourceName", "source_name"])
                .unwrap_or_else(|| source_url.clone());

            Ok(RssSource {
                source_url,
                source_name,
                source_group: str_field(&obj, &["sourceGroup", "source_group"]),
                source_icon: str_field(&obj, &["sourceIcon", "source_icon"]),
                enabled: bool_field(&obj, &["enabled"]).unwrap_or(true),
                variable: str_field(&obj, &["variable"]),
                custom_order: i64_field(&obj, &["customOrder", "custom_order"]).unwrap_or(0) as i32,
                last_update_time: i64_field(&obj, &["lastUpdateTime", "last_update_time"])
                    .unwrap_or(0),
                login_url: str_field(&obj, &["loginUrl", "login_url"]),
                login_ui: str_field(&obj, &["loginUi", "login_ui"]),
                header: str_field(&obj, &["header"]),
                sort_url: str_field(&obj, &["sortUrl", "sort_url"]),
                rule_articles: str_field(&obj, &["ruleArticles", "rule_articles"]),
                rule_next_page: str_field(&obj, &["ruleNextPage", "rule_next_page"]),
                rule_title: str_field(&obj, &["ruleTitle", "rule_title"]),
                rule_pub_date: str_field(&obj, &["rulePubDate", "rule_pub_date"]),
                rule_description: str_field(&obj, &["ruleDescription", "rule_description"]),
                rule_image: str_field(&obj, &["ruleImage", "rule_image"]),
                rule_link: str_field(&obj, &["ruleLink", "rule_link"]),
                rule_content: str_field(&obj, &["ruleContent", "rule_content"]),
                single_url: bool_field(&obj, &["singleUrl", "single_url"]).unwrap_or(false),
            })
        })
        .collect()
}

fn parse_replace_rules_json(json: &str) -> Result<Vec<ReplaceRule>, String> {
    json_items(json)?
        .into_iter()
        .enumerate()
        .map(|(index, item)| {
            let obj = object_of(item)?;
            let scope_content = bool_field(&obj, &["scopeContent"]);
            let scope_title = bool_field(&obj, &["scopeTitle"]);
            let scope =
                str_field(&obj, &["scope"]).or_else(|| match (scope_content, scope_title) {
                    (Some(false), Some(true)) => Some("__title__".to_string()),
                    _ => None,
                });

            Ok(ReplaceRule {
                id: None,
                name: str_field(&obj, &["name"]),
                pattern: str_field(&obj, &["pattern"]).or_else(|| str_field(&obj, &["regex"])),
                replacement: str_field(&obj, &["replacement", "replace"]),
                scope,
                is_regex: bool_field(&obj, &["isRegex", "is_regex"]).unwrap_or(false),
                enabled: bool_field(&obj, &["enabled", "isEnabled", "is_enabled"]).unwrap_or(true),
                order: i64_field(&obj, &["order"]).unwrap_or(index as i64) as i32,
            })
        })
        .collect()
}

fn parse_http_tts_json(json: &str) -> Result<Vec<HttpTTS>, String> {
    json_items(json)?
        .into_iter()
        .map(|item| {
            let obj = object_of(item)?;
            Ok(HttpTTS {
                id: None,
                name: str_field(&obj, &["name"]),
                url: str_field(&obj, &["url"]),
                content_type: str_field(&obj, &["contentType", "content_type"]),
                login_url: str_field(&obj, &["loginUrl", "login_url"]),
                login_ui: str_field(&obj, &["loginUi", "login_ui"]),
                header: str_field(&obj, &["header"]),
                enabled: bool_field(&obj, &["enabled"]).unwrap_or(true),
                concurrent_rate: str_field(&obj, &["concurrentRate", "concurrent_rate"]),
                last_update_time: i64_field(&obj, &["lastUpdateTime", "last_update_time"])
                    .unwrap_or(0),
            })
        })
        .collect()
}

#[tauri::command]
pub async fn import_source_from_url(url: String) -> ApiResponse<Vec<BookSource>> {
    match load_source_from_url(&url).await {
        Ok(sources) => ApiResponse {
            success: true,
            data: Some(sources),
            error: None,
        },
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(e.to_string()),
        },
    }
}

#[tauri::command]
pub fn import_source_from_json(json: String) -> ApiResponse<Vec<BookSource>> {
    match parse_source_json(&json) {
        Ok(sources) => ApiResponse {
            success: true,
            data: Some(sources),
            error: None,
        },
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(e.to_string()),
        },
    }
}

#[tauri::command]
pub async fn import_rss_source_from_url(url: String) -> ApiResponse<Vec<RssSource>> {
    match fetch_text(&url).await {
        Ok(text) => import_rss_source_from_json(text),
        Err(e) => err(format!("Fetch failed: {}", e)),
    }
}

#[tauri::command]
pub fn import_rss_source_from_json(json: String) -> ApiResponse<Vec<RssSource>> {
    match parse_rss_sources_json(&json) {
        Ok(sources) => ok(sources),
        Err(e) => err(e),
    }
}

#[tauri::command]
pub async fn import_replace_rules_from_url(url: String) -> ApiResponse<Vec<ReplaceRule>> {
    match fetch_text(&url).await {
        Ok(text) => import_replace_rules_from_json(text),
        Err(e) => err(format!("Fetch failed: {}", e)),
    }
}

#[tauri::command]
pub fn import_replace_rules_from_json(json: String) -> ApiResponse<Vec<ReplaceRule>> {
    match parse_replace_rules_json(&json) {
        Ok(rules) => ok(rules),
        Err(e) => err(e),
    }
}

#[tauri::command]
pub async fn import_http_tts_from_url(url: String) -> ApiResponse<Vec<HttpTTS>> {
    match fetch_text(&url).await {
        Ok(text) => import_http_tts_from_json(text),
        Err(e) => err(format!("Fetch failed: {}", e)),
    }
}

#[tauri::command]
pub fn import_http_tts_from_json(json: String) -> ApiResponse<Vec<HttpTTS>> {
    match parse_http_tts_json(&json) {
        Ok(list) => ok(list),
        Err(e) => err(e),
    }
}

// ============================================================================
// Web Server Commands
// ============================================================================

#[tauri::command]
pub fn start_web_server(
    app_handle: tauri::AppHandle,
    port: Option<u16>,
) -> ApiResponse<String> {
    let port = port.unwrap_or(1122);
    let state = app_handle.state::<AppState>();
    let pool = state.db.clone();
    match server::start_server(pool, port) {
        Ok(addr) => ApiResponse {
            success: true,
            data: Some(addr),
            error: None,
        },
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(e),
        },
    }
}

#[tauri::command]
pub fn stop_web_server() -> ApiResponse<()> {
    server::stop_server();
    ApiResponse {
        success: true,
        data: Some(()),
        error: None,
    }
}

#[tauri::command]
pub fn get_web_server_status() -> ApiResponse<bool> {
    ApiResponse {
        success: true,
        data: Some(server::is_server_running()),
        error: None,
    }
}

// ============================================================================
// WebDAV Backup/Restore Commands
// ============================================================================

#[tauri::command]
pub async fn test_webdav_connection(
    url: String,
    username: Option<String>,
    password: Option<String>,
) -> ApiResponse<()> {
    let client = WebDavClient::new(url, username, password);
    match client.test_connection().await {
        Ok(_) => ApiResponse {
            success: true,
            data: Some(()),
            error: None,
        },
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(e.to_string()),
        },
    }
}

#[tauri::command]
pub async fn backup_to_webdav(
    url: String,
    username: Option<String>,
    password: Option<String>,
    remote_name: Option<String>,
) -> ApiResponse<String> {
    let client = WebDavClient::new(url, username, password);
    let local_path = app_dir().join("legado.db");
    let file_name = remote_name.unwrap_or_else(|| "legado_backup.db".to_string());

    match client.upload(&file_name, &local_path).await {
        Ok(_) => ApiResponse {
            success: true,
            data: Some(file_name),
            error: None,
        },
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(e.to_string()),
        },
    }
}

#[tauri::command]
pub async fn restore_from_webdav(
    url: String,
    username: Option<String>,
    password: Option<String>,
    remote_name: Option<String>,
) -> ApiResponse<String> {
    let client = WebDavClient::new(url, username, password);
    let file_name = remote_name.unwrap_or_else(|| "legado_backup.db".to_string());
    let app_dir = app_dir();
    let restore_path = app_dir.join("legado.db.restore");

    match client.download(&file_name, &restore_path).await {
        Ok(_) => ApiResponse {
            success: true,
            data: Some("下载成功，请重启应用以完成恢复".to_string()),
            error: None,
        },
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(e.to_string()),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};

    #[test]
    fn parses_legado_import_links_from_index_html() {
        let html = r#"
            <a href="legado://import/bookSource?src=https://example.com/book.json">一键导入</a>
            <a href="legado://import/rssSource?src=https://example.com/rss.json">一键导入</a>
            <a href="legado://import/replaceRule?src=https://example.com/rule.json">一键导入</a>
            <a href="legado://import/httpTTS?src=https://example.com/tts.json">一键导入</a>
            <a href="legado://import/theme?src=https://example.com/theme.json">一键导入</a>
        "#;

        let links = parse_import_links(html);

        assert_eq!(links.len(), 5);
        assert_eq!(links[0].link_type, "bookSource");
        assert_eq!(links[3].source_url, "https://example.com/tts.json");
    }

    #[test]
    fn extracts_read_config_json_from_zip() {
        let mut buffer = Cursor::new(Vec::new());
        {
            let mut writer = zip::ZipWriter::new(&mut buffer);
            writer
                .start_file("readConfig.json", zip::write::SimpleFileOptions::default())
                .unwrap();
            writer
                .write_all(r##"{"name":"番茄小说","textSize":17,"bgStr":"#ffded9c5"}"##.as_bytes())
                .unwrap();
            writer.finish().unwrap();
        }

        let text = extract_json_from_zip(&buffer.into_inner()).unwrap();

        assert!(text.contains("番茄小说"));
        assert!(text.contains("textSize"));
    }

    #[test]
    fn decodes_import_link_src_query() {
        let html = r#"
            <a href="legado://import/rssSource?src=https%3A%2F%2Fexample.com%2Frss.json%3Fa%3D1%26b%3D2">一键导入</a>
        "#;

        let links = parse_import_links(html);

        assert_eq!(links.len(), 1);
        assert_eq!(links[0].source_url, "https://example.com/rss.json?a=1&b=2");
    }

    #[test]
    fn parses_rss_feed_articles() {
        let xml = r#"
            <rss><channel>
              <item>
                <title><![CDATA[第一篇]]></title>
                <link>https://example.com/a</link>
                <description>简介 &amp; 摘要</description>
                <pubDate>Thu, 28 May 2026 00:00:00 GMT</pubDate>
              </item>
            </channel></rss>
        "#;

        let articles = parse_feed_articles("https://example.com/feed.xml", xml);

        assert_eq!(articles.len(), 1);
        assert_eq!(articles[0].title, "第一篇");
        assert_eq!(articles[0].description.as_deref(), Some("简介 & 摘要"));
    }

    #[test]
    fn parses_atom_feed_articles() {
        let xml = r#"
            <feed>
              <entry>
                <title>Atom Title</title>
                <link rel="alternate" href="https://example.com/atom" />
                <updated>2026-05-28T00:00:00Z</updated>
                <summary>Atom summary</summary>
              </entry>
            </feed>
        "#;

        let articles = parse_feed_articles("https://example.com/atom.xml", xml);

        assert_eq!(articles.len(), 1);
        assert_eq!(
            articles[0].link.as_deref(),
            Some("https://example.com/atom")
        );
        assert_eq!(
            articles[0].pub_date.as_deref(),
            Some("2026-05-28T00:00:00Z")
        );
    }

    #[test]
    fn parses_rss_source_json() {
        let json = r#"[{
            "sourceUrl": "https://legado.aoaostar.com",
            "sourceName": "阅读APP源",
            "sourceGroup": "书源",
            "singleUrl": true,
            "ruleArticles": "id.content@h3"
        }]"#;

        let sources = parse_rss_sources_json(json).unwrap();

        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].source_url, "https://legado.aoaostar.com");
        assert!(sources[0].single_url);
    }

    #[test]
    fn parses_replace_rule_json() {
        let json = r#"[{
            "name": "净化",
            "pattern": "广告",
            "replacement": "",
            "isRegex": true,
            "isEnabled": true,
            "scopeContent": true,
            "order": 7
        }]"#;

        let rules = parse_replace_rules_json(json).unwrap();

        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].name.as_deref(), Some("净化"));
        assert!(rules[0].is_regex);
        assert_eq!(rules[0].order, 7);
    }

    #[test]
    fn parses_http_tts_json() {
        let json = r#"[{
            "name": "TTS",
            "url": "https://example.com/tts?text={{speakText}}",
            "contentType": "audio/wav",
            "concurrentRate": "0",
            "lastUpdateTime": 1
        }]"#;

        let list = parse_http_tts_json(json).unwrap();

        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name.as_deref(), Some("TTS"));
        assert_eq!(list[0].content_type.as_deref(), Some("audio/wav"));
    }
}
