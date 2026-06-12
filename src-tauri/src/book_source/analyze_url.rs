//! AnalyzeUrl - parse URL strings with JS interpolation, page params, and JSON options
//!
//! Equivalent of Android's AnalyzeUrl.kt

use regex::Regex;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;

use super::js_extensions::JsExtState;
use super::js_runtime::JsRuntime;

/// Parsed HTTP request parameters
#[derive(Debug, Clone, Default)]
pub struct RequestParams {
    pub url: String,
    pub method: HttpMethod,
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
    pub charset: Option<String>,
    pub base_url: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HttpMethod {
    Get,
    Post,
}

impl Default for HttpMethod {
    fn default() -> Self {
        HttpMethod::Get
    }
}

/// URL parser that handles JS interpolation, page params, and JSON options
pub struct AnalyzeUrl {
    pub params: RequestParams,
    #[allow(dead_code)]
    js_state: Arc<JsExtState>,
}

impl AnalyzeUrl {
    /// Parse a URL string with optional context
    ///
    /// # Arguments
    /// * `url` - Raw URL string, may contain JS, page params, and JSON options
    /// * `base_url` - Base URL for resolving relative URLs
    /// * `key` - Search keyword (replaces `{{key}}`)
    /// * `page` - Page number (replaces `<1,2,3>` style page params)
    pub fn new(
        url: &str,
        base_url: Option<&str>,
        key: Option<&str>,
        page: Option<i32>,
        js_state: Arc<JsExtState>,
    ) -> Self {
        let mut rule_url = url.to_string();
        let base = base_url.unwrap_or("").to_string();

        // Step 1: Execute @js: and <js></js> blocks
        rule_url = Self::analyze_js(&rule_url, &js_state);

        // Step 2: Replace {{js}} expressions and <page> params
        rule_url = Self::replace_key_page(&rule_url, key, page, &js_state);

        // Step 3: Parse URL options (method, headers, body, etc.)
        let params = Self::parse_url_options(&rule_url, &base, &js_state);

        Self { params, js_state }
    }

    /// Execute @js: and <js></js> blocks in the URL
    fn analyze_js(url: &str, js_state: &Arc<JsExtState>) -> String {
        let js_pattern = Regex::new(r"(?i)<js>([\s\S]*?)</js>|@js:([\s\S]*)").unwrap();
        let rt = JsRuntime::new(js_state.clone());
        let mut result = url.to_string();
        let mut start = 0;

        for cap in js_pattern.captures_iter(url) {
            let m = cap.get(0).unwrap();
            if m.start() > start {
                let prefix = &url[start..m.start()];
                if !prefix.trim().is_empty() {
                    result = prefix.replace("@result", &result);
                }
            }
            let js_code = cap
                .get(1)
                .or_else(|| cap.get(2))
                .map(|m| m.as_str())
                .unwrap_or("");
            match rt.execute(js_code, None, None, Some(&result), None) {
                Ok(js_result) => result = js_result,
                Err(e) => {
                    eprintln!("[AnalyzeUrl] JS error: {}", e);
                }
            }
            start = m.end();
        }

        if url.len() > start {
            let suffix = &url[start..];
            if !suffix.trim().is_empty() {
                result = suffix.replace("@result", &result);
            }
        }

        result
    }

    /// Replace {{js}} expressions, {{key}} placeholder, and <page> parameters
    fn replace_key_page(
        url: &str,
        key: Option<&str>,
        page: Option<i32>,
        js_state: &Arc<JsExtState>,
    ) -> String {
        let mut result = url.to_string();

        // Step A: Replace fixed placeholders before JS evaluation
        if let Some(k) = key {
            result = result.replace("{{key}}", k);
        }
        if let Some(p) = page {
            let page_pattern = Regex::new(r"<(.*?)>").unwrap();
            result = page_pattern
                .replace_all(&result, |caps: &regex::Captures| {
                    let pages: Vec<&str> = caps[1].split(',').collect();
                    let idx = if p <= 0 {
                        0
                    } else {
                        (p as usize).saturating_sub(1)
                    };
                    if idx < pages.len() {
                        pages[idx].trim().to_string()
                    } else {
                        pages.last().unwrap_or(&"").trim().to_string()
                    }
                })
                .to_string();
        }

        // Step B: Replace remaining {{js}} expressions
        let exp_pattern = Regex::new(r"\{\{([\s\S]*?)\}\}").unwrap();
        let rt = JsRuntime::new(js_state.clone());
        result = exp_pattern
            .replace_all(&result, |caps: &regex::Captures| {
                let js_code = &caps[1];
                let wrapped_code = Self::wrap_url_expression(js_code, key, page);
                match rt.execute(&wrapped_code, None, None, None, None) {
                    Ok(js_result) => js_result,
                    Err(e) => {
                        eprintln!("[AnalyzeUrl] {{}} eval error: {}", e);
                        String::new()
                    }
                }
            })
            .to_string();

        result
    }

    fn wrap_url_expression(js_code: &str, key: Option<&str>, page: Option<i32>) -> String {
        let mut prelude = String::new();

        if let Some(k) = key {
            let escaped_key = serde_json::to_string(k).unwrap_or_else(|_| "\"\"".to_string());
            prelude.push_str(&format!("const key = {escaped_key};"));
        }

        if let Some(p) = page {
            prelude.push_str(&format!("const page = {p};"));
        }

        if prelude.is_empty() {
            js_code.to_string()
        } else {
            format!("(() => {{{prelude}return ({js_code});}})()")
        }
    }

    /// Parse URL and trailing JSON options
    fn parse_url_options(url: &str, base: &str, js_state: &Arc<JsExtState>) -> RequestParams {
        let mut params = RequestParams::default();
        params.base_url = base.to_string();

        // Split URL from JSON options: first comma followed by {
        // regex crate does not support look-ahead, so we find `,\s*{` manually
        let (url_part, option_str) = if let Some(pos) = url.find(',') {
            let after = &url[pos + 1..];
            let trimmed = after.trim_start();
            if trimmed.starts_with('{') {
                (&url[..pos], Some(trimmed))
            } else {
                (url, None)
            }
        } else {
            (url, None)
        };

        // Resolve relative URL
        params.url = Self::resolve_url(url_part.trim(), base);
        if let Some(b) = Self::extract_base_url(&params.url) {
            params.base_url = b;
        }

        // Parse JSON options
        if let Some(opts) = option_str {
            let opts = opts.trim();
            if let Ok(json) = serde_json::from_str::<Value>(opts) {
                if let Some(obj) = json.as_object() {
                    // Method
                    if let Some(m) = obj.get("method").and_then(|v| v.as_str()) {
                        if m.eq_ignore_ascii_case("post") {
                            params.method = HttpMethod::Post;
                        }
                    }

                    // Headers
                    if let Some(headers) = obj.get("headers").and_then(|v| v.as_object()) {
                        for (k, v) in headers {
                            if let Some(val) = v.as_str() {
                                params.headers.insert(k.clone(), val.to_string());
                            }
                        }
                    }

                    // Body
                    if let Some(body) = obj.get("body").and_then(|v| v.as_str()) {
                        params.body = Some(body.to_string());
                    }

                    // Charset
                    if let Some(cs) = obj.get("charset").and_then(|v| v.as_str()) {
                        params.charset = Some(cs.to_string());
                    }

                    // WebJS - execute it to modify URL
                    if let Some(web_js) = obj.get("webJs").and_then(|v| v.as_str()) {
                        let rt = JsRuntime::new(js_state.clone());
                        if let Ok(new_url) = rt.execute(web_js, None, None, Some(&params.url), None)
                        {
                            params.url = new_url;
                        }
                    }
                }
            }
        }

        // For GET requests, separate query string from URL
        if params.method == HttpMethod::Get {
            let url_clone = params.url.clone();
            if let Some(pos) = url_clone.find('?') {
                let query = &url_clone[pos + 1..];
                params.url = url_clone[..pos].to_string();
                if !query.is_empty() {
                    params.body = Some(query.to_string());
                }
            }
        }

        params
    }

    /// Resolve a possibly relative URL against a base URL
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

    /// Extract base URL (scheme + host + path up to last /)
    fn extract_base_url(url: &str) -> Option<String> {
        if let Ok(parsed) = url::Url::parse(url) {
            let path = parsed.path();
            if let Some(pos) = path.rfind('/') {
                let base_path = &path[..pos + 1];
                return Some(format!(
                    "{}://{}{}",
                    parsed.scheme(),
                    parsed.host_str().unwrap_or(""),
                    base_path
                ));
            }
            return Some(format!(
                "{}://{}/",
                parsed.scheme(),
                parsed.host_str().unwrap_or("")
            ));
        }
        None
    }

    /// Execute HTTP request and return response body as string
    pub fn get_str_response(&self) -> Result<String, AnalyzeUrlError> {
        // Execute on a dedicated thread to avoid tokio runtime conflicts
        let params = self.params.clone();
        std::thread::spawn(move || match Self::execute_request(&params, false) {
            Ok(text) => Ok(text),
            Err(first_err) if Self::should_retry_without_proxy(&params, &first_err) => {
                Self::execute_request(&params, true).map_err(|direct_err| {
                    AnalyzeUrlError::Request(format!(
                        "proxied request failed: {}; direct retry without proxy failed: {}",
                        first_err, direct_err
                    ))
                })
            }
            Err(err) => Err(err),
        })
        .join()
        .unwrap_or_else(|_| Err(AnalyzeUrlError::Thread("panicked".to_string())))
    }

    fn execute_request(
        params: &RequestParams,
        without_proxy: bool,
    ) -> Result<String, AnalyzeUrlError> {
        // Use process-wide pooled clients; pick the no-proxy variant only on
        // the retry-without-proxy fallback path.
        let client = if without_proxy {
            crate::http::blocking_client_no_proxy()
        } else {
            crate::http::blocking_client()
        };

        let mut req = match params.method {
            HttpMethod::Get => {
                let url = if let Some(ref body) = params.body {
                    format!("{}?{}", params.url, body)
                } else {
                    params.url.clone()
                };
                client.get(url)
            }
            HttpMethod::Post => {
                let mut req = client.post(&params.url);
                if let Some(ref body) = params.body {
                    req = req.body(body.clone());
                }
                req
            }
        };

        // Set default User-Agent
        req = req.header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)");

        // Apply custom headers
        for (k, v) in &params.headers {
            req = req.header(k, v);
        }

        let resp = req
            .send()
            .map_err(|e| AnalyzeUrlError::Request(e.to_string()))?;
        resp.text()
            .map_err(|e| AnalyzeUrlError::Request(e.to_string()))
    }

    fn should_retry_without_proxy(params: &RequestParams, error: &AnalyzeUrlError) -> bool {
        Self::should_retry_without_proxy_for_env(params, error, Self::proxy_env_configured())
    }

    fn should_retry_without_proxy_for_env(
        params: &RequestParams,
        error: &AnalyzeUrlError,
        proxy_env_configured: bool,
    ) -> bool {
        params.method == HttpMethod::Get
            && matches!(error, AnalyzeUrlError::Request(_))
            && proxy_env_configured
    }

    fn proxy_env_configured() -> bool {
        ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"]
            .iter()
            .any(|key| std::env::var_os(key).is_some_and(|value| !value.is_empty()))
    }
}

#[derive(Debug, thiserror::Error)]
pub enum AnalyzeUrlError {
    #[error("HTTP client error: {0}")]
    Client(String),
    #[error("HTTP request error: {0}")]
    Request(String),
    #[error("Thread error: {0}")]
    Thread(String),
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_relative_url() {
        assert_eq!(
            AnalyzeUrl::resolve_url("/search?q=test", "https://example.com"),
            "https://example.com/search?q=test"
        );
        assert_eq!(
            AnalyzeUrl::resolve_url("search?q=test", "https://example.com/"),
            "https://example.com/search?q=test"
        );
        assert_eq!(
            AnalyzeUrl::resolve_url("https://other.com/page", "https://example.com"),
            "https://other.com/page"
        );
    }

    #[test]
    fn test_extract_base_url() {
        assert_eq!(
            AnalyzeUrl::extract_base_url("https://example.com/path/to/page.html"),
            Some("https://example.com/path/to/".to_string())
        );
        assert_eq!(
            AnalyzeUrl::extract_base_url("https://example.com/"),
            Some("https://example.com/".to_string())
        );
    }

    #[test]
    fn test_parse_simple_url() {
        let state = JsExtState::new();
        let au = AnalyzeUrl::new(
            "https://example.com/search?q={{key}}",
            None,
            Some("hello world"),
            None,
            state,
        );
        assert_eq!(au.params.url, "https://example.com/search");
        assert_eq!(au.params.body, Some("q=hello world".to_string()));
        assert_eq!(au.params.method, HttpMethod::Get);
    }

    #[test]
    fn test_parse_url_with_options() {
        let state = JsExtState::new();
        let au = AnalyzeUrl::new(
            "https://example.com/api, {\"method\": \"POST\", \"body\": \"q=test\"}",
            None,
            None,
            None,
            state,
        );
        assert_eq!(au.params.url, "https://example.com/api");
        assert_eq!(au.params.method, HttpMethod::Post);
        assert_eq!(au.params.body, Some("q=test".to_string()));
    }

    #[test]
    fn test_page_replacement() {
        let state = JsExtState::new();
        let au = AnalyzeUrl::new(
            "https://example.com/list_<1,2,3>.html",
            None,
            None,
            Some(2),
            state,
        );
        assert_eq!(au.params.url, "https://example.com/list_2.html");
    }

    #[test]
    fn test_page_placeholder_replacement() {
        let state = JsExtState::new();
        let au = AnalyzeUrl::new(
            "https://example.com/search?q={{key}}&page={{page}}",
            None,
            Some("book"),
            Some(3),
            state,
        );

        assert_eq!(au.params.url, "https://example.com/search");
        assert_eq!(au.params.body, Some("q=book&page=3".to_string()));
    }

    #[test]
    fn test_page_expression_replacement() {
        let state = JsExtState::new();
        let au = AnalyzeUrl::new(
            "https://example.com/search?offset={{(page - 1) * 20}}&q={{key}}",
            None,
            Some("book"),
            Some(4),
            state,
        );

        assert_eq!(au.params.url, "https://example.com/search");
        assert_eq!(au.params.body, Some("offset=60&q=book".to_string()));
    }

    #[test]
    fn test_page_overflow() {
        let state = JsExtState::new();
        let au = AnalyzeUrl::new(
            "https://example.com/list_<1,2,3>.html",
            None,
            None,
            Some(5),
            state,
        );
        assert_eq!(au.params.url, "https://example.com/list_3.html");
    }

    #[test]
    fn test_get_transport_error_retries_without_proxy_when_proxy_env_exists() {
        let params = RequestParams {
            url: "https://example.com/book".to_string(),
            method: HttpMethod::Get,
            ..Default::default()
        };
        let error = AnalyzeUrlError::Request("error sending request".to_string());

        assert!(AnalyzeUrl::should_retry_without_proxy_for_env(
            &params, &error, true
        ));
    }

    #[test]
    fn test_post_transport_error_does_not_retry_without_proxy() {
        let params = RequestParams {
            url: "https://example.com/api".to_string(),
            method: HttpMethod::Post,
            ..Default::default()
        };
        let error = AnalyzeUrlError::Request("error sending request".to_string());

        assert!(!AnalyzeUrl::should_retry_without_proxy_for_env(
            &params, &error, true
        ));
    }

    #[test]
    fn test_get_transport_error_does_not_retry_without_proxy_env() {
        let params = RequestParams {
            url: "https://example.com/book".to_string(),
            method: HttpMethod::Get,
            ..Default::default()
        };
        let error = AnalyzeUrlError::Request("error sending request".to_string());

        assert!(!AnalyzeUrl::should_retry_without_proxy_for_env(
            &params, &error, false
        ));
    }
}
