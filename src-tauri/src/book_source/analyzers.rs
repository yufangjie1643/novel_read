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

    /// Get string result from CSS selector
    pub fn get_string(&self, selector_str: &str, attr: Option<&str>) -> Option<String> {
        let selector = Selector::parse(selector_str).ok()?;
        let element = self.document.select(&selector).next()?;

        let text = if let Some(attr_name) = attr {
            element.value().attr(attr_name)?.to_string()
        } else {
            element.text().collect::<String>().trim().to_string()
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
}
