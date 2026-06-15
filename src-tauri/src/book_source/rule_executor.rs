//! Rule executor - applies parsed rules to HTML/JSON content
//!
//! Equivalent of Android's AnalyzeRule.kt

use regex::Regex;
use std::sync::Arc;

use super::analyzers::{HtmlAnalyzer, JsonAnalyzer};
use super::js_extensions::JsExtState;
use super::js_runtime::JsRuntime;
use super::rule_parser::{RuleMode, RuleParser, SourceRule};

/// Executes book source rules against fetched content
pub struct RuleExecutor {
    js_state: Arc<JsExtState>,
    parser: RuleParser,
}

impl RuleExecutor {
    pub fn new(js_state: Arc<JsExtState>) -> Self {
        Self {
            js_state,
            parser: RuleParser::new(),
        }
    }

    /// Execute a rule string against content, return a single string
    pub fn get_string(&self, rule_str: &str, content: &str, base_url: Option<&str>) -> String {
        let rendered_rule = self.render_inline_templates(rule_str, content, base_url);
        let rendered_rule = self.apply_at_js(&rendered_rule, base_url);
        if rendered_rule != rule_str && !Self::looks_like_executable_rule(&rendered_rule) {
            return rendered_rule;
        }

        let rules = self.parser.parse(&rendered_rule);
        let list = self.get_string_list_from_rules(&rules, content, base_url);
        if list.is_empty() {
            String::new()
        } else if list.len() == 1 {
            list.into_iter().next().unwrap()
        } else {
            list.join("\n")
        }
    }

    /// Execute a rule string against content, return list of strings
    pub fn get_string_list(
        &self,
        rule_str: &str,
        content: &str,
        base_url: Option<&str>,
    ) -> Vec<String> {
        let rendered_rule = self.render_inline_templates(rule_str, content, base_url);
        let rendered_rule = self.apply_at_js(&rendered_rule, base_url);
        if rendered_rule != rule_str && !Self::looks_like_executable_rule(&rendered_rule) {
            return if rendered_rule.is_empty() {
                Vec::new()
            } else {
                vec![rendered_rule]
            };
        }

        let rules = self.parser.parse(&rendered_rule);
        self.get_string_list_from_rules(&rules, content, base_url)
    }

    fn render_inline_templates(
        &self,
        rule_str: &str,
        content: &str,
        base_url: Option<&str>,
    ) -> String {
        if !rule_str.contains("{{") {
            return rule_str.to_string();
        }

        let Ok(pattern) = Regex::new(r"\{\{([\s\S]*?)\}\}") else {
            return rule_str.to_string();
        };

        pattern
            .replace_all(rule_str, |caps: &regex::Captures| {
                let expr = caps.get(1).map(|m| m.as_str()).unwrap_or("").trim();
                if RuleParser::is_json_path(expr) {
                    return JsonAnalyzer::new(content)
                        .ok()
                        .and_then(|analyzer| analyzer.get_value_string(expr))
                        .unwrap_or_default();
                }

                let rt = JsRuntime::new(self.js_state.clone());
                rt.execute(expr, None, None, Some(content), base_url)
                    .unwrap_or_default()
            })
            .to_string()
    }

    fn apply_at_js(&self, rule_str: &str, base_url: Option<&str>) -> String {
        let Some(pos) = rule_str.to_ascii_lowercase().find("@js:") else {
            return rule_str.to_string();
        };

        let result = &rule_str[..pos];
        let js_code = &rule_str[pos + 4..];
        let rt = JsRuntime::new(self.js_state.clone());
        rt.execute(js_code, None, None, Some(result), base_url)
            .unwrap_or_else(|_| result.to_string())
    }

    fn looks_like_executable_rule(rule: &str) -> bool {
        let trimmed = rule.trim();
        trimmed.starts_with("$.")
            || trimmed.starts_with("$[")
            || trimmed.starts_with("@Json:")
            || trimmed.starts_with("@CSS:")
            || trimmed.starts_with("@@")
            || trimmed.starts_with("@XPath:")
            || trimmed.starts_with("<js>")
            || trimmed.starts_with("class.")
            || trimmed.starts_with("id.")
            || trimmed.starts_with("tag.")
    }

    fn get_string_list_from_rules(
        &self,
        rules: &[SourceRule],
        content: &str,
        base_url: Option<&str>,
    ) -> Vec<String> {
        let mut result: Option<String> = None;

        for rule in rules {
            if rule.rule.is_empty() && !rule.replace_regex.is_empty() {
                // Only regex replacement
                if let Some(ref r) = result {
                    result = Some(self.apply_replace_regex(r, rule));
                }
                continue;
            }

            let raw = match rule.mode {
                RuleMode::Js => {
                    let rt = JsRuntime::new(self.js_state.clone());
                    match rt.execute(&rule.rule, None, None, result.as_deref(), base_url) {
                        Ok(s) => Some(s),
                        Err(e) => {
                            eprintln!("[RuleExecutor] JS error: {}", e);
                            None
                        }
                    }
                }
                RuleMode::Json => {
                    if let Ok(analyzer) = JsonAnalyzer::new(content) {
                        analyzer.get_string(&rule.rule)
                    } else {
                        None
                    }
                }
                RuleMode::XPath => {
                    // XPath not yet implemented
                    eprintln!("[RuleExecutor] XPath not implemented: {}", rule.rule);
                    None
                }
                RuleMode::Css | RuleMode::Regex => {
                    // Try CSS first; if rule looks like regex, handle differently
                    Self::execute_css_rule(content, &rule.rule)
                }
            };

            result = match raw {
                Some(mut s) => {
                    if !rule.replace_regex.is_empty() {
                        s = self.apply_replace_regex(&s, rule);
                    }
                    Some(s)
                }
                None => result,
            };
        }

        match result {
            Some(s) => {
                // Check if result contains newlines - split into list
                let lines: Vec<String> = s.split('\n').map(|l| l.to_string()).collect();
                if lines.len() > 1 {
                    lines.into_iter().filter(|l| !l.is_empty()).collect()
                } else {
                    vec![s]
                }
            }
            None => Vec::new(),
        }
    }

    /// Execute a CSS rule chain like "class.list@tag.a@text"
    fn execute_css_rule(content: &str, rule: &str) -> Option<String> {
        let analyzer = HtmlAnalyzer::new(content);

        // Check if this is a simple CSS selector (no @ chain)
        if !rule.contains('@') {
            // Legado bare extraction hint — when the rule is a single
            // word like "text", "html", "tag", or one of the common
            // HTML attribute names ("href", "src", "id", "class",
            // "value", "name", "title", "data-*", ...), it applies to
            // the OUTER element that was already selected by the
            // chapterList rule, not to a nested sub-selector.
            //
            // We detect this by: rule has no whitespace, no `.`, no `#`,
            // no `>`, no `[`, and matches the known extraction-hint
            // set. Anything else is a real (possibly invalid) CSS
            // selector and goes through the normal path.
            if Self::is_extraction_hint(rule) {
                return Self::extract_from_root(content, rule);
            }
            return analyzer.get_string(rule, None);
        }

        // Split by @ to get selector chain and extraction rule
        let parts: Vec<&str> = rule.split('@').collect();
        if parts.is_empty() {
            return None;
        }

        // Build CSS selector from parts (except last one)
        let selector_parts = &parts[..parts.len().saturating_sub(1)];
        let css_selector = Self::build_css_selector(selector_parts);

        // Last part tells us what to extract
        let extract = parts.last().unwrap_or(&"text");

        let (selector_str, attr) = match *extract {
            "text" => (css_selector.as_str(), None),
            "textNodes" => {
                // Direct text children of the selected element.
                return analyzer.get_direct_text(&css_selector);
            }
            "html" => {
                return analyzer.get_element_html(&css_selector);
            }
            "tag" => {
                // Return tag name - simplified: use text for now
                return analyzer.get_string(&css_selector, None);
            }
            _ => {
                // Treat as attribute name
                if extract.starts_with("attr.") {
                    (css_selector.as_str(), Some(&extract[5..]))
                } else {
                    (css_selector.as_str(), Some(*extract))
                }
            }
        };

        analyzer.get_string(selector_str, attr)
    }

    /// Build a CSS selector from rule parts like ["class.list", "tag.a"]
    fn build_css_selector(parts: &[&str]) -> String {
        let mut selectors = Vec::new();
        for part in parts {
            let s = Self::convert_rule_part_to_selector(part);
            if !s.is_empty() {
                selectors.push(s);
            }
        }
        selectors.join(" ")
    }

    /// Convert Legado rule syntax to CSS selector
    /// Examples:
    /// - "class.book-list" -> ".book-list"
    /// - "tag.a" -> "a"
    /// - "id.main" -> "#main"
    fn convert_rule_part_to_selector(part: &str) -> String {
        if part.starts_with("class.") {
            format!(".{}", &part[6..])
        } else if part.starts_with("tag.") {
            part[4..].to_string()
        } else if part.starts_with("id.") {
            format!("#{}", &part[3..])
        } else {
            part.to_string()
        }
    }

    /// Legado bare extraction hint set. A rule that is just one of
    /// these words (no `@`, no `.`, no `#`, no `[`, no `>`) is a
    /// directive to extract the corresponding value from the
    /// currently-selected outer element, NOT a sub-selector.
    fn is_extraction_hint(rule: &str) -> bool {
        if rule.is_empty() || rule.contains(' ') || rule.contains('.') || rule.contains('#') {
            return false;
        }
        if rule.contains('[') || rule.contains('>') || rule.contains(':') {
            return false;
        }
        matches!(
            rule,
            "text" | "html"
            | "tag"
            | "href" | "src"
            | "id" | "class" | "name" | "value" | "title"
            | "alt" | "type" | "rel" | "target" | "data-id" | "data-url"
            | "data-href" | "data-src" | "data-original" | "data-name"
        )
    }

    /// Extract a value from the *root element* of `content` (the
    /// outer element the caller already selected). Used by bare
    /// extraction hints like `text`, `html`, `href`, etc.
    ///
    /// Strategy: walk the children of `body > *` and try each
    /// candidate element in turn. This handles the common case
    /// where the chapterList rule matched a wrapping element like
    /// `<dd>` and the chapter info lives in the first `<a>` child.
    fn extract_from_root(content: &str, hint: &str) -> Option<String> {
        use scraper::{Html, Selector};
        let doc = Html::parse_document(content);
        let sel = Selector::parse("body > *").ok()?;
        let outer = doc.select(&sel).next()?;
        // Collect candidate elements: the outer first, then its
        // child elements, then the first descendant `<a>`.
        let mut candidates: Vec<_> = vec![outer];
        for c in outer.children() {
            if let Some(el) = scraper::ElementRef::wrap(c) {
                candidates.push(el);
            }
        }
        if matches!(hint, "text" | "textNodes" | "href" | "src" | "data-url" | "data-href" | "data-id" | "data-original" | "data-name" | "title" | "value" | "name") {
            // Also try the first descendant <a>, since chapterList
            // often lands on a wrapper like <dd> and chapter href /
            // text live on the inner <a>.
            if let Ok(a_sel) = Selector::parse("a") {
                if let Some(a) = outer.select(&a_sel).next() {
                    candidates.push(a);
                }
            }
        }
        for el in candidates {
            let result = match hint {
                "text" => {
                    let s: String = el.text().collect();
                    let trimmed = s.trim();
                    if trimmed.is_empty() {
                        None
                    } else {
                        Some(trimmed.to_string())
                    }
                }
                "textNodes" => {
                    // Walks the full subtree, equivalent to @text.
                    // Some Legado book-source rules use @textNodes
                    // for "all the text inside this element,
                    // paragraphs and all".
                    let s: String = el.text().collect();
                    let trimmed = s.trim();
                    if trimmed.is_empty() {
                        None
                    } else {
                        Some(trimmed.to_string())
                    }
                }
                "html" => Some(el.inner_html()),
                "tag" => Some(el.value().name().to_string()),
                _ => el
                    .value()
                    .attr(hint)
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty()),
            };
            if result.is_some() {
                return result;
            }
        }
        None
    }

    /// Apply regex replacement to a string
    fn apply_replace_regex(&self, text: &str, rule: &SourceRule) -> String {
        if let Ok(re) = Regex::new(&rule.replace_regex) {
            if rule.replace_first {
                re.replace(text, &rule.replacement as &str).to_string()
            } else {
                re.replace_all(text, &rule.replacement as &str).to_string()
            }
        } else {
            text.to_string()
        }
    }

    /// Get list of element HTMLs for a CSS selector rule
    pub fn get_element_htmls(&self, rule_str: &str, content: &str) -> Vec<String> {
        let rules = self.parser.parse(rule_str);
        if rules.is_empty() {
            return Vec::new();
        }

        let rule = &rules[0];
        match rule.mode {
            RuleMode::Css => {
                let analyzer = HtmlAnalyzer::new(content);
                if !rule.rule.contains('@') {
                    return analyzer.get_element_html_list(&rule.rule);
                }
                let parts: Vec<&str> = rule.rule.split('@').collect();
                let selector_parts = &parts[..parts.len().saturating_sub(1)];
                let css_selector = Self::build_css_selector(selector_parts);
                analyzer.get_element_html_list(&css_selector)
            }
            RuleMode::Json => JsonAnalyzer::new(content)
                .map(|analyzer| analyzer.get_value_list(&rule.rule))
                .unwrap_or_default(),
            RuleMode::XPath => Vec::new(), // XPath analyzer removed
            _ => Vec::new(),
        }
    }

    /// Get list of strings for a rule that targets multiple elements
    pub fn get_elements_text_list(&self, rule_str: &str, content: &str) -> Vec<String> {
        let rules = self.parser.parse(rule_str);
        if rules.is_empty() {
            return Vec::new();
        }

        let rule = &rules[0];
        match rule.mode {
            RuleMode::Css => {
                let analyzer = HtmlAnalyzer::new(content);
                if !rule.rule.contains('@') {
                    return analyzer.get_string_list(&rule.rule, None);
                }
                let parts: Vec<&str> = rule.rule.split('@').collect();
                let selector_parts = &parts[..parts.len().saturating_sub(1)];
                let css_selector = Self::build_css_selector(selector_parts);
                let extract = parts.last().unwrap_or(&"text");

                let attr = if *extract == "text" || *extract == "html" || *extract == "tag" {
                    None
                } else if extract.starts_with("attr.") {
                    Some(&extract[5..])
                } else {
                    Some(*extract)
                };

                analyzer.get_string_list(&css_selector, attr)
            }
            RuleMode::Json => {
                if let Ok(analyzer) = JsonAnalyzer::new(content) {
                    analyzer.get_string_list(&rule.rule)
                } else {
                    Vec::new()
                }
            }
            _ => Vec::new(),
        }
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
    fn test_css_rule_text() {
        let state = JsExtState::new();
        let exec = RuleExecutor::new(state);
        let result = exec.get_string("class.info@tag.span@text", TEST_HTML, None);
        assert_eq!(result, "Author Name");
    }

    #[test]
    fn test_css_rule_attr() {
        let state = JsExtState::new();
        let exec = RuleExecutor::new(state);
        let result = exec.get_string("class.book-list@tag.a@href", TEST_HTML, None);
        assert_eq!(result, "/book/1");
    }

    #[test]
    fn test_css_list() {
        let state = JsExtState::new();
        let exec = RuleExecutor::new(state);
        let result = exec.get_elements_text_list("class.book-list@tag.a@text", TEST_HTML);
        assert_eq!(result, vec!["Book One", "Book Two"]);
    }

    #[test]
    fn test_regex_replace() {
        let state = JsExtState::new();
        let exec = RuleExecutor::new(state);
        let result = exec.get_string("class.info@tag.span@text##Name##Writer", TEST_HTML, None);
        assert_eq!(result, "Author Writer");
    }

    #[test]
    fn test_json_rule() {
        let json = r#"{"books": [{"title": "A"}, {"title": "B"}]}"#;
        let state = JsExtState::new();
        let exec = RuleExecutor::new(state);
        let result = exec.get_string("$.books[0].title", json, None);
        assert_eq!(result, "A");
    }

    #[test]
    fn test_json_element_list() {
        let json = r#"{"books": [{"title": "A"}, {"title": "B"}]}"#;
        let state = JsExtState::new();
        let exec = RuleExecutor::new(state);
        let result = exec.get_element_htmls("$.books", json);

        assert_eq!(result.len(), 2);
        assert!(result[0].contains("\"title\":\"A\""));
    }

    #[test]
    fn test_json_inline_template() {
        let json = r#"{"book_id": 42}"#;
        let state = JsExtState::new();
        let exec = RuleExecutor::new(state);
        let result = exec.get_string("/novels/api/book/{{$.book_id}}", json, None);

        assert_eq!(result, "/novels/api/book/42");
    }

    #[test]
    fn test_inline_template_at_js() {
        let json = r#"{"status": 50}"#;
        let state = JsExtState::new();
        let exec = RuleExecutor::new(state);
        let result = exec.get_string("{{$.status}}@js:result.replace(/50/, '完结')", json, None);

        assert_eq!(result, "完结");
    }

    #[test]
    fn test_js_rule() {
        let state = JsExtState::new();
        let exec = RuleExecutor::new(state);
        let result = exec.get_string("<js>'hello ' + 'world'</js>", "ignored", None);
        assert_eq!(result, "hello world");
    }

    const CHAPTER_ROW: &str = r#"<dd> <a style="" href="/45_45541/42470534.html">完结感言</a></dd>"#;

    #[test]
    fn test_bare_text_hint_extracts_outer_text() {
        let state = JsExtState::new();
        let exec = RuleExecutor::new(state);
        let result = exec.get_string("text", CHAPTER_ROW, None);
        assert_eq!(result, "完结感言");
    }

    #[test]
    fn test_bare_href_hint_falls_through_wrapper_to_inner_anchor() {
        // The chapter list lands on a `<dd>` wrapper whose only child
        // is the actual `<a>` link. extract_from_root must descend
        // into the descendant <a> when the outer element doesn't
        // itself carry the requested attribute.
        let state = JsExtState::new();
        let exec = RuleExecutor::new(state);
        let result = exec.get_string("href", CHAPTER_ROW, None);
        assert_eq!(result, "/45_45541/42470534.html");
    }

    #[test]
    fn test_bare_html_hint_extracts_inner_html() {
        let state = JsExtState::new();
        let exec = RuleExecutor::new(state);
        let result = exec.get_string("html", "<div>hello <b>world</b></div>", None);
        assert!(result.contains("hello"));
        assert!(result.contains("world"));
    }

    #[test]
    fn test_bare_data_url_hint_extracts_data_attribute() {
        let state = JsExtState::new();
        let exec = RuleExecutor::new(state);
        let html = r#"<a data-url="cap1.htm">第1章</a>"#;
        assert_eq!(exec.get_string("data-url", html, None), "cap1.htm");
    }

    #[test]
    fn test_unknown_bare_word_does_not_treat_as_hint() {
        // A bare word that's NOT in the extraction-hint set should
        // be treated as a (probably invalid) CSS selector and return
        // empty — not crash and not spuriously match.
        let state = JsExtState::new();
        let exec = RuleExecutor::new(state);
        let result = exec.get_string("garbage_word", CHAPTER_ROW, None);
        assert!(result.is_empty() || !result.contains("完结感言"));
    }
}
