use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use tauri::Manager;

pub mod dao;
pub mod migrations;
pub mod models;

pub use dao::{
    BookChapterDao, BookDao, BookGroupDao, BookSourceDao, BookmarkDao, CacheDao, ChapterContentDao,
    CookieDao, DictRuleDao, HttpTTSDao, KeyboardAssistDao, ReadRecordDao, ReplaceRuleDao,
    RssArticleDao, RssReadRecordDao, RssSourceDao, RssStarDao, RuleSubDao, SearchKeywordDao,
    ServerDao, TxtTocRuleDao,
};
pub use models::{RssSource, RuleSub};

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
        self.conn
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Global database instance (initialized at app startup)
static DB: OnceLock<Database> = OnceLock::new();

static APP_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Get the app data directory
pub fn app_dir() -> &'static PathBuf {
    APP_DIR.get().expect("App directory not initialized")
}

/// Get the database file path
pub fn db_path() -> PathBuf {
    app_dir().join("legado.db")
}

/// Check for pending restore and apply it
fn check_pending_restore(app_dir: &PathBuf) -> Result<(), Box<dyn std::error::Error>> {
    let restore_path = app_dir.join("legado.db.restore");
    let db_path = app_dir.join("legado.db");

    if restore_path.exists() {
        // Replace the current DB with the restored one
        if db_path.exists() {
            std::fs::remove_file(&db_path)?;
        }
        std::fs::rename(&restore_path, &db_path)?;
    }

    Ok(())
}

/// Initialize the global database
pub fn init_db(app_handle: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let app_dir = app_handle.path().app_data_dir()?;

    std::fs::create_dir_all(&app_dir)?;
    APP_DIR
        .set(app_dir.clone())
        .map_err(|_| "App dir already initialized")?;

    // Check for pending restore before opening the database
    check_pending_restore(&app_dir)?;

    let db_path = app_dir.join("legado.db");
    let db = Database::open(db_path)?;

    // Insert default rule subscriptions if table is empty
    let rule_sub_dao = RuleSubDao::new(&db);
    if let Ok(subs) = rule_sub_dao.get_all() {
        if subs.is_empty() {
            let defaults = [
                RuleSub {
                    id: None,
                    name: Some("喵公子书源".to_string()),
                    url: Some("http://yuedu.miaogongzi.net/shuyuan".to_string()),
                    sub_type: 0,
                    custom_order: 0,
                    enabled: true,
                    auto_update: true,
                    last_update_time: 0,
                },
                RuleSub {
                    id: None,
                    name: Some("Nya源·合集".to_string()),
                    url: Some(
                        "https://shuyuan.nyasama.cc/cdn/5f626361539d546e6fa3a02b24598284.json"
                            .to_string(),
                    ),
                    sub_type: 0,
                    custom_order: 1,
                    enabled: true,
                    auto_update: true,
                    last_update_time: 0,
                },
            ];
            for sub in &defaults {
                let _ = rule_sub_dao.insert(sub);
            }
        }
    }

    // Insert default RSS sources if table is empty
    let rss_source_dao = RssSourceDao::new(&db);
    if let Ok(sources) = rss_source_dao.get_all() {
        if sources.is_empty() {
            let defaults = [
                RssSource {
                    source_url: "https://www.yuque.com/legado".to_string(),
                    source_name: "使用说明".to_string(),
                    source_group: Some("legado".to_string()),
                    source_icon: Some("https://cdn.jsdelivr.net/gh/gedoor/legado@master/app/src/main/res/mipmap-hdpi/ic_launcher.png".to_string()),
                    enabled: true,
                    variable: None,
                    custom_order: 2,
                    last_update_time: 0,
                    login_url: None,
                    login_ui: None,
                    header: None,
                    sort_url: None,
                    rule_articles: None,
                    rule_next_page: None,
                    rule_title: None,
                    rule_pub_date: None,
                    rule_description: None,
                    rule_image: None,
                    rule_link: None,
                    rule_content: None,
                    single_url: false,
                },
                RssSource {
                    source_url: "snssdk1128://user/profile/562564899806367".to_string(),
                    source_name: "小说拾遗".to_string(),
                    source_group: Some("legado".to_string()),
                    source_icon: Some("http://mmbiz.qpic.cn/mmbiz_png/MSvbRVunjxNFqy9DVEIF9s7EJRSozqWibESyVRvqn7RhJpKHfkq8HuwloAvMFMHrLGIvXNTT5ibqeqAcPDg0icibicA/0?wx_fmt=png".to_string()),
                    enabled: true,
                    variable: None,
                    custom_order: 3,
                    last_update_time: 0,
                    login_url: None,
                    login_ui: None,
                    header: None,
                    sort_url: None,
                    rule_articles: None,
                    rule_next_page: None,
                    rule_title: None,
                    rule_pub_date: None,
                    rule_description: None,
                    rule_image: None,
                    rule_link: None,
                    rule_content: None,
                    single_url: false,
                },
                RssSource {
                    source_url: "https://pan.miaogongzi.net".to_string(),
                    source_name: "Meow云".to_string(),
                    source_group: Some("legado".to_string()),
                    source_icon: Some("https://cdn.jsdelivr.net/gh/mgz0227/meowcloud/icon.png".to_string()),
                    enabled: true,
                    variable: None,
                    custom_order: 4,
                    last_update_time: 0,
                    login_url: None,
                    login_ui: None,
                    header: None,
                    sort_url: None,
                    rule_articles: None,
                    rule_next_page: None,
                    rule_title: None,
                    rule_pub_date: None,
                    rule_description: None,
                    rule_image: None,
                    rule_link: None,
                    rule_content: None,
                    single_url: false,
                },
                RssSource {
                    source_url: "https://www.lanzoux.com/b0bw8jwoh".to_string(),
                    source_name: "烏雲净化".to_string(),
                    source_group: Some("legado".to_string()),
                    source_icon: Some("https://cdn.jsdelivr.net/gh/gedoor/legado@master/app/src/main/res/mipmap-hdpi/ic_launcher.png".to_string()),
                    enabled: true,
                    variable: None,
                    custom_order: 5,
                    last_update_time: 0,
                    login_url: None,
                    login_ui: None,
                    header: None,
                    sort_url: None,
                    rule_articles: None,
                    rule_next_page: None,
                    rule_title: None,
                    rule_pub_date: None,
                    rule_description: None,
                    rule_image: None,
                    rule_link: None,
                    rule_content: None,
                    single_url: false,
                },
                RssSource {
                    source_url: "https://yuedu.miaogongzi.net/gx.html".to_string(),
                    source_name: "喵公子更新".to_string(),
                    source_group: Some("书源".to_string()),
                    source_icon: None,
                    enabled: true,
                    variable: None,
                    custom_order: 6,
                    last_update_time: 0,
                    login_url: None,
                    login_ui: None,
                    header: None,
                    sort_url: None,
                    rule_articles: None,
                    rule_next_page: None,
                    rule_title: None,
                    rule_pub_date: None,
                    rule_description: None,
                    rule_image: None,
                    rule_link: None,
                    rule_content: None,
                    single_url: true,
                },
            ];
            for source in &defaults {
                let _ = rss_source_dao.insert(source);
            }
        }
    }

    DB.set(db).map_err(|_| "Database already initialized")?;

    Ok(())
}

/// Get the global database instance
pub fn db() -> &'static Database {
    DB.get().expect("Database not initialized")
}
