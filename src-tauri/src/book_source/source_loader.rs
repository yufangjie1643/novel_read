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
    let value: Value =
        serde_json::from_str(json).map_err(|e| SourceLoaderError::Parse(e.to_string()))?;

    match value {
        Value::Array(arr) => {
            let mut sources = Vec::new();
            for item in arr {
                let source = json_value_to_source(item).map_err(|e| SourceLoaderError::Parse(e))?;
                sources.push(source);
            }
            Ok(sources)
        }
        Value::Object(_) => {
            let source = json_value_to_source(value).map_err(|e| SourceLoaderError::Parse(e))?;
            Ok(vec![source])
        }
        _ => Err(SourceLoaderError::Parse(
            "Expected object or array".to_string(),
        )),
    }
}

/// Convert JSON value to BookSource (handling various field naming conventions)
fn json_value_to_source(value: Value) -> Result<BookSource, String> {
    let obj = value.as_object().ok_or("Expected JSON object")?;

    let mut source = BookSource::default();

    // Required fields (support both new and legacy field names)
    source.book_source_url = get_string_field_any(obj, &["bookSourceUrl", "sourceUrl"])
        .ok_or("Missing bookSourceUrl or sourceUrl")?;

    source.book_source_name =
        get_string_field_any(obj, &["bookSourceName", "sourceName"]).unwrap_or_default();

    // Optional fields with various naming conventions
    source.book_source_group = get_string_field_any(obj, &["bookSourceGroup", "sourceGroup"]);
    source.book_url_pattern = get_string_field_any(obj, &["bookUrlPattern"]);
    source.js_lib = get_string_field_any(obj, &["jsLib"]);
    source.concurrent_rate = get_string_field_any(obj, &["concurrentRate"]);
    source.header = get_string_field_any(obj, &["header"]);
    source.login_url = get_string_field_any(obj, &["loginUrl"]);
    source.login_ui = get_string_field_any(obj, &["loginUi"]);
    source.login_check_js = get_string_field_any(obj, &["loginCheckJs"]);
    source.cover_decode_js = get_string_field_any(obj, &["coverDecodeJs"]);
    source.book_source_comment = get_string_field_any(obj, &["bookSourceComment", "sourceComment"]);
    source.variable_comment = get_string_field_any(obj, &["variableComment"]);
    source.explore_url =
        get_string_field_any(obj, &["exploreUrl", "findUrl", "ruleFindUrl", "sortUrl"]);
    source.explore_screen = get_string_field_any(obj, &["exploreScreen"]);
    source.search_url = get_string_field_any(obj, &["searchUrl", "ruleSearchUrl"]);

    // Rule fields (serialized as JSON strings in our DB)
    if let Some(rule) = obj.get("ruleExplore").or_else(|| obj.get("ruleFind")) {
        source.rule_explore = Some(rule.to_string());
    }
    // Fallback: construct explore rule from RSS-style fields (e.g. 喵公子 subscription)
    if source.rule_explore.is_none()
        && (obj.get("ruleArticles").is_some()
            || obj.get("ruleLink").is_some()
            || obj.get("ruleTitle").is_some())
    {
        let mut explore_map = serde_json::Map::new();
        if let Some(v) = obj.get("ruleArticles") {
            explore_map.insert("bookList".to_string(), v.clone());
        }
        if let Some(v) = obj.get("ruleTitle") {
            explore_map.insert("name".to_string(), v.clone());
        }
        if let Some(v) = obj.get("ruleLink") {
            explore_map.insert("bookUrl".to_string(), v.clone());
        }
        if let Some(v) = obj.get("ruleContent") {
            explore_map.insert("intro".to_string(), v.clone());
        }
        if let Some(v) = obj.get("ruleImage") {
            explore_map.insert("coverUrl".to_string(), v.clone());
        }
        if !explore_map.is_empty() {
            source.rule_explore = Some(Value::Object(explore_map).to_string());
        }
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

    // Numeric/boolean fields (support aliases)
    let type_value = obj
        .get("bookSourceType")
        .or_else(|| obj.get("sourceType"))
        .or_else(|| obj.get("type"));
    if let Some(v) = type_value {
        source.book_source_type = v.as_i64().unwrap_or(0) as i32;
    }
    if let Some(v) = obj.get("enabled") {
        source.enabled = v.as_bool().unwrap_or(true);
    }
    let enabled_explore_value = obj.get("enabledExplore").or_else(|| obj.get("enabledFind"));
    if let Some(v) = enabled_explore_value {
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

/// Try multiple field names (for backward compatibility with various source formats)
fn get_string_field_any(obj: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(v) = get_string_field(obj, key) {
            return Some(v);
        }
    }
    None
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

    #[test]
    fn test_parse_rss_style_explore_rule() {
        let json = r#"{
            "sourceUrl": "https://example.com",
            "sourceName": "RSS Source",
            "ruleArticles": "id.content@h3",
            "ruleLink": "a@href",
            "ruleTitle": "a@textNodes"
        }"#;

        let sources = parse_source_json(json).unwrap();
        assert_eq!(sources.len(), 1);
        let explore = sources[0].rule_explore.as_ref().unwrap();
        assert!(explore.contains("bookList"));
        assert!(explore.contains("id.content@h3"));
        assert!(explore.contains("bookUrl"));
        assert!(explore.contains("name"));
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
                    println!(
                        "  - {} ({})",
                        source.book_source_name, source.book_source_url
                    );
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
