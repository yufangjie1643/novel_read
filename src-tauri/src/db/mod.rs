use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

pub mod dao;
pub mod migrations;
pub mod models;

pub use dao::{
    BookChapterDao, BookDao, BookGroupDao, BookSourceDao, BookmarkDao, CacheDao, ChapterContentDao,
    CookieDao, DictRuleDao, HttpTTSDao, KeyboardAssistDao, ReadRecordDao, ReplaceRuleDao,
    RssArticleDao, RssReadRecordDao, RssSourceDao, RssStarDao, RuleSubDao, SearchKeywordDao,
    ServerDao, TxtTocRuleDao,
};

/// Database manager - wraps SQLite connection
pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    /// Open or create the database at the given path
    pub fn open(path: PathBuf) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        migrations::run_migrations(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Get the inner connection (locks mutex)
    pub fn conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().unwrap()
    }
}

/// Global database instance (initialized at app startup)
static mut DB: Option<Database> = None;

/// Initialize the global database
pub fn init_db(_app_handle: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    // Use standard app data directory
    let app_dir = dirs::data_dir()
        .ok_or("Failed to get data directory")?
        .join("io.legado.desktop");

    std::fs::create_dir_all(&app_dir)?;

    let db_path = app_dir.join("legado.db");
    let db = Database::open(db_path)?;

    unsafe {
        DB = Some(db);
    }

    Ok(())
}

/// Get the global database instance
///
/// # Safety
/// Must only be called after `init_db()` has been called
pub fn db() -> &'static Database {
    unsafe { (*std::ptr::addr_of!(DB)).as_ref().expect("Database not initialized") }
}
