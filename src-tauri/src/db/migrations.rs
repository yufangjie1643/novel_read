/// Database schema creation SQL for Legado
/// Ported from Android Room schema version 75

pub const CREATE_BOOKS_TABLE: &str = r#"
CREATE TABLE IF NOT EXISTS books (
    bookUrl TEXT PRIMARY KEY NOT NULL DEFAULT '',
    tocUrl TEXT NOT NULL DEFAULT '',
    origin TEXT NOT NULL DEFAULT 'local',
    originName TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    author TEXT NOT NULL DEFAULT '',
    kind TEXT,
    customTag TEXT,
    coverUrl TEXT,
    customCoverUrl TEXT,
    intro TEXT,
    customIntro TEXT,
    charset TEXT,
    type INTEGER NOT NULL DEFAULT 0,
    "group" INTEGER NOT NULL DEFAULT 0,
    latestChapterTitle TEXT,
    latestChapterTime INTEGER NOT NULL DEFAULT 0,
    lastCheckTime INTEGER NOT NULL DEFAULT 0,
    lastCheckCount INTEGER NOT NULL DEFAULT 0,
    totalChapterNum INTEGER NOT NULL DEFAULT 0,
    durChapterTitle TEXT,
    durChapterIndex INTEGER NOT NULL DEFAULT 0,
    durChapterPos INTEGER NOT NULL DEFAULT 0,
    durChapterTime INTEGER NOT NULL DEFAULT 0,
    wordCount TEXT,
    canUpdate INTEGER NOT NULL DEFAULT 1,
    "order" INTEGER NOT NULL DEFAULT 0,
    originOrder INTEGER NOT NULL DEFAULT 0,
    variable TEXT,
    readConfig TEXT,
    syncTime INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS index_books_name_author ON books(name, author);
"#;

pub const CREATE_BOOK_CHAPTERS_TABLE: &str = r#"
CREATE TABLE IF NOT EXISTS book_chapters (
    url TEXT NOT NULL,
    bookUrl TEXT NOT NULL,
    "index" INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL DEFAULT '',
    isVolume INTEGER NOT NULL DEFAULT 0,
    isVip INTEGER NOT NULL DEFAULT 0,
    isPay INTEGER NOT NULL DEFAULT 0,
    startFragmentId TEXT,
    endFragmentId TEXT,
    tag TEXT,
    wordCount TEXT,
    PRIMARY KEY (url, bookUrl)
);
"#;

pub const CREATE_BOOK_SOURCES_TABLE: &str = r#"
CREATE TABLE IF NOT EXISTS book_sources (
    bookSourceUrl TEXT PRIMARY KEY NOT NULL,
    bookSourceName TEXT NOT NULL DEFAULT '',
    bookSourceGroup TEXT,
    bookSourceType INTEGER NOT NULL DEFAULT 0,
    bookUrlPattern TEXT,
    customOrder INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    enabledExplore INTEGER NOT NULL DEFAULT 1,
    jsLib TEXT,
    enabledCookieJar INTEGER DEFAULT 1,
    concurrentRate TEXT,
    header TEXT,
    loginUrl TEXT,
    loginUi TEXT,
    loginCheckJs TEXT,
    coverDecodeJs TEXT,
    bookSourceComment TEXT,
    variableComment TEXT,
    lastUpdateTime INTEGER NOT NULL DEFAULT 0,
    respondTime INTEGER NOT NULL DEFAULT 180000,
    weight INTEGER NOT NULL DEFAULT 0,
    exploreUrl TEXT,
    exploreScreen TEXT,
    ruleExplore TEXT,
    searchUrl TEXT,
    ruleSearch TEXT,
    ruleBookInfo TEXT,
    ruleToc TEXT,
    ruleContent TEXT,
    ruleReview TEXT
);
"#;

pub const CREATE_BOOK_GROUPS_TABLE: &str = r#"
CREATE TABLE IF NOT EXISTS book_groups (
    groupId INTEGER PRIMARY KEY NOT NULL,
    groupName TEXT NOT NULL DEFAULT '',
    "order" INTEGER NOT NULL DEFAULT 0,
    show INTEGER NOT NULL DEFAULT 1,
    enableRefresh INTEGER NOT NULL DEFAULT 1
);
"#;

pub const CREATE_REPLACE_RULES_TABLE: &str = r#"
CREATE TABLE IF NOT EXISTS replace_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    pattern TEXT,
    replacement TEXT,
    scope TEXT,
    isRegex INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    "order" INTEGER NOT NULL DEFAULT 0
);
"#;

pub const CREATE_SEARCH_BOOKS_TABLE: &str = r#"
CREATE TABLE IF NOT EXISTS search_books (
    bookUrl TEXT PRIMARY KEY NOT NULL,
    origin TEXT NOT NULL DEFAULT '',
    originName TEXT,
    name TEXT NOT NULL DEFAULT '',
    author TEXT,
    kind TEXT,
    coverUrl TEXT,
    intro TEXT,
    wordCount TEXT,
    latestChapterTitle TEXT,
    tocUrl TEXT,
    variable TEXT,
    originOrder INTEGER NOT NULL DEFAULT 0
);
"#;

pub const CREATE_SEARCH_KEYWORDS_TABLE: &str = r#"
CREATE TABLE IF NOT EXISTS search_keywords (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword TEXT NOT NULL,
    usageCount INTEGER NOT NULL DEFAULT 1,
    lastUseTime INTEGER NOT NULL DEFAULT 0
);
"#;

pub const CREATE_COOKIES_TABLE: &str = r#"
CREATE TABLE IF NOT EXISTS cookies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    cookie TEXT NOT NULL
);
"#;

pub const CREATE_CACHES_TABLE: &str = r#"
CREATE TABLE IF NOT EXISTS caches (
    "key" TEXT PRIMARY KEY NOT NULL,
    value TEXT,
    deadline INTEGER NOT NULL DEFAULT 0
);
"#;

pub const CREATE_BOOKMARKS_TABLE: &str = r#"
CREATE TABLE IF NOT EXISTS bookmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bookName TEXT NOT NULL DEFAULT '',
    bookAuthor TEXT NOT NULL DEFAULT '',
    chapterName TEXT,
    bookUrl TEXT,
    chapterUrl TEXT,
    chapterIndex INTEGER NOT NULL DEFAULT 0,
    pageIndex INTEGER NOT NULL DEFAULT 0,
    content TEXT
);
"#;

pub const CREATE_READ_RECORDS_TABLE: &str = r#"
CREATE TABLE IF NOT EXISTS read_records (
    bookName TEXT PRIMARY KEY NOT NULL,
    readTime INTEGER NOT NULL DEFAULT 0,
    lastRead INTEGER NOT NULL DEFAULT 0
);
"#;

pub const CREATE_HTTP_TTS_TABLE: &str = r#"
CREATE TABLE IF NOT EXISTS http_tts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    url TEXT,
    contentType TEXT,
    loginUrl TEXT,
    loginUi TEXT,
    header TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    concurrentRate TEXT,
    lastUpdateTime INTEGER NOT NULL DEFAULT 0
);
"#;

pub const CREATE_RSS_SOURCES_TABLE: &str = r#"
CREATE TABLE IF NOT EXISTS rss_sources (
    sourceUrl TEXT PRIMARY KEY NOT NULL,
    sourceName TEXT NOT NULL DEFAULT '',
    sourceGroup TEXT,
    sourceIcon TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    variable TEXT,
    customOrder INTEGER NOT NULL DEFAULT 0,
    lastUpdateTime INTEGER NOT NULL DEFAULT 0,
    loginUrl TEXT,
    loginUi TEXT,
    header TEXT,
    sortUrl TEXT,
    ruleArticles TEXT,
    ruleNextPage TEXT,
    ruleTitle TEXT,
    rulePubDate TEXT,
    ruleDescription TEXT,
    ruleImage TEXT,
    ruleLink TEXT,
    ruleContent TEXT
);
"#;

pub const CREATE_RSS_ARTICLES_TABLE: &str = r#"
CREATE TABLE IF NOT EXISTS rss_articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    origin TEXT NOT NULL,
    sort TEXT,
    title TEXT NOT NULL DEFAULT '',
    content TEXT,
    description TEXT,
    link TEXT,
    pubDate TEXT,
    variable TEXT
);
"#;

pub const CREATE_TXT_TOC_RULES_TABLE: &str = r#"
CREATE TABLE IF NOT EXISTS txt_toc_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    rule TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    "order" INTEGER NOT NULL DEFAULT 0
);
"#;

pub const CREATE_RULE_SUBS_TABLE: &str = r#"
CREATE TABLE IF NOT EXISTS rule_subs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    url TEXT,
    type INTEGER NOT NULL DEFAULT 0,
    customOrder INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    autoUpdate INTEGER NOT NULL DEFAULT 1,
    lastUpdateTime INTEGER NOT NULL DEFAULT 0
);
"#;

pub const CREATE_DICT_RULES_TABLE: &str = r#"
CREATE TABLE IF NOT EXISTS dict_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    url TEXT,
    enabled INTEGER NOT NULL DEFAULT 1
);
"#;

pub const CREATE_KEYBOARD_ASSISTS_TABLE: &str = r#"
CREATE TABLE IF NOT EXISTS keyboard_assists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type INTEGER NOT NULL DEFAULT 0,
    "key" TEXT,
    value TEXT,
    serialNo INTEGER NOT NULL DEFAULT 0
);
"#;

pub const CREATE_SERVERS_TABLE: &str = r#"
CREATE TABLE IF NOT EXISTS servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    url TEXT,
    enabled INTEGER NOT NULL DEFAULT 1
);
"#;

pub const CREATE_RSS_STARS_TABLE: &str = r#"
CREATE TABLE IF NOT EXISTS rss_stars (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    origin TEXT NOT NULL,
    sort TEXT,
    title TEXT NOT NULL DEFAULT ''
);
"#;

pub const CREATE_RSS_READ_RECORDS_TABLE: &str = r#"
CREATE TABLE IF NOT EXISTS rss_read_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    origin TEXT NOT NULL,
    articleId INTEGER NOT NULL DEFAULT 0
);
"#;

pub const CREATE_CHAPTER_CONTENTS_TABLE: &str = r#"
CREATE TABLE IF NOT EXISTS chapter_contents (
    bookUrl TEXT NOT NULL,
    chapterIndex INTEGER NOT NULL DEFAULT 0,
    content TEXT NOT NULL DEFAULT '',
    updateTime INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (bookUrl, chapterIndex)
);
"#;

/// Execute all migration statements
pub fn run_migrations(conn: &rusqlite::Connection) -> rusqlite::Result<()> {
    conn.execute_batch(CREATE_BOOKS_TABLE)?;
    conn.execute_batch(CREATE_BOOK_CHAPTERS_TABLE)?;
    conn.execute_batch(CREATE_BOOK_SOURCES_TABLE)?;
    conn.execute_batch(CREATE_BOOK_GROUPS_TABLE)?;
    conn.execute_batch(CREATE_REPLACE_RULES_TABLE)?;
    conn.execute_batch(CREATE_SEARCH_BOOKS_TABLE)?;
    conn.execute_batch(CREATE_SEARCH_KEYWORDS_TABLE)?;
    conn.execute_batch(CREATE_COOKIES_TABLE)?;
    conn.execute_batch(CREATE_CACHES_TABLE)?;
    conn.execute_batch(CREATE_BOOKMARKS_TABLE)?;
    conn.execute_batch(CREATE_READ_RECORDS_TABLE)?;
    conn.execute_batch(CREATE_HTTP_TTS_TABLE)?;
    conn.execute_batch(CREATE_RSS_SOURCES_TABLE)?;
    conn.execute_batch(CREATE_RSS_ARTICLES_TABLE)?;
    conn.execute_batch(CREATE_TXT_TOC_RULES_TABLE)?;
    conn.execute_batch(CREATE_RULE_SUBS_TABLE)?;
    conn.execute_batch(CREATE_DICT_RULES_TABLE)?;
    conn.execute_batch(CREATE_KEYBOARD_ASSISTS_TABLE)?;
    conn.execute_batch(CREATE_SERVERS_TABLE)?;
    conn.execute_batch(CREATE_RSS_STARS_TABLE)?;
    conn.execute_batch(CREATE_RSS_READ_RECORDS_TABLE)?;
    conn.execute_batch(CREATE_CHAPTER_CONTENTS_TABLE)?;
    Ok(())
}
