//! Application-wide state injected into Tauri commands via
//! `tauri::State<'_, AppState>`.
//!
//! Holds the shared SQLite connection pool, search supervisor, and
//! source stats DAO. All DB-backed `#[tauri::command]` handlers
//! receive `state: State<'_, AppState>` and resolve a connection
//! via `state.db.get()` (typically from inside the `db_op` helper
//! in commands.rs which uses `Object::interact` to run the closure
//! on a deadpool worker thread).

use crate::db::AppPool;
use crate::db::SourceStatsDao;
use crate::search_supervisor::SearchSupervisor;
use std::sync::Arc;

/// Tauri-managed application state. The lifetime is tied to the Tauri app;
/// `tauri::State<'_, AppState>` derefs to `&AppState` from any command.
pub struct AppState {
    /// Shared connection pool. `Clone` is cheap (Arc inside).
    pub db: AppPool,
    pub source_stats: Arc<SourceStatsDao>,
    /// Centralized search dispatcher. All search-related IPC commands
    /// route through this. See `search_supervisor.rs`.
    pub supervisor: Arc<SearchSupervisor>,
    /// Legacy cancellation channel. Retained for ABI compatibility
    /// with any external code that may inspect `AppState`, but no
    /// longer used by the search path. Will be removed in a future
    /// version.
    #[allow(dead_code)]
    pub search_cancel_tx: Arc<tokio::sync::Mutex<Option<tokio::sync::watch::Sender<bool>>>>,
}

impl AppState {
    pub fn build(
        db: AppPool,
        source_stats: Arc<SourceStatsDao>,
        supervisor: Arc<SearchSupervisor>,
    ) -> Self {
        Self {
            db,
            source_stats,
            supervisor,
            search_cancel_tx: Arc::new(tokio::sync::Mutex::new(None)),
        }
    }
}
