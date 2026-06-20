//! Cookie sync via headless Edge + CDP.
//!
//! Used by the SourceEdit page so a user can sign in to a login-protected
//! book source without copy-pasting cookie strings. The flow:
//!
//!   1. Frontend calls `start_cookie_sync(login_url)` → this module spawns
//!      `msedge.exe --remote-debugging-port=<N> --user-data-dir=<tmp>` and
//!      navigates it to the login URL.
//!   2. User signs in inside the spawned Edge window.
//!   3. Frontend calls `read_cookies_via_edge(sync_id)` → this module dials
//!      the CDP HTTP endpoint, opens a single WebSocket frame, and runs
//!      `Network.getCookies`.
//!   4. Frontend displays the cookies; user saves the ones they want.
//!   5. Frontend calls `cancel_cookie_sync(sync_id)` → kill Edge and clean
//!      up the temp profile directory.
//!
//! Windows-only. The non-Windows `find_edge_path` returns `None`, so the
//! frontend gets a clear "Edge not available on this platform" error.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

const PORT_RANGE: std::ops::Range<u16> = 9222..9232;
const EDGE_START_TIMEOUT: Duration = Duration::from_secs(10);
const CDP_HTTP_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Serialize)]
pub struct SyncHandle {
    pub sync_id: String,
    pub port: u16,
    pub login_url: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CookieEntry {
    pub name: String,
    pub value: String,
    pub domain: String,
    pub path: String,
    pub expires: f64,
    pub http_only: bool,
    pub secure: bool,
}

#[derive(Debug, Deserialize)]
struct CdpTarget {
    #[serde(rename = "type")]
    target_type: String,
    #[serde(rename = "webSocketDebuggerUrl")]
    web_socket_debugger_url: String,
}

#[derive(Debug, Deserialize)]
struct CdpListResponse(Vec<CdpTarget>);

#[derive(Debug, Deserialize)]
struct CdpGetCookiesResult {
    cookies: Vec<RawCookie>,
}

#[derive(Debug, Deserialize)]
struct RawCookie {
    name: String,
    value: String,
    domain: String,
    path: String,
    #[serde(default)]
    expires: f64,
    #[serde(default, rename = "httpOnly")]
    http_only: bool,
    #[serde(default)]
    secure: bool,
}

#[derive(Debug, Deserialize)]
struct CdpResponse {
    /// CDP response id — only used while the raw `Value` is being matched
    /// in `read_cdp_response`; not read after this struct is materialized.
    #[allow(dead_code)]
    id: u64,
    #[serde(default)]
    result: Option<CdpGetCookiesResult>,
    #[serde(default)]
    error: Option<serde_json::Value>,
}

struct ActiveSync {
    child: Child,
    port: u16,
    #[allow(dead_code)]
    user_data_dir: PathBuf,
}

static ACTIVE_SYNCS: Lazy<Mutex<HashMap<String, ActiveSync>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

// ---------------------------------------------------------------------------
// Public API (called from commands.rs). All functions return
// Result<T, String> here; commands.rs wraps each into the standard
// ApiResponse<T> for IPC.
// ---------------------------------------------------------------------------

pub async fn start_cookie_sync(
    app_handle: AppHandle,
    #[allow(unused_variables)] source_url: String,
    login_url: String,
) -> Result<SyncHandle, String> {
    eprintln!("[cookie_sync] start: edge_path detection begin");
    let edge = match find_edge_path() {
        Some(p) => {
            eprintln!("[cookie_sync] edge found at {}", p.display());
            p
        }
        None => {
            eprintln!("[cookie_sync] edge NOT found on this system");
            return Err(
                "Edge not found on this system. Install Microsoft Edge or use a different source."
                    .into(),
            );
        }
    };

    let tmp_dir = std::env::temp_dir().join(format!("legado-edge-{}", uuid::Uuid::new_v4()));
    let user_data_dir = tmp_dir.clone();
    if let Err(e) = std::fs::create_dir_all(&user_data_dir) {
        return Err(format!("Failed to create temp profile dir: {e}"));
    }
    eprintln!("[cookie_sync] user_data_dir={}", user_data_dir.display());

    let mut chosen_port: Option<u16> = None;
    for port in PORT_RANGE {
        if !port_listening(port).await {
            chosen_port = Some(port);
            break;
        }
    }
    let port = match chosen_port {
        Some(p) => p,
        None => {
            return Err(format!(
                "No free debug port in {}-{}; close other debug sessions.",
                PORT_RANGE.start, PORT_RANGE.end - 1
            ));
        }
    };
    eprintln!("[cookie_sync] picked port={port}");

    let mut cmd = Command::new(&edge);
    cmd.arg(format!("--remote-debugging-port={port}"))
        .arg(format!("--user-data-dir={}", user_data_dir.display()))
        .arg("--no-first-run")
        .arg("--no-default-browser-check")
        .arg(&login_url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x00000200);
    }

    let child = match cmd.spawn() {
        Ok(c) => {
            eprintln!("[cookie_sync] edge spawned, pid={}", c.id());
            c
        }
        Err(e) => {
            eprintln!("[cookie_sync] edge spawn FAILED: {e}");
            return Err(format!(
                "Failed to start Edge at {}: {e}",
                edge.display()
            ));
        }
    };

    let sync_id = uuid::Uuid::new_v4().to_string();

    eprintln!("[cookie_sync] waiting for port {port} (timeout {EDGE_START_TIMEOUT:?})");
    let started = wait_for_port(port, EDGE_START_TIMEOUT).await;
    if !started {
        eprintln!("[cookie_sync] port {port} did NOT come up in time");
        let mut child = child;
        let _ = child.kill();
        let _ = std::fs::remove_dir_all(&user_data_dir);
        return Err(format!(
            "Edge started but did not open debug port {port} in {EDGE_START_TIMEOUT:?}."
        ));
    }
    eprintln!("[cookie_sync] port {port} is up, sync_id={sync_id}");

    ACTIVE_SYNCS.lock().unwrap().insert(
        sync_id.clone(),
        ActiveSync {
            child,
            port,
            user_data_dir,
        },
    );

    let _ = app_handle.emit(
        "cookie_sync_status",
        serde_json::json!({"sync_id": sync_id, "status": "started", "port": port}),
    );

    Ok(SyncHandle {
        sync_id,
        port,
        login_url,
    })
}

pub async fn read_cookies_via_edge(
    app_handle: AppHandle,
    sync_id: String,
) -> Result<Vec<CookieEntry>, String> {
    let port = {
        let map = ACTIVE_SYNCS.lock().unwrap();
        match map.get(&sync_id) {
            Some(s) => s.port,
            None => return Err("Sync session not found; was it cancelled?".into()),
        }
    };

    eprintln!("[cookie_sync] read_cookies_via_edge sync_id={sync_id} port={port}");
    let _ = app_handle.emit(
        "cookie_sync_status",
        serde_json::json!({"sync_id": sync_id, "status": "reading"}),
    );

    match fetch_cookies_via_cdp(port).await {
        Ok(cookies) => {
            eprintln!("[cookie_sync] cdp fetch OK: {} cookies", cookies.len());
            let _ = app_handle.emit(
                "cookie_sync_status",
                serde_json::json!({
                    "sync_id": sync_id,
                    "status": "captured",
                    "count": cookies.len(),
                }),
            );
            Ok(cookies)
        }
        Err(e) => {
            eprintln!("[cookie_sync] cdp fetch FAILED: {e}");
            let _ = app_handle.emit(
                "cookie_sync_status",
                serde_json::json!({"sync_id": sync_id, "status": "failed", "message": e.to_string()}),
            );
            Err(e)
        }
    }
}

pub fn cancel_cookie_sync(sync_id: &str) -> Result<(), String> {
    let mut map = ACTIVE_SYNCS.lock().unwrap();
    if let Some(mut sync) = map.remove(sync_id) {
        let _ = sync.child.kill();
        let _ = sync.child.wait();
        let _ = std::fs::remove_dir_all(&sync.user_data_dir);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Edge path discovery (Windows)
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
pub fn find_edge_path() -> Option<PathBuf> {
    // Try common install locations first — fastest and avoids registry.
    let candidates = [
        std::env::var("ProgramFiles(x86)").ok().map(|p| {
            PathBuf::from(p).join("Microsoft\\Edge\\Application\\msedge.exe")
        }),
        std::env::var("ProgramFiles").ok().map(|p| {
            PathBuf::from(p).join("Microsoft\\Edge\\Application\\msedge.exe")
        }),
        std::env::var("LocalAppData").ok().map(|p| {
            PathBuf::from(p).join("Microsoft\\Edge\\Application\\msedge.exe")
        }),
    ];
    for c in candidates.into_iter().flatten() {
        if c.exists() {
            return Some(c);
        }
    }

    // Registry fallback. We try HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe
    // without pulling in the winreg crate (which would be a 3rd-party dep) by
    // shelling out to `reg query`.
    let output = Command::new("reg")
        .args([
            "query",
            r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe",
            "/ve",
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        if let Some(rest) = line.split_whitespace().nth(2) {
            // REG_SZ value data lives in the last column after the type token.
            let path = rest.trim();
            if path.ends_with("msedge.exe") && PathBuf::from(path).exists() {
                return Some(PathBuf::from(path));
            }
        }
    }
    None
}

#[cfg(not(target_os = "windows"))]
pub fn find_edge_path() -> Option<PathBuf> {
    None
}

// ---------------------------------------------------------------------------
// CDP client (one-shot, no event subscription)
// ---------------------------------------------------------------------------

async fn port_listening(port: u16) -> bool {
    tokio::net::TcpStream::connect(("127.0.0.1", port))
        .await
        .map(|_| true)
        .unwrap_or(false)
}

async fn wait_for_port(port: u16, timeout: Duration) -> bool {
    let start = std::time::Instant::now();
    while start.elapsed() < timeout {
        if port_listening(port).await {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    false
}

async fn fetch_cookies_via_cdp(port: u16) -> Result<Vec<CookieEntry>, String> {
    eprintln!("[cookie_sync] cdp: step 1 — GET /json/list on port {port}");
    let target = pick_page_target(port).await?;
    eprintln!("[cookie_sync] cdp: picked target ws url: {target}");

    let ws_url = target
        .strip_prefix("ws://")
        .ok_or_else(|| "Unexpected WS URL scheme".to_string())?;
    let (authority, path) = ws_url
        .split_once('/')
        .ok_or_else(|| "Malformed WS URL".to_string())?;
    eprintln!("[cookie_sync] cdp: authority={authority} path={path}");
    let host_port: Vec<&str> = authority.split(':').collect();
    let host = host_port.first().copied().unwrap_or("127.0.0.1");
    let port: u16 = host_port
        .get(1)
        .and_then(|p| p.parse().ok())
        .ok_or_else(|| "Missing WS port".to_string())?;

    eprintln!("[cookie_sync] cdp: step 2 — TCP connect {host}:{port}");
    let mut stream = TcpStream::connect((host, port))
        .await
        .map_err(|e| format!("Connect failed: {e}"))?;

    let mut nonce = [0u8; 16];
    rand_bytes(&mut nonce);

    let handshake = format!(
        "GET /{} HTTP/1.1\r\n\
         Host: {host}:{port}\r\n\
         Upgrade: websocket\r\n\
         Connection: Upgrade\r\n\
         Sec-WebSocket-Key: {}\r\n\
         Sec-WebSocket-Version: 13\r\n\
         \r\n",
        path,
        base64_encode(&nonce)
    );
    eprintln!("[cookie_sync] cdp: step 3 — write WS handshake");
    stream
        .write_all(handshake.as_bytes())
        .await
        .map_err(|e| format!("WS handshake write: {e}"))?;

    let mut buf = Vec::with_capacity(2048);
    let mut chunk = [0u8; 1024];
    loop {
        let n = stream
            .read(&mut chunk)
            .await
            .map_err(|e| format!("WS handshake read: {e}"))?;
        if n == 0 {
            return Err("WS handshake closed early".into());
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(idx) = find_header_end(&buf) {
            let head = std::str::from_utf8(&buf[..idx]).map_err(|e| format!("Headers UTF-8: {e}"))?;
            eprintln!("[cookie_sync] cdp: WS handshake status: {}",
                head.lines().next().unwrap_or(""));
            // Edge / Chrome use a non-standard reason phrase
            // "WebSocket Protocol Handshake" while RFC 6455 §1.2 specifies
            // "Switching Protocols". Both are valid 101 responses — accept by
            // status code alone.
            if !head.contains("101") {
                return Err(format!("WS handshake failed: {}", head.lines().next().unwrap_or("")));
            }
            buf.drain(..idx + 4);
            break;
        }
    }

    eprintln!("[cookie_sync] cdp: step 4 — write Network.getCookies frame");
    let req = serde_json::json!({
        "id": 1,
        "method": "Network.getCookies"
    })
    .to_string();
    let req_bytes = req.as_bytes();
    let frame = ws_frame(true, 0x1, req_bytes);
    stream
        .write_all(&frame)
        .await
        .map_err(|e| format!("WS write: {e}"))?;

    eprintln!("[cookie_sync] cdp: step 5 — read response");
    let response = read_cdp_response(&mut stream).await?;
    eprintln!("[cookie_sync] cdp: response received, parsing…");

    let parsed: CdpResponse =
        serde_json::from_value(response).map_err(|e| format!("JSON parse: {e}"))?;
    if let Some(err) = parsed.error {
        return Err(format!("CDP error: {err}"));
    }
    let cookies = parsed
        .result
        .map(|r| r.cookies)
        .unwrap_or_default()
        .into_iter()
        .map(|c| CookieEntry {
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path,
            expires: c.expires,
            http_only: c.http_only,
            secure: c.secure,
        })
        .collect();
    Ok(cookies)
}

async fn pick_page_target(port: u16) -> Result<String, String> {
    let url = format!("http://127.0.0.1:{port}/json/list");
    eprintln!("[cookie_sync] GET {url}");
    let body = reqwest_get(&url).await?;
    eprintln!("[cookie_sync] /json/list body (first 200 chars): {}",
        &body.chars().take(200).collect::<String>());
    let parsed: CdpListResponse =
        serde_json::from_str(&body).map_err(|e| format!("JSON parse /json/list: {e}"))?;
    eprintln!("[cookie_sync] /json/list parsed {} targets", parsed.0.len());
    parsed
        .0
        .into_iter()
        .find(|t| t.target_type == "page")
        .map(|t| t.web_socket_debugger_url)
        .ok_or_else(|| "No page target found in Edge; was the login page opened?".to_string())
}

async fn reqwest_get(url: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(CDP_HTTP_TIMEOUT)
        .build()
        .map_err(|e| format!("HTTP client: {e}"))?;
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("GET {url}: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("GET {url} returned {}", resp.status()));
    }
    resp.text().await.map_err(|e| format!("Read body: {e}"))
}

async fn read_cdp_response(stream: &mut TcpStream) -> Result<serde_json::Value, String> {
    let mut buf: Vec<u8> = Vec::with_capacity(8192);
    let mut chunk = [0u8; 4096];
    let read_deadline = std::time::Instant::now() + Duration::from_secs(15);
    loop {
        let remaining = read_deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            return Err("WS read timed out after 15s".into());
        }
        let read_fut = stream.read(&mut chunk);
        let n = match tokio::time::timeout(remaining, read_fut).await {
            Ok(Ok(n)) => n,
            Ok(Err(e)) => return Err(format!("WS read: {e}")),
            Err(_) => return Err("WS read timed out after 15s".into()),
        };
        if n == 0 {
            return Err("WS closed without response".into());
        }
        buf.extend_from_slice(&chunk[..n]);

        // Try to parse any complete frames from the buffer.
        loop {
            match ws_try_parse_frame(&buf) {
                Some(Ok((opcode, payload, consumed))) => {
                    eprintln!("[cookie_sync] cdp: rx frame opcode=0x{opcode:x} bytes={}", payload.len());
                    buf.drain(..consumed);
                    match opcode {
                        0x1 => {
                            // text frame
                            let text = std::str::from_utf8(&payload)
                                .map_err(|e| format!("WS payload UTF-8: {e}"))?;
                            let v: serde_json::Value = serde_json::from_str(text)
                                .map_err(|e| format!("WS payload JSON: {e}"))?;
                            eprintln!("[cookie_sync] cdp: rx id={} method={}",
                                v.get("id").map(|x| x.to_string()).unwrap_or_default(),
                                v.get("method").map(|x| x.to_string()).unwrap_or_default());
                            if v.get("id").and_then(|x| x.as_u64()) == Some(1) {
                                return Ok(v);
                            }
                            // else: not our response — keep reading frames.
                        }
                        0x8 => return Err("WS close frame received".into()),
                        // 0x0 continuation, 0x9 ping, 0xA pong — skip.
                        _ => {}
                    }
                }
                Some(Err(e)) => return Err(e),
                None => break, // need more bytes
            }
        }
    }
}

// ---------------------------------------------------------------------------
// RFC 6455 helpers — minimal WS frame codec
// ---------------------------------------------------------------------------

fn base64_encode(input: &[u8]) -> String {
    // Use a minimal RFC 4648 encoder to avoid pulling in the `base64` crate
    // (the project already has base64 = "0.22" but we don't need its features).
    const ALPHA: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((input.len() + 2) / 3 * 4);
    let chunks = input.chunks(3);
    for chunk in chunks {
        let b0 = chunk[0];
        let b1 = chunk.get(1).copied().unwrap_or(0);
        let b2 = chunk.get(2).copied().unwrap_or(0);
        let triple = ((b0 as u32) << 16) | ((b1 as u32) << 8) | (b2 as u32);
        out.push(ALPHA[((triple >> 18) & 0x3F) as usize] as char);
        out.push(ALPHA[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            out.push(ALPHA[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(ALPHA[(triple & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

fn rand_bytes(out: &mut [u8]) {
    // rand_core is already a project dep (used by uuid). The `v4` feature
    // exposes fill().
    use rand_core::RngCore;
    rand_core::OsRng.fill_bytes(out);
}

fn ws_frame(fin: bool, opcode: u8, payload: &[u8]) -> Vec<u8> {
    let fin_bit = if fin { 0x80 } else { 0x00 };
    let opcode_byte = fin_bit | (opcode & 0x0F);
    let len = payload.len();
    let mut out = Vec::with_capacity(2 + 8 + 4 + len);
    out.push(opcode_byte);
    // Client → server frames MUST be masked (RFC 6455 §5.3).
    if len < 126 {
        out.push(0x80 | len as u8);
    } else if len < 65536 {
        out.push(0x80 | 126);
        out.extend_from_slice(&(len as u16).to_be_bytes());
    } else {
        out.push(0x80 | 127);
        out.extend_from_slice(&(len as u64).to_be_bytes());
    }
    let mut mask = [0u8; 4];
    rand_bytes(&mut mask);
    out.extend_from_slice(&mask);
    for (i, b) in payload.iter().enumerate() {
        out.push(b ^ mask[i & 3]);
    }
    out
}

fn ws_try_parse_frame(buf: &[u8]) -> Option<Result<(u8, Vec<u8>, usize), String>> {
    // Returns Some(Ok((opcode, payload, total_consumed))) if a complete frame
    // is in buf. Returns None if buf doesn't have enough bytes yet.
    // Returns Some(Err(...)) on malformed input.
    if buf.len() < 2 {
        return None;
    }
    let b0 = buf[0];
    let opcode = b0 & 0x0F;
    let b1 = buf[1];
    let masked = (b1 & 0x80) != 0;
    let len7 = (b1 & 0x7F) as usize;
    let mut idx = 2usize;
    let payload_len = match len7 {
        0..=125 => len7,
        126 => {
            if buf.len() < idx + 2 {
                return None;
            }
            let v = u16::from_be_bytes([buf[idx], buf[idx + 1]]) as usize;
            idx += 2;
            v
        }
        127 => {
            if buf.len() < idx + 8 {
                return None;
            }
            let mut v = [0u8; 8];
            v.copy_from_slice(&buf[idx..idx + 8]);
            idx += 8;
            u64::from_be_bytes(v) as usize
        }
        _ => return Some(Err("Invalid WS length".into())),
    };
    let mask_key = if masked {
        if buf.len() < idx + 4 {
            return None;
        }
        let mk = [buf[idx], buf[idx + 1], buf[idx + 2], buf[idx + 3]];
        idx += 4;
        Some(mk)
    } else {
        // Server→client frames are not masked (RFC 6455 §5.1). client→server
        // frames are masked.
        None
    };
    if buf.len() < idx + payload_len {
        return None;
    }
    let raw = &buf[idx..idx + payload_len];
    let mut payload = vec![0u8; payload_len];
    if let Some(mk) = mask_key {
        for (i, b) in raw.iter().enumerate() {
            payload[i] = b ^ mk[i & 3];
        }
    } else {
        payload.copy_from_slice(raw);
    }
    Some(Ok((opcode, payload, idx + payload_len)))
}

fn find_header_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n")
}