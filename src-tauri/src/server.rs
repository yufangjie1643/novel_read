//! Simple built-in HTTP server for sharing bookshelf over local network

use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use tiny_http::{Response, Server};

use crate::db::{
    dao::{BookChapterDao, BookDao},
    db,
};

static SERVER_RUNNING: AtomicBool = AtomicBool::new(false);

/// Start the built-in web server on the given port
pub fn start_server(port: u16) -> Result<String, String> {
    if SERVER_RUNNING.swap(true, Ordering::SeqCst) {
        return Err("Server already running".to_string());
    }

    let addr = format!("0.0.0.0:{}", port);
    let server = match Server::http(&addr) {
        Ok(s) => Arc::new(s),
        Err(e) => {
            SERVER_RUNNING.store(false, Ordering::SeqCst);
            return Err(format!("Failed to start server: {}", e));
        }
    };

    let server_clone = server.clone();
    let addr_for_thread = addr.clone();
    thread::spawn(move || {
        println!("[WebServer] Listening on http://{}", addr_for_thread);
        for request in server_clone.incoming_requests() {
            let response = handle_request(request.url());
            let _ = request.respond(response);
        }
        SERVER_RUNNING.store(false, Ordering::SeqCst);
        println!("[WebServer] Stopped");
    });

    Ok(format!("http://{}", addr))
}

/// Stop the web server
pub fn stop_server() {
    SERVER_RUNNING.store(false, Ordering::SeqCst);
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

    Response::from_string(body)
        .with_header(tiny_http::Header::from_bytes(
            &b"Content-Type"[..],
            &b"application/json; charset=utf-8"[..],
        ).unwrap())
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
