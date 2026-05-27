use serde::Serialize;
use crate::book_source::{
    analyze_url::AnalyzeUrl,
    js_extensions::JsExtState,
    source_loader::load_source_from_url,
    web_book::WebBook,
};
use crate::local_book::import_txt_content;
use crate::server;
use crate::db::{
    dao::{
        BookChapterDao, BookDao, BookGroupDao, BookSourceDao, BookmarkDao, CacheDao, ChapterContentDao,
        CookieDao, DictRuleDao, HttpTTSDao, KeyboardAssistDao, ReadRecordDao, ReplaceRuleDao,
        RssArticleDao, RssReadRecordDao, RssSourceDao, RssStarDao, RuleSubDao, SearchKeywordDao,
        ServerDao, TxtTocRuleDao,
    },
    db,
    models::{
        Book, BookChapter, BookGroup, BookSource, Bookmark, DictRule, HttpTTS, KeyboardAssist,
        ReadRecord, ReplaceRule, RssArticle, RssReadRecord, RssSource, RssStar, RuleSub,
        SearchBook, SearchKeyword, Server, TxtTocRule,
    },
};

#[derive(Serialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

// ============================================================================
// Book Commands
// ============================================================================

#[tauri::command]
pub fn get_books() -> ApiResponse<Vec<Book>> {
    let dao = BookDao::new(db());
    match dao.get_all() {
        Ok(books) => ApiResponse {
            success: true,
            data: Some(books),
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
pub fn add_book(book: Book) -> ApiResponse<()> {
    let dao = BookDao::new(db());
    match dao.insert(&book) {
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
pub fn update_book(book: Book) -> ApiResponse<()> {
    let dao = BookDao::new(db());
    match dao.update(&book) {
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
pub fn delete_book(book_url: String) -> ApiResponse<()> {
    let dao = BookDao::new(db());
    match dao.delete(&book_url) {
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

// ============================================================================
// BookSource Commands
// ============================================================================

#[tauri::command]
pub fn get_book_sources() -> ApiResponse<Vec<BookSource>> {
    let dao = BookSourceDao::new(db());
    match dao.get_all() {
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
pub fn get_enabled_book_sources() -> ApiResponse<Vec<BookSource>> {
    let dao = BookSourceDao::new(db());
    match dao.get_enabled() {
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
pub fn add_book_source(source: BookSource) -> ApiResponse<()> {
    let dao = BookSourceDao::new(db());
    match dao.insert(&source) {
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
pub fn update_book_source(source: BookSource) -> ApiResponse<()> {
    let dao = BookSourceDao::new(db());
    match dao.update(&source) {
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
pub fn delete_book_source(url: String) -> ApiResponse<()> {
    let dao = BookSourceDao::new(db());
    match dao.delete(&url) {
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

// ============================================================================
// BookChapter Commands
// ============================================================================

#[tauri::command]
pub fn get_chapters(book_url: String) -> ApiResponse<Vec<BookChapter>> {
    let dao = BookChapterDao::new(db());
    match dao.get_chapters(&book_url) {
        Ok(chapters) => ApiResponse {
            success: true,
            data: Some(chapters),
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
pub fn add_chapters(chapters: Vec<BookChapter>) -> ApiResponse<()> {
    let dao = BookChapterDao::new(db());
    match dao.insert_many(&chapters) {
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
pub fn delete_chapters(book_url: String) -> ApiResponse<()> {
    let dao = BookChapterDao::new(db());
    match dao.delete_by_book(&book_url) {
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

// ============================================================================
// BookGroup Commands
// ============================================================================

#[tauri::command]
pub fn get_book_groups() -> ApiResponse<Vec<BookGroup>> {
    let dao = BookGroupDao::new(db());
    match dao.get_all() {
        Ok(groups) => ApiResponse {
            success: true,
            data: Some(groups),
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
pub fn add_book_group(group: BookGroup) -> ApiResponse<()> {
    let dao = BookGroupDao::new(db());
    match dao.insert(&group) {
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
pub fn update_book_group(group: BookGroup) -> ApiResponse<()> {
    let dao = BookGroupDao::new(db());
    match dao.update(&group) {
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
pub fn delete_book_group(group_id: i64) -> ApiResponse<()> {
    let dao = BookGroupDao::new(db());
    match dao.delete(group_id) {
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

// ============================================================================
// ReplaceRule Commands
// ============================================================================

#[tauri::command]
pub fn get_replace_rules() -> ApiResponse<Vec<ReplaceRule>> {
    let dao = ReplaceRuleDao::new(db());
    match dao.get_all() {
        Ok(rules) => ApiResponse {
            success: true,
            data: Some(rules),
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
pub fn add_replace_rule(rule: ReplaceRule) -> ApiResponse<i64> {
    let dao = ReplaceRuleDao::new(db());
    match dao.insert(&rule) {
        Ok(id) => ApiResponse {
            success: true,
            data: Some(id),
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
pub fn update_replace_rule(rule: ReplaceRule) -> ApiResponse<()> {
    let dao = ReplaceRuleDao::new(db());
    match dao.update(&rule) {
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
pub fn delete_replace_rule(id: i64) -> ApiResponse<()> {
    let dao = ReplaceRuleDao::new(db());
    match dao.delete(id) {
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

// ============================================================================
// SearchKeyword Commands
// ============================================================================

#[tauri::command]
pub fn add_search_keyword(keyword: String) -> ApiResponse<()> {
    let dao = SearchKeywordDao::new(db());
    match dao.insert_or_update(&keyword) {
        Ok(_) => ApiResponse { success: true, data: Some(()), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

#[tauri::command]
pub fn get_search_keywords(limit: Option<i64>) -> ApiResponse<Vec<SearchKeyword>> {
    let dao = SearchKeywordDao::new(db());
    match dao.get_recent(limit.unwrap_or(20)) {
        Ok(keywords) => ApiResponse { success: true, data: Some(keywords), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

#[tauri::command]
pub fn clear_search_keywords() -> ApiResponse<()> {
    let dao = SearchKeywordDao::new(db());
    match dao.clear() {
        Ok(_) => ApiResponse { success: true, data: Some(()), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

// ============================================================================
// Cookie Commands
// ============================================================================

#[tauri::command]
pub fn set_cookie(url: String, cookie: String) -> ApiResponse<()> {
    let dao = CookieDao::new(db());
    match dao.insert_or_update(&url, &cookie) {
        Ok(_) => ApiResponse { success: true, data: Some(()), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

#[tauri::command]
pub fn get_cookie(url: String) -> ApiResponse<Option<String>> {
    let dao = CookieDao::new(db());
    match dao.get(&url) {
        Ok(cookie) => ApiResponse { success: true, data: Some(cookie), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

#[tauri::command]
pub fn delete_cookie(url: String) -> ApiResponse<()> {
    let dao = CookieDao::new(db());
    match dao.delete(&url) {
        Ok(_) => ApiResponse { success: true, data: Some(()), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

// ============================================================================
// Cache Commands
// ============================================================================

#[tauri::command]
pub fn set_cache(key: String, value: String, deadline: Option<i64>) -> ApiResponse<()> {
    let dao = CacheDao::new(db());
    match dao.put(&key, &value, deadline.unwrap_or(0)) {
        Ok(_) => ApiResponse { success: true, data: Some(()), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

#[tauri::command]
pub fn get_cache(key: String) -> ApiResponse<Option<String>> {
    let dao = CacheDao::new(db());
    match dao.get(&key) {
        Ok(value) => ApiResponse { success: true, data: Some(value), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

#[tauri::command]
pub fn delete_cache(key: String) -> ApiResponse<()> {
    let dao = CacheDao::new(db());
    match dao.delete(&key) {
        Ok(_) => ApiResponse { success: true, data: Some(()), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

// ============================================================================
// Bookmark Commands
// ============================================================================

#[tauri::command]
pub fn add_bookmark(bookmark: Bookmark) -> ApiResponse<i64> {
    let dao = BookmarkDao::new(db());
    match dao.insert(&bookmark) {
        Ok(id) => ApiResponse { success: true, data: Some(id), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

#[tauri::command]
pub fn update_bookmark(bookmark: Bookmark) -> ApiResponse<()> {
    let dao = BookmarkDao::new(db());
    match dao.update(&bookmark) {
        Ok(_) => ApiResponse { success: true, data: Some(()), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

#[tauri::command]
pub fn delete_bookmark(id: i64) -> ApiResponse<()> {
    let dao = BookmarkDao::new(db());
    match dao.delete(id) {
        Ok(_) => ApiResponse { success: true, data: Some(()), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

#[tauri::command]
pub fn get_bookmarks(book_url: String) -> ApiResponse<Vec<Bookmark>> {
    let dao = BookmarkDao::new(db());
    match dao.get_by_book(&book_url) {
        Ok(bookmarks) => ApiResponse { success: true, data: Some(bookmarks), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

// ============================================================================
// ReadRecord Commands
// ============================================================================

#[tauri::command]
pub fn add_read_record(record: ReadRecord) -> ApiResponse<()> {
    let dao = ReadRecordDao::new(db());
    match dao.upsert(&record) {
        Ok(_) => ApiResponse { success: true, data: Some(()), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

#[tauri::command]
pub fn get_read_records() -> ApiResponse<Vec<ReadRecord>> {
    let dao = ReadRecordDao::new(db());
    match dao.get_all() {
        Ok(records) => ApiResponse { success: true, data: Some(records), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

#[tauri::command]
pub fn delete_read_record(book_name: String) -> ApiResponse<()> {
    let dao = ReadRecordDao::new(db());
    match dao.delete(&book_name) {
        Ok(_) => ApiResponse { success: true, data: Some(()), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

// ============================================================================
// HttpTTS Commands
// ============================================================================

#[tauri::command]
pub fn get_http_tts_list() -> ApiResponse<Vec<HttpTTS>> {
    let dao = HttpTTSDao::new(db());
    match dao.get_all() {
        Ok(list) => ApiResponse { success: true, data: Some(list), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

#[tauri::command]
pub fn add_http_tts(tts: HttpTTS) -> ApiResponse<i64> {
    let dao = HttpTTSDao::new(db());
    match dao.insert(&tts) {
        Ok(id) => ApiResponse { success: true, data: Some(id), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

#[tauri::command]
pub fn update_http_tts(tts: HttpTTS) -> ApiResponse<()> {
    let dao = HttpTTSDao::new(db());
    match dao.update(&tts) {
        Ok(_) => ApiResponse { success: true, data: Some(()), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

#[tauri::command]
pub fn delete_http_tts(id: i64) -> ApiResponse<()> {
    let dao = HttpTTSDao::new(db());
    match dao.delete(id) {
        Ok(_) => ApiResponse { success: true, data: Some(()), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

// ============================================================================
// RssSource Commands
// ============================================================================

#[tauri::command]
pub fn get_rss_sources() -> ApiResponse<Vec<RssSource>> {
    let dao = RssSourceDao::new(db());
    match dao.get_all() {
        Ok(sources) => ApiResponse { success: true, data: Some(sources), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

#[tauri::command]
pub fn add_rss_source(source: RssSource) -> ApiResponse<()> {
    let dao = RssSourceDao::new(db());
    match dao.insert(&source) {
        Ok(_) => ApiResponse { success: true, data: Some(()), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

#[tauri::command]
pub fn update_rss_source(source: RssSource) -> ApiResponse<()> {
    let dao = RssSourceDao::new(db());
    match dao.update(&source) {
        Ok(_) => ApiResponse { success: true, data: Some(()), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

#[tauri::command]
pub fn delete_rss_source(url: String) -> ApiResponse<()> {
    let dao = RssSourceDao::new(db());
    match dao.delete(&url) {
        Ok(_) => ApiResponse { success: true, data: Some(()), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

// ============================================================================
// RssArticle Commands
// ============================================================================

#[tauri::command]
pub fn get_rss_articles(origin: String) -> ApiResponse<Vec<RssArticle>> {
    let dao = RssArticleDao::new(db());
    match dao.get_by_origin(&origin) {
        Ok(articles) => ApiResponse { success: true, data: Some(articles), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

#[tauri::command]
pub fn add_rss_articles(articles: Vec<RssArticle>) -> ApiResponse<()> {
    let dao = RssArticleDao::new(db());
    match dao.insert_many(&articles) {
        Ok(_) => ApiResponse { success: true, data: Some(()), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

// ============================================================================
// TxtTocRule Commands
// ============================================================================

#[tauri::command]
pub fn get_txt_toc_rules() -> ApiResponse<Vec<TxtTocRule>> {
    let dao = TxtTocRuleDao::new(db());
    match dao.get_all() {
        Ok(rules) => ApiResponse { success: true, data: Some(rules), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

#[tauri::command]
pub fn add_txt_toc_rule(rule: TxtTocRule) -> ApiResponse<i64> {
    let dao = TxtTocRuleDao::new(db());
    match dao.insert(&rule) {
        Ok(id) => ApiResponse { success: true, data: Some(id), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

#[tauri::command]
pub fn update_txt_toc_rule(rule: TxtTocRule) -> ApiResponse<()> {
    let dao = TxtTocRuleDao::new(db());
    match dao.update(&rule) {
        Ok(_) => ApiResponse { success: true, data: Some(()), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

#[tauri::command]
pub fn delete_txt_toc_rule(id: i64) -> ApiResponse<()> {
    let dao = TxtTocRuleDao::new(db());
    match dao.delete(id) {
        Ok(_) => ApiResponse { success: true, data: Some(()), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

// ============================================================================
// RuleSub Commands
// ============================================================================

#[tauri::command]
pub fn get_rule_subs() -> ApiResponse<Vec<RuleSub>> {
    let dao = RuleSubDao::new(db());
    match dao.get_all() {
        Ok(subs) => ApiResponse { success: true, data: Some(subs), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

#[tauri::command]
pub fn add_rule_sub(sub: RuleSub) -> ApiResponse<i64> {
    let dao = RuleSubDao::new(db());
    match dao.insert(&sub) {
        Ok(id) => ApiResponse { success: true, data: Some(id), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

#[tauri::command]
pub fn update_rule_sub(sub: RuleSub) -> ApiResponse<()> {
    let dao = RuleSubDao::new(db());
    match dao.update(&sub) {
        Ok(_) => ApiResponse { success: true, data: Some(()), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

#[tauri::command]
pub fn delete_rule_sub(id: i64) -> ApiResponse<()> {
    let dao = RuleSubDao::new(db());
    match dao.delete(id) {
        Ok(_) => ApiResponse { success: true, data: Some(()), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

// ============================================================================
// DictRule Commands
// ============================================================================

#[tauri::command]
pub fn get_dict_rules() -> ApiResponse<Vec<DictRule>> {
    let dao = DictRuleDao::new(db());
    match dao.get_all() {
        Ok(rules) => ApiResponse { success: true, data: Some(rules), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

#[tauri::command]
pub fn add_dict_rule(rule: DictRule) -> ApiResponse<i64> {
    let dao = DictRuleDao::new(db());
    match dao.insert(&rule) {
        Ok(id) => ApiResponse { success: true, data: Some(id), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

#[tauri::command]
pub fn update_dict_rule(rule: DictRule) -> ApiResponse<()> {
    let dao = DictRuleDao::new(db());
    match dao.update(&rule) {
        Ok(_) => ApiResponse { success: true, data: Some(()), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

#[tauri::command]
pub fn delete_dict_rule(id: i64) -> ApiResponse<()> {
    let dao = DictRuleDao::new(db());
    match dao.delete(id) {
        Ok(_) => ApiResponse { success: true, data: Some(()), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

// ============================================================================
// KeyboardAssist Commands
// ============================================================================

#[tauri::command]
pub fn get_keyboard_assists() -> ApiResponse<Vec<KeyboardAssist>> {
    let dao = KeyboardAssistDao::new(db());
    match dao.get_all() {
        Ok(assists) => ApiResponse { success: true, data: Some(assists), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

#[tauri::command]
pub fn add_keyboard_assist(assist: KeyboardAssist) -> ApiResponse<i64> {
    let dao = KeyboardAssistDao::new(db());
    match dao.insert(&assist) {
        Ok(id) => ApiResponse { success: true, data: Some(id), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

#[tauri::command]
pub fn update_keyboard_assist(assist: KeyboardAssist) -> ApiResponse<()> {
    let dao = KeyboardAssistDao::new(db());
    match dao.update(&assist) {
        Ok(_) => ApiResponse { success: true, data: Some(()), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

#[tauri::command]
pub fn delete_keyboard_assist(id: i64) -> ApiResponse<()> {
    let dao = KeyboardAssistDao::new(db());
    match dao.delete(id) {
        Ok(_) => ApiResponse { success: true, data: Some(()), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

// ============================================================================
// Server Commands
// ============================================================================

#[tauri::command]
pub fn get_servers() -> ApiResponse<Vec<Server>> {
    let dao = ServerDao::new(db());
    match dao.get_all() {
        Ok(servers) => ApiResponse { success: true, data: Some(servers), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

#[tauri::command]
pub fn add_server(server: Server) -> ApiResponse<i64> {
    let dao = ServerDao::new(db());
    match dao.insert(&server) {
        Ok(id) => ApiResponse { success: true, data: Some(id), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

#[tauri::command]
pub fn update_server(server: Server) -> ApiResponse<()> {
    let dao = ServerDao::new(db());
    match dao.update(&server) {
        Ok(_) => ApiResponse { success: true, data: Some(()), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

#[tauri::command]
pub fn delete_server(id: i64) -> ApiResponse<()> {
    let dao = ServerDao::new(db());
    match dao.delete(id) {
        Ok(_) => ApiResponse { success: true, data: Some(()), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

// ============================================================================
// RssStar Commands
// ============================================================================

#[tauri::command]
pub fn get_rss_stars() -> ApiResponse<Vec<RssStar>> {
    let dao = RssStarDao::new(db());
    match dao.get_all() {
        Ok(stars) => ApiResponse { success: true, data: Some(stars), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

#[tauri::command]
pub fn add_rss_star(star: RssStar) -> ApiResponse<i64> {
    let dao = RssStarDao::new(db());
    match dao.insert(&star) {
        Ok(id) => ApiResponse { success: true, data: Some(id), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

#[tauri::command]
pub fn delete_rss_star(id: i64) -> ApiResponse<()> {
    let dao = RssStarDao::new(db());
    match dao.delete(id) {
        Ok(_) => ApiResponse { success: true, data: Some(()), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

// ============================================================================
// RssReadRecord Commands
// ============================================================================

#[tauri::command]
pub fn mark_rss_read(record: RssReadRecord) -> ApiResponse<()> {
    let dao = RssReadRecordDao::new(db());
    match dao.upsert(&record) {
        Ok(_) => ApiResponse { success: true, data: Some(()), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

#[tauri::command]
pub fn is_rss_read(origin: String, article_id: i32) -> ApiResponse<bool> {
    let dao = RssReadRecordDao::new(db());
    match dao.is_read(&origin, article_id) {
        Ok(read) => ApiResponse { success: true, data: Some(read), error: None },
        Err(e) => ApiResponse { success: false, data: None, error: Some(e.to_string()) },
    }
}

// ============================================================================
// WebBook Commands (search, explore, book info, chapters, content)
// ============================================================================

#[tauri::command]
pub fn search_books(source: BookSource, key: String, page: Option<i32>) -> ApiResponse<Vec<SearchBook>> {
    let js_state = JsExtState::new();
    let web_book = WebBook::new(js_state);
    match web_book.search(&source, &key, page) {
        Ok(books) => ApiResponse {
            success: true,
            data: Some(books),
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
pub fn explore_books(source: BookSource, url: String, page: Option<i32>) -> ApiResponse<Vec<SearchBook>> {
    let js_state = JsExtState::new();
    let web_book = WebBook::new(js_state);
    match web_book.explore(&source, &url, page) {
        Ok(books) => ApiResponse {
            success: true,
            data: Some(books),
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
pub fn fetch_book_info(source: BookSource, mut book: Book) -> ApiResponse<Book> {
    let js_state = JsExtState::new();
    let web_book = WebBook::new(js_state);
    match web_book.get_book_info(&source, &mut book) {
        Ok(_) => ApiResponse {
            success: true,
            data: Some(book),
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
pub fn fetch_chapter_list(source: BookSource, book: Book) -> ApiResponse<Vec<BookChapter>> {
    let js_state = JsExtState::new();
    let web_book = WebBook::new(js_state);
    match web_book.get_chapter_list(&source, &book) {
        Ok(chapters) => ApiResponse {
            success: true,
            data: Some(chapters),
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
pub fn fetch_chapter_content(source: BookSource, book: Book, chapter: BookChapter) -> ApiResponse<String> {
    let js_state = JsExtState::new();
    let web_book = WebBook::new(js_state);
    match web_book.get_content(&source, &book, &chapter) {
        Ok(content) => ApiResponse {
            success: true,
            data: Some(content),
            error: None,
        },
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(e.to_string()),
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
pub fn import_txt_book(content: String, file_name: String) -> ApiResponse<ImportResult> {
    match import_txt_content(&content, &file_name) {
        Ok((book, count)) => ApiResponse {
            success: true,
            data: Some(ImportResult {
                book_url: book.book_url,
                name: book.name,
                chapter_count: count,
            }),
            error: None,
        },
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(e.to_string()),
        },
    }
}

// ============================================================================
// Chapter Content Cache Commands
// ============================================================================

#[tauri::command]
pub fn get_local_chapter_content(book_url: String, chapter_index: i32) -> ApiResponse<Option<String>> {
    let dao = ChapterContentDao::new(db());
    match dao.get(&book_url, chapter_index) {
        Ok(content) => ApiResponse {
            success: true,
            data: Some(content),
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
pub fn save_local_chapter_content(book_url: String, chapter_index: i32, content: String) -> ApiResponse<()> {
    let dao = ChapterContentDao::new(db());
    match dao.save(&book_url, chapter_index, &content) {
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

// ============================================================================
// Source Debug Commands
// ============================================================================

#[derive(Serialize)]
pub struct DebugResult {
    pub request_url: String,
    pub raw_response: String,
    pub parsed_result: String,
}

#[tauri::command]
pub fn debug_book_source(
    source: BookSource,
    step: String,
    key: Option<String>,
    book_url: Option<String>,
    chapter_url: Option<String>,
) -> ApiResponse<DebugResult> {
    let js_state = JsExtState::new();
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
            let analyze_url = AnalyzeUrl::new(&url, Some(&source.book_source_url), None, None, js_state);
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
            let analyze_url = AnalyzeUrl::new(&url, Some(&source.book_source_url), None, None, js_state);
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

// ============================================================================
// Source Import Commands
// ============================================================================

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

// ============================================================================
// Web Server Commands
// ============================================================================

#[tauri::command]
pub fn start_web_server(port: Option<u16>) -> ApiResponse<String> {
    let port = port.unwrap_or(1122);
    match server::start_server(port) {
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
