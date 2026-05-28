use rquickjs::{Context, Ctx, Function, Object, Runtime, Value};
use std::sync::Arc;

use super::js_extensions::JsExtState;

/// JS execution environment for book source rules
pub struct JsRuntime {
    /// Shared state for extensions (cookie, cache, etc.)
    state: Arc<JsExtState>,
}

impl JsRuntime {
    pub fn new(state: Arc<JsExtState>) -> Self {
        Self { state }
    }

    /// Execute JavaScript code with injected context
    pub fn execute(
        &self,
        js_code: &str,
        source_url: Option<&str>,
        book_url: Option<&str>,
        result: Option<&str>,
        base_url: Option<&str>,
    ) -> Result<String, JsRuntimeError> {
        let rt = Runtime::new().map_err(|e| JsRuntimeError::Runtime(e.to_string()))?;

        // Set memory limit for safety
        rt.set_memory_limit(32 * 1024 * 1024); // 32MB

        let ctx = Context::full(&rt).map_err(|e| JsRuntimeError::Context(e.to_string()))?;

        // Execute inside context - all operations use rquickjs::Error
        let inner_result = ctx.with(|ctx| {
            let globals = ctx.globals();

            // Inject java object
            let java = Self::create_java_object(ctx.clone(), &self.state)?;
            globals.set("java", java)?;

            // Inject context variables
            if let Some(url) = source_url {
                globals.set("source", url)?;
            }
            if let Some(url) = book_url {
                globals.set("book", url)?;
            }
            if let Some(res) = result {
                globals.set("result", res)?;
            }
            if let Some(url) = base_url {
                globals.set("baseUrl", url)?;
            }

            // Execute the JS code
            let result: Value = ctx.eval(js_code)?;

            // Convert result to string
            let result_str = if result.is_null() || result.is_undefined() {
                "null".to_string()
            } else if let Some(n) = result.as_number() {
                if n.fract() == 0.0 {
                    format!("{n:.0}")
                } else {
                    n.to_string()
                }
            } else if let Some(b) = result.as_bool() {
                b.to_string()
            } else {
                result
                    .as_string()
                    .and_then(|s| s.to_string().ok())
                    .unwrap_or_else(|| "[object]".to_string())
            };

            Ok::<String, rquickjs::Error>(result_str)
        });

        inner_result.map_err(|e| JsRuntimeError::Execution(e.to_string()))
    }

    /// Create the `java` object with utility methods
    fn create_java_object<'js>(
        ctx: Ctx<'js>,
        state: &Arc<JsExtState>,
    ) -> Result<Object<'js>, rquickjs::Error> {
        let java = Object::new(ctx.clone())?;

        // java.log(msg)
        let s = state.clone();
        java.set(
            "log",
            Function::new(ctx.clone(), move |msg: String| {
                s.log(&msg);
            })?
            .with_name("log")?,
        )?;

        // java.getCookie(tag, key?)
        let s = state.clone();
        java.set(
            "getCookie",
            Function::new(
                ctx.clone(),
                move |tag: String, key: Option<String>| -> String {
                    s.get_cookie(&tag, key.as_deref())
                },
            )?
            .with_name("getCookie")?,
        )?;

        // java.base64Decode(str)
        let s = state.clone();
        java.set(
            "base64Decode",
            Function::new(ctx.clone(), move |input: String| -> String {
                s.base64_decode(&input)
            })?
            .with_name("base64Decode")?,
        )?;

        // java.base64Encode(str)
        let s = state.clone();
        java.set(
            "base64Encode",
            Function::new(ctx.clone(), move |input: String| -> String {
                s.base64_encode(&input)
            })?
            .with_name("base64Encode")?,
        )?;

        // java.randomUUID()
        let s = state.clone();
        java.set(
            "randomUUID",
            Function::new(ctx.clone(), move || -> String { s.random_uuid() })?
                .with_name("randomUUID")?,
        )?;

        // java.get(key) - from cache
        let s = state.clone();
        java.set(
            "get",
            Function::new(ctx.clone(), move |key: String| -> String {
                s.get_cache(&key).unwrap_or_default()
            })?
            .with_name("get")?,
        )?;

        // java.put(key, value) - to cache
        let s = state.clone();
        java.set(
            "put",
            Function::new(ctx.clone(), move |key: String, value: String| {
                s.set_cache(&key, &value, 0);
            })?
            .with_name("put")?,
        )?;

        // java.ajax(url) - HTTP GET
        let s = state.clone();
        java.set(
            "ajax",
            Function::new(ctx.clone(), move |url: String| -> String { s.ajax(&url) })?
                .with_name("ajax")?,
        )?;

        Ok(java)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum JsRuntimeError {
    #[error("Failed to create JS runtime: {0}")]
    Runtime(String),
    #[error("Failed to create JS context: {0}")]
    Context(String),
    #[error("JS execution failed: {0}")]
    Execution(String),
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_js_basic_execution() {
        let state = JsExtState::new();
        let rt = JsRuntime::new(state);

        let result = rt
            .execute("'hello' + ' ' + 'world'", None, None, None, None)
            .unwrap();

        assert_eq!(result, "hello world");
    }

    #[test]
    fn test_js_with_variables() {
        let state = JsExtState::new();
        let rt = JsRuntime::new(state);

        let result = rt
            .execute("result.toUpperCase()", None, None, Some("test"), None)
            .unwrap();

        assert_eq!(result, "TEST");
    }

    #[test]
    fn test_js_number_result() {
        let state = JsExtState::new();
        let rt = JsRuntime::new(state);

        let result = rt.execute("1 + 2", None, None, None, None).unwrap();

        assert_eq!(result, "3");
    }

    #[test]
    fn test_js_java_log() {
        let state = JsExtState::new();
        let rt = JsRuntime::new(state);

        let result = rt
            .execute("java.log('test message'); 'ok'", None, None, None, None)
            .unwrap();

        assert_eq!(result, "ok");
    }

    #[test]
    fn test_js_base64() {
        let state = JsExtState::new();
        let rt = JsRuntime::new(state);

        let result = rt
            .execute("java.base64Encode('hello')", None, None, None, None)
            .unwrap();

        assert_eq!(result, "aGVsbG8=");
    }

    #[test]
    fn test_js_ajax() {
        let state = JsExtState::new();
        let rt = JsRuntime::new(state);

        let result = rt.execute(
            "java.ajax('https://httpbin.org/get')",
            None,
            None,
            None,
            None,
        );

        match result {
            Ok(text) => {
                assert!(
                    text.contains("httpbin.org") || text.contains("{\"url\""),
                    "Expected httpbin response, got: {}",
                    text
                );
            }
            Err(e) => {
                println!("AJAX test skipped (network unavailable): {}", e);
            }
        }
    }
}
