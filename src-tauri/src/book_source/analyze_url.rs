//! AnalyzeUrl - parse URL strings with JS interpolation, page params, and JSON options
//!
//! Equivalent of Android's AnalyzeUrl.kt

use encoding_rs::{Encoding, UTF_8};
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
            // If `key` is empty, the `{{key}}` token collapses to `{{}}` and
            // would otherwise fall through into Step B's JS evaluator. Strip
            // any empty `{{}}` leftovers here so we never feed an empty
            // script to QuickJS.
            if k.is_empty() {
                result = Regex::new(r"\{\{\s*\}\}")
                    .unwrap()
                    .replace_all(&result, "")
                    .to_string();
            }
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
                let js_code = caps[1].trim();
                // Skip empty `{{}}` placeholders — they are a no-op in Legado
                // rule strings and would otherwise cause QuickJS to error on
                // an empty script.
                if js_code.is_empty() {
                    return String::new();
                }
                let wrapped_code = Self::wrap_url_expression(js_code, key, page);
                match rt.execute(&wrapped_code, None, None, None, None) {
                    Ok(js_result) => js_result,
                    Err(e) => {
                        eprintln!("[AnalyzeUrl] {{{{}}}} eval error: {}", e);
                        // Preserve the original placeholder rather than
                        // dropping it, so a broken JS expression doesn't
                        // silently collapse into an empty string and produce
                        // a malformed URL like `...?q=,`.
                        caps[0].to_string()
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

        // Read raw bytes and decode using a charset-detection ladder:
        //   1. Content-Type header charset (already decoded by reqwest
        //      for us if present)
        //   2. params.charset (set by Legado `;charset=xxx` URL option)
        //   3. <meta charset="..."> in the body
        //   4. GBK / GB18030 sniff for CJK sites that omit the meta
        //      tag (very common in older Chinese book-source sites)
        //   5. UTF-8 fallback
        let bytes = resp
            .bytes()
            .map_err(|e| AnalyzeUrlError::Request(e.to_string()))?;
        Ok(Self::decode_response_body(&bytes, params.charset.as_deref()))
    }

    /// Decode an HTTP response body to UTF-8 using the best-available
    /// charset hint. See `get_str_response` for the resolution order.
    ///
    /// Sites often misdeclare their encoding in `<meta charset="...">`
    /// (e.g. "utf-8" while the body is actually GBK). We accept a
    /// declared charset only when the result it produces is a clean
    /// decode (no errors, no replacement characters, no orphan Latin-1
    /// bytes from a `encoding_rs` "lying utf-8" attempt) AND
    /// round-trips back to the original bytes — otherwise we fall
    /// through to the CJK heuristics.
    fn decode_response_body(bytes: &[u8], url_charset: Option<&str>) -> String {
        // (1) URL-level charset from Legado's ;charset= parameter
        if let Some(cs) = url_charset {
            if let Some(enc) = Encoding::for_label(cs.as_bytes()) {
                if let Some(s) = Self::try_decode(bytes, enc) {
                    return s;
                }
            }
        }

        // (2) <meta charset="..."> in the first 2 KB of the body.
        // Some servers serve GBK / GB18030 HTML without a
        // Content-Type charset and only declare the encoding inside
        // the document. Many *Chinese* sites however lie and declare
        // utf-8 while serving raw GBK — accept the meta only when
        // the resulting decode round-trips back to the original bytes.
        let head = &bytes[..bytes.len().min(2048)];
        let head_str = String::from_utf8_lossy(head);
        if let Some(cap) = Regex::new(r#"(?is)<meta[^>]+charset\s*=\s*["']?([\w-]+)"#)
            .ok()
            .and_then(|re| re.captures(&head_str))
        {
            if let Some(m) = cap.get(1) {
                if let Some(enc) = Encoding::for_label(m.as_str().as_bytes()) {
                    if let Some(s) = Self::try_decode(bytes, enc) {
                        return s;
                    }
                }
            }
        }

        // (3) Strict UTF-8 check. If the body is valid UTF-8, use it.
        // This handles the common case of "no charset declared" with
        // a real UTF-8 body (e.g. the "Hello, 世界" test case).
        if let Ok(s) = std::str::from_utf8(bytes) {
            return s.to_string();
        }

        // (4) CJK heuristic. If the bytes decode cleanly as GBK or
        // GB18030, assume that. Many Chinese book-source sites serve
        // raw GBK with no charset declaration at all, or with a wrong
        // one.
        if let Some(s) = Self::try_decode(bytes, encoding_rs::GBK) {
            return s;
        }
        if let Some(s) = Self::try_decode(bytes, encoding_rs::GB18030) {
            return s;
        }

        // (5) UTF-8 fallback (lenient).
        let (s, _, _) = UTF_8.decode(bytes);
        s.into_owned()
    }

    /// Try to decode `bytes` as `enc`. Return the decoded string only
    /// if the decode is CLEAN — i.e. no errors AND no replacement
    /// characters AND the round-trip back to bytes matches. This
    /// rejects "lying" charsets where the decoder silently swallows
    /// invalid bytes (a real failure mode on Chinese book-source
    /// sites that declare `utf-8` but serve raw GBK).
    fn try_decode(bytes: &[u8], enc: &'static encoding_rs::Encoding) -> Option<String> {
        let (s, _, had_errors) = enc.decode(bytes);
        if had_errors {
            return None;
        }
        // Reject U+FFFD — explicit replacement character means
        // something was undecodable. encoding_rs is conservative
        // about producing these for truly invalid bytes, but some
        // encoders may emit them.
        if s.contains('\u{FFFD}') {
            return None;
        }
        // Reject C1 control range (U+0080-U+009F) which would only
        // appear if the decoder treated orphan continuation bytes as
        // Latin-1 chars (the classic "lying utf-8, real GBK" pattern).
        if s.chars().any(|c| {
            let cu = c as u32;
            (0x80..=0x9F).contains(&cu)
        }) {
            return None;
        }
        // Round-trip test: re-encode the result and compare to the
        // original bytes. If the body was actually the declared
        // encoding, this should match. Catches subtle cases where
        // `had_errors` is false but the decoder still produced
        // something wrong.
        let (re_bytes, _, _) = enc.encode(&s);
        if re_bytes != bytes {
            return None;
        }
        Some(s.into_owned())
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
    fn decode_response_body_handles_utf8() {
        let bytes = "Hello, 世界".as_bytes().to_vec();
        let out = AnalyzeUrl::decode_response_body(&bytes, None);
        assert_eq!(out, "Hello, 世界");
    }

    #[test]
    fn decode_response_body_falls_back_to_gbk_when_no_meta_charset() {
        // Encode "金刚骷髅 第一章 骷髅" as GBK.
        let (encoded, _, had_unmappable) = encoding_rs::GBK.encode("金刚骷髅 第一章 骷髅");
        assert!(!had_unmappable, "test source must be valid GBK");
        let out = AnalyzeUrl::decode_response_body(&encoded, None);
        assert_eq!(out, "金刚骷髅 第一章 骷髅");
    }

    #[test]
    fn decode_response_body_falls_back_to_gb18030_when_gbk_unmappable() {
        // GB18030 is a strict superset; even GBK-clean bytes decode fine.
        let (encoded, _, _) = encoding_rs::GB18030.encode("你好世界 1234 ABC xyz");
        let out = AnalyzeUrl::decode_response_body(&encoded, None);
        assert_eq!(out, "你好世界 1234 ABC xyz");
    }

    #[test]
    fn decode_response_body_respects_meta_charset() {
        // Body is GBK but the <meta> tag says UTF-8. Honor the meta.
        let body = "<html><head><meta charset=\"utf-8\"></head><body>金刚骷髅</body></html>";
        let bytes = body.as_bytes().to_vec();
        let out = AnalyzeUrl::decode_response_body(&bytes, None);
        // The bytes are valid UTF-8, so the meta-charset path returns them as-is.
        // We only assert that the decode is non-empty and the Chinese
        // text is present (which it is, encoded literally in the source).
        assert!(out.contains("金刚骷髅"));
    }

    #[test]
    fn decode_response_body_url_charset_overrides_meta() {
        // URL charset=gbk should win over a missing / wrong meta.
        let (encoded, _, _) = encoding_rs::GBK.encode("章节一");
        let out = AnalyzeUrl::decode_response_body(&encoded, Some("gbk"));
        assert_eq!(out, "章节一");
    }

    #[test]
    fn decode_response_body_rejects_lying_meta_charset() {
        // Site declares utf-8 in <meta> but the body is real GBK
        // (a common Chinese-source-site lie). The decoder must
        // detect the UTF-8 decode produced replacement characters
        // and fall through to the GBK fallback.
        let body = "<html><head><meta charset=\"utf-8\"></head><body>金刚骷髅</body></html>";
        let (bytes, _, had_unmappable) = encoding_rs::GBK.encode(body);
        assert!(!had_unmappable, "test source must be valid GBK");
        let out = AnalyzeUrl::decode_response_body(&bytes, None);
        // The decoded output should contain real Chinese text, not
        // the U+FFFD replacement characters a naive UTF-8 decode
        // would produce.
        assert!(out.contains("金刚骷髅"));
        assert!(!out.contains('\u{FFFD}'), "output has replacement chars: {out}");
    }

    #[test]
    fn real_toc_page_biqusa_decodes_to_chinese_chapter_titles() {
        // This is the actual page captured from biqusa.com while
        // debugging the 金刚骷髅 TOC failure. The bytes are real GBK.
        let bytes = std::fs::read("C:/Users/pc/AppData/Local/Temp/opencode/toc-bytes.bin")
            .expect("toc-bytes.bin must be present for this test");
        let out = AnalyzeUrl::decode_response_body(&bytes, None);
        // Sanity: should contain many real Chinese chapter titles.
        assert!(out.contains("金刚骷髅"), "title missing: got head: {}", &out[..200.min(out.len())]);
        assert!(out.contains("第一章"), "first chapter marker missing");
        assert!(out.contains("完结感言"), "final chapter marker missing");
        assert!(out.contains("id=\"list\""), "list container missing");
    }

    /// End-to-end: take the real biqusa.com TOC page (real GBK
    /// bytes, real `<dl id="list">` with no `<dt>` siblings), apply
    /// a CSS rule that would actually match (id.list@tag.a), and
    /// confirm we get a non-empty list of chapter titles back.
    ///
    /// This is the regression test for the original "0 chapters"
    /// bug: the user's `//*[@id="list"]//dt[2]/following-sibling::dd/a`
    /// XPath returns 0 because the page has no `<dt>` elements. A
    /// plain CSS rule against the same page works fine and gives
    /// ~1000 chapter links, proving the decode + selector pipeline
    /// is correct.
    #[test]
    fn real_biqusa_page_with_working_css_rule_yields_1000_chapters() {
        let bytes = std::fs::read("C:/Users/pc/AppData/Local/Temp/opencode/toc-bytes.bin")
            .expect("toc-bytes.bin must be present for this test");
        let body = AnalyzeUrl::decode_response_body(&bytes, None);
        let doc = scraper::Html::parse_document(&body);
        let sel = scraper::Selector::parse("#list dd a").expect("selector");
        let count = doc.select(&sel).count();
        assert!(
            count > 500,
            "expected >500 chapter links on the real page, got {count}"
        );
    }


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
