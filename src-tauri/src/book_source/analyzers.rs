//! HTML/JSON analyzers for book source rule engine
//!
//! Replaces Android's jsoup + JsoupXpath + JSONPath

use scraper::{Html, Selector};
use serde_json::Value;

/// HTML analyzer using CSS selectors (replaces jsoup)
pub struct HtmlAnalyzer {
    document: Html,
}

impl HtmlAnalyzer {
    pub fn new(html: &str) -> Self {
        Self {
            document: Html::parse_document(html),
        }
    }

    /// Get string result from CSS selector. When no attribute is
    /// requested, returns the element's full text with `<br>` turned
    /// into newlines and block elements (`<p>`, `<div>`, etc.)
    /// separated by blank lines — so chapter content comes out with
    /// visible paragraph breaks. U+00A0 (`&nbsp;`) is normalized
    /// to a regular space.
    pub fn get_string(&self, selector_str: &str, attr: Option<&str>) -> Option<String> {
        let selector = Selector::parse(selector_str).ok()?;
        let element = self.document.select(&selector).next()?;

        let text = if let Some(attr_name) = attr {
            element.value().attr(attr_name)?.to_string()
        } else {
            let mut out = String::new();
            walk_with_breaks(element, &mut out);
            let raw = collapse_blank_lines(&out);
            normalize_chapter_text(&raw)
        };

        if text.is_empty() {
            None
        } else {
            Some(text)
        }
    }

    /// Get all matching strings from CSS selector
    pub fn get_string_list(&self, selector_str: &str, attr: Option<&str>) -> Vec<String> {
        let Ok(selector) = Selector::parse(selector_str) else {
            return Vec::new();
        };

        self.document
            .select(&selector)
            .map(|element| {
                if let Some(attr_name) = attr {
                    element.value().attr(attr_name).unwrap_or("").to_string()
                } else {
                    element.text().collect::<String>().trim().to_string()
                }
            })
            .filter(|s| !s.is_empty())
            .collect()
    }

    /// Get HTML of first matching element
    pub fn get_element_html(&self, selector_str: &str) -> Option<String> {
        let selector = Selector::parse(selector_str).ok()?;
        let element = self.document.select(&selector).next()?;
        Some(element.html())
    }

    /// Get all matching element HTMLs
    pub fn get_element_html_list(&self, selector_str: &str) -> Vec<String> {
        let Ok(selector) = Selector::parse(selector_str) else {
            return Vec::new();
        };

        self.document
            .select(&selector)
            .map(|element| element.html())
            .collect()
    }

    /// Get the concatenated text of the first matching element,
    /// walking the entire subtree and treating `<br>` as a line
    /// break. Block elements (`<p>`, `<div>`, etc.) get a blank
    /// line after them so paragraphs come out separated.
    ///
    /// Used by the `@text` and `@textNodes` Legado hints.
    pub fn get_direct_text(&self, selector_str: &str) -> Option<String> {
        self.get_text_with_breaks(selector_str)
    }

    /// Get text from the first matching element, with `<br>` treated
    /// as a line break. Useful for chapter bodies where the source
    /// uses `<br/><br/>` between paragraphs.
    ///
    /// Algorithm: walk the subtree, treating `<br>` as a newline.
    /// Inline tags (no `<br>`, no block element) get their text
    /// concatenated. Block elements (`<p>`, `<div>`, `<h1>`-`<h6>`,
    /// `<li>`, `<tr>`, etc.) get a newline after them. The output is
    /// then normalized so `&nbsp;` becomes a regular space and runs
    /// of 3+ spaces are capped at 2 (matching 2em indent).
    pub fn get_text_with_breaks(&self, selector_str: &str) -> Option<String> {
        use scraper::Node;
        let selector = Selector::parse(selector_str).ok()?;
        let element = self.document.select(&selector).next()?;
        let mut out = String::new();
        walk_with_breaks(element, &mut out);
        let collapsed = collapse_blank_lines(&out);
        if collapsed.is_empty() {
            return None;
        }
        Some(normalize_chapter_text(&collapsed))
    }
}

/// Normalize text extracted from a chapter body:
/// - `&nbsp;` (U+00A0) → regular space, so it doesn't render as
///   a visible "weird character" in fonts that distinguish the two.
/// - `\r\n` and `\r` → `\n`, so line breaks are consistent.
/// - Multiple consecutive spaces (≥ 3) → 2 spaces, which is what
///   biquga-style sites use for first-line indentation.
fn normalize_chapter_text(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut run_spaces = 0usize;
    for c in s.chars() {
        match c {
            '\r' => {
                if !out.ends_with('\n') {
                    out.push('\n');
                }
                run_spaces = 0;
            }
            ' ' | '\u{00A0}' => {
                run_spaces += 1;
                out.push(' ');
            }
            _ => {
                // Cap a trailing run of spaces at 2 (typical 2em
                // indent). Drop the rest.
                while run_spaces > 2 {
                    out.pop();
                    run_spaces -= 1;
                }
                run_spaces = 0;
                out.push(c);
            }
        }
    }
    // Also cap trailing spaces at the end.
    while run_spaces > 2 {
        out.pop();
        run_spaces -= 1;
    }
    out
}

/// Walk an element's subtree, appending text to `out` and inserting
/// newlines for `<br>` and after block-level closing tags so
/// paragraphs come out separated.
fn walk_with_breaks(el: scraper::ElementRef, out: &mut String) {
    let block_tags: &[&str] = &[
        "p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "tr", "td", "th", "blockquote",
        "pre", "section", "article", "header", "footer", "aside", "ul", "ol", "table",
    ];
    for child in el.children() {
        match child.value() {
            scraper::Node::Text(t) => {
                out.push_str(t);
            }
            scraper::Node::Element(e) => {
                let tag = e.name().to_ascii_lowercase();
                if tag == "br" {
                    out.push('\n');
                    continue;
                }
                if let Some(grand) = scraper::ElementRef::wrap(child) {
                    walk_with_breaks(grand, out);
                }
                if block_tags.contains(&tag.as_str()) {
                    // Ensure paragraphs are separated by at least one
                    // blank line. We don't add the line break yet
                    // (might still be inside a containing block);
                    // collapse_blank_lines takes care of the rest.
                    if !out.ends_with('\n') {
                        out.push('\n');
                    }
                    out.push('\n');
                }
            }
            _ => {}
        }
    }
}

/// Collapse runs of three or more `\n` to a single `\n\n` (one blank
/// line) so paragraph breaks are visible but the text doesn't have
/// huge gaps.
fn collapse_blank_lines(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut consecutive_newlines = 0;
    for ch in s.chars() {
        if ch == '\n' {
            consecutive_newlines += 1;
            if consecutive_newlines <= 2 {
                out.push('\n');
            }
        } else {
            consecutive_newlines = 0;
            out.push(ch);
        }
    }
    out.trim_matches('\n').to_string()
}

/// JSON analyzer (basic JSONPath-like support)
pub struct JsonAnalyzer {
    value: Value,
}

impl JsonAnalyzer {
    pub fn new(json: &str) -> Result<Self, serde_json::Error> {
        Ok(Self {
            value: serde_json::from_str(json)?,
        })
    }

    pub fn from_value(value: Value) -> Self {
        Self { value }
    }

    /// Get string from JSONPath-like path
    /// Supports: $.key, $.key[0], $.key.nested
    pub fn get_string(&self, path: &str) -> Option<String> {
        let value = self.resolve_path(path)?;
        match value {
            Value::String(s) => Some(s.clone()),
            Value::Number(n) => Some(n.to_string()),
            Value::Bool(b) => Some(b.to_string()),
            _ => None,
        }
    }

    /// Get string list from JSONPath-like path
    pub fn get_string_list(&self, path: &str) -> Vec<String> {
        match self.resolve_path(path) {
            Some(Value::Array(arr)) => arr
                .iter()
                .filter_map(|v| match v {
                    Value::String(s) => Some(s.clone()),
                    Value::Number(n) => Some(n.to_string()),
                    _ => None,
                })
                .collect(),
            Some(value) => match value {
                Value::String(s) => vec![s.clone()],
                Value::Number(n) => vec![n.to_string()],
                _ => Vec::new(),
            },
            None => Vec::new(),
        }
    }

    /// Get raw JSON values at a path, serialized for downstream rule execution.
    pub fn get_value_list(&self, path: &str) -> Vec<String> {
        match self.resolve_path(path) {
            Some(Value::Array(arr)) => arr.iter().map(Self::value_to_rule_input).collect(),
            Some(value) => vec![Self::value_to_rule_input(value)],
            None => Vec::new(),
        }
    }

    /// Get a raw JSON value at a path. Strings are returned without quotes.
    pub fn get_value_string(&self, path: &str) -> Option<String> {
        self.resolve_path(path).map(Self::value_to_rule_input)
    }

    fn value_to_rule_input(value: &Value) -> String {
        match value {
            Value::String(s) => s.clone(),
            Value::Number(n) => n.to_string(),
            Value::Bool(b) => b.to_string(),
            Value::Null => String::new(),
            Value::Array(_) | Value::Object(_) => value.to_string(),
        }
    }

    /// Resolve a JSONPath-like path to a Value
    fn resolve_path(&self, path: &str) -> Option<&Value> {
        // Remove leading $.
        let path = path.trim_start_matches("$").trim_start_matches(".");
        if path.is_empty() {
            return Some(&self.value);
        }

        let mut current = &self.value;
        for part in path.split('.') {
            // Handle array index: key[0]
            let (key, index) = if let Some(start) = part.find('[') {
                let end = part.find(']')?;
                let key = &part[..start];
                let index: usize = part[start + 1..end].parse().ok()?;
                (key, Some(index))
            } else {
                (part, None)
            };

            current = current.get(key)?;

            if let Some(idx) = index {
                current = current.get(idx)?;
            }
        }

        Some(current)
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_HTML: &str = r#"
    <html>
        <body>
            <div class="book-list">
                <a href="/book/1" class="title">Book One</a>
                <a href="/book/2" class="title">Book Two</a>
            </div>
            <div class="info">
                <span class="author">Author Name</span>
            </div>
        </body>
    </html>
    "#;

    #[test]
    fn test_html_get_string() {
        let analyzer = HtmlAnalyzer::new(TEST_HTML);
        let result = analyzer.get_string(".author", None);
        assert_eq!(result, Some("Author Name".to_string()));
    }

    #[test]
    fn test_html_get_attr() {
        let analyzer = HtmlAnalyzer::new(TEST_HTML);
        let result = analyzer.get_string("a.title", Some("href"));
        assert_eq!(result, Some("/book/1".to_string()));
    }

    #[test]
    fn test_html_get_string_list() {
        let analyzer = HtmlAnalyzer::new(TEST_HTML);
        let result = analyzer.get_string_list("a.title", None);
        assert_eq!(result, vec!["Book One", "Book Two"]);
    }

    const TEST_JSON: &str = r#"{
        "books": [
            {"title": "Book One", "author": "Author A"},
            {"title": "Book Two", "author": "Author B"}
        ],
        "total": 2
    }"#;

    #[test]
    fn test_json_get_string() {
        let analyzer = JsonAnalyzer::new(TEST_JSON).unwrap();
        let result = analyzer.get_string("$.total");
        assert_eq!(result, Some("2".to_string()));
    }

    #[test]
    fn test_json_get_nested_string() {
        let analyzer = JsonAnalyzer::new(TEST_JSON).unwrap();
        let result = analyzer.get_string("$.books[0].title");
        assert_eq!(result, Some("Book One".to_string()));
    }

    #[test]
    fn test_json_get_string_list() {
        let analyzer = JsonAnalyzer::new(TEST_JSON).unwrap();
        let result = analyzer.get_string_list("$.books");
        // Array of objects - should return empty for now (needs better handling)
        assert!(result.is_empty());
    }

    #[test]
    fn test_json_get_value_list() {
        let analyzer = JsonAnalyzer::new(TEST_JSON).unwrap();
        let result = analyzer.get_value_list("$.books");

        assert_eq!(result.len(), 2);
        assert!(result[0].contains("Book One"));
    }

    #[test]
    fn test_json_get_value_string() {
        let analyzer = JsonAnalyzer::new(TEST_JSON).unwrap();
        let result = analyzer.get_value_string("$.books[0]");

        assert!(result.unwrap().contains("Author A"));
    }

    #[test]
    fn test_get_text_with_breaks_preserves_paragraphs() {
        // biquga-style: paragraphs separated by `<br/><br/>`,
        // with `&nbsp;` for first-line indent.
        let html = r#"
            <div id="content">
                <p>
                    &nbsp;&nbsp;&nbsp;&nbsp;天才一秒记住本站地址：[爱曲小说]
                    https://www.biqusa.com/最快更新！<br/><br/>
                </p>
                <div id="conter_tip"><b>最新网址：www.biqusa.com</b></div>
                &nbsp;&nbsp;&nbsp;&nbsp;这里是……哪里？<br/><br/>
                &nbsp;&nbsp;&nbsp;&nbsp;赵乾坤回过头来的时候，<br/><br/>
                &nbsp;&nbsp;&nbsp;&nbsp;发现他站在冰天雪地中。
            </div>
        "#;
        let analyzer = HtmlAnalyzer::new(html);
        // Use plain CSS selector (the function expects CSS, not
        // Legado shorthand — callers in the rule executor convert
        // first).
        let text = analyzer.get_text_with_breaks("#content").unwrap();
        // Newlines are present (paragraph breaks).
        assert!(text.contains('\n'), "expected newlines, got: {text}");
        // &nbsp; (U+00A0) is normalized to a regular space.
        assert!(!text.contains('\u{00A0}'), "U+00A0 not normalized: {text}");
        // The real story text is present.
        assert!(text.contains("这里是"));
        assert!(text.contains("赵乾坤"));
    }

    #[test]
    fn test_get_text_with_breaks_caps_indent_spaces() {
        // 4 &nbsp; in a row should become 2 spaces, not 4.
        let html = "<div id='c'>&nbsp;&nbsp;&nbsp;&nbsp;hello</div>";
        let analyzer = HtmlAnalyzer::new(html);
        let text = analyzer.get_text_with_breaks("#c").unwrap();
        assert_eq!(text, "  hello");
    }
}
