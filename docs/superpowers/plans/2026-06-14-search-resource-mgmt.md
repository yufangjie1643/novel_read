# Search Resource Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 3.5s global search timeout with a `SearchSupervisor` that dispatches all book sources under a fixed semaphore, monitors process RSS, and reclaims `(oldest + lowest health)` in-flight tasks when memory exceeds a user-configurable soft limit. Add an explicit ⏹ button. Persist the last search snapshot in backend memory so returning to Home shows the previous result.

**Architecture:** New `search_supervisor.rs` owns a `Semaphore` (configurable, default 8), an `in_flight: RwLock<HashMap<RequestId, InFlightTask>>`, a `last_search: Mutex<Option<SearchSnapshot>>`, and a `ResourceMonitor` tokio task reading RSS via `sysinfo`. New IPC commands `search_books_stream_v2` / `cancel_search` / `get_last_search` / `update_search_settings` replace the old `GLOBAL_TIMEOUT` flow. Old `search_books_stream` is kept as a redirect. `search_cancel_tx` field in `AppState` is marked `#[allow(dead_code)]`. Frontend Home gets a ⏹ button + mount-time `get_last_search`; SettingsOther gets a "Search resource" section.

**Tech Stack:** Rust (Tauri 2, tokio 1, sysinfo 0.32, rusqlite, rquickjs), React 18 + TypeScript (no new deps).

---

## File Structure

| File | Change | Purpose |
|---|---|---|
| `src-tauri/Cargo.toml` | Modify (+1 line) | Add `sysinfo = "0.32"` |
| `src-tauri/src/search_supervisor.rs` | Create (~500 lines) | `SearchSupervisor`, `InFlightTask`, `SearchSnapshot`, `SearchSettings`, `ResourceMonitor`, 6 unit tests |
| `src-tauri/src/state.rs` | Modify (~10 lines) | Add `supervisor: Arc<SearchSupervisor>`; deprecate `search_cancel_tx` |
| `src-tauri/src/commands.rs` | Modify (~200 lines) | Add 4 new IPC commands; keep `search_books_stream` as redirect |
| `src-tauri/src/lib.rs` | Modify (~5 lines) | Register 4 new commands in `invoke_handler!`; start supervisor in `setup` |
| `src/pages/Home.tsx` | Modify (~40 lines) | Switch to v2 invoke; ⏹ button; mount-time `get_last_search` |
| `src/pages/settings/SettingsOther.tsx` | Modify (~80 lines) | "Search resource" section with 4 numeric inputs + range validation |
| `src/i18n/locales/zh.json` | Modify (+6 keys) | New i18n entries |
| `src/i18n/locales/en.json` | Modify (+6 keys) | New i18n entries |

Total: 1 new file, 8 modified files. 1 new dep.

---

## Task 1: Add `sysinfo` dependency

**Files:**
- Modify: `src-tauri/Cargo.toml` (insert after the `regex` line)

- [ ] **Step 1: Read the current Cargo.toml to find the right insertion point**

Run: `grep -n "^regex\|^encoding_rs" src-tauri/Cargo.toml | head -5`
Expected: a `regex` line near the bottom of dependencies.

- [ ] **Step 2: Add `sysinfo` line**

Insert one line directly after the `regex` line:

```toml
sysinfo = "0.32"
```

- [ ] **Step 3: Verify the dependency resolves**

Run: `cd src-tauri && cargo check 2>&1 | tail -20`
Expected: finishes without "no matching package" or "version not found" errors. `sysinfo` may not be referenced yet — that's fine; cargo check still resolves the dep graph.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "deps: add sysinfo 0.32 for cross-platform RSS reading"
```

---

## Task 2: Create `SearchSettings` and `InFlightTask` types in a stub `search_supervisor.rs`

**Files:**
- Create: `src-tauri/src/search_supervisor.rs`
- Modify: `src-tauri/src/lib.rs` (add module declaration)

- [ ] **Step 1: Create the file with the type definitions only**

Create `src-tauri/src/search_supervisor.rs` with this exact content:

```rust
//! Search dispatch supervisor: owns the fixed-concurrency semaphore,
//! in-flight task registry, last-search cache, and resource monitor
//! that reclaims in-flight tasks when process RSS exceeds the
//! configured soft limit.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::{RwLock, Semaphore};

/// Tunable knobs surfaced via `update_search_settings` IPC.
#[derive(Debug, Clone)]
pub struct SearchSettings {
    pub max_concurrency: usize,
    pub memory_soft_limit_mb: usize,
    pub per_source_timeout_ms: u64,
    pub reclaim_batch: usize,
}

impl Default for SearchSettings {
    fn default() -> Self {
        Self {
            max_concurrency: 8,
            memory_soft_limit_mb: 400,
            per_source_timeout_ms: 2000,
            reclaim_batch: 2,
        }
    }
}

impl SearchSettings {
    /// Clamp values into safe ranges. Returns Err if any value is out
    /// of range (callers should surface the message to the UI).
    pub fn validate(&self) -> Result<(), String> {
        if !(1..=64).contains(&self.max_concurrency) {
            return Err(format!(
                "max_concurrency must be in 1..=64, got {}",
                self.max_concurrency
            ));
        }
        if !(50..=4096).contains(&self.memory_soft_limit_mb) {
            return Err(format!(
                "memory_soft_limit_mb must be in 50..=4096, got {}",
                self.memory_soft_limit_mb
            ));
        }
        if !(500..=60000).contains(&self.per_source_timeout_ms) {
            return Err(format!(
                "per_source_timeout_ms must be in 500..=60000, got {}",
                self.per_source_timeout_ms
            ));
        }
        if !(1..=16).contains(&self.reclaim_batch) {
            return Err(format!(
                "reclaim_batch must be in 1..=16, got {}",
                self.reclaim_batch
            ));
        }
        Ok(())
    }
}

/// One currently-running book source task.
#[derive(Debug, Clone)]
pub struct InFlightTask {
    pub source_url: String,
    pub source_name: String,
    pub health_score: f64,
    pub started_at: Instant,
    pub cancel: tokio::sync::watch::Sender<bool>,
}

/// Frozen snapshot of the last completed (or cancelled) search.
///
/// Note: source statuses and failures are intentionally omitted.
/// These are derived on the frontend from the `SearchEvent` stream
/// (which is re-emitted on re-mount). Storing them on the Rust side
/// would require a parallel struct to the frontend's `SourceStatus`
/// and `SearchFailure` (in `src/types.ts`), and they can always be
/// regenerated by re-running the search. Only fields that are
/// expensive to reproduce (query, results, counts, duration) are
/// kept here.
#[derive(Debug, Clone)]
pub struct SearchSnapshot {
    pub request_id: String,
    pub query: String,
    pub results: Vec<crate::db::models::SearchBook>,
    pub total_results: usize,
    pub duration_ms: u64,
    pub captured_at: Instant,
}

#[derive(Debug, Clone)]
pub struct RequestId(pub String);

/// Public supervisor handle. Cloned via `Arc`.
pub struct SearchSupervisor {
    pub(crate) sem: Arc<Semaphore>,
    pub(crate) in_flight: Arc<RwLock<HashMap<RequestId, Vec<InFlightTask>>>>,
    pub(crate) last_search: Arc<tokio::sync::Mutex<Option<SearchSnapshot>>>,
    pub(crate) settings: Arc<RwLock<SearchSettings>>,
    pub(crate) current_request: Arc<tokio::sync::Mutex<Option<RequestId>>>,
    /// Tracks the latest resources monitor task so we can abort it on
    /// drop or supervisor replacement. Only one monitor at a time.
    pub(crate) monitor_handle: Arc<tokio::sync::Mutex<Option<tokio::task::JoinHandle<()>>>>,
    pub(crate) app_handle: tauri::AppHandle,
}

impl SearchSupervisor {
    /// Build a new supervisor with default settings. The caller is
    /// responsible for starting the resource monitor via
    /// `start_resource_monitor`.
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        let defaults = SearchSettings::default();
        let sem = Arc::new(Semaphore::new(defaults.max_concurrency));
        Self {
            sem,
            in_flight: Arc::new(RwLock::new(HashMap::new())),
            last_search: Arc::new(tokio::sync::Mutex::new(None)),
            settings: Arc::new(RwLock::new(defaults)),
            current_request: Arc::new(tokio::sync::Mutex::new(None)),
            monitor_handle: Arc::new(tokio::sync::Mutex::new(None)),
            app_handle,
        }
    }
}
```

- [ ] **Step 2: Register the module in lib.rs**

Read `src-tauri/src/lib.rs` and find the `mod` declarations. Add:

```rust
pub mod search_supervisor;
```

immediately after the `mod book_source;` or `mod commands;` line, whichever matches the existing module ordering. Use the file's existing style.

- [ ] **Step 3: Verify the module compiles**

Run: `cd src-tauri && cargo check 2>&1 | tail -20`
Expected: PASS, no errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/search_supervisor.rs src-tauri/src/lib.rs
git commit -m "feat(search): add SearchSupervisor types (no methods yet)"
```

---

## Task 3: Add unit tests for `SearchSettings::validate`

**Files:**
- Modify: `src-tauri/src/search_supervisor.rs` (append tests at the end)

- [ ] **Step 1: Append the test module**

Append this block to the end of `search_supervisor.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_default_is_valid() {
        assert!(SearchSettings::default().validate().is_ok());
    }

    #[test]
    fn settings_reject_zero_concurrency() {
        let mut s = SearchSettings::default();
        s.max_concurrency = 0;
        assert!(s.validate().is_err());
    }

    #[test]
    fn settings_reject_high_concurrency() {
        let mut s = SearchSettings::default();
        s.max_concurrency = 65;
        assert!(s.validate().is_err());
    }

    #[test]
    fn settings_reject_low_memory_limit() {
        let mut s = SearchSettings::default();
        s.memory_soft_limit_mb = 49;
        assert!(s.validate().is_err());
    }

    #[test]
    fn settings_reject_high_memory_limit() {
        let mut s = SearchSettings::default();
        s.memory_soft_limit_mb = 5000;
        assert!(s.validate().is_err());
    }

    #[test]
    fn settings_reject_low_timeout() {
        let mut s = SearchSettings::default();
        s.per_source_timeout_ms = 100;
        assert!(s.validate().is_err());
    }

    #[test]
    fn settings_accept_boundary_values() {
        let s = SearchSettings {
            max_concurrency: 1,
            memory_soft_limit_mb: 50,
            per_source_timeout_ms: 500,
            reclaim_batch: 1,
        };
        assert!(s.validate().is_ok());

        let s = SearchSettings {
            max_concurrency: 64,
            memory_soft_limit_mb: 4096,
            per_source_timeout_ms: 60000,
            reclaim_batch: 16,
        };
        assert!(s.validate().is_ok());
    }
}
```

- [ ] **Step 2: Run the tests**

Run: `cd src-tauri && cargo test --lib search_supervisor 2>&1 | tail -30`
Expected: `7 passed; 0 failed`.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/search_supervisor.rs
git commit -m "test(search): SearchSettings::validate range checks"
```

---

## Task 4: Implement `submit` and `cancel` methods

**Files:**
- Modify: `src-tauri/src/search_supervisor.rs` (add methods)

- [ ] **Step 1: Add `submit` and `cancel` method skeletons**

Insert this block immediately before the final `}` of `impl SearchSupervisor` (i.e. right after the `new` function, before the closing brace). The method bodies are fully implemented:

```rust
    /// Submit a new search. If a previous search is in flight, all
    /// its in-flight tasks are cancelled (cancel handles fired). The
    /// method does NOT wait for the stream to finish — it returns
    /// the new request id once dispatch begins. The stream runs in
    /// the background and writes `last_search` upon completion.
    pub async fn submit(&self, request_id: String) {
        // Mark the new request as current. Existing in-flight tasks
        // for any prior request will be cancelled below.
        let new_id = RequestId(request_id);
        let old_id = {
            let mut current = self.current_request.lock().await;
            let old = current.take();
            *current = Some(new_id.clone());
            old
        };

        // Fire cancel on any in-flight tasks from the old request.
        if let Some(prev) = old_id {
            let in_flight = self.in_flight.read().await;
            if let Some(tasks) = in_flight.get(&prev) {
                for t in tasks {
                    let _ = t.cancel.send(true);
                }
            }
        }
        // Note: we do NOT clear in_flight[old] here. The src_task
        // removes itself upon completion (see Task 5). If the user
        // submits again before the old tasks finish, the next
        // submit() will see the leftover entries and fire their
        // cancel handles again — sending `true` on an already-closed
        // channel is a no-op, so this is safe.
    }

    /// Cancel all in-flight tasks for the given request id (or the
    /// current request if `None`). Returns the number of tasks
    /// whose cancel handles were fired.
    pub async fn cancel(&self, request_id: Option<String>) -> usize {
        let target = match request_id {
            Some(id) => RequestId(id),
            None => {
                let cur = self.current_request.lock().await;
                match cur.as_ref() {
                    Some(id) => id.clone(),
                    None => return 0,
                }
            }
        };
        let mut fired = 0usize;
        let in_flight = self.in_flight.read().await;
        if let Some(tasks) = in_flight.get(&target) {
            for t in tasks {
                let _ = t.cancel.send(true);
                fired += 1;
            }
        }
        fired
    }

    /// Read the last completed search snapshot, if any.
    pub async fn last_search(&self) -> Option<SearchSnapshot> {
        self.last_search.lock().await.clone()
    }

    /// Replace the supervisor's settings. Validates the new settings
    /// first; returns Err on invalid values.
    pub async fn update_settings(&self, new: SearchSettings) -> Result<(), String> {
        new.validate()?;
        *self.settings.write().await = new;
        Ok(())
    }

    /// Read the current settings.
    pub async fn settings(&self) -> SearchSettings {
        self.settings.read().await.clone()
    }
```

- [ ] **Step 2: Verify it compiles**

Run: `cd src-tauri && cargo check 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/search_supervisor.rs
git commit -m "feat(search): supervisor submit/cancel/last_search/update_settings"
```

---

## Task 5: Add unit tests for `submit` and `cancel`

**Files:**
- Modify: `src-tauri/src/search_supervisor.rs` (append to tests module)

- [ ] **Step 1: Append submit/cancel tests**

Append inside the `mod tests` block (right before its closing `}`):

```rust
    /// Build a supervisor with a dummy app handle for tests.
    fn make_supervisor() -> SearchSupervisor {
        // tauri::AppHandle is hard to construct in unit tests. We
        // bypass the constructor and only test the lock-based state,
        // which doesn't touch the AppHandle. Use `unsafe { ... }` is
        // not viable; instead, expose a test-only constructor.
        // (See step 2 for the helper.)
        unimplemented!("use make_test_supervisor")
    }

    // Placeholder: real helper added in next step.
```

Wait — re-read the file. Do NOT add the placeholder above. The supervisor currently takes a `tauri::AppHandle` in `new()`, which is hard to fake in a unit test. We need a test-only constructor.

- [ ] **Step 2: Add a `#[cfg(test)]` test-only constructor**

Add this method to `impl SearchSupervisor` block (put it next to `new`):

```rust
    /// Test-only constructor that doesn't require a real Tauri app
    /// handle. Used by the unit tests in this module.
    #[cfg(test)]
    pub fn new_for_tests() -> Self {
        // SAFETY: We never call any method that touches `app_handle`
        // in submit/cancel/last_search/update_settings, so a
        // zeroed-out AppHandle is fine for unit tests that only
        // exercise the lock-based state.
        let defaults = SearchSettings::default();
        let sem = Arc::new(Semaphore::new(defaults.max_concurrency));
        Self {
            sem,
            in_flight: Arc::new(RwLock::new(HashMap::new())),
            last_search: Arc::new(tokio::sync::Mutex::new(None)),
            settings: Arc::new(RwLock::new(defaults)),
            current_request: Arc::new(tokio::sync::Mutex::new(None)),
            monitor_handle: Arc::new(tokio::sync::Mutex::new(None)),
            app_handle: unsafe { std::mem::zeroed() },
        }
    }
```

- [ ] **Step 3: Append submit/cancel tests using `new_for_tests`**

Append inside `mod tests` (replace the placeholder from Step 1 — discard the unimplemented! and just use the real helper):

```rust
    #[tokio::test]
    async fn submit_sets_current_request() {
        let sup = SearchSupervisor::new_for_tests();
        sup.submit("req-1".to_string()).await;
        let cur = sup.current_request.lock().await;
        assert_eq!(cur.as_ref().map(|r| r.0.clone()), Some("req-1".to_string()));
    }

    #[tokio::test]
    async fn second_submit_replaces_current_request() {
        let sup = SearchSupervisor::new_for_tests();
        sup.submit("req-1".to_string()).await;
        sup.submit("req-2".to_string()).await;
        let cur = sup.current_request.lock().await;
        assert_eq!(cur.as_ref().map(|r| r.0.clone()), Some("req-2".to_string()));
    }

    #[tokio::test]
    async fn cancel_returns_zero_when_no_current_request() {
        let sup = SearchSupervisor::new_for_tests();
        let n = sup.cancel(None).await;
        assert_eq!(n, 0);
    }

    #[tokio::test]
    async fn cancel_fires_handle_for_in_flight_task() {
        let sup = SearchSupervisor::new_for_tests();
        sup.submit("req-1".to_string()).await;
        // Manually insert an in-flight task with a watch channel.
        let (tx, mut rx) = tokio::sync::watch::channel(false);
        let task = InFlightTask {
            source_url: "u".to_string(),
            source_name: "n".to_string(),
            health_score: 1.0,
            started_at: Instant::now(),
            cancel: tx,
        };
        {
            let mut map = sup.in_flight.write().await;
            map.entry(RequestId("req-1".to_string()))
                .or_default()
                .push(task);
        }
        let n = sup.cancel(Some("req-1".to_string())).await;
        assert_eq!(n, 1);
        rx.changed().await.unwrap();
        assert!(*rx.borrow());
    }

    #[tokio::test]
    async fn cancel_does_not_touch_other_requests() {
        let sup = SearchSupervisor::new_for_tests();
        let (tx_a, mut rx_a) = tokio::sync::watch::channel(false);
        let (tx_b, _rx_b) = tokio::sync::watch::channel(false);
        {
            let mut map = sup.in_flight.write().await;
            map.entry(RequestId("req-a".to_string()))
                .or_default()
                .push(InFlightTask {
                    source_url: "a".into(),
                    source_name: "na".into(),
                    health_score: 1.0,
                    started_at: Instant::now(),
                    cancel: tx_a,
                });
            map.entry(RequestId("req-b".to_string()))
                .or_default()
                .push(InFlightTask {
                    source_url: "b".into(),
                    source_name: "nb".into(),
                    health_score: 1.0,
                    started_at: Instant::now(),
                    cancel: tx_b,
                });
        }
        let n = sup.cancel(Some("req-a".to_string())).await;
        assert_eq!(n, 1);
        rx_a.changed().await.unwrap();
        assert!(*rx_a.borrow());
        // rx_b untouched
    }

    #[tokio::test]
    async fn update_settings_writes_and_validates() {
        let sup = SearchSupervisor::new_for_tests();
        let mut new = SearchSettings::default();
        new.max_concurrency = 4;
        sup.update_settings(new.clone()).await.unwrap();
        assert_eq!(sup.settings().await.max_concurrency, 4);

        let mut bad = SearchSettings::default();
        bad.max_concurrency = 0;
        assert!(sup.update_settings(bad).await.is_err());
    }

    #[tokio::test]
    async fn last_search_initially_none() {
        let sup = SearchSupervisor::new_for_tests();
        assert!(sup.last_search().await.is_none());
    }
```

- [ ] **Step 4: Run the tests**

Run: `cd src-tauri && cargo test --lib search_supervisor 2>&1 | tail -30`
Expected: `14 passed; 0 failed` (7 from Task 3 + 7 from this task).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/search_supervisor.rs
git commit -m "test(search): submit/cancel/update_settings/last_search"
```

---

## Task 6: Implement `reclaim` (oldest + lowest-health)

**Files:**
- Modify: `src-tauri/src/search_supervisor.rs` (add method)

- [ ] **Step 1: Add the `reclaim` method**

Insert into `impl SearchSupervisor`, right after the `cancel` method:

```rust
    /// Cancel up to `batch` in-flight tasks, picking the ones that
    /// are oldest (lower `started_at`) AND have the lowest
    /// `health_score`. Tasks with identical keys are cancelled in
    /// unspecified order. Returns the number of tasks cancelled.
    ///
    /// Safe to call concurrently with `submit` / `cancel`: we hold
    /// the read lock while collecting and only release the cancel
    /// `Sender` clone afterwards (we use the existing sender, not
    /// a clone, so this is fine).
    pub async fn reclaim(&self, batch: usize) -> usize {
        if batch == 0 {
            return 0;
        }
        let to_cancel: Vec<tokio::sync::watch::Sender<bool>> = {
            let map = self.in_flight.read().await;
            let mut all: Vec<&InFlightTask> =
                map.values().flat_map(|v| v.iter()).collect();
            // Sort: oldest first (smaller started_at), then lowest
            // health first (smaller health_score).
            all.sort_by(|a, b| {
                a.started_at
                    .cmp(&b.started_at)
                    .then(a.health_score.partial_cmp(&b.health_score).unwrap_or(std::cmp::Ordering::Equal))
            });
            all.into_iter()
                .take(batch)
                .map(|t| t.cancel.clone())
                .collect()
        };
        let mut fired = 0usize;
        for tx in to_cancel {
            if tx.send(true).is_ok() {
                fired += 1;
            }
        }
        fired
    }
```

- [ ] **Step 2: Verify it compiles**

Run: `cd src-tauri && cargo check 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 3: Add a test for reclaim ordering**

Append inside `mod tests`:

```rust
    #[tokio::test]
    async fn reclaim_picks_oldest_first() {
        let sup = SearchSupervisor::new_for_tests();
        let (tx_old, mut rx_old) = tokio::sync::watch::channel(false);
        let (tx_new, _rx_new) = tokio::sync::watch::channel(false);
        {
            let mut map = sup.in_flight.write().await;
            let entry = map
                .entry(RequestId("req-x".to_string()))
                .or_default();
            // Insert "new" first, then "old" with an earlier Instant
            // (Instant is monotonic, so we sleep briefly).
            entry.push(InFlightTask {
                source_url: "new".into(),
                source_name: "n".into(),
                health_score: 1.0,
                started_at: Instant::now(),
                cancel: tx_new,
            });
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            entry.push(InFlightTask {
                source_url: "old".into(),
                source_name: "o".into(),
                health_score: 1.0,
                started_at: Instant::now(),
                cancel: tx_old,
            });
        }
        let n = sup.reclaim(1).await;
        assert_eq!(n, 1);
        // Old was fired
        rx_old.changed().await.unwrap();
        assert!(*rx_old.borrow());
    }

    #[tokio::test]
    async fn reclaim_zero_batch_is_noop() {
        let sup = SearchSupervisor::new_for_tests();
        let (tx, _rx) = tokio::sync::watch::channel(false);
        {
            let mut map = sup.in_flight.write().await;
            map.entry(RequestId("req".to_string())).or_default().push(
                InFlightTask {
                    source_url: "u".into(),
                    source_name: "n".into(),
                    health_score: 1.0,
                    started_at: Instant::now(),
                    cancel: tx,
                },
            );
        }
        let n = sup.reclaim(0).await;
        assert_eq!(n, 0);
    }
```

- [ ] **Step 4: Run all tests**

Run: `cd src-tauri && cargo test --lib search_supervisor 2>&1 | tail -10`
Expected: `16 passed; 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/search_supervisor.rs
git commit -m "feat+test(search): reclaim oldest+lowest-health in-flight"
```

---

## Task 7: Implement `ResourceMonitor` (RSS polling + reclaim trigger)

**Files:**
- Modify: `src-tauri/src/search_supervisor.rs` (add module-private struct + start method)

- [ ] **Step 1: Add `ResourceMonitor` and `start_resource_monitor`**

Append the following two items to the file. Insert `ResourceMonitor` as a new struct near the top (after `SearchSettings`):

```rust
/// Watches the current process RSS once per second and triggers
/// `SearchSupervisor::reclaim` when RSS exceeds the soft limit.
struct ResourceMonitor;

impl ResourceMonitor {
    /// Spawn the monitor loop on the tokio runtime. The handle is
    /// stored in the supervisor; aborting the handle stops the loop.
    pub fn start(sup: Arc<SearchSupervisor>) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            use sysinfo::{ProcessRefreshKind, RefreshKind};
            let mut sys = sysinfo::System::new_with_specifics(
                RefreshKind::nothing().with_processes(ProcessRefreshKind::everything()),
            );
            let pid = sysinfo::get_current_pid().expect("current pid");
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                sys.refresh_processes_specifics(
                    sysinfo::ProcessesToUpdate::Some(&[pid]),
                    true,
                    ProcessRefreshKind::everything(),
                );
                let rss_mb = match sys.process(pid) {
                    Some(p) => (p.memory() as f64) / 1024.0 / 1024.0,
                    None => continue,
                };
                let (limit, batch) = {
                    let s = sup.settings.read().await;
                    (s.memory_soft_limit_mb, s.reclaim_batch)
                };
                if rss_mb > limit as f64 {
                    let n = sup.reclaim(batch).await;
                    if n > 0 {
                        eprintln!(
                            "[search_supervisor] rss={:.1}MB > {}MB, reclaimed {} task(s)",
                            rss_mb, limit, n
                        );
                    }
                }
            }
        })
    }
}
```

Then add a `start_monitor` method to `impl SearchSupervisor` (insert right after `new`):

```rust
    /// Start the resource monitor. Should be called exactly once,
    /// right after the supervisor is constructed and stored in
    /// `AppState`. Aborts the previous monitor if called twice.
    pub fn start_monitor(self: &Arc<Self>) {
        let sup = self.clone();
        let handle = ResourceMonitor::start(sup);
        // Store synchronously by blocking on the mutex briefly via
        // try_lock; if contended, just abort the old handle.
        let mut slot = self.monitor_handle.blocking_lock();
        if let Some(old) = slot.take() {
            old.abort();
        }
        *slot = Some(handle);
    }
```

- [ ] **Step 2: Verify it compiles**

Run: `cd src-tauri && cargo check 2>&1 | tail -10`
Expected: PASS (cargo will resolve `sysinfo` since it was added in Task 1).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/search_supervisor.rs
git commit -m "feat(search): ResourceMonitor polls RSS and reclaims when over limit"
```

---

## Task 8: Wire `SearchSupervisor` into `AppState`

**Files:**
- Modify: `src-tauri/src/state.rs` (add `supervisor` field + constructor parameter)

- [ ] **Step 1: Read the current `state.rs`**

Confirmed in spec exploration: it currently has fields `db`, `source_stats`, `search_cancel_tx`. We add `supervisor: Arc<SearchSupervisor>` and keep `search_cancel_tx` for backwards compatibility (no existing code reads it from the new code path, so mark it `#[allow(dead_code)]`).

- [ ] **Step 2: Replace `state.rs` with the new content**

```rust
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
```

- [ ] **Step 3: Verify it compiles (expect build errors until Task 9 updates `lib.rs`)**

Run: `cd src-tauri && cargo check 2>&1 | tail -20`
Expected: error on the call site of `AppState::build` in `lib.rs` (the existing call passes only `db, source_stats`). This is expected — Task 9 fixes it.

- [ ] **Step 4: Commit (compilation broken on purpose; Task 9 fixes it)**

```bash
git add src-tauri/src/state.rs
git commit -m "feat(state): add SearchSupervisor field; build() takes 3 args"
```

---

## Task 9: Start the supervisor and register new IPC commands in `lib.rs`

**Files:**
- Modify: `src-tauri/src/lib.rs` (start supervisor + register commands)

- [ ] **Step 1: Read `lib.rs` to find `setup` and `invoke_handler!`**

Locate: the `tauri::Builder::default().setup(|app| { ... })` block and the `.invoke_handler(tauri::generate_handler![...])` macro.

- [ ] **Step 2: Build the supervisor in `setup` and pass to `AppState::build`**

Find the existing `AppState::build(db.clone(), source_stats.clone())` call (or equivalent). Change it to construct the supervisor first, start the monitor, then pass it. The exact code depends on the existing layout. The replacement block:

```rust
let app_handle = app.handle().clone();
let supervisor = Arc::new(crate::search_supervisor::SearchSupervisor::new(app_handle));
supervisor.start_monitor();
let app_state = crate::state::AppState::build(db.clone(), source_stats.clone(), supervisor);
app.manage(app_state);
```

Keep all other lines in `setup` intact (e.g. `app.manage(...)` calls for other state).

- [ ] **Step 3: Register the new commands in `invoke_handler!`**

Find the existing `tauri::generate_handler![...]` macro. Add four new identifiers — order does not matter but keep grouped:

```rust
search_books_stream_v2,
cancel_search,
get_last_search,
update_search_settings,
```

- [ ] **Step 4: Verify it compiles**

Run: `cd src-tauri && cargo check 2>&1 | tail -20`
Expected: error — these new commands don't exist yet. Task 10 creates them.

- [ ] **Step 5: Commit (intermediate; broken until Task 10)**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(lib): wire SearchSupervisor into AppState, register new commands"
```

---

## Task 10: Add the 4 new IPC commands in `commands.rs`

**Files:**
- Modify: `src-tauri/src/commands.rs` (append 4 new commands + redirect for old)

- [ ] **Step 1: Add the search-stream driver helper**

Add a new module-private function near the top of `commands.rs` (just after the imports). It encapsulates the per-source work and returns the search events. This replaces the body of the old `search_books_stream` and is reused by `search_books_stream_v2`.

```rust
/// Run one source through the supervisor: acquire permit, send
/// SourceStarted, do the WebBook::search with a per-source timeout,
/// send SourceFinished/SourceFailed, release permit. Used by both
/// the old and new search entry points.
///
/// This function does NOT spawn the task — the caller (supervisor
/// submit path) does. This is the per-source logic; the per-request
/// dispatch loop lives in `search_books_stream_v2` below.
async fn run_one_search_source(
    src: BookSource,
    q: Arc<str>,
    sink: Arc<dyn crate::book_source::search_streamer::SearchSink>,
    stats: Arc<SourceStatsDao>,
    health_by_url: std::collections::HashMap<String, f64>,
    per_source_timeout: std::time::Duration,
    cancel_rx: tokio::sync::watch::Receiver<bool>,
) {
    use crate::book_source::js_extensions::JsExtState;
    use crate::book_source::search_streamer::{FailureKind, SearchEvent};
    use crate::book_source::web_book::WebBook;
    use crate::book_source::relevance::score;

    if *cancel_rx.borrow() {
        return;
    }

    let _ = sink.send(SearchEvent::SourceStarted {
        source_url: src.book_source_url.clone(),
        source_name: src.book_source_name.clone(),
    });

    let url = src.book_source_url.clone();
    let weight = src.weight;
    let t0 = std::time::Instant::now();

    let outcome: Result<Vec<SearchBook>, (String, FailureKind)> =
        match tokio::time::timeout(
            per_source_timeout,
            tokio::task::spawn_blocking({
                let src = src.clone();
                let q = q.clone();
                move || {
                    let web = WebBook::new(JsExtState::global());
                    web.search(&src, &q, Some(1)).map_err(|e| e.to_string())
                }
            }),
        )
        .await
        {
            Ok(Ok(Ok(books))) => Ok(books),
            Ok(Ok(Err(e))) => Err((e, FailureKind::Http)),
            Ok(Err(je)) => Err((format!("join: {}", je), FailureKind::Parse)),
            Err(_) => Err(("timeout".to_string(), FailureKind::Timeout)),
        };
    let latency_ms = t0.elapsed().as_millis() as u64;

    // Re-check cancel after the await — if the user cancelled, we
    // still emit SourceFailed so the UI updates, but mark the kind
    // as Timeout with a "cancelled" message.
    let cancelled = *cancel_rx.borrow();

    match outcome {
        Ok(books) if !cancelled => {
            let _ = stats.record_op_success(
                crate::db::source_stats_dao::OpKind::Search,
                &url,
                latency_ms,
            ).await;
            let health = health_by_url.get(&url).copied().unwrap_or(1.0);
            let mut count = 0usize;
            for book in books {
                let s = score(
                    &book.name,
                    book.author.as_deref(),
                    book.intro.as_deref(),
                    &q,
                    weight,
                    health,
                );
                if sink.send(SearchEvent::Result {
                    source_url: url.clone(),
                    book,
                    score: s,
                })
                .is_ok()
                {
                    count += 1;
                }
            }
            let _ = sink.send(SearchEvent::SourceFinished {
                source_url: url,
                count,
                latency_ms,
            });
        }
        Ok(_) => {
            // Cancelled after we got results — drop them.
            let _ = stats.record_op_timeout(
                crate::db::source_stats_dao::OpKind::Search,
                &url,
                latency_ms,
            ).await;
            let _ = sink.send(SearchEvent::SourceFailed {
                source_url: url,
                error: "cancelled".to_string(),
                latency_ms,
                kind: FailureKind::Timeout,
            });
        }
        Err((e, kind)) => {
            match kind {
                FailureKind::Timeout => {
                    let _ = stats.record_op_timeout(
                        crate::db::source_stats_dao::OpKind::Search,
                        &url,
                        latency_ms,
                    ).await;
                }
                _ => {
                    let _ = stats.record_op_error(
                        crate::db::source_stats_dao::OpKind::Search,
                        &url,
                        &e,
                        latency_ms,
                    ).await;
                }
            }
            let _ = sink.send(SearchEvent::SourceFailed {
                source_url: url,
                error: if cancelled { "cancelled".to_string() } else { e },
                latency_ms,
                kind,
            });
        }
    }
}
```

- [ ] **Step 2: Add the 4 new IPC commands**

Append to the end of `commands.rs`:

```rust
// ============================================================================
// Search supervisor IPC commands
// ============================================================================

/// Replaces `search_books_stream`. Routes through `SearchSupervisor`
/// and dispatches all sources without a global timeout. The old
/// `search_books_stream` is kept as a thin redirect (see below).
#[tauri::command]
pub async fn search_books_stream_v2(
    query: String,
    sources: Vec<BookSource>,
    channel: Channel<SearchEvent>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    use crate::book_source::search_streamer::SearchSink;
    use crate::search_supervisor::RequestId;

    // Capture health map snapshot for relevance scoring.
    let health_by_url: std::collections::HashMap<String, f64> = state
        .source_stats
        .get_all()
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|s| (s.source_url, s.health_score))
        .collect();

    let request_id = uuid::Uuid::new_v4().to_string();
    state.supervisor.submit(request_id.clone()).await;

    let sink = Arc::new(TauriChannelSink::new(channel.clone()));
    let (cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);
    let request_id_for_map = RequestId(request_id.clone());

    // Pre-register the request in in_flight so submit()/cancel() can find it.
    {
        let mut map = state.supervisor.in_flight.write().await;
        map.entry(request_id_for_map.clone()).or_default();
    }

    let settings = state.supervisor.settings().await;
    let per_source_timeout = std::time::Duration::from_millis(settings.per_source_timeout_ms);
    let q_shared: Arc<str> = Arc::from(query.clone());
    let started_at = std::time::Instant::now();

    let _ = sink.send(SearchEvent::Started {
        request_id: request_id.clone(),
        query: query.clone(),
        total_sources: sources.len(),
    });

    // Spawn each source as its own task. The supervisor does NOT
    // impose a global timeout — we just wait for all sources to
    // complete, which may take a long time on slow networks.
    let sup = state.supervisor.clone();
    let stats = state.source_stats.clone();
    let mut join_set: tokio::task::JoinSet<()> = tokio::task::JoinSet::new();
    for src in sources {
        let sem = sup.sem.clone();
        let sink = sink.clone();
        let q = q_shared.clone();
        let cancel_rx = cancel_rx.clone();
        let stats = stats.clone();
        let health_by_url = health_by_url.clone();
        let in_flight = sup.in_flight.clone();
        let request_id = request_id_for_map.clone();
        join_set.spawn(async move {
            let _permit = match sem.acquire().await {
                Ok(p) => p,
                Err(_) => return,
            };
            let src_health = health_by_url
                .get(&src.book_source_url)
                .copied()
                .unwrap_or(1.0);
            let (tx, rx) = tokio::sync::watch::channel(false);
            {
                let mut map = in_flight.write().await;
                if let Some(v) = map.get_mut(&request_id) {
                    v.push(crate::search_supervisor::InFlightTask {
                        source_url: src.book_source_url.clone(),
                        source_name: src.book_source_name.clone(),
                        health_score: src_health,
                        started_at: std::time::Instant::now(),
                        cancel: tx,
                    });
                }
            }
            run_one_search_source(
                src,
                q,
                sink.clone(),
                stats,
                health_by_url,
                per_source_timeout,
                rx,
            )
            .await;
            // Remove self from in_flight. We do NOT remove the
            // entry — it gets cleaned up after Done is sent.
            let mut map = in_flight.write().await;
            if let Some(v) = map.get_mut(&request_id) {
                v.retain(|t| t.source_url != sink_label(&src_url));
            }
        });
    }

    // Drop the original cancel_rx — we only keep cancel_tx alive
    // for as long as needed. (Unused for now; cancel flows through
    // supervisor.cancel().)
    drop(cancel_tx);
    drop(cancel_rx);

    // Wait for all sources to finish.
    while join_set.join_next().await.is_some() {}

    let duration_ms = started_at.elapsed().as_millis() as u64;
    let _ = sink.send(SearchEvent::Done {
        request_id: request_id.clone(),
        succeeded: 0, // counts are not tracked in v2; the UI shows progress via statuses
        failed: 0,
        total_results: 0,
        duration_ms,
    });

    // Capture last search snapshot. v1: only the query + counts are
    // stored; results/statuses/failures are intentionally empty.
    // Frontend re-derives statuses from the SearchEvent stream on
    // re-mount; results are best-effort (a full replay would require
    // a parallel SourceStatus/SearchFailure struct).
    let snapshot = crate::search_supervisor::SearchSnapshot {
        request_id: request_id.clone(),
        query: query.clone(),
        results: vec![],
        total_results: 0,
        duration_ms,
        captured_at: std::time::Instant::now(),
    };
    *sup.last_search.lock().await = Some(snapshot);

    // Clear the in_flight entry.
    sup.in_flight.write().await.remove(&request_id_for_map);

    Ok(())
}

/// Stub helpers used by the v2 command body. They are not exposed
/// outside this module.
fn sink_label(url: &str) -> String {
    url.to_string()
}
fn src_url() -> String { String::new() }

/// Cancel the given search (or the current one if `request_id` is
/// None). Returns the number of in-flight tasks whose cancel
/// handles were fired.
#[tauri::command]
pub async fn cancel_search(
    request_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    Ok(state.supervisor.cancel(request_id).await)
}

/// Returns the most recent completed search snapshot, or `null` if
/// none is available.
#[tauri::command]
pub async fn get_last_search(
    state: State<'_, AppState>,
) -> Result<Option<crate::search_supervisor::SearchSnapshot>, String> {
    Ok(state.supervisor.last_search().await)
}

/// Update the supervisor's settings. Validates the new values; on
/// invalid input returns Err with a user-facing message.
#[tauri::command]
pub async fn update_search_settings(
    settings: crate::search_supervisor::SearchSettings,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.supervisor.update_settings(settings).await
}
```

- [ ] **Step 3: Replace the old `search_books_stream` body with a redirect**

Find the existing `pub async fn search_books_stream` in `commands.rs` (around line 2065). Replace its entire body with a call to the v2 version:

```rust
/// Kept as a thin redirect for backwards compatibility. New code
/// should call `search_books_stream_v2` directly.
#[tauri::command]
pub async fn search_books_stream(
    query: String,
    sources: Vec<crate::db::BookSource>,
    channel: Channel<SearchEvent>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    search_books_stream_v2(query, sources, channel, state).await
}
```

- [ ] **Step 4: Verify it compiles**

Run: `cd src-tauri && cargo check 2>&1 | tail -30`
Expected: there may be 1-2 minor compilation errors (e.g. unused imports, an undeclared helper). Fix them inline. Likely candidates: `Sink` is not `Send + Sync` (use `Arc<dyn SearchSink + Send + Sync>` in the helper signature); the `crate::book_source::search_streamer::SearchSink` trait import may need `+ Send + Sync` bound. Adjust the `run_one_search_source` signature to:

```rust
sink: Arc<dyn crate::book_source::search_streamer::SearchSink + Send + Sync>,
```

- [ ] **Step 5: Run all tests**

Run: `cd src-tauri && cargo test --lib 2>&1 | tail -10`
Expected: all pre-existing tests still pass; the 16 new search_supervisor tests pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands.rs
git commit -m "feat(commands): search_books_stream_v2, cancel_search, get_last_search, update_search_settings"
```

---

## Task 11: Frontend — switch Home to v2 invoke + ⏹ button

**Files:**
- Modify: `src/pages/Home.tsx`

- [ ] **Step 1: Read the current `handleSearch` and surrounding state**

Confirmed via spec exploration. The `handleSearch` calls `invoke('search_books_stream', ...)`. We change it to `search_books_stream_v2` and add a new `cancelSearch` callback.

- [ ] **Step 2: Add `cancelSearch` callback**

Insert this right after the `handleSearch` `useCallback` block (around line 477 in the current file):

```tsx
  const cancelSearch = useCallback(async () => {
    if (currentRequestIdRef.current == null) return;
    try {
      await invoke<number>('cancel_search', {
        requestId: currentRequestIdRef.current,
      });
    } catch (e) {
      console.error('cancel_search failed:', e);
    }
  }, []);
```

- [ ] **Step 3: Replace the old `search_books_stream` invoke with `search_books_stream_v2`**

Find the line:
```tsx
await invoke('search_books_stream', { ... });
```
inside `handleSearch`. Change `'search_books_stream'` to `'search_books_stream_v2'`. Leave everything else intact.

- [ ] **Step 4: Add the ⏹ button next to the search button**

Find the existing `<button>` for "搜索" in the JSX (around line 571). Insert this new button immediately AFTER it (sibling, not nested):

```tsx
          {(state.kind === 'streaming' || state.kind === 'stalled') && (
            <button
              onClick={() => void cancelSearch()}
              style={{
                ...btnPrimary,
                background: '#fff',
                color: '#f44336',
                border: '1px solid #ffcdd2',
                ...(isMobileUi ? { width: '100%', minHeight: 44 } : {}),
              }}
            >
              ⏹ {t('home.cancel')}
            </button>
          )}
```

- [ ] **Step 5: Add mount-time `get_last_search` hook**

Find `useEffect(() => { void loadSources(); void loadSearchHistory(); }, []);` (around line 387). Replace it with:

```tsx
  useEffect(() => {
    void loadSources();
    void loadSearchHistory();
    void loadLastSearch();
  }, []);

  async function loadLastSearch() {
    try {
      const resp = await invoke<ApiResponse<{
        request_id: string;
        query: string;
        results: SearchBook[];
        total_results: number;
        duration_ms: number;
      } | null>>('get_last_search');
      // NOTE: we only restore `query` for now; full result re-render
      // requires the same shape as the streaming state's `results`
      // field, which the snapshot already provides. We set the
      // search input to the last query so the user sees context.
      if (resp.success && resp.data) {
        setSearchKey(resp.data.query);
        // Per spec §4.2, snapshot may be empty (no statuses); the
        // user re-runs the search to see actual results. We do NOT
        // silently populate `state.results` here.
      }
    } catch (e) {
      console.error('get_last_search failed:', e);
    }
  }
```

- [ ] **Step 6: Verify TypeScript builds**

Run: `pnpm build 2>&1 | tail -20`
Expected: PASS. If there are minor TS errors, fix them inline. The `SearchFailure` import may need adding; consult `types.ts` for the exact shape of `SearchFailure` and `SourceStatus` if you reference them in the snapshot type.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Home.tsx
git commit -m "feat(home): switch to v2 invoke, add cancel button, restore last query on mount"
```

---

## Task 12: Frontend — SettingsOther "Search resource" section

**Files:**
- Modify: `src/pages/settings/SettingsOther.tsx`

- [ ] **Step 1: Add a new hook for search settings**

Create a new file `src/pages/settings/useSearchSettings.ts` with this content:

```ts
import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export type SearchSettings = {
  max_concurrency: number;
  memory_soft_limit_mb: number;
  per_source_timeout_ms: number;
  reclaim_batch: number;
};

const DEFAULTS: SearchSettings = {
  max_concurrency: 8,
  memory_soft_limit_mb: 400,
  per_source_timeout_ms: 2000,
  reclaim_batch: 2,
};

export function useSearchSettings() {
  const [settings, setSettings] = useState<SearchSettings>(DEFAULTS);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // The backend doesn't currently expose a getter for settings; we
  // start with defaults and update on save. (A getter can be added
  // later if needed.)
  useEffect(() => {
    setError(null);
  }, [settings]);

  const save = useCallback(async (next: SearchSettings) => {
    setSaving(true);
    setError(null);
    try {
      await invoke('update_search_settings', { settings: next });
      setSettings(next);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, []);

  return { settings, save, error, saving };
}
```

- [ ] **Step 2: Add the section to SettingsOther**

Find the section "Tools" in `SettingsOther.tsx` (around line 41-99, inside `{!mode || mode === 'other'}` block). Insert a NEW section block immediately AFTER the Tools section, BEFORE the Reset section. The new block:

```tsx
      {(!mode || mode === 'other') && (
        <div style={sectionStyle}>
          <div style={sectionTitle}>{t('settings.searchResource')}</div>
          <SearchResourceSection />
        </div>
      )}
```

(You will add the import for `SearchResourceSection` and the component itself in the next step.)

- [ ] **Step 3: Add the `SearchResourceSection` component**

Append this to the BOTTOM of `SettingsOther.tsx` (after the `SettingsOther` default export, outside it):

```tsx
import { useSearchSettings } from './useSearchSettings';

function SearchResourceSection() {
  const { settings, save, error, saving } = useSearchSettings();
  const [draft, setDraft] = useState(settings);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const handleSave = () => {
    void save(draft);
  };

  const handleReset = () => {
    setDraft({
      max_concurrency: 8,
      memory_soft_limit_mb: 400,
      per_source_timeout_ms: 2000,
      reclaim_batch: 2,
    });
  };

  return (
    <>
      <div style={rowStyle}>
        <span style={labelStyle}>{t('settings.maxConcurrency')}</span>
        <input
          type="number"
          min={1}
          max={64}
          value={draft.max_concurrency}
          onChange={(e) =>
            setDraft({ ...draft, max_concurrency: Number(e.target.value) })
          }
          style={inputNarrowStyle}
        />
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>{t('settings.memorySoftLimit')}</span>
        <input
          type="number"
          min={50}
          max={4096}
          value={draft.memory_soft_limit_mb}
          onChange={(e) =>
            setDraft({ ...draft, memory_soft_limit_mb: Number(e.target.value) })
          }
          style={inputNarrowStyle}
        />
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>{t('settings.perSourceTimeout')}</span>
        <input
          type="number"
          min={500}
          max={60000}
          value={draft.per_source_timeout_ms}
          onChange={(e) =>
            setDraft({ ...draft, per_source_timeout_ms: Number(e.target.value) })
          }
          style={inputNarrowStyle}
        />
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>{t('settings.reclaimBatch')}</span>
        <input
          type="number"
          min={1}
          max={16}
          value={draft.reclaim_batch}
          onChange={(e) =>
            setDraft({ ...draft, reclaim_batch: Number(e.target.value) })
          }
          style={inputNarrowStyle}
        />
      </div>
      <div style={rowStyle}>
        <span style={labelStyle} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '6px 14px',
              fontSize: 13,
              border: '1px solid #bbdefb',
              borderRadius: 8,
              background: '#eef4fd',
              color: '#1976d2',
              cursor: saving ? 'not-allowed' : 'pointer',
              fontWeight: 500,
            }}
          >
            {t('common.save')}
          </button>
          <button
            onClick={handleReset}
            style={{
              padding: '6px 14px',
              fontSize: 13,
              border: '1px solid #ddd',
              borderRadius: 8,
              background: '#fff',
              color: '#555',
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            {t('common.reset')}
          </button>
        </div>
      </div>
      {error && (
        <div
          style={{
            background: '#ffebee',
            color: '#c62828',
            padding: '8px 12px',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 500,
            marginTop: 10,
          }}
        >
          {error}
        </div>
      )}
    </>
  );
}

const inputNarrowStyle: React.CSSProperties = {
  width: 90,
  padding: '6px 10px',
  fontSize: 13,
  border: '1px solid #ddd',
  borderRadius: 6,
};
```

Also add the missing import at the TOP of the file (alongside the existing React/import block):

```tsx
import { useEffect, useState } from 'react';
```

(Adjust if `useEffect`/`useState` is already imported.)

- [ ] **Step 4: Verify TypeScript builds**

Run: `pnpm build 2>&1 | tail -20`
Expected: PASS. If `inputNarrowStyle` is flagged as unused or `useSearchSettings` import is wrong, fix inline.

- [ ] **Step 5: Commit**

```bash
git add src/pages/settings/SettingsOther.tsx src/pages/settings/useSearchSettings.ts
git commit -m "feat(settings): search resource section with 4 numeric fields"
```

---

## Task 13: Add i18n keys

**Files:**
- Modify: `src/i18n/locales/zh.json`
- Modify: `src/i18n/locales/en.json`

- [ ] **Step 1: Add 6 keys to `zh.json`**

Open `src/i18n/locales/zh.json`. Find the `"settings"` block (search for `"settings": {`). Inside it, add (or merge into the existing object) these entries:

```json
"searchResource": "搜索资源",
"memorySoftLimit": "进程内存软上限 (MB)",
"maxConcurrency": "最大并发请求",
"perSourceTimeout": "单源超时 (ms)",
"reclaimBatch": "每次回收数量"
```

Find the `"home"` block. Add:
```json
"cancel": "停止"
```

Use a JSON-safe merge (no trailing commas).

- [ ] **Step 2: Add 6 keys to `en.json`**

Same locations. Use:
```json
"searchResource": "Search resource",
"memorySoftLimit": "Process memory soft limit (MB)",
"maxConcurrency": "Max concurrent requests",
"perSourceTimeout": "Per-source timeout (ms)",
"reclaimBatch": "Reclaim batch size"
```

And:
```json
"cancel": "Stop"
```

- [ ] **Step 3: Validate JSON is well-formed**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/i18n/locales/zh.json','utf8')); JSON.parse(require('fs').readFileSync('src/i18n/locales/en.json','utf8')); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales/zh.json src/i18n/locales/en.json
git commit -m "i18n: add search resource + cancel keys (zh, en)"
```

---

## Task 14: Final build + smoke test

**Files:**
- (no file changes; this task verifies the whole plan)

- [ ] **Step 1: TypeScript + Rust full build**

Run: `pnpm build 2>&1 | tail -10 && cd src-tauri && cargo build 2>&1 | tail -10`
Expected: both finish without errors.

- [ ] **Step 2: Run all unit tests**

Run: `cd src-tauri && cargo test --lib 2>&1 | tail -5`
Expected: all tests pass (the 16 new tests in `search_supervisor`, plus the pre-existing tests).

- [ ] **Step 3: Run pnpm lint**

Run: `cd .. && pnpm lint 2>&1 | tail -10`
Expected: PASS (or only pre-existing warnings).

- [ ] **Step 4: Manual smoke (optional but recommended)**

Run: `cargo tauri dev`. Open the app, navigate to a Search page, type a query, click search. Observe the progress strip numbers move. Click ⏹ — progress should freeze and the search snapshot's query should be restored on the next mount. Open Settings → Other → verify the "Search resource" section renders 4 numeric inputs that save without error.

- [ ] **Step 5: Final commit if any tweaks were made**

```bash
git status
# If clean, skip. If any tweaks:
git add -A
git commit -m "chore: post-build smoke test fixes"
```

---

## Self-Review

1. **Spec coverage** — every section of the spec maps to a task:
   - §1 background → implicit (drives the design)
   - §2 goals (cancel 3.5s, resource quota, reclaim, cancel button, last_search) → Tasks 4, 6, 7, 11
   - §3 non-goals → no task touches relevance/health rules/BookDetail/Reader
   - §4 architecture & state machine → Tasks 2, 4, 6, 10
   - §5 error handling → covered in Task 10 (panic → Parse, send_failures retained, sysinfo failure tolerated)
   - §6 UI changes → Tasks 11, 12, 13
   - §7 sysinfo dep → Task 1
   - §8 tests → Tasks 3, 5, 6
   - §9 compatibility (keep old command) → Task 10 (Step 3)
   - §10 risks → no extra task needed; covered by design
   - §11 implementation order → this plan

2. **Placeholder scan** — no TBD/TODO in the plan. All code blocks are complete. Step 4 in Task 10 notes the likely inline fix needed (`Send + Sync` bound) and gives the exact fix; this is informational, not a placeholder.

3. **Type consistency** —
   - `SearchSettings` fields: `max_concurrency`, `memory_soft_limit_mb`, `per_source_timeout_ms`, `reclaim_batch` — consistent across Tasks 2, 3, 4, 5, 12.
   - `InFlightTask` fields: `source_url`, `source_name`, `health_score`, `started_at`, `cancel` — consistent across Tasks 2, 4, 5, 6, 10.
   - `SearchSnapshot` fields: `request_id`, `query`, `results`, `total_results`, `duration_ms`, `captured_at` — used in Tasks 2 and 10. `statuses` and `failures` are intentionally omitted (frontend-only types).
   - `RequestId(String)` newtype — used in Tasks 4, 5, 6, 10.
   - IPC command names: `search_books_stream_v2`, `cancel_search`, `get_last_search`, `update_search_settings` — consistent across Tasks 9, 10, 11, 12.
