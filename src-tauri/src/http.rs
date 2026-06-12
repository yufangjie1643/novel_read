//! Process-wide shared HTTP clients (async + blocking, with/without proxy).
//!
//! Background: `reqwest::Client` owns a connection pool, DNS cache, cookie jar
//! and TLS state. Rebuilding it on every request (as the legacy code did at
//! `commands.rs`, `analyze_url.rs`, `js_extensions.rs`, `source_loader.rs`)
//! discards all of that and forces a fresh DNS + TLS handshake every time.
//!
//! These singletons reuse one client per (sync/async, proxy/no-proxy) pair so
//! repeated requests to the same host stay on a kept-alive connection.

use std::sync::OnceLock;
use std::time::Duration;

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
                  (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const POOL_MAX_IDLE_PER_HOST: usize = 8;

static ASYNC_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
static ASYNC_CLIENT_NO_PROXY: OnceLock<reqwest::Client> = OnceLock::new();
static BLOCKING_CLIENT: OnceLock<reqwest::blocking::Client> = OnceLock::new();
static BLOCKING_CLIENT_NO_PROXY: OnceLock<reqwest::blocking::Client> = OnceLock::new();

fn build_async(no_proxy: bool) -> reqwest::Client {
    let mut builder = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .connect_timeout(CONNECT_TIMEOUT)
        .pool_max_idle_per_host(POOL_MAX_IDLE_PER_HOST)
        .gzip(true)
        .cookie_store(true)
        .user_agent(UA);
    if no_proxy {
        builder = builder.no_proxy();
    }
    builder
        .build()
        .expect("failed to build shared async reqwest::Client")
}

fn build_blocking(no_proxy: bool) -> reqwest::blocking::Client {
    let mut builder = reqwest::blocking::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .connect_timeout(CONNECT_TIMEOUT)
        .pool_max_idle_per_host(POOL_MAX_IDLE_PER_HOST)
        .gzip(true)
        .cookie_store(true)
        .user_agent(UA);
    if no_proxy {
        builder = builder.no_proxy();
    }
    builder
        .build()
        .expect("failed to build shared blocking reqwest::Client")
}

/// Shared async HTTP client honouring system proxy settings.
pub fn async_client() -> &'static reqwest::Client {
    ASYNC_CLIENT.get_or_init(|| build_async(false))
}

/// Shared async HTTP client that bypasses system proxy (fallback path).
pub fn async_client_no_proxy() -> &'static reqwest::Client {
    ASYNC_CLIENT_NO_PROXY.get_or_init(|| build_async(true))
}

/// Shared blocking HTTP client honouring system proxy settings.
pub fn blocking_client() -> &'static reqwest::blocking::Client {
    BLOCKING_CLIENT.get_or_init(|| build_blocking(false))
}

/// Shared blocking HTTP client that bypasses system proxy (fallback path).
pub fn blocking_client_no_proxy() -> &'static reqwest::blocking::Client {
    BLOCKING_CLIENT_NO_PROXY.get_or_init(|| build_blocking(true))
}
