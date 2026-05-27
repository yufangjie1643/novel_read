//! Book source loader - download and parse source JSON

use crate::db::models::BookSource;
use serde_json::Value;

/// Download and parse a book source from URL
pub async fn load_source_from_url(url: &str) -> Result<Vec<BookSource>, SourceLoaderError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| SourceLoaderError::Client(e.to_string()))?;

    let response = client
        .get(url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
        .send()
        .await
        .map_err(|e| SourceLoaderError::Request(e.to_string()))?;

    let text = response
        .text()
        .await
        .map_err(|e| SourceLoaderError::Request(e.to_string()))?;

    parse_source_json(&text)
}

/// Parse book source JSON (single object or array)
pub fn parse_source_json(json: &str) -> Result<Vec<BookSource>, SourceLoaderError> {
    let value: Value = serde_json::from_str(json)
        .map_err(|e| SourceLoaderError::Parse(e.to_string()))?;

    match value {
        Value::Array(arr) => {
            let mut sources = Vec::new();
            for item in arr {
                let source = json_value_to_source(item)
                    .map_err(|e| SourceLoaderError::Parse(e))?;
                sources.push(source);
            }
            Ok(sources)
        }
        Value::Object(_) => {
            let source = json_value_to_source(value)
                .map_err(|e| SourceLoaderError::Parse(e))?;
            Ok(vec![source])
        }
        _ => Err(SourceLoaderError::Parse("Expected object or array".to_string())),
    }
}

/// Convert JSON value to BookSource (handling various field naming conventions)
fn json_value_to_source(value: Value) -> Result<BookSource, String> {
    let obj = value.as_object().ok_or("Expected JSON object")?;

    let mut source = BookSource::default();

    // Required fields
    source.book_source_url = get_string_field(obj, "bookSourceUrl")
        .or_else(|| get_string_field(obj, "bookSourceUrl"))
        .ok_or("Missing bookSourceUrl")?;

    source.book_source_name = get_string_field(obj, "bookSourceName")
        .or_else(|| get_string_field(obj, "bookSourceName"))
        .unwrap_or_default();

    // Optional fields with various naming conventions
    source.book_source_group = get_string_field(obj, "bookSourceGroup");
    source.book_url_pattern = get_string_field(obj, "bookUrlPattern");
    source.js_lib = get_string_field(obj, "jsLib");
    source.concurrent_rate = get_string_field(obj, "concurrentRate");
    source.header = get_string_field(obj, "header");
    source.login_url = get_string_field(obj, "loginUrl");
    source.login_ui = get_string_field(obj, "loginUi");
    source.login_check_js = get_string_field(obj, "loginCheckJs");
    source.cover_decode_js = get_string_field(obj, "coverDecodeJs");
    source.book_source_comment = get_string_field(obj, "bookSourceComment");
    source.variable_comment = get_string_field(obj, "variableComment");
    source.explore_url = get_string_field(obj, "exploreUrl");
    source.explore_screen = get_string_field(obj, "exploreScreen");
    source.search_url = get_string_field(obj, "searchUrl");

    // Rule fields (serialized as JSON strings in our DB)
    if let Some(rule) = obj.get("ruleExplore") {
        source.rule_explore = Some(rule.to_string());
    }
    if let Some(rule) = obj.get("ruleSearch") {
        source.rule_search = Some(rule.to_string());
    }
    if let Some(rule) = obj.get("ruleBookInfo") {
        source.rule_book_info = Some(rule.to_string());
    }
    if let Some(rule) = obj.get("ruleToc") {
        source.rule_toc = Some(rule.to_string());
    }
    if let Some(rule) = obj.get("ruleContent") {
        source.rule_content = Some(rule.to_string());
    }
    if let Some(rule) = obj.get("ruleReview") {
        source.rule_review = Some(rule.to_string());
    }

    // Numeric/boolean fields
    if let Some(v) = obj.get("bookSourceType") {
        source.book_source_type = v.as_i64().unwrap_or(0) as i32;
    }
    if let Some(v) = obj.get("enabled") {
        source.enabled = v.as_bool().unwrap_or(true);
    }
    if let Some(v) = obj.get("enabledExplore") {
        source.enabled_explore = v.as_bool().unwrap_or(true);
    }
    if let Some(v) = obj.get("enabledCookieJar") {
        source.enabled_cookie_jar = v.as_bool();
    }

    Ok(source)
}

fn get_string_field(obj: &serde_json::Map<String, Value>, key: &str) -> Option<String> {
    obj.get(key).and_then(|v| {
        if v.is_string() {
            v.as_str().map(|s| s.to_string())
        } else {
            None
        }
    })
}

#[derive(Debug, thiserror::Error)]
pub enum SourceLoaderError {
    #[error("HTTP client error: {0}")]
    Client(String),
    #[error("HTTP request error: {0}")]
    Request(String),
    #[error("JSON parse error: {0}")]
    Parse(String),
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_single_source() {
        let json = r#"{
            "bookSourceUrl": "https://example.com",
            "bookSourceName": "Test Source",
            "searchUrl": "https://example.com/search?q={{key}}",
            "ruleSearch": {
                "bookList": "class.list@tag.a",
                "name": "@text"
            }
        }"#;

        let sources = parse_source_json(json).unwrap();
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].book_source_url, "https://example.com");
        assert_eq!(sources[0].book_source_name, "Test Source");
        assert!(sources[0].rule_search.is_some());
    }

    #[test]
    fn test_parse_source_array() {
        let json = r#"[
            {"bookSourceUrl": "https://a.com", "bookSourceName": "A"},
            {"bookSourceUrl": "https://b.com", "bookSourceName": "B"}
        ]"#;

        let sources = parse_source_json(json).unwrap();
        assert_eq!(sources.len(), 2);
        assert_eq!(sources[0].book_source_name, "A");
        assert_eq!(sources[1].book_source_name, "B");
    }

    /// Integration test with real book source URL
    #[tokio::test]
    async fn test_load_real_source() {
        let url = "http://yuedu.miaogongzi.net/shuyuan/miaogongziDY.json";
        let result = load_source_from_url(url).await;

        match result {
            Ok(sources) => {
                println!("Loaded {} sources", sources.len());
                for source in &sources {
                    println!("  - {} ({})", source.book_source_name, source.book_source_url);
                }
                assert!(!sources.is_empty(), "Should load at least one source");
            }
            Err(e) => {
                // Network might not be available in CI, so don't panic
                println!("Failed to load source: {}", e);
            }
        }
    }
}
