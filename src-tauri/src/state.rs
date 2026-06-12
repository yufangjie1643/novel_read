//! Application-wide state injected into Tauri commands via
//! `tauri::State<'_, AppState>`.
//!
//! Holds the shared SQLite connection pool built at startup. All DB-backed
//! `#[tauri::command]` handlers receive `state: State<'_, AppState>` and
//! resolve a connection via `state.db.get()` (typically from inside the
//! `db_op` helper in commands.rs which uses `Object::interact` to run the
//! closure on a deadpool worker thread).

use crate::db::AppPool;

/// Tauri-managed application state. The lifetime is tied to the Tauri app;
/// `tauri::State<'_, AppState>` derefs to `&AppState` from any command.
pub struct AppState {
    /// Shared connection pool. `Clone` is cheap (Arc inside).
    pub db: AppPool,
}

impl AppState {
    pub fn build(db: AppPool) -> Self {
        Self { db }
    }
}
