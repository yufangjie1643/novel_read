//! Simple built-in HTTP server for sharing bookshelf over local network

use serde_json::json;
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use tiny_http::{Response, Server};

use crate::db::{
    dao::{BookChapterDao, BookDao},
    db,
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
pub fn start_server(port: u16) -> Result<String, String> {
    if SERVER_RUNNING.load(Ordering::SeqCst) {
        if let Ok(addr) = SERVER_ADDR.lock() {
            if let Some(a) = addr.as_ref() {
                return Ok(a.clone());
            }
        }
    }

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

        thread::spawn(move || {
            println!("[WebServer] Listening on http://{}", bind_addr);
            for request in server_clone.incoming_requests() {
                if !SERVER_RUNNING.load(Ordering::SeqCst) {
                    let _ = request.respond(Response::from_string("Server shutting down"));
                    break;
                }
                let response = handle_request(request.url());
                let _ = request.respond(response);
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

/// Stop the web server by signalling the thread to exit and waking up
/// the blocking `incoming_requests()` iterator with a dummy request.
pub fn stop_server() {
    if !SERVER_RUNNING.load(Ordering::SeqCst) {
        return;
    }
    SERVER_RUNNING.store(false, Ordering::SeqCst);

    // Wake up the blocking accept() by sending a dummy HTTP request.
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

/// Check if server is running
pub fn is_server_running() -> bool {
    SERVER_RUNNING.load(Ordering::SeqCst)
}

fn handle_request(url: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    let result = match url {
        "/api/books" => get_books_json(),
        "/api/status" => Ok(json!({ "status": "ok", "running": true }).to_string()),
        _ => Ok(json!({ "error": "Not found" }).to_string()),
    };

    let body = match result {
        Ok(json_str) => json_str,
        Err(e) => json!({ "error": e }).to_string(),
    };

    Response::from_string(body).with_header(
        tiny_http::Header::from_bytes(
            &b"Content-Type"[..],
            &b"application/json; charset=utf-8"[..],
        )
        .unwrap(),
    )
}

fn get_books_json() -> Result<String, String> {
    let dao = BookDao::new(db());
    let books = dao.get_all().map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for book in books {
        let chapter_dao = BookChapterDao::new(db());
        let chapters = chapter_dao
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

    serde_json::to_string_pretty(&result).map_err(|e| e.to_string())
}
