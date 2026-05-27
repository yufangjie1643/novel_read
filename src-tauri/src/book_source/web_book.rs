//! WebBook - orchestrates search, book info, TOC, and content fetching
//!
//! Equivalent of Android's WebBook.kt + BookList.kt + BookInfo.kt + BookChapterList.kt + BookContent.kt

use serde::Deserialize;
use std::sync::Arc;

use crate::db::models::{Book, BookChapter, BookSource, SearchBook};

use super::analyze_url::AnalyzeUrl;
use super::js_extensions::JsExtState;
use super::rule_executor::RuleExecutor;

// ============================================================================
// Rule structs (parsed from BookSource JSON rule fields)
// ============================================================================

#[derive(Debug, Clone, Deserialize, Default)]
pub struct SearchRule {
    pub book_list: Option<String>,
    pub name: Option<String>,
    pub author: Option<String>,
    pub intro: Option<String>,
    pub kind: Option<String>,
    pub last_chapter: Option<String>,
    pub book_url: Option<String>,
    pub cover_url: Option<String>,
    pub word_count: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct ExploreRule {
    pub book_list: Option<String>,
    pub name: Option<String>,
    pub author: Option<String>,
    pub intro: Option<String>,
    pub kind: Option<String>,
    pub last_chapter: Option<String>,
    pub book_url: Option<String>,
    pub cover_url: Option<String>,
    pub word_count: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct BookInfoRule {
    pub name: Option<String>,
    pub author: Option<String>,
    pub intro: Option<String>,
    pub kind: Option<String>,
    pub cover_url: Option<String>,
    pub toc_url: Option<String>,
    pub word_count: Option<String>,
    pub last_chapter: Option<String>,
    pub init: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct TocRule {
    pub chapter_list: Option<String>,
    pub chapter_name: Option<String>,
    pub chapter_url: Option<String>,
    pub is_volume: Option<String>,
    pub is_vip: Option<String>,
    pub update_time: Option<String>,
    pub pre_update_js: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct ContentRule {
    pub content: Option<String>,
    pub title: Option<String>,
    pub next_content_url: Option<String>,
    pub web_js: Option<String>,
    pub source_regex: Option<String>,
}

// ============================================================================
// WebBook
// ============================================================================

pub struct WebBook {
    js_state: Arc<JsExtState>,
    executor: RuleExecutor,
}

impl WebBook {
    pub fn new(js_state: Arc<JsExtState>) -> Self {
        let executor = RuleExecutor::new(js_state.clone());
        Self {
            js_state,
            executor,
        }
    }

    // ==================== Search ====================

    /// Search for books using a book source
    pub fn search(
        &self,
        source: &BookSource,
        key: &str,
        page: Option<i32>,
    ) -> Result<Vec<SearchBook>, WebBookError> {
        let search_url = source.search_url.as_ref()
            .ok_or_else(|| WebBookError::NoSearchUrl)?;

        // Parse search URL
        let analyze_url = AnalyzeUrl::new(
            search_url,
            Some(&source.book_source_url),
            Some(key),
            page,
            self.js_state.clone(),
        );

        // Fetch response
        let body = analyze_url.get_str_response()
            .map_err(|e| WebBookError::Request(e.to_string()))?;

        // Parse search rules
        let search_rule: SearchRule = if let Some(rule_json) = &source.rule_search {
            serde_json::from_str(rule_json)
                .unwrap_or_default()
        } else {
            return Ok(Vec::new());
        };

        let book_list_rule = search_rule.book_list.as_deref()
            .unwrap_or("");

        let base_url = analyze_url.params.base_url.clone();

        if book_list_rule.is_empty() {
            // Try to parse entire response as single book detail page
            let mut book = SearchBook {
                origin: source.book_source_url.clone(),
                origin_name: Some(source.book_source_name.clone()),
                ..SearchBook::default()
            };
            self.fill_search_book(
                &mut book, &body, &search_rule, &base_url,
            )?;
            if !book.name.is_empty() {
                return Ok(vec![book]);
            }
            return Ok(Vec::new());
        }

        // Get list of book elements
        let elements = self.executor.get_element_htmls(book_list_rule, &body);
        let mut results = Vec::new();

        for element_html in elements {
            let mut book = SearchBook {
                origin: source.book_source_url.clone(),
                origin_name: Some(source.book_source_name.clone()),
                ..SearchBook::default()
            };
            self.fill_search_book(
                &mut book, &element_html, &search_rule, &base_url,
            )?;
            if !book.name.is_empty() {
                results.push(book);
            }
        }

        Ok(results)
    }

    // ==================== Explore ====================

    /// Explore books from a book source's catalog
    pub fn explore(
        &self,
        source: &BookSource,
        url: &str,
        page: Option<i32>,
    ) -> Result<Vec<SearchBook>, WebBookError> {
        let analyze_url = AnalyzeUrl::new(
            url,
            Some(&source.book_source_url),
            None,
            page,
            self.js_state.clone(),
        );

        let body = analyze_url.get_str_response()
            .map_err(|e| WebBookError::Request(e.to_string()))?;

        let explore_rule: ExploreRule = if let Some(rule_json) = &source.rule_explore {
            serde_json::from_str(rule_json)
                .unwrap_or_default()
        } else {
            return Ok(Vec::new());
        };

        let book_list_rule = explore_rule.book_list.as_deref().unwrap_or("");
        let base_url = analyze_url.params.base_url.clone();

        if book_list_rule.is_empty() {
            let mut book = SearchBook {
                origin: source.book_source_url.clone(),
                origin_name: Some(source.book_source_name.clone()),
                ..SearchBook::default()
            };
            self.fill_explore_book(&mut book, &body, &explore_rule, &base_url)?;
            if !book.name.is_empty() {
                return Ok(vec![book]);
            }
            return Ok(Vec::new());
        }

        let elements = self.executor.get_element_htmls(book_list_rule, &body);
        let mut results = Vec::new();

        for element_html in elements {
            let mut book = SearchBook {
                origin: source.book_source_url.clone(),
                origin_name: Some(source.book_source_name.clone()),
                ..SearchBook::default()
            };
            self.fill_explore_book(&mut book, &element_html, &explore_rule, &base_url)?;
            if !book.name.is_empty() {
                results.push(book);
            }
        }

        Ok(results)
    }

    fn fill_explore_book(
        &self,
        book: &mut SearchBook,
        content: &str,
        rule: &ExploreRule,
        base_url: &str,
    ) -> Result<(), WebBookError> {
        book.name = rule.name.as_ref()
            .map(|r| self.executor.get_string(r, content, Some(base_url)))
            .unwrap_or_default();

        if book.name.is_empty() {
            return Ok(());
        }

        book.author = rule.author.as_ref()
            .map(|r| {
                let text = self.executor.get_string(r, content, Some(base_url));
                if text.is_empty() { None } else { Some(text) }
            })
            .flatten();

        book.book_url = rule.book_url.as_ref()
            .map(|r| {
                let url = self.executor.get_string(r, content, Some(base_url));
                Self::resolve_url(&url, base_url)
            })
            .unwrap_or_else(|| base_url.to_string());

        book.cover_url = rule.cover_url.as_ref()
            .map(|r| {
                let url = self.executor.get_string(r, content, Some(base_url));
                if url.is_empty() { None } else { Some(Self::resolve_url(&url, base_url)) }
            })
            .flatten();

        book.intro = rule.intro.as_ref()
            .map(|r| {
                let text = self.executor.get_string(r, content, Some(base_url));
                if text.is_empty() { None } else { Some(text) }
            })
            .flatten();

        book.kind = rule.kind.as_ref()
            .map(|r| {
                let list = self.executor.get_string_list(r, content, Some(base_url));
                if list.is_empty() { None } else { Some(list.join(",")) }
            })
            .flatten();

        book.latest_chapter_title = rule.last_chapter.as_ref()
            .map(|r| {
                let text = self.executor.get_string(r, content, Some(base_url));
                if text.is_empty() { None } else { Some(text) }
            })
            .flatten();

        book.word_count = rule.word_count.as_ref()
            .map(|r| {
                let text = self.executor.get_string(r, content, Some(base_url));
                if text.is_empty() { None } else { Some(text) }
            })
            .flatten();

        Ok(())
    }

    fn fill_search_book(
        &self,
        book: &mut SearchBook,
        content: &str,
        rule: &SearchRule,
        base_url: &str,
    ) -> Result<(), WebBookError> {
        // Name (required)
        book.name = rule.name.as_ref()
            .map(|r| self.executor.get_string(r, content, Some(base_url)))
            .unwrap_or_default();

        if book.name.is_empty() {
            return Ok(());
        }

        // Author
        book.author = rule.author.as_ref()
            .map(|r| {
                let text = self.executor.get_string(r, content, Some(base_url));
                if text.is_empty() { None } else { Some(text) }
            })
            .flatten();

        // Book URL
        book.book_url = rule.book_url.as_ref()
            .map(|r| {
                let url = self.executor.get_string(r, content, Some(base_url));
                Self::resolve_url(&url, base_url)
            })
            .unwrap_or_else(|| base_url.to_string());

        // Cover URL
        book.cover_url = rule.cover_url.as_ref()
            .map(|r| {
                let url = self.executor.get_string(r, content, Some(base_url));
                if url.is_empty() { None } else { Some(Self::resolve_url(&url, base_url)) }
            })
            .flatten();

        // Intro
        book.intro = rule.intro.as_ref()
            .map(|r| {
                let text = self.executor.get_string(r, content, Some(base_url));
                if text.is_empty() { None } else { Some(text) }
            })
            .flatten();

        // Kind
        book.kind = rule.kind.as_ref()
            .map(|r| {
                let list = self.executor.get_string_list(r, content, Some(base_url));
                if list.is_empty() { None } else { Some(list.join(",")) }
            })
            .flatten();

        // Last chapter
        book.latest_chapter_title = rule.last_chapter.as_ref()
            .map(|r| {
                let text = self.executor.get_string(r, content, Some(base_url));
                if text.is_empty() { None } else { Some(text) }
            })
            .flatten();

        // Word count
        book.word_count = rule.word_count.as_ref()
            .map(|r| {
                let text = self.executor.get_string(r, content, Some(base_url));
                if text.is_empty() { None } else { Some(text) }
            })
            .flatten();

        Ok(())
    }

    // ==================== Book Info ====================

    /// Fetch and parse book info
    pub fn get_book_info(
        &self,
        source: &BookSource,
        book: &mut Book,
    ) -> Result<(), WebBookError> {
        let book_url = &book.book_url;

        let analyze_url = AnalyzeUrl::new(
            book_url,
            Some(&source.book_source_url),
            None, None,
            self.js_state.clone(),
        );

        let body = analyze_url.get_str_response()
            .map_err(|e| WebBookError::Request(e.to_string()))?;

        let info_rule: BookInfoRule = if let Some(rule_json) = &source.rule_book_info {
            serde_json::from_str(rule_json)
                .unwrap_or_default()
        } else {
            return Ok(());
        };

        let base_url = &analyze_url.params.base_url;

        // Name
        if let Some(rule) = &info_rule.name {
            book.name = self.executor.get_string(rule, &body, Some(base_url));
        }
        // Author
        if let Some(rule) = &info_rule.author {
            book.author = self.executor.get_string(rule, &body, Some(base_url));
        }
        // Intro
        if let Some(rule) = &info_rule.intro {
            let text = self.executor.get_string(rule, &body, Some(base_url));
            book.intro = if text.is_empty() { None } else { Some(text) };
        }
        // Kind
        if let Some(rule) = &info_rule.kind {
            let list = self.executor.get_string_list(rule, &body, Some(base_url));
            book.kind = if list.is_empty() { None } else { Some(list.join(",")) };
        }
        // Cover URL
        if let Some(rule) = &info_rule.cover_url {
            let url = self.executor.get_string(rule, &body, Some(base_url));
            book.cover_url = if url.is_empty() { None } else { Some(Self::resolve_url(&url, base_url)) };
        }
        // TOC URL
        if let Some(rule) = &info_rule.toc_url {
            let url = self.executor.get_string(rule, &body, Some(base_url));
            book.toc_url = if url.is_empty() { book_url.clone() } else { Self::resolve_url(&url, base_url) };
        } else {
            book.toc_url = book_url.clone();
        }
        // Last chapter
        if let Some(rule) = &info_rule.last_chapter {
            let text = self.executor.get_string(rule, &body, Some(base_url));
            book.latest_chapter_title = if text.is_empty() { None } else { Some(text) };
        }
        // Word count
        if let Some(rule) = &info_rule.word_count {
            let text = self.executor.get_string(rule, &body, Some(base_url));
            book.word_count = if text.is_empty() { None } else { Some(text) };
        }

        Ok(())
    }

    // ==================== Chapter List ====================

    /// Fetch and parse chapter list
    pub fn get_chapter_list(
        &self,
        source: &BookSource,
        book: &Book,
    ) -> Result<Vec<BookChapter>, WebBookError> {
        let toc_url = &book.toc_url;

        let analyze_url = AnalyzeUrl::new(
            toc_url,
            Some(&book.book_url),
            None, None,
            self.js_state.clone(),
        );

        let body = analyze_url.get_str_response()
            .map_err(|e| WebBookError::Request(e.to_string()))?;

        let toc_rule: TocRule = if let Some(rule_json) = &source.rule_toc {
            serde_json::from_str(rule_json)
                .unwrap_or_default()
        } else {
            return Ok(Vec::new());
        };

        let chapter_list_rule = toc_rule.chapter_list.as_deref()
            .unwrap_or("");

        if chapter_list_rule.is_empty() {
            return Ok(Vec::new());
        }

        let elements = self.executor.get_element_htmls(chapter_list_rule, &body);
        let mut chapters = Vec::new();
        let base_url = &analyze_url.params.base_url;

        for (index, element_html) in elements.into_iter().enumerate() {
            let mut chapter = BookChapter {
                index: index as i32,
                ..Default::default()
            };

            // Chapter name
            if let Some(rule) = &toc_rule.chapter_name {
                chapter.title = self.executor.get_string(rule, &element_html, Some(base_url));
            }
            if chapter.title.is_empty() {
                continue;
            }

            // Chapter URL
            if let Some(rule) = &toc_rule.chapter_url {
                let url = self.executor.get_string(rule, &element_html, Some(base_url));
                chapter.url = Self::resolve_url(&url, base_url);
            }
            if chapter.url.is_empty() {
                chapter.url = book.book_url.clone();
            }
            chapter.book_url = book.book_url.clone();

            chapters.push(chapter);
        }

        Ok(chapters)
    }

    // ==================== Content ====================

    /// Fetch and parse chapter content
    pub fn get_content(
        &self,
        source: &BookSource,
        book: &Book,
        chapter: &BookChapter,
    ) -> Result<String, WebBookError> {
        let content_rule: ContentRule = if let Some(rule_json) = &source.rule_content {
            serde_json::from_str(rule_json)
                .unwrap_or_default()
        } else {
            return Ok(String::new());
        };

        let content_rule_str = content_rule.content.as_deref()
            .unwrap_or("");

        if content_rule_str.is_empty() {
            return Ok(chapter.url.clone());
        }

        let analyze_url = AnalyzeUrl::new(
            &chapter.url,
            Some(&book.toc_url),
            None, None,
            self.js_state.clone(),
        );

        let body = analyze_url.get_str_response()
            .map_err(|e| WebBookError::Request(e.to_string()))?;

        let base_url = &analyze_url.params.base_url;
        let content = self.executor.get_string(content_rule_str, &body, Some(base_url));

        Ok(content)
    }

    // ==================== Helpers ====================

    /// Resolve a possibly relative URL
    fn resolve_url(url: &str, base: &str) -> String {
        if url.starts_with("http://") || url.starts_with("https://") {
            return url.to_string();
        }
        if base.is_empty() {
            return url.to_string();
        }
        if let Ok(base_parsed) = url::Url::parse(base) {
            if let Ok(resolved) = base_parsed.join(url) {
                return resolved.to_string();
            }
        }
        url.to_string()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum WebBookError {
    #[error("Book source has no search URL")]
    NoSearchUrl,
    #[error("Request failed: {0}")]
    Request(String),
    #[error("Parse error: {0}")]
    Parse(String),
}
