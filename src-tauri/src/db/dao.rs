use super::models::{
    Book, BookChapter, BookGroup, BookSource, Bookmark, DictRule, ExploreItem, ExploreItemsPage,
    HttpTTS, KeyboardAssist, ReadRecord, ReplaceRule, RssArticle, RssReadRecord, RssSource,
    RssStar, RuleSub, SearchKeyword, Server, TxtTocRule,
};
use super::Database;
use rusqlite::{params, Connection, Result, Row};

/// Book data access object
pub struct BookDao<'a> {
    db: &'a Database,
}

impl<'a> BookDao<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    /// Insert a book using a provided connection (for transactions)
    pub fn insert_conn(&self, conn: &Connection, book: &Book) -> Result<()> {
        conn.execute(
            r#"INSERT INTO books (
                bookUrl, tocUrl, origin, originName, name, author, kind, customTag,
                coverUrl, customCoverUrl, intro, customIntro, charset, type, "group",
                latestChapterTitle, latestChapterTime, lastCheckTime, lastCheckCount,
                totalChapterNum, durChapterTitle, durChapterIndex, durChapterPos,
                durChapterTime, wordCount, canUpdate, "order", originOrder,
                variable, readConfig, syncTime
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
                      ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30, ?31)"#,
            params![
                book.book_url, book.toc_url, book.origin, book.origin_name, book.name, book.author,
                book.kind, book.custom_tag, book.cover_url, book.custom_cover_url, book.intro,
                book.custom_intro, book.charset, book.book_type, book.group, book.latest_chapter_title,
                book.latest_chapter_time, book.last_check_time, book.last_check_count, book.total_chapter_num,
                book.dur_chapter_title, book.dur_chapter_index, book.dur_chapter_pos, book.dur_chapter_time,
                book.word_count, book.can_update as i32, book.order, book.origin_order, book.variable,
                book.read_config, book.sync_time
            ],
        )?;
        Ok(())
    }

    /// Insert a book
    pub fn insert(&self, book: &Book) -> Result<()> {
        self.insert_conn(&self.db.conn(), book)
    }

    /// Update a book using a provided connection (for transactions)
    pub fn update_conn(&self, conn: &Connection, book: &Book) -> Result<()> {
        conn.execute(
            r#"UPDATE books SET
                tocUrl = ?2, origin = ?3, originName = ?4, name = ?5, author = ?6,
                kind = ?7, customTag = ?8, coverUrl = ?9, customCoverUrl = ?10,
                intro = ?11, customIntro = ?12, charset = ?13, type = ?14, "group" = ?15,
                latestChapterTitle = ?16, latestChapterTime = ?17, lastCheckTime = ?18,
                lastCheckCount = ?19, totalChapterNum = ?20, durChapterTitle = ?21,
                durChapterIndex = ?22, durChapterPos = ?23, durChapterTime = ?24,
                wordCount = ?25, canUpdate = ?26, "order" = ?27, originOrder = ?28,
                variable = ?29, readConfig = ?30, syncTime = ?31
            WHERE bookUrl = ?1"#,
            params![
                book.book_url,
                book.toc_url,
                book.origin,
                book.origin_name,
                book.name,
                book.author,
                book.kind,
                book.custom_tag,
                book.cover_url,
                book.custom_cover_url,
                book.intro,
                book.custom_intro,
                book.charset,
                book.book_type,
                book.group,
                book.latest_chapter_title,
                book.latest_chapter_time,
                book.last_check_time,
                book.last_check_count,
                book.total_chapter_num,
                book.dur_chapter_title,
                book.dur_chapter_index,
                book.dur_chapter_pos,
                book.dur_chapter_time,
                book.word_count,
                book.can_update as i32,
                book.order,
                book.origin_order,
                book.variable,
                book.read_config,
                book.sync_time
            ],
        )?;
        Ok(())
    }

    /// Update a book
    pub fn update(&self, book: &Book) -> Result<()> {
        self.update_conn(&self.db.conn(), book)
    }

    /// Delete a book by URL, cascading to related records
    pub fn delete(&self, book_url: &str) -> Result<()> {
        let mut conn = self.db.conn();
        let tx = conn.transaction()?;

        // Get book name for read_records cleanup
        let book_name: Option<String> = {
            let mut stmt = tx.prepare("SELECT name FROM books WHERE bookUrl = ?1")?;
            let mut rows = stmt.query(params![book_url])?;
            rows.next()?.and_then(|r| r.get(0).ok())
        };

        tx.execute(
            "DELETE FROM book_chapters WHERE bookUrl = ?1",
            params![book_url],
        )?;
        tx.execute(
            "DELETE FROM bookmarks WHERE bookUrl = ?1",
            params![book_url],
        )?;
        tx.execute(
            "DELETE FROM chapter_contents WHERE bookUrl = ?1",
            params![book_url],
        )?;
        if let Some(ref name) = book_name {
            tx.execute(
                "DELETE FROM read_records WHERE bookName = ?1",
                params![name],
            )?;
        }
        tx.execute("DELETE FROM books WHERE bookUrl = ?1", params![book_url])?;

        tx.commit()?;
        Ok(())
    }

    /// Get a book by URL
    pub fn get(&self, book_url: &str) -> Result<Option<Book>> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare("SELECT * FROM books WHERE bookUrl = ?1")?;
        let mut rows = stmt.query(params![book_url])?;

        if let Some(row) = rows.next()? {
            Ok(Some(Self::row_to_book(row)?))
        } else {
            Ok(None)
        }
    }

    /// Get all books
    pub fn get_all(&self) -> Result<Vec<Book>> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare("SELECT * FROM books ORDER BY \"order\"")?;
        let rows = stmt.query_map([], Self::row_to_book)?;
        rows.collect()
    }

    /// Get books by group
    pub fn get_by_group(&self, group_id: i64) -> Result<Vec<Book>> {
        let conn = self.db.conn();
        let mut stmt =
            conn.prepare("SELECT * FROM books WHERE \"group\" = ?1 ORDER BY \"order\"")?;
        let rows = stmt.query_map(params![group_id], Self::row_to_book)?;
        rows.collect()
    }

    /// Check if book exists
    pub fn exists(&self, book_url: &str) -> Result<bool> {
        let count: i64 = self.db.conn().query_row(
            "SELECT COUNT(*) FROM books WHERE bookUrl = ?1",
            params![book_url],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    /// Convert a database row to a Book struct
    fn row_to_book(row: &Row) -> Result<Book> {
        Ok(Book {
            book_url: row.get("bookUrl")?,
            toc_url: row.get("tocUrl")?,
            origin: row.get("origin")?,
            origin_name: row.get("originName")?,
            name: row.get("name")?,
            author: row.get("author")?,
            kind: row.get("kind").ok(),
            custom_tag: row.get("customTag").ok(),
            cover_url: row.get("coverUrl").ok(),
            custom_cover_url: row.get("customCoverUrl").ok(),
            intro: row.get("intro").ok(),
            custom_intro: row.get("customIntro").ok(),
            charset: row.get("charset").ok(),
            book_type: row.get("type")?,
            group: row.get("group")?,
            latest_chapter_title: row.get("latestChapterTitle").ok(),
            latest_chapter_time: row.get("latestChapterTime")?,
            last_check_time: row.get("lastCheckTime")?,
            last_check_count: row.get("lastCheckCount")?,
            total_chapter_num: row.get("totalChapterNum")?,
            dur_chapter_title: row.get("durChapterTitle").ok(),
            dur_chapter_index: row.get("durChapterIndex")?,
            dur_chapter_pos: row.get("durChapterPos")?,
            dur_chapter_time: row.get("durChapterTime")?,
            word_count: row.get("wordCount").ok(),
            can_update: row.get::<_, i32>("canUpdate")? != 0,
            order: row.get("order")?,
            origin_order: row.get("originOrder")?,
            variable: row.get("variable").ok(),
            read_config: row.get("readConfig").ok(),
            sync_time: row.get("syncTime")?,
        })
    }
}

// ============================================================================
// BookSourceDao
// ============================================================================

pub struct BookSourceDao<'a> {
    db: &'a Database,
}

impl<'a> BookSourceDao<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    pub fn insert(&self, source: &BookSource) -> Result<()> {
        self.db.conn().execute(
            r#"INSERT INTO book_sources (
                bookSourceUrl, bookSourceName, bookSourceGroup, bookSourceType, bookUrlPattern,
                customOrder, enabled, enabledExplore, jsLib, enabledCookieJar, concurrentRate,
                header, loginUrl, loginUi, loginCheckJs, coverDecodeJs, bookSourceComment,
                variableComment, lastUpdateTime, respondTime, weight, exploreUrl, exploreScreen,
                ruleExplore, searchUrl, ruleSearch, ruleBookInfo, ruleToc, ruleContent, ruleReview
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30)"#,
            params![
                source.book_source_url, source.book_source_name, source.book_source_group, source.book_source_type,
                source.book_url_pattern, source.custom_order, source.enabled as i32, source.enabled_explore as i32,
                source.js_lib, source.enabled_cookie_jar, source.concurrent_rate, source.header, source.login_url,
                source.login_ui, source.login_check_js, source.cover_decode_js, source.book_source_comment,
                source.variable_comment, source.last_update_time, source.respond_time, source.weight,
                source.explore_url, source.explore_screen, source.rule_explore, source.search_url,
                source.rule_search, source.rule_book_info, source.rule_toc, source.rule_content, source.rule_review
            ],
        )?;
        Ok(())
    }

    pub fn update(&self, source: &BookSource) -> Result<()> {
        self.db.conn().execute(
            r#"UPDATE book_sources SET
                bookSourceName = ?2, bookSourceGroup = ?3, bookSourceType = ?4, bookUrlPattern = ?5,
                customOrder = ?6, enabled = ?7, enabledExplore = ?8, jsLib = ?9, enabledCookieJar = ?10,
                concurrentRate = ?11, header = ?12, loginUrl = ?13, loginUi = ?14, loginCheckJs = ?15,
                coverDecodeJs = ?16, bookSourceComment = ?17, variableComment = ?18, lastUpdateTime = ?19,
                respondTime = ?20, weight = ?21, exploreUrl = ?22, exploreScreen = ?23, ruleExplore = ?24,
                searchUrl = ?25, ruleSearch = ?26, ruleBookInfo = ?27, ruleToc = ?28, ruleContent = ?29, ruleReview = ?30
            WHERE bookSourceUrl = ?1"#,
            params![
                source.book_source_url, source.book_source_name, source.book_source_group, source.book_source_type,
                source.book_url_pattern, source.custom_order, source.enabled as i32, source.enabled_explore as i32,
                source.js_lib, source.enabled_cookie_jar, source.concurrent_rate, source.header, source.login_url,
                source.login_ui, source.login_check_js, source.cover_decode_js, source.book_source_comment,
                source.variable_comment, source.last_update_time, source.respond_time, source.weight,
                source.explore_url, source.explore_screen, source.rule_explore, source.search_url,
                source.rule_search, source.rule_book_info, source.rule_toc, source.rule_content, source.rule_review
            ],
        )?;
        Ok(())
    }

    pub fn delete(&self, url: &str) -> Result<()> {
        self.db.conn().execute(
            "DELETE FROM book_sources WHERE bookSourceUrl = ?1",
            params![url],
        )?;
        Ok(())
    }

    pub fn get(&self, url: &str) -> Result<Option<BookSource>> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare("SELECT * FROM book_sources WHERE bookSourceUrl = ?1")?;
        let mut rows = stmt.query(params![url])?;
        if let Some(row) = rows.next()? {
            Ok(Some(Self::row_to_source(row)?))
        } else {
            Ok(None)
        }
    }

    pub fn get_all(&self) -> Result<Vec<BookSource>> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare("SELECT * FROM book_sources ORDER BY customOrder")?;
        let rows = stmt.query_map([], Self::row_to_source)?;
        rows.collect()
    }

    pub fn get_enabled(&self) -> Result<Vec<BookSource>> {
        let conn = self.db.conn();
        let mut stmt =
            conn.prepare("SELECT * FROM book_sources WHERE enabled = 1 ORDER BY customOrder")?;
        let rows = stmt.query_map([], Self::row_to_source)?;
        rows.collect()
    }

    pub fn get_explore_enabled(&self) -> Result<Vec<BookSource>> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT * FROM book_sources
             WHERE enabledExplore = 1
               AND exploreUrl IS NOT NULL
               AND trim(exploreUrl) <> ''
             ORDER BY customOrder",
        )?;
        let rows = stmt.query_map([], Self::row_to_source)?;
        rows.collect()
    }

    pub fn get_explore_items(
        &self,
        offset: usize,
        limit: usize,
        filter: Option<&str>,
    ) -> Result<ExploreItemsPage> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT bookSourceUrl, bookSourceName, exploreUrl FROM book_sources
             WHERE enabledExplore = 1
               AND exploreUrl IS NOT NULL
               AND trim(exploreUrl) <> ''
             ORDER BY customOrder",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>("bookSourceUrl")?,
                row.get::<_, String>("bookSourceName")?,
                row.get::<_, Option<String>>("exploreUrl")?,
            ))
        })?;

        let filter = filter
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.to_lowercase());
        let mut total = 0usize;
        let mut item_index = 0usize;
        let mut items = Vec::with_capacity(limit.min(128));

        for row in rows {
            let (source_url, source_name, explore_url) = row?;
            let source_name_lc = source_name.to_lowercase();
            let Some(explore_url) = explore_url else {
                continue;
            };

            for line in explore_url.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }

                let id = format!("{}|{}", source_url, item_index);
                item_index += 1;

                let (label, url) = if let Some((label, url)) = trimmed.split_once("::") {
                    let label = label.trim();
                    let label = if label.is_empty() {
                        source_name.clone()
                    } else {
                        label.to_string()
                    };
                    (label, url.trim().to_string())
                } else {
                    (source_name.clone(), trimmed.to_string())
                };

                if url.is_empty() {
                    continue;
                }

                if let Some(filter) = &filter {
                    let label_lc = label.to_lowercase();
                    if !label_lc.contains(filter) && !source_name_lc.contains(filter) {
                        continue;
                    }
                }

                if total >= offset && items.len() < limit {
                    items.push(ExploreItem {
                        id,
                        source_url: source_url.clone(),
                        source_name: source_name.clone(),
                        label,
                        url,
                    });
                }
                total += 1;
            }
        }

        Ok(ExploreItemsPage { items, total })
    }

    pub fn exists(&self, url: &str) -> Result<bool> {
        let count: i64 = self.db.conn().query_row(
            "SELECT COUNT(*) FROM book_sources WHERE bookSourceUrl = ?1",
            params![url],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    fn row_to_source(row: &Row) -> Result<BookSource> {
        Ok(BookSource {
            book_source_url: row.get("bookSourceUrl")?,
            book_source_name: row.get("bookSourceName")?,
            book_source_group: row.get("bookSourceGroup").ok(),
            book_source_type: row.get("bookSourceType")?,
            book_url_pattern: row.get("bookUrlPattern").ok(),
            custom_order: row.get("customOrder")?,
            enabled: row.get::<_, i32>("enabled")? != 0,
            enabled_explore: row.get::<_, i32>("enabledExplore")? != 0,
            js_lib: row.get("jsLib").ok(),
            enabled_cookie_jar: row.get("enabledCookieJar").ok().map(|v: i32| v != 0),
            concurrent_rate: row.get("concurrentRate").ok(),
            header: row.get("header").ok(),
            login_url: row.get("loginUrl").ok(),
            login_ui: row.get("loginUi").ok(),
            login_check_js: row.get("loginCheckJs").ok(),
            cover_decode_js: row.get("coverDecodeJs").ok(),
            book_source_comment: row.get("bookSourceComment").ok(),
            variable_comment: row.get("variableComment").ok(),
            last_update_time: row.get("lastUpdateTime")?,
            respond_time: row.get("respondTime")?,
            weight: row.get("weight")?,
            explore_url: row.get("exploreUrl").ok(),
            explore_screen: row.get("exploreScreen").ok(),
            rule_explore: row.get("ruleExplore").ok(),
            search_url: row.get("searchUrl").ok(),
            rule_search: row.get("ruleSearch").ok(),
            rule_book_info: row.get("ruleBookInfo").ok(),
            rule_toc: row.get("ruleToc").ok(),
            rule_content: row.get("ruleContent").ok(),
            rule_review: row.get("ruleReview").ok(),
        })
    }
}

// ============================================================================
// BookChapterDao
// ============================================================================

pub struct BookChapterDao<'a> {
    db: &'a Database,
}

impl<'a> BookChapterDao<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    pub fn insert(&self, chapter: &BookChapter) -> Result<()> {
        self.db.conn().execute(
            r#"INSERT INTO book_chapters (
                url, bookUrl, "index", title, isVolume, isVip, isPay,
                startFragmentId, endFragmentId, tag, wordCount
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)"#,
            params![
                chapter.url,
                chapter.book_url,
                chapter.index,
                chapter.title,
                chapter.is_volume as i32,
                chapter.is_vip as i32,
                chapter.is_pay as i32,
                chapter.start_fragment_id,
                chapter.end_fragment_id,
                chapter.tag,
                chapter.word_count
            ],
        )?;
        Ok(())
    }

    /// Insert many chapters using a provided connection (for transactions)
    pub fn insert_many_conn(&self, conn: &Connection, chapters: &[BookChapter]) -> Result<()> {
        let mut stmt = conn.prepare(
            r#"INSERT INTO book_chapters (
                url, bookUrl, "index", title, isVolume, isVip, isPay,
                startFragmentId, endFragmentId, tag, wordCount
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)"#,
        )?;
        for chapter in chapters {
            stmt.execute(params![
                chapter.url,
                chapter.book_url,
                chapter.index,
                chapter.title,
                chapter.is_volume as i32,
                chapter.is_vip as i32,
                chapter.is_pay as i32,
                chapter.start_fragment_id,
                chapter.end_fragment_id,
                chapter.tag,
                chapter.word_count
            ])?;
        }
        Ok(())
    }

    pub fn insert_many(&self, chapters: &[BookChapter]) -> Result<()> {
        let mut conn = self.db.conn();
        let tx = conn.transaction()?;
        self.insert_many_conn(&tx, chapters)?;
        tx.commit()?;
        Ok(())
    }

    pub fn delete_by_book(&self, book_url: &str) -> Result<()> {
        self.db.conn().execute(
            "DELETE FROM book_chapters WHERE bookUrl = ?1",
            params![book_url],
        )?;
        Ok(())
    }

    pub fn get_chapters(&self, book_url: &str) -> Result<Vec<BookChapter>> {
        let conn = self.db.conn();
        let mut stmt =
            conn.prepare("SELECT * FROM book_chapters WHERE bookUrl = ?1 ORDER BY \"index\"")?;
        let rows = stmt.query_map(params![book_url], Self::row_to_chapter)?;
        rows.collect()
    }

    pub fn get_chapter(&self, book_url: &str, index: i32) -> Result<Option<BookChapter>> {
        let conn = self.db.conn();
        let mut stmt =
            conn.prepare("SELECT * FROM book_chapters WHERE bookUrl = ?1 AND \"index\" = ?2")?;
        let mut rows = stmt.query(params![book_url, index])?;
        if let Some(row) = rows.next()? {
            Ok(Some(Self::row_to_chapter(row)?))
        } else {
            Ok(None)
        }
    }

    pub fn get_count(&self, book_url: &str) -> Result<i64> {
        let count: i64 = self.db.conn().query_row(
            "SELECT COUNT(*) FROM book_chapters WHERE bookUrl = ?1",
            params![book_url],
            |row| row.get(0),
        )?;
        Ok(count)
    }

    fn row_to_chapter(row: &Row) -> Result<BookChapter> {
        Ok(BookChapter {
            url: row.get("url")?,
            book_url: row.get("bookUrl")?,
            index: row.get("index")?,
            title: row.get("title")?,
            is_volume: row.get::<_, i32>("isVolume")? != 0,
            is_vip: row.get::<_, i32>("isVip")? != 0,
            is_pay: row.get::<_, i32>("isPay")? != 0,
            start_fragment_id: row.get("startFragmentId").ok(),
            end_fragment_id: row.get("endFragmentId").ok(),
            tag: row.get("tag").ok(),
            word_count: row.get("wordCount").ok(),
        })
    }
}

// ============================================================================
// BookGroupDao
// ============================================================================

pub struct BookGroupDao<'a> {
    db: &'a Database,
}

impl<'a> BookGroupDao<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    pub fn insert(&self, group: &BookGroup) -> Result<()> {
        self.db.conn().execute(
            r#"INSERT INTO book_groups (
                groupId, groupName, "order", show, enableRefresh
            ) VALUES (?1, ?2, ?3, ?4, ?5)"#,
            params![
                group.group_id,
                group.group_name,
                group.order,
                group.show as i32,
                group.enable_refresh as i32
            ],
        )?;
        Ok(())
    }

    pub fn update(&self, group: &BookGroup) -> Result<()> {
        self.db.conn().execute(
            r#"UPDATE book_groups SET
                groupName = ?2, "order" = ?3, show = ?4, enableRefresh = ?5
            WHERE groupId = ?1"#,
            params![
                group.group_id,
                group.group_name,
                group.order,
                group.show as i32,
                group.enable_refresh as i32
            ],
        )?;
        Ok(())
    }

    pub fn delete(&self, group_id: i64) -> Result<()> {
        self.db.conn().execute(
            "DELETE FROM book_groups WHERE groupId = ?1",
            params![group_id],
        )?;
        Ok(())
    }

    pub fn get(&self, group_id: i64) -> Result<Option<BookGroup>> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare("SELECT * FROM book_groups WHERE groupId = ?1")?;
        let mut rows = stmt.query(params![group_id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(Self::row_to_group(row)?))
        } else {
            Ok(None)
        }
    }

    pub fn get_all(&self) -> Result<Vec<BookGroup>> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare("SELECT * FROM book_groups ORDER BY \"order\"")?;
        let rows = stmt.query_map([], Self::row_to_group)?;
        rows.collect()
    }

    pub fn get_visible(&self) -> Result<Vec<BookGroup>> {
        let conn = self.db.conn();
        let mut stmt =
            conn.prepare("SELECT * FROM book_groups WHERE show = 1 ORDER BY \"order\"")?;
        let rows = stmt.query_map([], Self::row_to_group)?;
        rows.collect()
    }

    fn row_to_group(row: &Row) -> Result<BookGroup> {
        Ok(BookGroup {
            group_id: row.get("groupId")?,
            group_name: row.get("groupName")?,
            order: row.get("order")?,
            show: row.get::<_, i32>("show")? != 0,
            enable_refresh: row.get::<_, i32>("enableRefresh")? != 0,
        })
    }
}

// ============================================================================
// ReplaceRuleDao
// ============================================================================

pub struct ReplaceRuleDao<'a> {
    db: &'a Database,
}

impl<'a> ReplaceRuleDao<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    pub fn insert(&self, rule: &ReplaceRule) -> Result<i64> {
        self.db.conn().execute(
            r#"INSERT INTO replace_rules (
                name, pattern, replacement, scope, isRegex, enabled, "order"
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"#,
            params![
                rule.name,
                rule.pattern,
                rule.replacement,
                rule.scope,
                rule.is_regex as i32,
                rule.enabled as i32,
                rule.order
            ],
        )?;
        Ok(self.db.conn().last_insert_rowid())
    }

    pub fn update(&self, rule: &ReplaceRule) -> Result<()> {
        let id = rule.id.ok_or(rusqlite::Error::InvalidParameterName(
            "id is required for update".to_string(),
        ))?;
        self.db.conn().execute(
            r#"UPDATE replace_rules SET
                name = ?2, pattern = ?3, replacement = ?4, scope = ?5,
                isRegex = ?6, enabled = ?7, "order" = ?8
            WHERE id = ?1"#,
            params![
                id,
                rule.name,
                rule.pattern,
                rule.replacement,
                rule.scope,
                rule.is_regex as i32,
                rule.enabled as i32,
                rule.order
            ],
        )?;
        Ok(())
    }

    pub fn delete(&self, id: i64) -> Result<()> {
        self.db
            .conn()
            .execute("DELETE FROM replace_rules WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn get(&self, id: i64) -> Result<Option<ReplaceRule>> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare("SELECT * FROM replace_rules WHERE id = ?1")?;
        let mut rows = stmt.query(params![id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(Self::row_to_rule(row)?))
        } else {
            Ok(None)
        }
    }

    pub fn get_all(&self) -> Result<Vec<ReplaceRule>> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare("SELECT * FROM replace_rules ORDER BY \"order\"")?;
        let rows = stmt.query_map([], Self::row_to_rule)?;
        rows.collect()
    }

    pub fn get_enabled(&self) -> Result<Vec<ReplaceRule>> {
        let conn = self.db.conn();
        let mut stmt =
            conn.prepare("SELECT * FROM replace_rules WHERE enabled = 1 ORDER BY \"order\"")?;
        let rows = stmt.query_map([], Self::row_to_rule)?;
        rows.collect()
    }

    pub fn get_by_scope(&self, scope: &str) -> Result<Vec<ReplaceRule>> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT * FROM replace_rules WHERE enabled = 1 AND (scope IS NULL OR scope = '' OR scope LIKE ?1) ORDER BY \"order\""
        )?;
        let rows = stmt.query_map(params![format!("%{}%", scope)], Self::row_to_rule)?;
        rows.collect()
    }

    fn row_to_rule(row: &Row) -> Result<ReplaceRule> {
        Ok(ReplaceRule {
            id: row.get("id").ok(),
            name: row.get("name").ok(),
            pattern: row.get("pattern").ok(),
            replacement: row.get("replacement").ok(),
            scope: row.get("scope").ok(),
            is_regex: row.get::<_, i32>("isRegex")? != 0,
            enabled: row.get::<_, i32>("enabled")? != 0,
            order: row.get("order")?,
        })
    }
}

// ============================================================================
// SearchKeywordDao
// ============================================================================

pub struct SearchKeywordDao<'a> {
    db: &'a Database,
}

impl<'a> SearchKeywordDao<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    pub fn insert_or_update(&self, keyword: &str) -> Result<()> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;

        self.db.conn().execute(
            r#"INSERT INTO search_keywords (keyword, usageCount, lastUseTime)
               VALUES (?1, 1, ?2)
               ON CONFLICT(keyword) DO UPDATE SET
               usageCount = usageCount + 1, lastUseTime = ?2"#,
            params![keyword, now],
        )?;
        Ok(())
    }

    pub fn get_recent(&self, limit: i64) -> Result<Vec<SearchKeyword>> {
        let conn = self.db.conn();
        let mut stmt =
            conn.prepare("SELECT * FROM search_keywords ORDER BY lastUseTime DESC LIMIT ?1")?;
        let rows = stmt.query_map(params![limit], Self::row_to_keyword)?;
        rows.collect()
    }

    pub fn get_popular(&self, limit: i64) -> Result<Vec<SearchKeyword>> {
        let conn = self.db.conn();
        let mut stmt =
            conn.prepare("SELECT * FROM search_keywords ORDER BY usageCount DESC LIMIT ?1")?;
        let rows = stmt.query_map(params![limit], Self::row_to_keyword)?;
        rows.collect()
    }

    pub fn delete(&self, id: i64) -> Result<()> {
        self.db
            .conn()
            .execute("DELETE FROM search_keywords WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn clear(&self) -> Result<()> {
        self.db.conn().execute("DELETE FROM search_keywords", [])?;
        Ok(())
    }

    fn row_to_keyword(row: &Row) -> Result<SearchKeyword> {
        Ok(SearchKeyword {
            id: row.get("id").ok(),
            keyword: row.get("keyword")?,
            usage_count: row.get("usageCount")?,
            last_use_time: row.get("lastUseTime")?,
        })
    }
}

// ============================================================================
// CookieDao
// ============================================================================

pub struct CookieDao<'a> {
    db: &'a Database,
}

impl<'a> CookieDao<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    pub fn insert_or_update(&self, url: &str, cookie: &str) -> Result<i64> {
        self.db.conn().execute(
            r#"INSERT INTO cookies (url, cookie) VALUES (?1, ?2)
               ON CONFLICT(url) DO UPDATE SET cookie = ?2"#,
            params![url, cookie],
        )?;
        Ok(self.db.conn().last_insert_rowid())
    }

    pub fn get(&self, url: &str) -> Result<Option<String>> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare("SELECT cookie FROM cookies WHERE url = ?1")?;
        let mut rows = stmt.query(params![url])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    pub fn delete(&self, url: &str) -> Result<()> {
        self.db
            .conn()
            .execute("DELETE FROM cookies WHERE url = ?1", params![url])?;
        Ok(())
    }

    pub fn clear(&self) -> Result<()> {
        self.db.conn().execute("DELETE FROM cookies", [])?;
        Ok(())
    }
}

// ============================================================================
// CacheDao
// ============================================================================

pub struct CacheDao<'a> {
    db: &'a Database,
}

impl<'a> CacheDao<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    pub fn put(&self, key: &str, value: &str, deadline: i64) -> Result<()> {
        self.db.conn().execute(
            r#"INSERT INTO caches ("key", value, deadline) VALUES (?1, ?2, ?3)
               ON CONFLICT("key") DO UPDATE SET value = ?2, deadline = ?3"#,
            params![key, value, deadline],
        )?;
        Ok(())
    }

    pub fn get(&self, key: &str) -> Result<Option<String>> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;

        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT value FROM caches WHERE \"key\" = ?1 AND (deadline = 0 OR deadline > ?2)",
        )?;
        let mut rows = stmt.query(params![key, now])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    pub fn delete(&self, key: &str) -> Result<()> {
        self.db
            .conn()
            .execute("DELETE FROM caches WHERE \"key\" = ?1", params![key])?;
        Ok(())
    }

    pub fn clear_expired(&self) -> Result<()> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;

        self.db.conn().execute(
            "DELETE FROM caches WHERE deadline > 0 AND deadline < ?1",
            params![now],
        )?;
        Ok(())
    }

    pub fn clear(&self) -> Result<()> {
        self.db.conn().execute("DELETE FROM caches", [])?;
        Ok(())
    }
}

// ============================================================================
// BookmarkDao
// ============================================================================

pub struct BookmarkDao<'a> {
    db: &'a Database,
}

impl<'a> BookmarkDao<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    pub fn insert(&self, bookmark: &Bookmark) -> Result<i64> {
        self.db.conn().execute(
            r#"INSERT INTO bookmarks (
                bookName, bookAuthor, chapterName, bookUrl, chapterUrl,
                chapterIndex, pageIndex, content
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"#,
            params![
                bookmark.book_name,
                bookmark.book_author,
                bookmark.chapter_name,
                bookmark.book_url,
                bookmark.chapter_url,
                bookmark.chapter_index,
                bookmark.page_index,
                bookmark.content
            ],
        )?;
        Ok(self.db.conn().last_insert_rowid())
    }

    pub fn update(&self, bookmark: &Bookmark) -> Result<()> {
        let id = bookmark.id.ok_or(rusqlite::Error::InvalidParameterName(
            "id is required".to_string(),
        ))?;
        self.db.conn().execute(
            r#"UPDATE bookmarks SET
                bookName = ?2, bookAuthor = ?3, chapterName = ?4,
                bookUrl = ?5, chapterUrl = ?6, chapterIndex = ?7,
                pageIndex = ?8, content = ?9
            WHERE id = ?1"#,
            params![
                id,
                bookmark.book_name,
                bookmark.book_author,
                bookmark.chapter_name,
                bookmark.book_url,
                bookmark.chapter_url,
                bookmark.chapter_index,
                bookmark.page_index,
                bookmark.content
            ],
        )?;
        Ok(())
    }

    pub fn delete(&self, id: i64) -> Result<()> {
        self.db
            .conn()
            .execute("DELETE FROM bookmarks WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn delete_by_book(&self, book_url: &str) -> Result<()> {
        self.db.conn().execute(
            "DELETE FROM bookmarks WHERE bookUrl = ?1",
            params![book_url],
        )?;
        Ok(())
    }

    pub fn get_by_book(&self, book_url: &str) -> Result<Vec<Bookmark>> {
        let conn = self.db.conn();
        let mut stmt =
            conn.prepare("SELECT * FROM bookmarks WHERE bookUrl = ?1 ORDER BY chapterIndex")?;
        let rows = stmt.query_map(params![book_url], Self::row_to_bookmark)?;
        rows.collect()
    }

    pub fn get_all(&self) -> Result<Vec<Bookmark>> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare("SELECT * FROM bookmarks ORDER BY id DESC")?;
        let rows = stmt.query_map([], Self::row_to_bookmark)?;
        rows.collect()
    }

    fn row_to_bookmark(row: &Row) -> Result<Bookmark> {
        Ok(Bookmark {
            id: row.get("id").ok(),
            book_name: row.get("bookName")?,
            book_author: row.get("bookAuthor")?,
            chapter_name: row.get("chapterName").ok(),
            book_url: row.get("bookUrl").ok(),
            chapter_url: row.get("chapterUrl").ok(),
            chapter_index: row.get("chapterIndex")?,
            page_index: row.get("pageIndex")?,
            content: row.get("content").ok(),
        })
    }
}

// ============================================================================
// ReadRecordDao
// ============================================================================

pub struct ReadRecordDao<'a> {
    db: &'a Database,
}

impl<'a> ReadRecordDao<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    pub fn upsert(&self, record: &ReadRecord) -> Result<()> {
        self.db.conn().execute(
            r#"INSERT INTO read_records (bookName, readTime, lastRead)
               VALUES (?1, ?2, ?3)
               ON CONFLICT(bookName) DO UPDATE SET
               readTime = readTime + ?2, lastRead = ?3"#,
            params![record.book_name, record.read_time, record.last_read],
        )?;
        Ok(())
    }

    pub fn get(&self, book_name: &str) -> Result<Option<ReadRecord>> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare("SELECT * FROM read_records WHERE bookName = ?1")?;
        let mut rows = stmt.query(params![book_name])?;
        if let Some(row) = rows.next()? {
            Ok(Some(Self::row_to_record(row)?))
        } else {
            Ok(None)
        }
    }

    pub fn get_all(&self) -> Result<Vec<ReadRecord>> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare("SELECT * FROM read_records ORDER BY lastRead DESC")?;
        let rows = stmt.query_map([], Self::row_to_record)?;
        rows.collect()
    }

    pub fn delete(&self, book_name: &str) -> Result<()> {
        self.db.conn().execute(
            "DELETE FROM read_records WHERE bookName = ?1",
            params![book_name],
        )?;
        Ok(())
    }

    fn row_to_record(row: &Row) -> Result<ReadRecord> {
        Ok(ReadRecord {
            book_name: row.get("bookName")?,
            read_time: row.get("readTime")?,
            last_read: row.get("lastRead")?,
        })
    }
}

// ============================================================================
// HttpTTSDao
// ============================================================================

pub struct HttpTTSDao<'a> {
    db: &'a Database,
}

impl<'a> HttpTTSDao<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    pub fn insert(&self, tts: &HttpTTS) -> Result<i64> {
        self.db.conn().execute(
            r#"INSERT INTO http_tts (
                name, url, contentType, loginUrl, loginUi, header,
                enabled, concurrentRate, lastUpdateTime
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"#,
            params![
                tts.name,
                tts.url,
                tts.content_type,
                tts.login_url,
                tts.login_ui,
                tts.header,
                tts.enabled as i32,
                tts.concurrent_rate,
                tts.last_update_time
            ],
        )?;
        Ok(self.db.conn().last_insert_rowid())
    }

    pub fn update(&self, tts: &HttpTTS) -> Result<()> {
        let id = tts.id.ok_or(rusqlite::Error::InvalidParameterName(
            "id is required".to_string(),
        ))?;
        self.db.conn().execute(
            r#"UPDATE http_tts SET
                name = ?2, url = ?3, contentType = ?4, loginUrl = ?5, loginUi = ?6,
                header = ?7, enabled = ?8, concurrentRate = ?9, lastUpdateTime = ?10
            WHERE id = ?1"#,
            params![
                id,
                tts.name,
                tts.url,
                tts.content_type,
                tts.login_url,
                tts.login_ui,
                tts.header,
                tts.enabled as i32,
                tts.concurrent_rate,
                tts.last_update_time
            ],
        )?;
        Ok(())
    }

    pub fn delete(&self, id: i64) -> Result<()> {
        self.db
            .conn()
            .execute("DELETE FROM http_tts WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn get(&self, id: i64) -> Result<Option<HttpTTS>> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare("SELECT * FROM http_tts WHERE id = ?1")?;
        let mut rows = stmt.query(params![id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(Self::row_to_tts(row)?))
        } else {
            Ok(None)
        }
    }

    pub fn get_all(&self) -> Result<Vec<HttpTTS>> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare("SELECT * FROM http_tts ORDER BY id")?;
        let rows = stmt.query_map([], Self::row_to_tts)?;
        rows.collect()
    }

    pub fn get_enabled(&self) -> Result<Vec<HttpTTS>> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare("SELECT * FROM http_tts WHERE enabled = 1 ORDER BY id")?;
        let rows = stmt.query_map([], Self::row_to_tts)?;
        rows.collect()
    }

    fn row_to_tts(row: &Row) -> Result<HttpTTS> {
        Ok(HttpTTS {
            id: row.get("id").ok(),
            name: row.get("name").ok(),
            url: row.get("url").ok(),
            content_type: row.get("contentType").ok(),
            login_url: row.get("loginUrl").ok(),
            login_ui: row.get("loginUi").ok(),
            header: row.get("header").ok(),
            enabled: row.get::<_, i32>("enabled")? != 0,
            concurrent_rate: row.get("concurrentRate").ok(),
            last_update_time: row.get("lastUpdateTime")?,
        })
    }
}

// ============================================================================
// RssSourceDao
// ============================================================================

pub struct RssSourceDao<'a> {
    db: &'a Database,
}

impl<'a> RssSourceDao<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    pub fn insert(&self, source: &RssSource) -> Result<()> {
        self.db.conn().execute(
            r#"INSERT INTO rss_sources (
                sourceUrl, sourceName, sourceGroup, sourceIcon, enabled, variable,
                customOrder, lastUpdateTime, loginUrl, loginUi, header, sortUrl,
                ruleArticles, ruleNextPage, ruleTitle, rulePubDate, ruleDescription,
                ruleImage, ruleLink, ruleContent, singleUrl
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)"#,
            params![
                source.source_url, source.source_name, source.source_group, source.source_icon,
                source.enabled as i32, source.variable, source.custom_order, source.last_update_time,
                source.login_url, source.login_ui, source.header, source.sort_url,
                source.rule_articles, source.rule_next_page, source.rule_title, source.rule_pub_date,
                source.rule_description, source.rule_image, source.rule_link, source.rule_content,
                source.single_url as i32
            ],
        )?;
        Ok(())
    }

    pub fn update(&self, source: &RssSource) -> Result<()> {
        self.db.conn().execute(
            r#"UPDATE rss_sources SET
                sourceName = ?2, sourceGroup = ?3, sourceIcon = ?4, enabled = ?5,
                variable = ?6, customOrder = ?7, lastUpdateTime = ?8, loginUrl = ?9,
                loginUi = ?10, header = ?11, sortUrl = ?12, ruleArticles = ?13,
                ruleNextPage = ?14, ruleTitle = ?15, rulePubDate = ?16,
                ruleDescription = ?17, ruleImage = ?18, ruleLink = ?19, ruleContent = ?20, singleUrl = ?21
            WHERE sourceUrl = ?1"#,
            params![
                source.source_url, source.source_name, source.source_group, source.source_icon,
                source.enabled as i32, source.variable, source.custom_order, source.last_update_time,
                source.login_url, source.login_ui, source.header, source.sort_url,
                source.rule_articles, source.rule_next_page, source.rule_title, source.rule_pub_date,
                source.rule_description, source.rule_image, source.rule_link, source.rule_content,
                source.single_url as i32
            ],
        )?;
        Ok(())
    }

    pub fn delete(&self, url: &str) -> Result<()> {
        self.db
            .conn()
            .execute("DELETE FROM rss_sources WHERE sourceUrl = ?1", params![url])?;
        Ok(())
    }

    pub fn get(&self, url: &str) -> Result<Option<RssSource>> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare("SELECT * FROM rss_sources WHERE sourceUrl = ?1")?;
        let mut rows = stmt.query(params![url])?;
        if let Some(row) = rows.next()? {
            Ok(Some(Self::row_to_source(row)?))
        } else {
            Ok(None)
        }
    }

    pub fn get_all(&self) -> Result<Vec<RssSource>> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare("SELECT * FROM rss_sources ORDER BY customOrder")?;
        let rows = stmt.query_map([], Self::row_to_source)?;
        rows.collect()
    }

    pub fn get_enabled(&self) -> Result<Vec<RssSource>> {
        let conn = self.db.conn();
        let mut stmt =
            conn.prepare("SELECT * FROM rss_sources WHERE enabled = 1 ORDER BY customOrder")?;
        let rows = stmt.query_map([], Self::row_to_source)?;
        rows.collect()
    }

    fn row_to_source(row: &Row) -> Result<RssSource> {
        Ok(RssSource {
            source_url: row.get("sourceUrl")?,
            source_name: row.get("sourceName")?,
            source_group: row.get("sourceGroup").ok(),
            source_icon: row.get("sourceIcon").ok(),
            enabled: row.get::<_, i32>("enabled")? != 0,
            variable: row.get("variable").ok(),
            custom_order: row.get("customOrder")?,
            last_update_time: row.get("lastUpdateTime")?,
            login_url: row.get("loginUrl").ok(),
            login_ui: row.get("loginUi").ok(),
            header: row.get("header").ok(),
            sort_url: row.get("sortUrl").ok(),
            rule_articles: row.get("ruleArticles").ok(),
            rule_next_page: row.get("ruleNextPage").ok(),
            rule_title: row.get("ruleTitle").ok(),
            rule_pub_date: row.get("rulePubDate").ok(),
            rule_description: row.get("ruleDescription").ok(),
            rule_image: row.get("ruleImage").ok(),
            rule_link: row.get("ruleLink").ok(),
            rule_content: row.get("ruleContent").ok(),
            single_url: row.get::<_, i32>("singleUrl").unwrap_or(0) != 0,
        })
    }
}

// ============================================================================
// RssArticleDao
// ============================================================================

pub struct RssArticleDao<'a> {
    db: &'a Database,
}

impl<'a> RssArticleDao<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    pub fn insert(&self, article: &RssArticle) -> Result<i64> {
        self.db.conn().execute(
            r#"INSERT INTO rss_articles (
                origin, sort, title, content, description, link, pubDate, variable
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"#,
            params![
                article.origin,
                article.sort,
                article.title,
                article.content,
                article.description,
                article.link,
                article.pub_date,
                article.variable
            ],
        )?;
        Ok(self.db.conn().last_insert_rowid())
    }

    pub fn insert_many(&self, articles: &[RssArticle]) -> Result<()> {
        let mut conn = self.db.conn();
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare(
                r#"INSERT INTO rss_articles (
                    origin, sort, title, content, description, link, pubDate, variable
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"#,
            )?;
            for article in articles {
                stmt.execute(params![
                    article.origin,
                    article.sort,
                    article.title,
                    article.content,
                    article.description,
                    article.link,
                    article.pub_date,
                    article.variable
                ])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn delete_by_origin(&self, origin: &str) -> Result<()> {
        self.db.conn().execute(
            "DELETE FROM rss_articles WHERE origin = ?1",
            params![origin],
        )?;
        Ok(())
    }

    pub fn get_by_origin(&self, origin: &str) -> Result<Vec<RssArticle>> {
        let conn = self.db.conn();
        let mut stmt =
            conn.prepare("SELECT * FROM rss_articles WHERE origin = ?1 ORDER BY id DESC")?;
        let rows = stmt.query_map(params![origin], Self::row_to_article)?;
        rows.collect()
    }

    pub fn get_all(&self) -> Result<Vec<RssArticle>> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare("SELECT * FROM rss_articles ORDER BY id DESC")?;
        let rows = stmt.query_map([], Self::row_to_article)?;
        rows.collect()
    }

    fn row_to_article(row: &Row) -> Result<RssArticle> {
        Ok(RssArticle {
            id: row.get("id").ok(),
            origin: row.get("origin")?,
            sort: row.get("sort").ok(),
            title: row.get("title")?,
            content: row.get("content").ok(),
            description: row.get("description").ok(),
            link: row.get("link").ok(),
            pub_date: row.get("pubDate").ok(),
            variable: row.get("variable").ok(),
        })
    }
}

// ============================================================================
// TxtTocRuleDao
// ============================================================================

pub struct TxtTocRuleDao<'a> {
    db: &'a Database,
}

impl<'a> TxtTocRuleDao<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    pub fn insert(&self, rule: &TxtTocRule) -> Result<i64> {
        self.db.conn().execute(
            r#"INSERT INTO txt_toc_rules (name, rule, enabled, "order")
               VALUES (?1, ?2, ?3, ?4)"#,
            params![rule.name, rule.rule, rule.enabled as i32, rule.order],
        )?;
        Ok(self.db.conn().last_insert_rowid())
    }

    pub fn update(&self, rule: &TxtTocRule) -> Result<()> {
        let id = rule.id.ok_or(rusqlite::Error::InvalidParameterName(
            "id is required".to_string(),
        ))?;
        self.db.conn().execute(
            r#"UPDATE txt_toc_rules SET name = ?2, rule = ?3, enabled = ?4, "order" = ?5
               WHERE id = ?1"#,
            params![id, rule.name, rule.rule, rule.enabled as i32, rule.order],
        )?;
        Ok(())
    }

    pub fn delete(&self, id: i64) -> Result<()> {
        self.db
            .conn()
            .execute("DELETE FROM txt_toc_rules WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn get_all(&self) -> Result<Vec<TxtTocRule>> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare("SELECT * FROM txt_toc_rules ORDER BY \"order\"")?;
        let rows = stmt.query_map([], Self::row_to_rule)?;
        rows.collect()
    }

    pub fn get_enabled(&self) -> Result<Vec<TxtTocRule>> {
        let conn = self.db.conn();
        let mut stmt =
            conn.prepare("SELECT * FROM txt_toc_rules WHERE enabled = 1 ORDER BY \"order\"")?;
        let rows = stmt.query_map([], Self::row_to_rule)?;
        rows.collect()
    }

    fn row_to_rule(row: &Row) -> Result<TxtTocRule> {
        Ok(TxtTocRule {
            id: row.get("id").ok(),
            name: row.get("name").ok(),
            rule: row.get("rule").ok(),
            enabled: row.get::<_, i32>("enabled")? != 0,
            order: row.get("order")?,
        })
    }
}

// ============================================================================
// RuleSubDao
// ============================================================================

pub struct RuleSubDao<'a> {
    db: &'a Database,
}

impl<'a> RuleSubDao<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    pub fn insert(&self, sub: &RuleSub) -> Result<i64> {
        self.db.conn().execute(
            r#"INSERT INTO rule_subs (
                name, url, type, customOrder, enabled, autoUpdate, lastUpdateTime
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"#,
            params![
                sub.name,
                sub.url,
                sub.sub_type,
                sub.custom_order,
                sub.enabled as i32,
                sub.auto_update as i32,
                sub.last_update_time
            ],
        )?;
        Ok(self.db.conn().last_insert_rowid())
    }

    pub fn update(&self, sub: &RuleSub) -> Result<()> {
        let id = sub.id.ok_or(rusqlite::Error::InvalidParameterName(
            "id is required".to_string(),
        ))?;
        self.db.conn().execute(
            r#"UPDATE rule_subs SET
                name = ?2, url = ?3, type = ?4, customOrder = ?5,
                enabled = ?6, autoUpdate = ?7, lastUpdateTime = ?8
            WHERE id = ?1"#,
            params![
                id,
                sub.name,
                sub.url,
                sub.sub_type,
                sub.custom_order,
                sub.enabled as i32,
                sub.auto_update as i32,
                sub.last_update_time
            ],
        )?;
        Ok(())
    }

    pub fn delete(&self, id: i64) -> Result<()> {
        self.db
            .conn()
            .execute("DELETE FROM rule_subs WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn get_all(&self) -> Result<Vec<RuleSub>> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare("SELECT * FROM rule_subs ORDER BY customOrder")?;
        let rows = stmt.query_map([], Self::row_to_sub)?;
        rows.collect()
    }

    pub fn get_enabled(&self) -> Result<Vec<RuleSub>> {
        let conn = self.db.conn();
        let mut stmt =
            conn.prepare("SELECT * FROM rule_subs WHERE enabled = 1 ORDER BY customOrder")?;
        let rows = stmt.query_map([], Self::row_to_sub)?;
        rows.collect()
    }

    fn row_to_sub(row: &Row) -> Result<RuleSub> {
        Ok(RuleSub {
            id: row.get("id").ok(),
            name: row.get("name").ok(),
            url: row.get("url").ok(),
            sub_type: row.get("type")?,
            custom_order: row.get("customOrder")?,
            enabled: row.get::<_, i32>("enabled")? != 0,
            auto_update: row.get::<_, i32>("autoUpdate")? != 0,
            last_update_time: row.get("lastUpdateTime")?,
        })
    }
}

// ============================================================================
// DictRuleDao
// ============================================================================

pub struct DictRuleDao<'a> {
    db: &'a Database,
}

impl<'a> DictRuleDao<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    pub fn insert(&self, rule: &DictRule) -> Result<i64> {
        self.db.conn().execute(
            "INSERT INTO dict_rules (name, url, enabled) VALUES (?1, ?2, ?3)",
            params![rule.name, rule.url, rule.enabled as i32],
        )?;
        Ok(self.db.conn().last_insert_rowid())
    }

    pub fn update(&self, rule: &DictRule) -> Result<()> {
        let id = rule.id.ok_or(rusqlite::Error::InvalidParameterName(
            "id is required".to_string(),
        ))?;
        self.db.conn().execute(
            "UPDATE dict_rules SET name = ?2, url = ?3, enabled = ?4 WHERE id = ?1",
            params![id, rule.name, rule.url, rule.enabled as i32],
        )?;
        Ok(())
    }

    pub fn delete(&self, id: i64) -> Result<()> {
        self.db
            .conn()
            .execute("DELETE FROM dict_rules WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn get_all(&self) -> Result<Vec<DictRule>> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare("SELECT * FROM dict_rules ORDER BY id")?;
        let rows = stmt.query_map([], Self::row_to_rule)?;
        rows.collect()
    }

    pub fn get_enabled(&self) -> Result<Vec<DictRule>> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare("SELECT * FROM dict_rules WHERE enabled = 1 ORDER BY id")?;
        let rows = stmt.query_map([], Self::row_to_rule)?;
        rows.collect()
    }

    fn row_to_rule(row: &Row) -> Result<DictRule> {
        Ok(DictRule {
            id: row.get("id").ok(),
            name: row.get("name").ok(),
            url: row.get("url").ok(),
            enabled: row.get::<_, i32>("enabled")? != 0,
        })
    }
}

// ============================================================================
// KeyboardAssistDao
// ============================================================================

pub struct KeyboardAssistDao<'a> {
    db: &'a Database,
}

impl<'a> KeyboardAssistDao<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    pub fn insert(&self, assist: &KeyboardAssist) -> Result<i64> {
        self.db.conn().execute(
            r#"INSERT INTO keyboard_assists (type, "key", value, serialNo)
               VALUES (?1, ?2, ?3, ?4)"#,
            params![
                assist.assist_type,
                assist.key,
                assist.value,
                assist.serial_no
            ],
        )?;
        Ok(self.db.conn().last_insert_rowid())
    }

    pub fn update(&self, assist: &KeyboardAssist) -> Result<()> {
        let id = assist.id.ok_or(rusqlite::Error::InvalidParameterName(
            "id is required".to_string(),
        ))?;
        self.db.conn().execute(
            r#"UPDATE keyboard_assists SET type = ?2, "key" = ?3, value = ?4, serialNo = ?5
               WHERE id = ?1"#,
            params![
                id,
                assist.assist_type,
                assist.key,
                assist.value,
                assist.serial_no
            ],
        )?;
        Ok(())
    }

    pub fn delete(&self, id: i64) -> Result<()> {
        self.db
            .conn()
            .execute("DELETE FROM keyboard_assists WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn get_all(&self) -> Result<Vec<KeyboardAssist>> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare("SELECT * FROM keyboard_assists ORDER BY serialNo")?;
        let rows = stmt.query_map([], Self::row_to_assist)?;
        rows.collect()
    }

    fn row_to_assist(row: &Row) -> Result<KeyboardAssist> {
        Ok(KeyboardAssist {
            id: row.get("id").ok(),
            assist_type: row.get("type")?,
            key: row.get("key").ok(),
            value: row.get("value").ok(),
            serial_no: row.get("serialNo")?,
        })
    }
}

// ============================================================================
// ServerDao
// ============================================================================

pub struct ServerDao<'a> {
    db: &'a Database,
}

impl<'a> ServerDao<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    pub fn insert(&self, server: &Server) -> Result<i64> {
        self.db.conn().execute(
            "INSERT INTO servers (name, url, enabled) VALUES (?1, ?2, ?3)",
            params![server.name, server.url, server.enabled as i32],
        )?;
        Ok(self.db.conn().last_insert_rowid())
    }

    pub fn update(&self, server: &Server) -> Result<()> {
        let id = server.id.ok_or(rusqlite::Error::InvalidParameterName(
            "id is required".to_string(),
        ))?;
        self.db.conn().execute(
            "UPDATE servers SET name = ?2, url = ?3, enabled = ?4 WHERE id = ?1",
            params![id, server.name, server.url, server.enabled as i32],
        )?;
        Ok(())
    }

    pub fn delete(&self, id: i64) -> Result<()> {
        self.db
            .conn()
            .execute("DELETE FROM servers WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn get_all(&self) -> Result<Vec<Server>> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare("SELECT * FROM servers ORDER BY id")?;
        let rows = stmt.query_map([], Self::row_to_server)?;
        rows.collect()
    }

    pub fn get_enabled(&self) -> Result<Vec<Server>> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare("SELECT * FROM servers WHERE enabled = 1 ORDER BY id")?;
        let rows = stmt.query_map([], Self::row_to_server)?;
        rows.collect()
    }

    fn row_to_server(row: &Row) -> Result<Server> {
        Ok(Server {
            id: row.get("id").ok(),
            name: row.get("name").ok(),
            url: row.get("url").ok(),
            enabled: row.get::<_, i32>("enabled")? != 0,
        })
    }
}

// ============================================================================
// RssStarDao
// ============================================================================

pub struct RssStarDao<'a> {
    db: &'a Database,
}

impl<'a> RssStarDao<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    pub fn insert(&self, star: &RssStar) -> Result<i64> {
        self.db.conn().execute(
            "INSERT INTO rss_stars (origin, sort, title) VALUES (?1, ?2, ?3)",
            params![star.origin, star.sort, star.title],
        )?;
        Ok(self.db.conn().last_insert_rowid())
    }

    pub fn delete(&self, id: i64) -> Result<()> {
        self.db
            .conn()
            .execute("DELETE FROM rss_stars WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn get_all(&self) -> Result<Vec<RssStar>> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare("SELECT * FROM rss_stars ORDER BY id DESC")?;
        let rows = stmt.query_map([], Self::row_to_star)?;
        rows.collect()
    }

    pub fn get_by_origin(&self, origin: &str) -> Result<Vec<RssStar>> {
        let conn = self.db.conn();
        let mut stmt =
            conn.prepare("SELECT * FROM rss_stars WHERE origin = ?1 ORDER BY id DESC")?;
        let rows = stmt.query_map(params![origin], Self::row_to_star)?;
        rows.collect()
    }

    fn row_to_star(row: &Row) -> Result<RssStar> {
        Ok(RssStar {
            id: row.get("id").ok(),
            origin: row.get("origin")?,
            sort: row.get("sort").ok(),
            title: row.get("title")?,
        })
    }
}

// ============================================================================
// RssReadRecordDao
// ============================================================================

pub struct RssReadRecordDao<'a> {
    db: &'a Database,
}

impl<'a> RssReadRecordDao<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    pub fn upsert(&self, record: &RssReadRecord) -> Result<()> {
        self.db.conn().execute(
            r#"INSERT INTO rss_read_records (origin, articleId) VALUES (?1, ?2)
               ON CONFLICT(origin, articleId) DO NOTHING"#,
            params![record.origin, record.article_id],
        )?;
        Ok(())
    }

    pub fn is_read(&self, origin: &str, article_id: i32) -> Result<bool> {
        let count: i64 = self.db.conn().query_row(
            "SELECT COUNT(*) FROM rss_read_records WHERE origin = ?1 AND articleId = ?2",
            params![origin, article_id],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    pub fn delete(&self, id: i64) -> Result<()> {
        self.db
            .conn()
            .execute("DELETE FROM rss_read_records WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn get_read_article_ids(&self, origin: &str) -> Result<Vec<i32>> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare("SELECT articleId FROM rss_read_records WHERE origin = ?1")?;
        let rows = stmt.query_map(params![origin], |row| row.get(0))?;
        rows.collect()
    }

    pub fn clear_by_origin(&self, origin: &str) -> Result<()> {
        self.db.conn().execute(
            "DELETE FROM rss_read_records WHERE origin = ?1",
            params![origin],
        )?;
        Ok(())
    }
}

// ============================================================================
// ChapterContentDao
// ============================================================================

pub struct ChapterContentDao<'a> {
    db: &'a Database,
}

impl<'a> ChapterContentDao<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    /// Save or update chapter content using a provided connection (for transactions)
    pub fn save_conn(
        &self,
        conn: &Connection,
        book_url: &str,
        chapter_index: i32,
        content: &str,
        now: i64,
    ) -> Result<()> {
        conn.execute(
            r#"INSERT INTO chapter_contents (bookUrl, chapterIndex, content, updateTime)
               VALUES (?1, ?2, ?3, ?4)
               ON CONFLICT(bookUrl, chapterIndex) DO UPDATE SET
               content = ?3, updateTime = ?4"#,
            params![book_url, chapter_index, content, now],
        )?;
        Ok(())
    }

    /// Save or update chapter content
    pub fn save(&self, book_url: &str, chapter_index: i32, content: &str) -> Result<()> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        self.save_conn(&self.db.conn(), book_url, chapter_index, content, now)
    }

    /// Get chapter content
    pub fn get(&self, book_url: &str, chapter_index: i32) -> Result<Option<String>> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT content FROM chapter_contents WHERE bookUrl = ?1 AND chapterIndex = ?2",
        )?;
        let mut rows = stmt.query(params![book_url, chapter_index])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    /// Delete all contents for a book
    pub fn delete_by_book(&self, book_url: &str) -> Result<()> {
        self.db.conn().execute(
            "DELETE FROM chapter_contents WHERE bookUrl = ?1",
            params![book_url],
        )?;
        Ok(())
    }

    /// Check if content exists
    pub fn exists(&self, book_url: &str, chapter_index: i32) -> Result<bool> {
        let count: i64 = self.db.conn().query_row(
            "SELECT COUNT(*) FROM chapter_contents WHERE bookUrl = ?1 AND chapterIndex = ?2",
            params![book_url, chapter_index],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    /// Batch save chapter contents within a transaction
    pub fn save_many(&self, entries: &[(String, i32, String)]) -> Result<usize> {
        let mut conn = self.db.conn();
        let tx = conn.transaction()?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        {
            let mut stmt = tx.prepare(
                r#"INSERT INTO chapter_contents (bookUrl, chapterIndex, content, updateTime)
                   VALUES (?1, ?2, ?3, ?4)
                   ON CONFLICT(bookUrl, chapterIndex) DO UPDATE SET
                   content = ?3, updateTime = ?4"#,
            )?;
            for (book_url, chapter_index, content) in entries {
                stmt.execute(params![book_url, chapter_index, content, now])?;
            }
        }
        tx.commit()?;
        Ok(entries.len())
    }
}
