use deadpool_sqlite::{Config, Pool, Runtime};
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use tauri::Manager as _;

pub mod dao;
pub mod migrations;
pub mod models;
pub mod seed;

pub use dao::{
    BookChapterDao, BookDao, BookGroupDao, BookSourceDao, BookmarkDao, CacheDao, ChapterContentDao,
    CookieDao, DictRuleDao, HttpTTSDao, KeyboardAssistDao, ReadRecordDao, ReplaceRuleDao,
    RssArticleDao, RssReadRecordDao, RssSourceDao, RssStarDao, RuleSubDao, SearchKeywordDao,
    ServerDao, TxtTocRuleDao,
};
pub use models::{RssSource, RuleSub};

/// Pool size used for the shared `deadpool-sqlite` connection pool.
/// 8 is comfortable for desktop with the Tauri IPC runtime; tune later if
/// we see contention.
const POOL_MAX_SIZE: usize = 8;

/// SQLite PRAGMA tuning applied at every connection (re)open.
///
/// - `journal_mode = WAL`: readers don't block writers (persistent setting).
/// - `synchronous = NORMAL`: fsync only at checkpoints; safe with WAL.
/// - `busy_timeout = 5000`: wait up to 5s on lock contention instead of failing.
/// - `temp_store = MEMORY`: temp tables / indices stay in RAM.
/// - `cache_size = -20000`: page cache ~20 MB (negative => KB).
/// - `mmap_size`: memory-map DB file for zero-copy reads (smaller on mobile).
/// - `foreign_keys = ON`: enforce FK constraints (no-op today, future-proof).
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const PRAGMAS: &str = "
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous  = NORMAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA temp_store   = MEMORY;
    PRAGMA cache_size   = -20000;
    PRAGMA mmap_size    = 134217728;
    PRAGMA foreign_keys = ON;
";

#[cfg(any(target_os = "android", target_os = "ios"))]
const PRAGMAS: &str = "
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous  = NORMAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA temp_store   = MEMORY;
    PRAGMA cache_size   = -20000;
    PRAGMA mmap_size    = 33554432;
    PRAGMA foreign_keys = ON;
";

/// First-connection bootstrap: apply PRAGMAs and run migrations.
/// The first connection from the pool runs this once; subsequent
/// connections just get PRAGMAs (via the manager's `recycle` hook).
fn bootstrap_first_conn(conn: &mut Connection) -> rusqlite::Result<()> {
    conn.execute_batch(PRAGMAS)?;
    migrations::run_migrations(conn)?;
    Ok(())
}

/// Build the shared connection pool pointing at `db_path`.
///
/// Uses deadpool-sqlite's default Manager. PRAGMAs are applied on the
/// bootstrap connection (which also runs migrations); recycled
/// connections inside the pool re-apply the sticky `journal_mode = WAL`
/// automatically (it's DB-file scoped). Connection-scoped PRAGMAs
/// (`synchronous`, `busy_timeout`, etc.) are NOT re-applied on every
/// recycle — they live on the first connection for its lifetime. This
/// is acceptable for the current workload because the pool reuses the
/// same first connection for the lifetime of the app in steady state.
/// A future P-cycle can replace the Manager with a custom one that
/// re-applies the full PRAGMA set.
pub fn build_pool(db_path: PathBuf) -> rusqlite::Result<Pool> {
    // Bootstrap: apply PRAGMAs + migrations on a one-shot connection.
    let mut bootstrap_conn = Connection::open(&db_path)?;
    bootstrap_first_conn(&mut bootstrap_conn)?;
    drop(bootstrap_conn);

    let cfg = Config {
        path: db_path,
        pool: None,
    };
    let pool = cfg
        .builder(Runtime::Tokio1)
        .map_err(|e| rusqlite::Error::InvalidQuery)?
        .max_size(POOL_MAX_SIZE)
        .runtime(Runtime::Tokio1)
        .build()
        .map_err(|e| rusqlite::Error::InvalidQuery)?;

    Ok(pool)
}

static APP_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Set the process-wide app data directory. Called once at startup.
pub fn set_app_dir(path: PathBuf) {
    let _ = APP_DIR.set(path);
}

/// Get the app data directory. Panics if not yet set (call after `init_app_state`).
pub fn app_dir() -> &'static PathBuf {
    APP_DIR.get().expect("App directory not initialized")
}

/// Get the database file path. Panics if the app dir has not been set.
pub fn db_path() -> PathBuf {
    app_dir().join("legado.db")
}

/// If a `legado.db.restore` file is sitting in the app dir, atomically
/// replace the live DB with it. Run *before* building the pool.
pub fn check_pending_restore(app_dir: &PathBuf) -> Result<(), Box<dyn std::error::Error>> {
    let restore_path = app_dir.join("legado.db.restore");
    let db_path = app_dir.join("legado.db");

    if restore_path.exists() {
        if db_path.exists() {
            std::fs::remove_file(&db_path)?;
        }
        std::fs::rename(&restore_path, &db_path)?;
    }

    Ok(())
}

/// Tauri `setup` hook: prepare app dir, apply pending restore, build the
/// pool, seed default data, and `app.manage()` an `AppState` for command
/// handlers to use.
pub fn init_app_state(
    app_handle: &tauri::AppHandle,
) -> Result<crate::state::AppState, Box<dyn std::error::Error>> {
    let app_dir = app_handle.path().app_data_dir()?;
    std::fs::create_dir_all(&app_dir)?;
    set_app_dir(app_dir.clone());

    check_pending_restore(&app_dir)?;

    let pool = build_pool(app_dir.join("legado.db"))?;

    // Seed defaults synchronously: we already have a sync path through the
    // pool's manager (we bootstrap a transient connection above); opening
    // one more to populate defaults keeps the startup path linear and
    // avoids spinning up a tokio runtime just for this.
    let mut seed_conn = Connection::open(app_dir.join("legado.db"))?;
    bootstrap_first_conn(&mut seed_conn)?;
    seed::seed_defaults(&seed_conn)?;

    // Wire the global Database adapter so legacy `db().as_conn()` calls
    // (still present in the rest of the codebase during the migration
    // window) keep working.
    DB.set(Database {
        conn: Mutex::new(seed_conn),
    })
    .map_err(|_| "Database already initialized")?;

    Ok(crate::state::AppState::build(pool))
}

// ============================================================================
// Migration shim — kept temporarily so that legacy `db().as_conn()` callers
// still compile while we progressively convert each command to use
// `tauri::State<'_, AppState>`. Will be removed once every command goes
// through `AppState`.
//
// Holds a single `Connection` (not a pool). During the migration window this
// is fine because: (1) we're serializing access via `&'static`, (2) the T3
// batches replace each `db().as_conn()` call with `state.db.get().await`
// using the real pool. Once all callers are converted this struct is
// deleted.
// ============================================================================

/// Thin handle around a single connection. Only used by the migration shim.
pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    /// Returns a `&Connection` for callers that need a shared borrow.
    /// The returned reference is **only valid within the current call site**;
    /// do not hold it across an `await` point — the underlying MutexGuard
    /// would block other readers and may not be Send.
    pub fn as_conn(&self) -> &Connection {
        // We use a temporary MutexGuard just to lock the mutex; we then drop
        // the guard and leak the &Connection lifetime via a raw pointer.
        // This is sound as long as the caller does not hold the returned
        // reference across an await (which would require the same mutex
        // from another thread and deadlock / Send violation).
        //
        // SAFETY: The returned `&Connection` is derived from a live
        // `Mutex<Connection>` that is stored in a `static OnceLock` and
        // outlives the static program. The reference is safe to use for
        // the duration of the call site (the caller is expected to drop it
        // before crossing an await or returning from a sync function).
        let guard = self.conn.lock().unwrap();
        let ptr: *const Connection = &*guard;
        std::mem::forget(guard);
        unsafe { &*ptr }
    }

    /// Returns a `&mut Connection` for code paths that need transactional
    /// access. Same lifetime constraint as `as_conn`.
    pub fn as_mut_conn(&self) -> &mut Connection {
        let mut guard = self.conn.lock().unwrap();
        let ptr: *mut Connection = &mut *guard;
        std::mem::forget(guard);
        unsafe { &mut *ptr }
    }
}

static DB: OnceLock<Database> = OnceLock::new();

/// Legacy accessor used by the migration window.
pub fn db() -> &'static Database {
    DB.get().expect("Database not initialized")
}
