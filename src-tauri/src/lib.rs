pub mod book_source;
pub mod commands;
pub mod content_processor;
pub mod controllers;
#[allow(invalid_reference_casting)]
pub mod db;
pub mod http;
pub mod local_book;
pub mod search_supervisor;
pub mod server;
pub mod state;
pub mod webdav;

use commands::*;
use std::sync::Arc;
use tauri::Manager;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri::{LogicalSize, Size};

#[cfg_attr(mobile, tauri::mobile_entry_point)]

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Build the search supervisor and start its resource
            // monitor before constructing AppState (the supervisor
            // is owned by AppState).
            let app_handle = app.handle().clone();
            let supervisor = Arc::new(
                crate::search_supervisor::SearchSupervisor::new(app_handle),
            );
            supervisor.start_monitor();
            let app_state = db::init_app_state(app.handle(), supervisor)?;
            app.manage(app_state);
            apply_preview_window_size(app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Book commands
            get_books,
            add_book,
            update_book,
            delete_book,
            save_book_progress,
            clear_book_cache,
            migrate_book_source,
            // BookSource commands
            get_book_sources,
            get_source_stats,
            get_enabled_book_sources,
            get_explore_book_sources,
            get_explore_items,
            get_book_source,
            add_book_source,
            update_book_source,
            delete_book_source,
            top_book_source,
            get_book_source_groups,
            get_explore_kinds,
            // BookChapter commands
            get_chapters,
            add_chapters,
            delete_chapters,
            // BookGroup commands
            get_book_groups,
            add_book_group,
            update_book_group,
            delete_book_group,
            // ReplaceRule commands
            get_replace_rules,
            add_replace_rule,
            update_replace_rule,
            delete_replace_rule,
            test_replace_rule,
            insert_replace_rules,
            // SearchKeyword commands
            add_search_keyword,
            get_search_keywords,
            clear_search_keywords,
            // Cookie commands
            set_cookie,
            get_cookie,
            delete_cookie,
            // Cache commands
            set_cache,
            get_cache,
            delete_cache,
            // Bookmark commands
            add_bookmark,
            update_bookmark,
            delete_bookmark,
            get_bookmarks,
            // ReadRecord commands
            add_read_record,
            get_read_records,
            delete_read_record,
            // HttpTTS commands
            get_http_tts_list,
            add_http_tts,
            update_http_tts,
            delete_http_tts,
            // RssSource commands
            get_rss_sources,
            get_rss_source,
            add_rss_source,
            update_rss_source,
            delete_rss_source,
            insert_rss_sources,
            // RssArticle commands
            get_rss_articles,
            add_rss_articles,
            fetch_rss_articles,
            parse_source_links_from_html,
            fetch_import_page_html,
            fetch_import_config_text,
            fetch_import_links_from_url,
            // TxtTocRule commands
            get_txt_toc_rules,
            add_txt_toc_rule,
            update_txt_toc_rule,
            delete_txt_toc_rule,
            // RuleSub commands
            get_rule_subs,
            add_rule_sub,
            update_rule_sub,
            delete_rule_sub,
            // DictRule commands
            get_dict_rules,
            add_dict_rule,
            update_dict_rule,
            delete_dict_rule,
            // App file management commands
            list_app_files,
            create_app_folder,
            delete_app_file,
            // KeyboardAssist commands
            get_keyboard_assists,
            add_keyboard_assist,
            update_keyboard_assist,
            delete_keyboard_assist,
            // Server commands
            get_servers,
            add_server,
            update_server,
            delete_server,
            // RssStar commands
            get_rss_stars,
            add_rss_star,
            delete_rss_star,
            // RssReadRecord commands
            mark_rss_read,
            is_rss_read,
            get_rss_read_article_ids,
            // WebBook commands
            search_books,
            search_books_stream,
            explore_books,
            fetch_book_info,
            fetch_chapter_list,
            ping_source,
            fetch_chapter_content,
            // Book update check
            check_book_update,
            // Local book import commands
            import_txt_book,
            import_epub_book,
            // Chapter content cache commands
            get_local_chapter_content,
            save_local_chapter_content,
            batch_cache_chapters,
            export_book_text,
            // Source debug commands
            debug_book_source,
            // Web server commands
            start_web_server,
            stop_web_server,
            get_web_server_status,
            // Source import commands
            import_source_from_url,
            import_source_from_json,
            insert_book_sources,
            import_rss_source_from_url,
            import_rss_source_from_json,
            import_replace_rules_from_url,
            import_replace_rules_from_json,
            import_http_tts_from_url,
            import_http_tts_from_json,
            // HttpServerAuth commands
            get_http_server_auth,
            set_http_server_credentials,
            clear_http_server_credentials,
            // WebDAV commands
            test_webdav_connection,
            backup_to_webdav,
            restore_from_webdav,
            // Search supervisor commands
            search_books_stream_v2,
            cancel_search,
            get_last_search,
            update_search_settings,
            cache_cover,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn apply_preview_window_size(app: &tauri::App) {
    let preview_enabled = std::env::var("LEGADO_WINDOW_PREVIEW")
        .map(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
        .unwrap_or(false);
    if !preview_enabled {
        return;
    }

    let ui_mode = std::env::var("VITE_APP_UI_MODE").unwrap_or_default();
    let is_mobile = ui_mode.eq_ignore_ascii_case("mobile");
    let width = env_f64(
        "LEGADO_WINDOW_WIDTH",
        if is_mobile { 390.0 } else { 1200.0 },
    );
    let height = env_f64(
        "LEGADO_WINDOW_HEIGHT",
        if is_mobile { 844.0 } else { 800.0 },
    );
    let min_width = env_f64(
        "LEGADO_WINDOW_MIN_WIDTH",
        if is_mobile { 360.0 } else { 800.0 },
    );
    let min_height = env_f64(
        "LEGADO_WINDOW_MIN_HEIGHT",
        if is_mobile { 640.0 } else { 600.0 },
    );

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_min_size(Some(Size::Logical(LogicalSize {
            width: min_width,
            height: min_height,
        })));
        let _ = window.set_size(Size::Logical(LogicalSize { width, height }));
        let _ = window.center();
        if is_mobile {
            let _ = window.set_title("Legado Desktop - Mobile Preview");
        }
    }
}

fn env_f64(name: &str, default_value: f64) -> f64 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse::<f64>().ok())
        .filter(|value| value.is_finite() && *value > 0.0)
        .unwrap_or(default_value)
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn apply_preview_window_size(_: &tauri::App) {}
