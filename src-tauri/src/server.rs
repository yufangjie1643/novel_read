//! Simple built-in HTTP server for sharing bookshelf over local network.
//!
//! Routes (all require Basic Auth except where noted):
//!
//! | Method | Path                       | Handler                        |
//! |--------|----------------------------|--------------------------------|
//! | GET    | `/api/status`              | Health check                   |
//! | GET    | `/api/books`               | Bookshelf + chapters           |
//! | GET    | `/api/bookshelf`           | Bookshelf (legacy alias)       |
//! | GET    | `/api/bookSources`         | List book sources              |
//! | GET    | `/api/bookSources/{url}`   | Get one book source            |
//! | POST   | `/api/bookSources`         | Insert book source(s)          |
//! | DELETE | `/api/bookSources`         | Delete book source(s) by URL   |
//! | GET    | `/api/replaceRules`        | List replace rules             |
//! | POST   | `/api/replaceRules`        | Insert replace rule(s)         |
//! | DELETE | `/api/replaceRules`        | Delete replace rule by id      |
//! | GET    | `/api/rssSources`          | List RSS sources               |
//! | POST   | `/api/rssSources`          | Insert RSS source(s)           |
//! | DELETE | `/api/rssSources`          | Delete RSS source(s) by URL    |
//! | GET    | `/api/book/chapter`        | Chapter list (param `?url=`)   |
//! | GET    | `/api/book/content`        | Chapter content (`?url=&index=`) |
//! | POST   | `/api/book/progress`       | Save reading progress          |
//!
//! `start_server` requires Basic Auth credentials to already be configured
//! via `set_http_server_credentials`; otherwise it returns
//! "请先在设置页配置 HTTP 服务凭证".

use argon2::password_hash::PasswordVerifier;
use base64::Engine;
use deadpool::managed::Object;
use rusqlite::Connection;
use serde_json::json;
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

use crate::db::{
    AppPool,
    models::HttpServerAuth,
};

static SERVER_RUNNING: AtomicBool = AtomicBool::new(false);
static SERVER_ADDR: Mutex<Option<String>> = Mutex::new(None);

/// Get the local LAN IP address (best-effort).
/// Uses a UDP socket trick to determine the primary outgoing interface.
fn get_local_ip() -> Option<String> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    socket.local_addr().ok().map(|a| a.ip().to_string())
}

/// Start the built-in web server on the given port.
/// If the requested port is in use, automatically tries the next 9 ports.
///
/// Refuses to start if no Basic Auth credential row exists in the
/// `http_server_auth` table — the user must configure credentials via the
/// Settings page first.
pub fn start_server(pool: AppPool, port: u16, creds: HttpServerAuth) -> Result<String, String> {
    if SERVER_RUNNING.load(Ordering::SeqCst) {
        if let Ok(addr) = SERVER_ADDR.lock() {
            if let Some(a) = addr.as_ref() {
                return Ok(a.clone());
            }
        }
    }

    let creds = Arc::new(creds);

    let host = get_local_ip().unwrap_or_else(|| "127.0.0.1".to_string());

    for try_port in port..=port.saturating_add(9) {
        let bind_addr = format!("0.0.0.0:{}", try_port);
        let server = match Server::http(&bind_addr) {
            Ok(s) => Arc::new(s),
            Err(_) => continue,
        };

        SERVER_RUNNING.store(true, Ordering::SeqCst);
        let server_clone = server.clone();
        let result_url = format!("http://{}:{}", host, try_port);

        if let Ok(mut guard) = SERVER_ADDR.lock() {
            *guard = Some(result_url.clone());
        }

        let pool_for_thread = pool.clone();
        let creds_for_thread = creds.clone();
        thread::spawn(move || {
            let rt = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(rt) => rt,
                Err(e) => {
                    eprintln!("[WebServer] failed to build runtime: {}", e);
                    return;
                }
            };
            println!("[WebServer] Listening on http://{}", bind_addr);
            for request in server_clone.incoming_requests() {
                if !SERVER_RUNNING.load(Ordering::SeqCst) {
                    let _ = request.respond(Response::from_string("Server shutting down"));
                    break;
                }
                let pool_for_request = pool_for_thread.clone();
                let creds_for_request = creds_for_thread.clone();
                let url = request.url().to_string();
                let method = request.method().clone();
                let outcome = rt.block_on(async move {
                    dispatch_request(
                        &pool_for_request,
                        &creds_for_request,
                        method,
                        url,
                        request,
                    )
                    .await
                });
                match outcome {
                    Ok((req, response)) => {
                        let _ = req.respond(response);
                    }
                    Err(e) => eprintln!("[WebServer] handler error: {e}"),
                }
            }
            // Thread ends, server_clone dropped, port released.
            SERVER_RUNNING.store(false, Ordering::SeqCst);
            if let Ok(mut guard) = SERVER_ADDR.lock() {
                *guard = None;
            }
            println!("[WebServer] Stopped");
        });

        return Ok(result_url);
    }

    Err("Failed to start server: all ports in range are in use".to_string())
}

/// Stop the web server by signalling the thread to exit and waking up the
/// blocking `incoming_requests()` iterator with a dummy request.
pub fn stop_server() {
    if !SERVER_RUNNING.load(Ordering::SeqCst) {
        return;
    }
    SERVER_RUNNING.store(false, Ordering::SeqCst);

    if let Ok(addr_guard) = SERVER_ADDR.lock() {
        if let Some(addr) = addr_guard.as_ref() {
            if let Some(port_str) = addr.rsplit(':').next() {
                if let Ok(port) = port_str.parse::<u16>() {
                    let _ = std::net::TcpStream::connect(("127.0.0.1", port))
                        .and_then(|mut stream| {
                            stream.write_all(
                                b"GET /api/status HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
                            )
                        });
                }
            }
        }
    }
}

pub fn is_server_running() -> bool {
    SERVER_RUNNING.load(Ordering::SeqCst)
}

// ============================================================================
// Bootstrap helpers
// ============================================================================

fn header_value<'a>(req: &'a Request, name: &str) -> Option<&'a str> {
    // tiny_http's Header::equiv takes &str; convert to owned Box<str> so
    // the closure for `find` can capture it. The borrow checker is happy
    // because the closure outlives only the find() call.
    let needle: Box<str> = Box::from(name.to_ascii_lowercase().into_boxed_str());
    let needle_ref: &'static str = Box::leak(needle);
    req.headers()
        .iter()
        .find(|h| h.field.equiv(needle_ref))
        .map(|h| h.value.as_str())
}

fn check_basic_auth(req: &Request, creds: &HttpServerAuth) -> bool {
    let Some(header) = header_value(req, "Authorization") else {
        return false;
    };
    let Some(encoded) = header.strip_prefix("Basic ") else {
        return false;
    };
    let Ok(decoded) = base64::engine::general_purpose::STANDARD.decode(encoded.trim()) else {
        return false;
    };
    let Ok(pair) = std::str::from_utf8(&decoded) else {
        return false;
    };
    let Some((user, pass)) = pair.split_once(':') else {
        return false;
    };
    if user != creds.username {
        return false;
    }
    let Ok(parsed) = argon2::password_hash::PasswordHash::new(&creds.password_hash) else {
        return false;
    };
    argon2::Argon2::default()
        .verify_password(pass.as_bytes(), &parsed)
        .is_ok()
}

fn unauthorized_response() -> Response<std::io::Cursor<Vec<u8>>> {
    Response::from_string("Unauthorized")
        .with_status_code(StatusCode(401))
        .with_header(
            Header::from_bytes(
                &b"WWW-Authenticate"[..],
                &b"Basic realm=\"novel_read\""[..],
            )
            .unwrap(),
        )
        .with_header(
            Header::from_bytes(&b"Content-Type"[..], &b"text/plain; charset=utf-8"[..]).unwrap(),
        )
}

fn json_response(status: u16, body: String) -> Response<std::io::Cursor<Vec<u8>>> {
    Response::from_string(body)
        .with_status_code(StatusCode(status))
        .with_header(
            Header::from_bytes(
                &b"Content-Type"[..],
                &b"application/json; charset=utf-8"[..],
            )
            .unwrap(),
        )
}

fn text_response(status: u16, body: String) -> Response<std::io::Cursor<Vec<u8>>> {
    Response::from_string(body)
        .with_status_code(StatusCode(status))
        .with_header(
            Header::from_bytes(
                &b"Content-Type"[..],
                &b"text/plain; charset=utf-8"[..],
            )
            .unwrap(),
        )
}

fn not_found_response() -> Response<std::io::Cursor<Vec<u8>>> {
    text_response(404, "Not Found".to_string())
}

fn bad_request(msg: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    text_response(400, msg.to_string())
}

// ============================================================================
// Router
// ============================================================================

async fn dispatch_request(
    pool: &AppPool,
    creds: &HttpServerAuth,
    method: Method,
    url: String,
    mut req: Request,
) -> Result<(Request, Response<std::io::Cursor<Vec<u8>>>), String> {
    // Pre-check auth before consuming the body. tiny_http's Request is
    // moved into this function; we keep ownership throughout.
    if !check_basic_auth(&req, creds) {
        return Ok((req, unauthorized_response()));
    }

    let (path, query) = match url.split_once('?') {
        Some((p, q)) => (p, q.to_string()),
        None => (url.as_str(), String::new()),
    };
    let method_str = method.as_str().to_string();
    let needs_body = matches!(
        (method_str.as_str(), path),
        ("POST", "/api/bookSources")
            | ("DELETE", "/api/bookSources")
            | ("POST", "/api/replaceRules")
            | ("POST", "/api/rssSources")
            | ("DELETE", "/api/rssSources")
            | ("POST", "/api/book/progress")
    );
    let body = if needs_body {
        let mut s = String::new();
        let _ = std::io::Read::read_to_string(req.as_reader(), &mut s);
        s
    } else {
        String::new()
    };

    let response = route(pool, &method_str, path, &query, &body).await;
    Ok((req, response))
}

async fn route(
    pool: &AppPool,
    method: &str,
    path: &str,
    query: &str,
    body: &str,
) -> Response<std::io::Cursor<Vec<u8>>> {
    if method == "GET" && path == "/api/status" {
        return json_response(200, json!({ "status": "ok", "running": true }).to_string());
    }
    if method == "GET" && path == "/api/books" {
        return match books_json(pool).await {
            Ok(s) => json_response(200, s),
            Err(e) => json_response(500, json!({ "error": e }).to_string()),
        };
    }
    if method == "GET" && path == "/api/bookshelf" {
        return match books_json(pool).await {
            Ok(s) => json_response(200, s),
            Err(e) => json_response(500, json!({ "error": e }).to_string()),
        };
    }
    if method == "GET" && path == "/api/bookSources" {
        return match list_book_sources_json(pool).await {
            Ok(s) => json_response(200, s),
            Err(e) => json_response(500, json!({ "error": e }).to_string()),
        };
    }
    if method == "POST" && path == "/api/bookSources" {
        return match save_book_sources_json(pool, body).await {
            Ok(s) => json_response(200, s),
            Err(e) => bad_request(&e),
        };
    }
    if method == "DELETE" && path == "/api/bookSources" {
        return match delete_book_sources_json(pool, body).await {
            Ok(s) => json_response(200, s),
            Err(e) => bad_request(&e),
        };
    }
    if method == "GET" && path.starts_with("/api/bookSources/") {
        let encoded = &path["/api/bookSources/".len()..];
        return match get_book_source_json(pool, encoded).await {
            Ok(Some(s)) => json_response(200, s),
            Ok(None) => text_response(404, "Not Found".to_string()),
            Err(e) => json_response(500, json!({ "error": e }).to_string()),
        };
    }
    if method == "GET" && path == "/api/replaceRules" {
        return match list_replace_rules_json(pool).await {
            Ok(s) => json_response(200, s),
            Err(e) => json_response(500, json!({ "error": e }).to_string()),
        };
    }
    if method == "POST" && path == "/api/replaceRules" {
        return match save_replace_rule_json(pool, body).await {
            Ok(s) => json_response(200, s),
            Err(e) => bad_request(&e),
        };
    }
    if method == "DELETE" && path == "/api/replaceRules" {
        return match delete_replace_rule_json(pool, query).await {
            Ok(s) => json_response(200, s),
            Err(e) => bad_request(&e),
        };
    }
    if method == "GET" && path == "/api/rssSources" {
        return match list_rss_sources_json(pool).await {
            Ok(s) => json_response(200, s),
            Err(e) => json_response(500, json!({ "error": e }).to_string()),
        };
    }
    if method == "POST" && path == "/api/rssSources" {
        return match save_rss_sources_json(pool, body).await {
            Ok(s) => json_response(200, s),
            Err(e) => bad_request(&e),
        };
    }
    if method == "DELETE" && path == "/api/rssSources" {
        return match delete_rss_sources_json(pool, body).await {
            Ok(s) => json_response(200, s),
            Err(e) => bad_request(&e),
        };
    }
    if method == "GET" && path == "/api/book/chapter" {
        return match chapter_list_json(pool, query).await {
            Ok(s) => json_response(200, s),
            Err(e) => bad_request(&e),
        };
    }
    if method == "GET" && path == "/api/book/content" {
        return match chapter_content_json(pool, query).await {
            Ok(s) => json_response(200, s),
            Err(e) => bad_request(&e),
        };
    }
    if method == "POST" && path == "/api/book/progress" {
        return match save_progress_json(pool, body).await {
            Ok(s) => json_response(200, s),
            Err(e) => bad_request(&e),
        };
    }
    not_found_response()
}

// ============================================================================
// Body helpers
// ============================================================================

fn parse_query(q: &str) -> std::collections::HashMap<String, String> {
    q.split('&')
        .filter_map(|kv| kv.split_once('='))
        .map(|(k, v)| {
            (
                url_decode(k),
                url_decode(v),
            )
        })
        .collect()
}

fn url_decode(s: &str) -> String {
    // Minimal percent-decoding for query strings.
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'+' {
            out.push(b' ');
            i += 1;
        } else if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(
                std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("00"),
                16,
            ) {
                out.push(b);
            }
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8_lossy(&out).to_string()
}

// ============================================================================
// Route handlers — each calls the corresponding controllers module.
// ============================================================================

async fn books_json(pool: &AppPool) -> Result<String, String> {
    with_conn(pool, |conn| {
        let books = crate::controllers::book::list_all(conn).map_err(err_to_string)?;
        let mut result = Vec::with_capacity(books.len());
        for book in &books {
            let chapters = crate::db::dao::BookChapterDao::new(conn)
                .get_chapters(&book.book_url)
                .unwrap_or_default()
                .into_iter()
                .map(|c| {
                    json!({
                        "index": c.index,
                        "title": c.title,
                    })
                })
                .collect::<Vec<_>>();
            result.push(json!({
                "book_url": book.book_url,
                "name": book.name,
                "author": book.author,
                "cover_url": book.cover_url,
                "intro": book.intro,
                "dur_chapter_title": book.dur_chapter_title,
                "dur_chapter_index": book.dur_chapter_index,
                "total_chapter_num": book.total_chapter_num,
                "chapters": chapters,
            }));
        }
        serde_json::to_string_pretty(&result).map_err(err_to_string)
    })
    .await
}

async fn list_book_sources_json(pool: &AppPool) -> Result<String, String> {
    with_conn(pool, |conn| {
        let list = crate::controllers::book_source::list_all(conn).map_err(err_to_string)?;
        serde_json::to_string(&list).map_err(err_to_string)
    })
    .await
}

async fn get_book_source_json(pool: &AppPool, encoded_url: &str) -> Result<Option<String>, String> {
    let decoded = match url_decode(encoded_url).parse::<url::Url>() {
        Ok(u) => u.to_string(),
        Err(_) => url_decode(encoded_url),
    };
    with_conn(pool, move |conn| {
        crate::controllers::book_source::get(conn, &decoded)
            .map(|opt| opt.and_then(|s| serde_json::to_string(&s).ok()))
            .map_err(err_to_string)
    })
    .await
}

async fn save_book_sources_json(pool: &AppPool, body: &str) -> Result<String, String> {
    if body.trim().is_empty() {
        return Err("请求体不能为空".to_string());
    }
    let sources: Vec<crate::db::models::BookSource> = serde_json::from_str(body)
        .map_err(|e| format!("JSON 解析失败: {e}"))?;
    with_conn(pool, move |conn| {
        let n = crate::controllers::book_source::insert_many(conn, &sources).map_err(err_to_string)?;
        Ok(n.to_string())
    })
    .await
}

async fn delete_book_sources_json(pool: &AppPool, body: &str) -> Result<String, String> {
    if body.trim().is_empty() {
        return Err("请求体不能为空".to_string());
    }
    let sources: Vec<crate::db::models::BookSource> = serde_json::from_str(body)
        .map_err(|e| format!("JSON 解析失败: {e}"))?;
    with_conn(pool, move |conn| {
        for s in &sources {
            crate::controllers::book_source::delete(conn, &s.book_source_url)
                .map_err(err_to_string)?;
        }
        Ok("ok".to_string())
    })
    .await
}

async fn list_replace_rules_json(pool: &AppPool) -> Result<String, String> {
    with_conn(pool, |conn| {
        let list = crate::controllers::replace_rule::list_all(conn).map_err(err_to_string)?;
        serde_json::to_string(&list).map_err(err_to_string)
    })
    .await
}

async fn save_replace_rule_json(pool: &AppPool, body: &str) -> Result<String, String> {
    if body.trim().is_empty() {
        return Err("请求体不能为空".to_string());
    }
    let rules: Vec<crate::db::models::ReplaceRule> = serde_json::from_str(body)
        .map_err(|e| format!("JSON 解析失败: {e}"))?;
    with_conn(pool, move |conn| {
        let n = crate::controllers::replace_rule::insert_many(conn, &rules).map_err(err_to_string)?;
        Ok(n.to_string())
    })
    .await
}

async fn delete_replace_rule_json(pool: &AppPool, query: &str) -> Result<String, String> {
    let params = parse_query(query);
    let id: i64 = params
        .get("id")
        .and_then(|v| v.parse().ok())
        .ok_or_else(|| "缺少参数 id".to_string())?;
    with_conn(pool, move |conn| {
        crate::controllers::replace_rule::delete(conn, id).map_err(err_to_string)?;
        Ok("ok".to_string())
    })
    .await
}

async fn list_rss_sources_json(pool: &AppPool) -> Result<String, String> {
    with_conn(pool, |conn| {
        let list = crate::controllers::rss_source::list_all(conn).map_err(err_to_string)?;
        serde_json::to_string(&list).map_err(err_to_string)
    })
    .await
}

async fn save_rss_sources_json(pool: &AppPool, body: &str) -> Result<String, String> {
    if body.trim().is_empty() {
        return Err("请求体不能为空".to_string());
    }
    let sources: Vec<crate::db::models::RssSource> = serde_json::from_str(body)
        .map_err(|e| format!("JSON 解析失败: {e}"))?;
    with_conn(pool, move |conn| {
        let n = crate::controllers::rss_source::insert_many(conn, &sources).map_err(err_to_string)?;
        Ok(n.to_string())
    })
    .await
}

async fn delete_rss_sources_json(pool: &AppPool, body: &str) -> Result<String, String> {
    if body.trim().is_empty() {
        return Err("请求体不能为空".to_string());
    }
    let sources: Vec<crate::db::models::RssSource> = serde_json::from_str(body)
        .map_err(|e| format!("JSON 解析失败: {e}"))?;
    with_conn(pool, move |conn| {
        for s in &sources {
            crate::controllers::rss_source::delete(conn, &s.source_url).map_err(err_to_string)?;
        }
        Ok("ok".to_string())
    })
    .await
}

async fn chapter_list_json(pool: &AppPool, query: &str) -> Result<String, String> {
    let params = parse_query(query);
    let url = params
        .get("url")
        .ok_or_else(|| "缺少参数 url".to_string())?
        .clone();
    with_conn(pool, move |conn| {
        let chapters = crate::db::dao::BookChapterDao::new(conn)
            .get_chapters(&url)
            .map_err(err_to_string)?;
        serde_json::to_string(&chapters).map_err(err_to_string)
    })
    .await
}

async fn chapter_content_json(pool: &AppPool, query: &str) -> Result<String, String> {
    let params = parse_query(query);
    let url = params
        .get("url")
        .ok_or_else(|| "缺少参数 url".to_string())?
        .clone();
    let index: i32 = params
        .get("index")
        .and_then(|v| v.parse().ok())
        .ok_or_else(|| "缺少参数 index".to_string())?;
    with_conn(pool, move |conn| {
        let chapter = crate::db::dao::BookChapterDao::new(conn)
            .get_chapter(&url, index)
            .map_err(err_to_string)?
            .ok_or_else(|| "未找到章节".to_string())?;
        let content = crate::db::dao::ChapterContentDao::new(conn)
            .get(&url, index)
            .map_err(err_to_string)?;
        serde_json::to_string(&json!({ "title": chapter.title, "content": content }))
            .map_err(err_to_string)
    })
    .await
}

async fn save_progress_json(pool: &AppPool, body: &str) -> Result<String, String> {
    if body.trim().is_empty() {
        return Err("请求体不能为空".to_string());
    }
    let progress: crate::db::models::BookProgress = serde_json::from_str(body)
        .map_err(|e| format!("JSON 解析失败: {e}"))?;
    with_conn(pool, move |conn| {
        crate::controllers::book_progress::save(conn, &progress).map_err(err_to_string)?;
        Ok("ok".to_string())
    })
    .await
}

// ============================================================================
// Pool helper
// ============================================================================

fn err_to_string<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

async fn with_conn<F, T>(pool: &AppPool, f: F) -> Result<T, String>
where
    F: FnOnce(&mut Connection) -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    let pool = pool.clone();
    async {
        let obj: Object<_> = pool.get().await.map_err(|e| e.to_string())?;
        obj.interact(f)
            .await
            .map_err(|e: deadpool_sync::InteractError| e.to_string())?
    }
    .await
}
