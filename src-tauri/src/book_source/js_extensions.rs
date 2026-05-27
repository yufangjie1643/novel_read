//! JsExtensions - injected Rust functions callable from JS
//!
//! Replaces Android's JsExtensions.kt (100+ methods)
//! Core methods: ajax, getCookie, base64Decode, cacheFile, etc.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Shared state for JS extensions
pub struct JsExtState {
    /// Cookie store: domain -> cookie string
    cookies: Mutex<HashMap<String, String>>,
    /// Cache store: key -> (value, expiry)
    cache: Mutex<HashMap<String, (String, Option<u64>)>>,
}

impl JsExtState {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            cookies: Mutex::new(HashMap::new()),
            cache: Mutex::new(HashMap::new()),
        })
    }

    // ==================== Cookie ====================

    pub fn get_cookie(&self, tag: &str, key: Option<&str>) -> String {
        let cookies = self.cookies.lock().unwrap();
        match key {
            Some(k) => {
                // Extract specific key from cookie string
                cookies.get(tag).map(|s| {
                    Self::extract_cookie_value(s, k)
                }).unwrap_or_default()
            }
            None => cookies.get(tag).cloned().unwrap_or_default(),
        }
    }

    pub fn set_cookie(&self, tag: &str, cookie: &str) {
        let mut cookies = self.cookies.lock().unwrap();
        cookies.insert(tag.to_string(), cookie.to_string());
    }

    fn extract_cookie_value(cookie_str: &str, key: &str) -> String {
        for part in cookie_str.split(';') {
            let part = part.trim();
            if let Some(eq_pos) = part.find('=') {
                let k = part[..eq_pos].trim();
                let v = part[eq_pos + 1..].trim();
                if k == key {
                    return v.to_string();
                }
            }
        }
        String::new()
    }

    // ==================== Cache ====================

    pub fn get_cache(&self, key: &str) -> Option<String> {
        let cache = self.cache.lock().unwrap();
        cache.get(key).and_then(|(value, expiry)| {
            if let Some(exp) = expiry {
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_secs();
                if now > *exp {
                    return None;
                }
            }
            Some(value.clone())
        })
    }

    pub fn set_cache(&self, key: &str, value: &str, save_time: u64) {
        let mut cache = self.cache.lock().unwrap();
        let expiry = if save_time > 0 {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs();
            Some(now + save_time)
        } else {
            None
        };
        cache.insert(key.to_string(), (value.to_string(), expiry));
    }

    // ==================== Encoding ====================

    pub fn base64_decode(&self, input: &str) -> String {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD
            .decode(input.as_bytes())
            .ok()
            .and_then(|v| String::from_utf8(v).ok())
            .unwrap_or_default()
    }

    pub fn base64_encode(&self, input: &str) -> String {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD.encode(input.as_bytes())
    }

    // ==================== File I/O ====================

    pub fn read_file(&self, path: &str) -> Option<Vec<u8>> {
        std::fs::read(path).ok()
    }

    pub fn write_file(&self, path: &str, content: &[u8]) -> bool {
        std::fs::write(path, content).is_ok()
    }

    pub fn delete_file(&self, path: &str) -> bool {
        std::fs::remove_file(path).is_ok()
    }

    // ==================== Utils ====================

    pub fn log(&self, msg: &str) {
        println!("[JS] {}", msg);
    }

    pub fn random_uuid(&self) -> String {
        uuid::Uuid::new_v4().to_string()
    }

    // ==================== HTTP ====================

    /// Synchronous HTTP GET - executes on a dedicated thread to avoid
    /// tokio runtime conflicts when called from within rquickjs closures.
    pub fn ajax(&self, url: &str) -> String {
        let url = url.to_string();
        std::thread::spawn(move || {
            let client = match reqwest::blocking::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
            {
                Ok(c) => c,
                Err(_) => return String::new(),
            };
            client
                .get(&url)
                .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
                .send()
                .and_then(|r| r.text())
                .unwrap_or_default()
        })
        .join()
        .unwrap_or_default()
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cookie_store() {
        let state = JsExtState::new();
        state.set_cookie("example.com", "session=abc123; path=/");
        assert_eq!(state.get_cookie("example.com", None), "session=abc123; path=/");
        assert_eq!(state.get_cookie("example.com", Some("session")), "abc123");
    }

    #[test]
    fn test_cache() {
        let state = JsExtState::new();
        state.set_cache("key1", "value1", 0);
        assert_eq!(state.get_cache("key1"), Some("value1".to_string()));
    }

    #[test]
    fn test_base64() {
        let state = JsExtState::new();
        let encoded = state.base64_encode("hello world");
        assert_eq!(encoded, "aGVsbG8gd29ybGQ=");
        let decoded = state.base64_decode(&encoded);
        assert_eq!(decoded, "hello world");
    }
}
