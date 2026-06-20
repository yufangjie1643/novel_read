use serde::{Deserialize, Serialize};

// ============================================================================
// Book
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Book {
    pub book_url: String,
    pub toc_url: String,
    pub origin: String,
    pub origin_name: String,
    pub name: String,
    pub author: String,
    pub kind: Option<String>,
    pub custom_tag: Option<String>,
    pub cover_url: Option<String>,
    pub custom_cover_url: Option<String>,
    pub intro: Option<String>,
    pub custom_intro: Option<String>,
    pub charset: Option<String>,
    pub book_type: i32,
    pub group: i64,
    pub latest_chapter_title: Option<String>,
    pub latest_chapter_time: i64,
    pub last_check_time: i64,
    pub last_check_count: i32,
    pub total_chapter_num: i32,
    pub dur_chapter_title: Option<String>,
    pub dur_chapter_index: i32,
    pub dur_chapter_pos: i32,
    pub dur_chapter_time: i64,
    pub word_count: Option<String>,
    pub can_update: bool,
    pub order: i32,
    pub origin_order: i32,
    pub variable: Option<String>,
    pub read_config: Option<String>,
    pub sync_time: i64,
}

impl Default for Book {
    fn default() -> Self {
        Self {
            book_url: String::new(),
            toc_url: String::new(),
            origin: "local".to_string(),
            origin_name: String::new(),
            name: String::new(),
            author: String::new(),
            kind: None,
            custom_tag: None,
            cover_url: None,
            custom_cover_url: None,
            intro: None,
            custom_intro: None,
            charset: None,
            book_type: 0,
            group: 0,
            latest_chapter_title: None,
            latest_chapter_time: 0,
            last_check_time: 0,
            last_check_count: 0,
            total_chapter_num: 0,
            dur_chapter_title: None,
            dur_chapter_index: 0,
            dur_chapter_pos: 0,
            dur_chapter_time: 0,
            word_count: None,
            can_update: true,
            order: 0,
            origin_order: 0,
            variable: None,
            read_config: None,
            sync_time: 0,
        }
    }
}

// ============================================================================
// BookChapter
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct BookChapter {
    pub url: String,
    pub book_url: String,
    pub index: i32,
    pub title: String,
    pub is_volume: bool,
    pub is_vip: bool,
    pub is_pay: bool,
    pub start_fragment_id: Option<String>,
    pub end_fragment_id: Option<String>,
    pub tag: Option<String>,
    pub word_count: Option<String>,
    /// Publication time in unix seconds. 0 = unknown / not extracted.
    pub pub_time: i64,
}

impl Default for BookChapter {
    fn default() -> Self {
        Self {
            url: String::new(),
            book_url: String::new(),
            index: 0,
            title: String::new(),
            is_volume: false,
            is_vip: false,
            is_pay: false,
            start_fragment_id: None,
            end_fragment_id: None,
            tag: None,
            word_count: None,
            pub_time: 0,
        }
    }
}

// ============================================================================
// BookSource
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct BookSource {
    pub book_source_url: String,
    pub book_source_name: String,
    pub book_source_group: Option<String>,
    pub book_source_type: i32,
    pub book_url_pattern: Option<String>,
    pub custom_order: i32,
    pub enabled: bool,
    pub enabled_explore: bool,
    pub js_lib: Option<String>,
    pub enabled_cookie_jar: Option<bool>,
    pub concurrent_rate: Option<String>,
    pub header: Option<String>,
    pub login_url: Option<String>,
    pub login_ui: Option<String>,
    pub login_check_js: Option<String>,
    pub cover_decode_js: Option<String>,
    pub book_source_comment: Option<String>,
    pub variable_comment: Option<String>,
    pub last_update_time: i64,
    pub respond_time: i64,
    pub weight: i32,
    pub explore_url: Option<String>,
    pub explore_screen: Option<String>,
    pub rule_explore: Option<String>,
    pub search_url: Option<String>,
    pub rule_search: Option<String>,
    pub rule_book_info: Option<String>,
    pub rule_toc: Option<String>,
    pub rule_content: Option<String>,
    pub rule_review: Option<String>,
}

/// Lightweight projection of `BookSource` for list rendering and future
/// filter / batch operations. Excludes all search / explore / chapter rules
/// and request / response headers — the list page never reads them.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BookSourceSummary {
    #[serde(rename = "bookSourceUrl")]
    pub book_source_url: String,
    #[serde(rename = "bookSourceName")]
    pub book_source_name: String,
    #[serde(rename = "bookSourceGroup")]
    pub book_source_group: Option<String>,
    #[serde(rename = "bookSourceType")]
    pub book_source_type: i32,
    #[serde(rename = "enabled")]
    pub enabled: bool,
    #[serde(rename = "enabledExplore")]
    pub enabled_explore: bool,
    #[serde(rename = "weight")]
    pub weight: i32,
    #[serde(rename = "customOrder")]
    pub custom_order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ExploreItem {
    pub id: String,
    pub source_url: String,
    pub source_name: String,
    pub label: String,
    pub url: String,
    #[serde(rename = "hasLoginUrl")]
    pub has_login_url: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ExploreItemsPage {
    pub items: Vec<ExploreItem>,
    pub total: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ExploreKind {
    pub title: String,
    pub url: Option<String>,
}

impl Default for BookSource {
    fn default() -> Self {
        Self {
            book_source_url: String::new(),
            book_source_name: String::new(),
            book_source_group: None,
            book_source_type: 0,
            book_url_pattern: None,
            custom_order: 0,
            enabled: true,
            enabled_explore: true,
            js_lib: None,
            enabled_cookie_jar: Some(true),
            concurrent_rate: None,
            header: None,
            login_url: None,
            login_ui: None,
            login_check_js: None,
            cover_decode_js: None,
            book_source_comment: None,
            variable_comment: None,
            last_update_time: 0,
            respond_time: 180000,
            weight: 0,
            explore_url: None,
            explore_screen: None,
            rule_explore: None,
            search_url: None,
            rule_search: None,
            rule_book_info: None,
            rule_toc: None,
            rule_content: None,
            rule_review: None,
        }
    }
}

// ============================================================================
// BookGroup
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BookGroup {
    pub group_id: i64,
    pub group_name: String,
    pub order: i32,
    pub show: bool,
    pub enable_refresh: bool,
}

impl Default for BookGroup {
    fn default() -> Self {
        Self {
            group_id: 0,
            group_name: String::new(),
            order: 0,
            show: true,
            enable_refresh: true,
        }
    }
}

// ============================================================================
// ReplaceRule
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReplaceRule {
    pub id: Option<i64>,
    pub name: Option<String>,
    pub pattern: Option<String>,
    pub replacement: Option<String>,
    pub scope: Option<String>,
    pub is_regex: bool,
    pub enabled: bool,
    pub order: i32,
}

impl Default for ReplaceRule {
    fn default() -> Self {
        Self {
            id: None,
            name: None,
            pattern: None,
            replacement: None,
            scope: None,
            is_regex: false,
            enabled: true,
            order: 0,
        }
    }
}

/// Match metadata returned by `apply_single_rule`.
/// `first_match_range` is a UTF-8 byte offset range, matching what
/// `HTMLTextAreaElement.selectionStart/End` expects so the frontend can
/// highlight the first match in-place.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct RuleMatchMeta {
    pub matched: bool,
    pub match_count: usize,
    pub result: String,
    pub first_match_range: Option<(usize, usize)>,
    pub error: Option<String>,
}

impl Default for RuleMatchMeta {
    fn default() -> Self {
        Self {
            matched: false,
            match_count: 0,
            result: String::new(),
            first_match_range: None,
            error: None,
        }
    }
}

// ============================================================================
// SearchBook
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SearchBook {
    pub book_url: String,
    pub origin: String,
    pub origin_name: Option<String>,
    pub name: String,
    pub author: Option<String>,
    pub kind: Option<String>,
    pub cover_url: Option<String>,
    pub intro: Option<String>,
    pub word_count: Option<String>,
    pub latest_chapter_title: Option<String>,
    pub toc_url: Option<String>,
    pub variable: Option<String>,
    pub origin_order: i32,
}

impl Default for SearchBook {
    fn default() -> Self {
        Self {
            book_url: String::new(),
            origin: String::new(),
            origin_name: None,
            name: String::new(),
            author: None,
            kind: None,
            cover_url: None,
            intro: None,
            word_count: None,
            latest_chapter_title: None,
            toc_url: None,
            variable: None,
            origin_order: 0,
        }
    }
}

// ============================================================================
// SearchKeyword
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SearchKeyword {
    pub id: Option<i64>,
    pub keyword: String,
    pub usage_count: i32,
    pub last_use_time: i64,
}

// ============================================================================
// Cookie
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Cookie {
    pub id: Option<i64>,
    pub url: String,
    pub cookie: String,
    #[serde(rename = "lastUpdateTime")]
    pub last_update_time: i64,
}

// ============================================================================
// Cache
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Cache {
    pub key: String,
    pub value: Option<String>,
    pub deadline: i64,
}

// ============================================================================
// Bookmark
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Bookmark {
    pub id: Option<i64>,
    pub book_name: String,
    pub book_author: String,
    pub chapter_name: Option<String>,
    pub book_url: Option<String>,
    pub chapter_url: Option<String>,
    pub chapter_index: i32,
    pub page_index: i32,
    pub content: Option<String>,
}

// ============================================================================
// ReadRecord
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReadRecord {
    pub book_name: String,
    pub read_time: i64,
    pub last_read: i64,
}

// ============================================================================
// HttpTTS
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HttpTTS {
    pub id: Option<i64>,
    pub name: Option<String>,
    pub url: Option<String>,
    pub content_type: Option<String>,
    pub login_url: Option<String>,
    pub login_ui: Option<String>,
    pub header: Option<String>,
    pub enabled: bool,
    pub concurrent_rate: Option<String>,
    pub last_update_time: i64,
}

// ============================================================================
// RssSource
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct RssSource {
    pub source_url: String,
    pub source_name: String,
    pub source_group: Option<String>,
    pub source_icon: Option<String>,
    pub enabled: bool,
    pub variable: Option<String>,
    pub custom_order: i32,
    pub last_update_time: i64,
    pub login_url: Option<String>,
    pub login_ui: Option<String>,
    pub header: Option<String>,
    pub sort_url: Option<String>,
    pub rule_articles: Option<String>,
    pub rule_next_page: Option<String>,
    pub rule_title: Option<String>,
    pub rule_pub_date: Option<String>,
    pub rule_description: Option<String>,
    pub rule_image: Option<String>,
    pub rule_link: Option<String>,
    pub rule_content: Option<String>,
    pub single_url: bool,
}

impl Default for RssSource {
    fn default() -> Self {
        Self {
            source_url: String::new(),
            source_name: String::new(),
            source_group: None,
            source_icon: None,
            enabled: true,
            variable: None,
            custom_order: 0,
            last_update_time: 0,
            login_url: None,
            login_ui: None,
            header: None,
            sort_url: None,
            rule_articles: None,
            rule_next_page: None,
            rule_title: None,
            rule_pub_date: None,
            rule_description: None,
            rule_image: None,
            rule_link: None,
            rule_content: None,
            single_url: false,
        }
    }
}

// ============================================================================
// SourceLink (for parsing special import links from HTML)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SourceLink {
    pub raw_url: String,
    pub source_url: String,
    pub link_type: String,
    pub label: Option<String>,
}

// ============================================================================
// RssArticle
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RssArticle {
    pub id: Option<i64>,
    pub origin: String,
    pub sort: Option<String>,
    pub title: String,
    pub content: Option<String>,
    pub description: Option<String>,
    pub link: Option<String>,
    pub pub_date: Option<String>,
    pub variable: Option<String>,
}

// ============================================================================
// TxtTocRule
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TxtTocRule {
    pub id: Option<i64>,
    pub name: Option<String>,
    pub rule: Option<String>,
    pub example: Option<String>,
    pub enabled: bool,
    pub order: i32,
}

// ============================================================================
// RuleSub
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RuleSub {
    pub id: Option<i64>,
    pub name: Option<String>,
    pub url: Option<String>,
    pub sub_type: i32,
    pub custom_order: i32,
    pub enabled: bool,
    pub auto_update: bool,
    pub last_update_time: i64,
}

// ============================================================================
// DictRule
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DictRule {
    pub id: Option<i64>,
    pub name: Option<String>,
    pub url: Option<String>,
    pub show_rule: Option<String>,
    pub enabled: bool,
    pub sort_number: i32,
}

// ============================================================================
// KeyboardAssist
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct KeyboardAssist {
    pub id: Option<i64>,
    pub assist_type: i32,
    pub key: Option<String>,
    pub value: Option<String>,
    pub serial_no: i32,
}

// ============================================================================
// Server
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Server {
    pub id: Option<i64>,
    pub name: Option<String>,
    pub url: Option<String>,
    pub enabled: bool,
}

/// Single-row credential table for the built-in HTTP server.
/// `password_hash` is the argon2 PHC string — never expose to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HttpServerAuth {
    pub username: String,
    pub password_hash: String,
    pub updated_at: i64,
}

/// Sanitized credential view sent to the frontend (no password hash).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HttpServerAuthView {
    pub username: String,
    pub updated_at: i64,
}

impl From<&HttpServerAuth> for HttpServerAuthView {
    fn from(v: &HttpServerAuth) -> Self {
        Self {
            username: v.username.clone(),
            updated_at: v.updated_at,
        }
    }
}

// ============================================================================
// RssStar
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RssStar {
    pub id: Option<i64>,
    pub origin: String,
    pub sort: Option<String>,
    pub title: String,
}

// ============================================================================
// RssReadRecord
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RssReadRecord {
    pub id: Option<i64>,
    pub origin: String,
    pub article_id: i32,
}

// ============================================================================
// BookProgress (unified — progress + sync metadata)
// ============================================================================
//
// One row per book in `book_progress_sync`. Holds:
//   - The four reading-progress columns (durChapterIndex/Pos/Time/Title) so
//     the reader's chapter-flip write can skip the heavy books-table path.
//   - The sync-state fields (lastLocalTime, lastRemoteTime, lastSyncedAt,
//     remoteEtag) so a single round-trip suffices for both save and sync.

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct BookProgress {
    pub book_url: String,
    // Progress (mirrors books.durChapter*)
    pub dur_chapter_index: i32,
    pub dur_chapter_pos: i32,
    pub dur_chapter_time: i64,
    pub dur_chapter_title: Option<String>,
    // Sync metadata
    pub last_local_time: i64,
    pub last_remote_time: i64,
    pub last_synced_at: i64,
    pub remote_etag: Option<String>,
}

impl Default for BookProgress {
    fn default() -> Self {
        Self {
            book_url: String::new(),
            dur_chapter_index: 0,
            dur_chapter_pos: 0,
            dur_chapter_time: 0,
            dur_chapter_title: None,
            last_local_time: 0,
            last_remote_time: 0,
            last_synced_at: 0,
            remote_etag: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookProgressSnapshot {
    pub schema_version: i32,
    pub book_url: String,
    pub book_name: String,
    pub chapter_index: i32,
    pub chapter_pos: i32,
    pub chapter_title: String,
    pub chapter_time: i64,
    pub read_time: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SyncDirection {
    Upload,
    Download,
    Auto,
}

impl Default for SyncDirection {
    fn default() -> Self {
        SyncDirection::Auto
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum SyncBookProgressResult {
    Uploaded {
        book_url: String,
        local_time: i64,
        remote_time: i64,
    },
    Downloaded {
        book_url: String,
        local_time: i64,
        remote_time: i64,
    },
    Skipped {
        book_url: String,
        reason: String,
    },
    Failed {
        book_url: String,
        error: String,
    },
}
