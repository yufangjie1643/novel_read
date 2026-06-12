# P3 Implementation Plan — Finish the Async/Consistency Pass on the IPC Layer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drain the last 10% of the P0→P1→P2 IPC migration: convert 11 sync commands to async, replace 19 verbose `ApiResponse` literals with the existing `ok()`/`err()` helpers, and lock the target shape in with a source-grep regression test.

**Architecture:** All work is in `src-tauri/src/commands.rs` plus a new `src-tauri/tests/p3_command_shape.rs`. No new dependencies, no IPC protocol changes, no frontend changes. Four (or five, if T0.5 fires) small commits, each independently buildable and testable.

**Tech Stack:** Rust 1.x, deadpool, rusqlite, Tauri v2, tokio (already in tree). No new crates.

**Spec:** `docs/p3-spec.md` (already committed in `42b772921`).

**Current state:** 11 sync + 103 async = 114 `#[tauri::command]` functions in `src-tauri/src/commands.rs`. 19 of them still use the verbose `ApiResponse { success: …, data: …, error: … }` literal; the other 95 use the `ok()` / `err()` helpers at `src-tauri/src/commands.rs:97-111`. There is no automated test guarding this shape.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src-tauri/src/commands.rs` | Modify (in every commit) | 11 sync→async; 19 literals→helpers |
| `src-tauri/tests/p3_command_shape.rs` | Create (T3) | Source-grep regression: every command is async; every DB-touching command carries `app_handle` |
| `src-tauri/src/server.rs` | No change | Already takes `&AppPool` (P2-T10) |
| `src-tauri/src/local_book/mod.rs` | No change | Already takes `&Connection` (P2-T10) |
| `src-tauri/src/db/mod.rs` | No change | `Database` shim already gone (P2-T11) |
| Frontend (`src/`, `scripts/`, `tools/`) | No change | Protocol unchanged |
| `docs/p3-spec.md` | T4 closeout | Mark shipped, fill "What P3 changed" |

---

## Task 0 (PRE-T1): Confirm T0.5 contingency

**File:** none

Before starting T1, check whether the 4 `import_*_from_json` commands silently use the now-deleted `db()` accessor. If they do, T0.5 fires and adds a small db_op migration before T1.

- [ ] **Step 1: Run `cargo build` against current master**

Run:
```bash
cd D:\code\novel_read\src-tauri
cargo build 2>&1 | tee "$env:TEMP\build_pre_t1.txt"
```

Expected: 0 errors, 0 warnings (clean baseline inherited from P2).

- [ ] **Step 2: Grep for any `db()` reference that would compile in `commands.rs`**

Run:
```bash
cd D:\code\novel_read\src-tauri
Select-String -Path "src\commands.rs" -Pattern '\bdb\(\)'
```

Expected: 0 matches (the shim is gone). If matches appear, they are stale comments or string literals; investigate but do not panic.

- [ ] **Step 3: Grep the 4 import commands by name**

Run:
```bash
cd D:\code\novel_read\src-tauri
Select-String -Path "src\commands.rs" -Pattern 'import_source_from_json|import_rss_source_from_json|import_replace_rules_from_json|import_http_tts_from_json' -Context 0,15
```

Expected: each command body is a `match parse_*(json) { Ok(items) => ok(items), Err(e) => err(e) }` pattern that does NOT touch the DB. The JSON parser functions (`parse_source_json`, `parse_rss_sources_json`, `parse_replace_rules_json`, `parse_http_tts_json`) are pure — they return `Vec<X>` and the command returns it directly.

- [ ] **Step 4: Decide on T0.5**

If Step 2 returns 0 matches AND Step 3 confirms no DB writes, **T0.5 is not needed**. Skip to T1. (Most likely outcome.)

If a `db()` reference is found, T0.5 fires: stop, write a 1-paragraph incident note in `docs/p3-spec.md` "What P3 changed", and add T0.5 to this plan with: for each of the 4 commands, change the signature to `pub async fn import_x_from_json(app_handle: tauri::AppHandle, json: String) -> ApiResponse<Vec<X>>` and replace the parser call with `db_op(app_handle, move |conn| { … }).await`. Then re-run `cargo build`. ~20-line patch per command.

- [ ] **Step 5: No commit at Task 0**

This is a read-only investigation. No commit is made.

---

## Task 1: Convert 11 sync IPC commands to async

**Files:**
- Modify: `src-tauri/src/commands.rs` (one change per command, 11 spots)
- Test: `src-tauri/tests/p3_command_shape.rs` (built in T3, will fail until all 11 are converted)

The 11 commands and their target shapes are listed in `docs/p3-spec.md` § "The 11 commands to convert". The full list, in source order, with line numbers as of P2's `12da627c8`:

| # | Line | Current | Target |
|---:|---:|---|---|
| 1 | 1169 | `pub fn parse_source_links_from_html(html: String) -> ApiResponse<Vec<SourceLink>> { ok(parse_import_links(&html)) }` | `pub async fn parse_source_links_from_html(html: String) -> ApiResponse<Vec<SourceLink>> { ok(parse_import_links(&html)) }` |
| 2 | 1541 | `pub fn list_app_files(relative_path: Option<String>) -> ApiResponse<ManagedFileList> { … uses ok()/err() … }` | `pub async fn list_app_files(relative_path: Option<String>) -> ApiResponse<ManagedFileList> { … unchanged … }` |
| 3 | 1599 | `pub fn create_app_folder(relative_path: Option<String>, name: String) -> ApiResponse<()>` | `pub async fn create_app_folder(…same args…)` |
| 4 | 1618 | `pub fn delete_app_file(relative_path: String) -> ApiResponse<()>` | `pub async fn delete_app_file(…same args…)` |
| 5 | 2753 | `pub fn import_source_from_json(json: String) -> ApiResponse<Vec<BookSource>>` (verbose `ApiResponse` literal inside) | `pub async fn import_source_from_json(json: String) -> ApiResponse<Vec<BookSource>>` (literal stays; T2 will replace it) |
| 6 | 2777 | `pub fn import_rss_source_from_json(json: String) -> ApiResponse<Vec<RssSource>>` (already uses `ok()`/`err()`) | `pub async fn import_rss_source_from_json(…same args…)` |
| 7 | 2793 | `pub fn import_replace_rules_from_json(json: String) -> ApiResponse<Vec<ReplaceRule>>` (already uses helpers) | `pub async fn import_replace_rules_from_json(…same args…)` |
| 8 | 2809 | `pub fn import_http_tts_from_json(json: String) -> ApiResponse<Vec<HttpTTS>>` (already uses helpers) | `pub async fn import_http_tts_from_json(…same args…)` |
| 9 | 2821 | `pub fn start_web_server(app_handle: tauri::AppHandle, port: Option<u16>) -> ApiResponse<String>` (calls sync `server::start_server(pool, port)`) | `pub async fn start_web_server(app_handle: tauri::AppHandle, port: Option<u16>) -> ApiResponse<String>` — body wraps `server::start_server(pool, port)` in `tokio::task::spawn_blocking` |
| 10 | 2843 | `pub fn stop_web_server() -> ApiResponse<()>` (calls `server::stop_server()`) | `pub async fn stop_web_server() -> ApiResponse<()>` — body calls `server::stop_server()` directly (no DB) |
| 11 | 2853 | `pub fn get_web_server_status() -> ApiResponse<bool>` (calls `server::is_server_running()`) | `pub async fn get_web_server_status() -> ApiResponse<bool>` — body calls `server::is_server_running()` directly (no DB) |

- [ ] **Step 1: Convert `parse_source_links_from_html` (command 1)**

In `src-tauri/src/commands.rs` at line 1169, change `pub fn parse_source_links_from_html` to `pub async fn parse_source_links_from_html`. Body is one line (`ok(parse_import_links(&html))`) and does not change.

- [ ] **Step 2: Convert `list_app_files` (command 2)**

At line 1541, change `pub fn list_app_files` to `pub async fn list_app_files`. Body is unchanged (it uses `ok()` / `err()` already; no `await` is needed because everything is sync FS work).

- [ ] **Step 3: Convert `create_app_folder` (command 3)**

At line 1599, change `pub fn create_app_folder` to `pub async fn create_app_folder`. Body unchanged.

- [ ] **Step 4: Convert `delete_app_file` (command 4)**

At line 1618, change `pub fn delete_app_file` to `pub async fn delete_app_file`. Body unchanged.

- [ ] **Step 5: Convert `import_source_from_json` (command 5)**

At line 2753, change `pub fn import_source_from_json` to `pub async fn import_source_from_json`. Body unchanged (the verbose `ApiResponse { … }` literal is intentional left-over; T2 will replace it).

- [ ] **Step 6: Convert `import_rss_source_from_json` (command 6)**

At line 2777, change `pub fn import_rss_source_from_json` to `pub async fn import_rss_source_from_json`. Body unchanged.

- [ ] **Step 7: Convert `import_replace_rules_from_json` (command 7)**

At line 2793, change `pub fn import_replace_rules_from_json` to `pub async fn import_replace_rules_from_json`. Body unchanged.

- [ ] **Step 8: Convert `import_http_tts_from_json` (command 8)**

At line 2809, change `pub fn import_http_tts_from_json` to `pub async fn import_http_tts_from_json`. Body unchanged.

- [ ] **Step 9: Convert `start_web_server` (command 9)**

At line 2821, change `pub fn start_web_server` to `pub async fn start_web_server`. Body change:

Before:
```rust
let port = port.unwrap_or(1122);
let state = app_handle.state::<AppState>();
let pool = state.db.clone();
match server::start_server(pool, port) {
    Ok(addr) => ApiResponse { success: true, data: Some(addr), error: None },
    Err(e) => ApiResponse { success: false, data: None, error: Some(e) },
}
```

After:
```rust
let port = port.unwrap_or(1122);
let state = app_handle.state::<AppState>();
let pool = state.db.clone();
match tokio::task::spawn_blocking(move || server::start_server(pool, port))
    .await
{
    Ok(Ok(addr)) => ok(addr),
    Ok(Err(e)) => err(e),
    Err(e) => err(format!("Task failed: {}", e)),
}
```

(The verbose `ApiResponse { … }` literals here are also T2 candidates; T2 will replace them.)

- [ ] **Step 10: Convert `stop_web_server` (command 10)**

At line 2843, change `pub fn stop_web_server` to `pub async fn stop_web_server`. Body unchanged (`server::stop_server()` is sync but trivially fast — it sets an `AtomicBool` and possibly writes a TCP connect). If you want extra hygiene, wrap the call in `tokio::task::spawn_blocking`, but the original spec said "directly" because the work is microseconds and the listener thread is the heavy part. Do NOT wrap.

- [ ] **Step 11: Convert `get_web_server_status` (command 11)**

At line 2853, change `pub fn get_web_server_status` to `pub async fn get_web_server_status`. Body unchanged (`server::is_server_running()` is a single `AtomicBool::load`).

- [ ] **Step 12: Verify build**

Run:
```bash
cd D:\code\novel_read\src-tauri
cargo build 2>&1
```

Expected: `Finished` line, 0 errors, 0 warnings.

- [ ] **Step 13: Verify all existing tests pass**

Run:
```bash
cd D:\code\novel_read\src-tauri
cargo test --lib --test p0_pragmas_and_indices --test p1_app_state --test p2_pragmas_recycled --test p2_pool_stress 2>&1
```

Expected: 77 passed (66 lib + 3 P0 + 4 P1 + 2 P2 recycled + 2 P2 stress); 0 failed.

- [ ] **Step 14: Verify the sync count is now 0**

Run:
```bash
cd D:\code\novel_read\src-tauri
(Select-String -Path "src\commands.rs" -Pattern '^pub fn \w+' | Where-Object { (Select-String -Path "src\commands.rs" -Pattern '^#\[tauri::command\]' -Context 5,0) } ).Count
```

Easier sanity check:
```bash
cd D:\code\novel_read\src-tauri
$lines = Get-Content -LiteralPath "src\commands.rs"
$count = 0
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^pub fn \w+') {
        for ($k = $i - 1; $k -ge 0 -and $k -ge $i - 5; $k--) {
            if ($lines[$k] -match '^#\[tauri::command\]') { $count++; break }
            if ($lines[$k] -match '^pub (async )?fn ') { break }
        }
    }
}
"sync tauri commands: $count"
```

Expected: `sync tauri commands: 0`.

- [ ] **Step 15: Commit**

Run (PowerShell-safe backtick escape):
```bash
cd D:\code\novel_read
$body = "refactor(commands): convert 11 remaining sync IPC commands to async

The last 10 percent of the P0->P1->P2 migration. Eleven commands were
still pub fn:
  - parse_source_links_from_html   (pure parse, one-line body)
  - list_app_files                (FS only)
  - create_app_folder             (FS only)
  - delete_app_file               (FS only)
  - import_source_from_json       (pure JSON parse)
  - import_rss_source_from_json   (pure JSON parse)
  - import_replace_rules_from_json (pure JSON parse)
  - import_http_tts_from_json     (pure JSON parse)
  - start_web_server              (now wraps server::start_server in
                                   tokio::task::spawn_blocking; P2-T10
                                   already added app_handle plumbing)
  - stop_web_server               (calls sync server::stop_server, no DB)
  - get_web_server_status         (calls sync server::is_server_running,
                                   no DB)

None of these touch the DB; the 4 import_*_from_json are pure JSON parse
helpers that return Vec<X> via the ok()/err() envelope. T0.5 was therefore
not needed (verified by cargo build at Task 0, Step 1).

cargo build: 0 errors, 0 warnings.
cargo test --lib + 4 integration suites: 77 passed, 0 failed.
Sync #[tauri::command] count is now 0 (was 11).

P3-T1."
$body | Out-File -Encoding utf8 "$env:TEMP\commit_t1.txt"
git add src-tauri/src/commands.rs
git commit -F "$env:TEMP\commit_t1.txt"
```

Expected: one new commit on top of `42b772921`.

---

## Task 2: Replace 19 verbose `ApiResponse { … }` literals with `ok()` / `err()`

**Files:**
- Modify: `src-tauri/src/commands.rs`

`ok()` and `err()` already exist at `src-tauri/src/commands.rs:97-111`. This task is a mechanical, behavior-preserving replacement of the 19 remaining inline literals.

The 19 sites are scattered through the file. Find them all by:

```bash
cd D:\code\novel_read\src-tauri
Select-String -Path "src\commands.rs" -Pattern '^\s*ApiResponse \{' | ForEach-Object { "{0,4}: {1}" -f $_.LineNumber, $_.Line }
```

Expected: 19 hits (the count is approximate — T2 fixes whatever count is left after T1; if T1 reduced the count by converting one of the verbose ones via the start_web_server edit, the actual count may be 18 or 19).

Replacement patterns (apply line by line; do not regex the file):

Pattern A (success):
```rust
ApiResponse {
    success: true,
    data: Some(X),
    error: None,
}
```
→ `ok(X)` (if X is a single expression) or
```rust
ok(SomeType {
    field1: v1,
    field2: v2,
})
```
(if X is a struct literal that spans multiple lines; flatten the struct init onto one or more `ok(…)` args).

Pattern B (error):
```rust
ApiResponse {
    success: false,
    data: None,
    error: Some(e.to_string()),
}
```
→ `err(e.to_string())` (or `err(e)` if `e: impl Into<String>`)

Pattern C (early-return error inside a sync body):
```rust
return ApiResponse {
    success: false,
    data: None,
    error: Some("Invalid folder name".to_string()),
};
```
→ `return err("Invalid folder name");`

- [ ] **Step 1: Enumerate the 19 sites**

Run the `Select-String` above; record each (line, surrounding context) before editing.

- [ ] **Step 2: Replace site-by-site (Pattern A first)**

For each `ApiResponse { success: true, … }` literal, replace with the corresponding `ok(…)` call. After every 4-5 replacements, run `cargo build` to confirm zero errors. Do NOT batch all 19 into one giant edit.

- [ ] **Step 3: Replace site-by-site (Pattern B and C)**

Same drill for the error literals. Run `cargo build` after every batch.

- [ ] **Step 4: Final cargo build**

Run:
```bash
cd D:\code\novel_read\src-tauri
cargo build 2>&1
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 5: Final test pass**

Run:
```bash
cd D:\code\novel_read\src-tauri
cargo test --lib --test p0_pragmas_and_indices --test p1_app_state --test p2_pragmas_recycled --test p2_pool_stress 2>&1
```

Expected: 77 passed; 0 failed.

- [ ] **Step 6: Verify zero verbose literals remain**

Run:
```bash
cd D:\code\novel_read\src-tauri
Select-String -Path "src\commands.rs" -Pattern '^\s*ApiResponse \{'
```

Expected: 0 hits (or only the `pub struct ApiResponse` definition and the `ok()`/`err()` helper bodies, which do not start with `ApiResponse {` indented as `\s*`).

- [ ] **Step 7: Commit**

```bash
cd D:\code\novel_read
$body = "refactor(commands): replace verbose ApiResponse literals with ok()/err()

The ok() and err() helpers at src-tauri/src/commands.rs:97-111 were
already in place since P1; this commit drains the last N verbose
ApiResponse { success: ... } literals so the IPC layer is 100% on the
helper API. The replacement is behaviour-preserving (verified by
cargo build + full test suite).

P3-T2."
$body | Out-File -Encoding utf8 "$env:TEMP\commit_t2.txt"
git add src-tauri/src/commands.rs
git commit -F "$env:TEMP\commit_t2.txt"
```

Expected: one new commit on top of T1.

---

## Task 3: Add `tests/p3_command_shape.rs` regression test (TDD)

**Files:**
- Create: `src-tauri/tests/p3_command_shape.rs`

This task is genuinely TDD: write the test, run it (it will pass on the post-T1/T2 code), then commit. The test acts as a forward-looking regression guard, not a back-looking bug catcher.

- [ ] **Step 1: Create the test file**

Write `src-tauri/tests/p3_command_shape.rs`:

```rust
//! P3 regression: lock in the IPC command shape.
//!
//! The post-P2 / post-P3 invariant for every `#[tauri::command]` in
//! `src/commands.rs` is:
//!
//! 1. Every command is `pub async fn` (no sync hold-outs).
//! 2. Every command that touches the DB (i.e. its body contains
//!    `db_op(` or `state.db`) also declares
//!    `app_handle: tauri::AppHandle` in its signature.
//! 3. The total number of `#[tauri::command]` annotations equals a
//!    known constant (so a contributor adding a new command is forced
//!    to acknowledge it by updating the constant).
//!
//! This test is a textual scan; no syn / quote / proc-macro machinery.

use std::fs;
use std::path::PathBuf;

const COMMANDS_RS: &str = "src/commands.rs";
const EXPECTED_COMMAND_COUNT: usize = 114;

fn read_commands_rs() -> String {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let path = PathBuf::from(manifest_dir).join(COMMANDS_RS);
    fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("failed to read {}: {e}", path.display()))
}

/// Find every `#[tauri::command]` in the source, return the (line_number, signature_line)
/// of the first non-doc, non-blank line after it.
fn find_commands(src: &str) -> Vec<(usize, String)> {
    let lines: Vec<&str> = src.lines().collect();
    let mut out = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        if line.trim() == "#[tauri::command]" {
            for next in &lines[i + 1..] {
                let t = next.trim();
                if t.is_empty() || t.starts_with("//") { continue; }
                out.push((i + 1, next.to_string()));
                break;
            }
        }
    }
    out
}

#[test]
fn every_tauri_command_is_async() {
    let src = read_commands_rs();
    let mut offenders = Vec::new();
    for (line, sig) in find_commands(&src) {
        if sig.trim_start().starts_with("pub fn ") {
            offenders.push((line, sig));
        }
    }
    assert!(
        offenders.is_empty(),
        "Found {} sync #[tauri::command]s (must all be `pub async fn`):\n  {:#?}",
        offenders.len(),
        offenders,
    );
}

#[test]
fn total_command_count_is_expected() {
    let src = read_commands_rs();
    let count = src
        .lines()
        .filter(|l| l.trim() == "#[tauri::command]")
        .count();
    assert_eq!(
        count, EXPECTED_COMMAND_COUNT,
        "Command count drifted from {EXPECTED_COMMAND_COUNT} to {count}. \
         If you intentionally added or removed a command, update \
         EXPECTED_COMMAND_COUNT in tests/p3_command_shape.rs.",
    );
}

#[test]
fn every_db_touching_command_takes_app_handle() {
    let src = read_commands_rs();
    let lines: Vec<&str> = src.lines().collect();
    let mut offenders = Vec::new();

    for (i, line) in lines.iter().enumerate() {
        if line.trim() != "#[tauri::command]" {
            continue;
        }
        // Find the signature line.
        let sig_idx = lines[i + 1..]
            .iter()
            .position(|l| {
                let t = l.trim();
                !t.is_empty() && !t.starts_with("//")
            })
            .map(|p| p + i + 1)
            .unwrap_or(i);
        let sig_line = lines[sig_idx].to_string();
        if !sig_line.contains("pub async fn ") {
            // The `every_tauri_command_is_async` test will catch this; skip.
            continue;
        }
        // Find the body start (first `{` on or after sig_idx) and matching `}`.
        // Heuristic: concatenate lines from sig_idx until the opening `{`,
        // then read forward until the matching `}` is balanced.
        let body = collect_body(&lines, sig_idx);
        let body_text = body.join("\n");
        let touches_db = body_text.contains("db_op(")
            || body_text.contains("state.db")
            || body_text.contains("app_handle.state::<AppState>()");
        if touches_db && !sig_line.contains("app_handle: tauri::AppHandle") {
            // The signature may span multiple lines; check the full signature too.
            let mut sig_end = sig_idx;
            let mut depth = 0i32;
            for (k, l) in lines.iter().enumerate().skip(sig_idx) {
                for c in l.chars() {
                    if c == '(' { depth += 1; }
                    if c == ')' {
                        depth -= 1;
                        if depth == 0 { sig_end = k; break; }
                    }
                }
                if depth == 0 && k > sig_idx { break; }
            }
            let full_sig = lines[sig_idx..=sig_end].join(" ");
            if !full_sig.contains("app_handle: tauri::AppHandle") {
                offenders.push((sig_idx + 1, sig_line));
            }
        }
    }

    assert!(
        offenders.is_empty(),
        "Found {} commands that touch the DB but do not declare \
         `app_handle: tauri::AppHandle`:\n  {:#?}",
        offenders.len(),
        offenders,
    );
}

fn collect_body(lines: &[&str], from: usize) -> Vec<String> {
    // Locate the opening `{` of the function body, then collect until the
    // matching `}` is balanced. This is a best-effort textual scan; it
    // does not understand strings, chars, or comments. For commands.rs's
    // style (no inline `{` in strings inside command bodies) it is good
    // enough.
    let mut depth = 0i32;
    let mut started = false;
    let mut out = Vec::new();
    for l in &lines[from..] {
        for c in l.chars() {
            if c == '{' {
                depth += 1;
                started = true;
            } else if c == '}' {
                depth -= 1;
            }
        }
        if started {
            out.push(l.to_string());
        }
        if started && depth == 0 {
            break;
        }
    }
    out
}
```

- [ ] **Step 2: Run the test; expect 3/3 pass**

Run:
```bash
cd D:\code\novel_read\src-tauri
cargo test --test p3_command_shape 2>&1
```

Expected:
```
running 3 tests
test every_tauri_command_is_async ... ok
test every_db_touching_command_takes_app_handle ... ok
test total_command_count_is_expected ... ok

test result: ok. 3 passed; 0 failed; ...
```

(If `total_command_count_is_expected` fails because the count is e.g. 113 because T0.5 fired and we added a `pub async fn` helper that doesn't have a `#[tauri::command]` annotation, update `EXPECTED_COMMAND_COUNT`. T0.5 is not expected to fire per Task 0's investigation.)

- [ ] **Step 3: Run the full test suite; expect 80 total**

Wait — re-checking the test count math: 66 lib + 3 P0 + 4 P1 + 2 P2 recycled + 2 P2 stress + 3 P3 = 80. The spec said 78; the correct count is 80. Update the spec at T4.

Run:
```bash
cd D:\code\novel_read\src-tauri
cargo test --lib --test p0_pragmas_and_indices --test p1_app_state --test p2_pragmas_recycled --test p2_pool_stress --test p3_command_shape 2>&1 | Select-String "test result"
```

Expected: 6 lines, each saying `ok. N passed; 0 failed; 0 ignored; …`. Totals: 66 + 3 + 4 + 2 + 2 + 3 = **80 passed**.

- [ ] **Step 4: Sanity-check the test actually fails when expected**

To prove the test is not a no-op, temporarily revert T1 (rename one `pub async fn` back to `pub fn`) and re-run:

```bash
cd D:\code\novel_read\src-tauri
# Pick the simplest command, e.g. delete_app_file at L1618
# (Get-Content src\commands.rs - replace "pub async fn delete_app_file" with "pub fn delete_app_file" at line 1618)
(Get-Content -LiteralPath "src\commands.rs") -replace '^pub async fn delete_app_file', 'pub fn delete_app_file' | Set-Content -LiteralPath "src\commands.rs"
cargo test --test p3_command_shape every_tauri_command_is_async 2>&1
```

Expected: `test every_tauri_command_is_async ... FAILED` with a message identifying the offending line.

Restore:
```bash
cd D:\code\novel_read\src-tauri
(Get-Content -LiteralPath "src\commands.rs") -replace '^pub fn delete_app_file', 'pub async fn delete_app_file' | Set-Content -LiteralPath "src\commands.rs"
cargo test --test p3_command_shape 2>&1
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
cd D:\code\novel_read
$body = "test(p3): regression for IPC command shape (all async, DB cmds carry app_handle)

Three textual assertions on src/commands.rs that fail the build if a
future PR regresses the post-P3 IPC shape:

  1. every #[tauri::command] is `pub async fn` (no sync hold-outs).
  2. The total count of #[tauri::command] is the expected constant
     (currently 114). A new command forces the contributor to
     update the constant in the same commit.
  3. Every command whose body contains `db_op(`, `state.db`, or
     `app_handle.state::<AppState>()` also declares
     `app_handle: tauri::AppHandle` in its signature.

The test is a pure source-grep; no syn / quote / proc-macro
machinery. Parsing happens via paren/brace depth counters plus
literal string match. If a future command genuinely needs to break
the shape (e.g. a long-running command that holds a connection
without app_handle), the test is updated in the same commit that
introduces the command.

cargo test: 80 passed (66 lib + 3 P0 + 4 P1 + 2 P2 recycled + 2 P2
stress + 3 P3).

P3-T3."
$body | Out-File -Encoding utf8 "$env:TEMP\commit_t3.txt"
git add src-tauri/tests/p3_command_shape.rs
git commit -F "$env:TEMP\commit_t3.txt"
```

Expected: one new commit on top of T2.

---

## Task 4: Full regression + spec closeout

**Files:**
- Modify: `docs/p3-spec.md` (Status line + "What P3 changed" section)

- [ ] **Step 1: Final `cargo build`**

```bash
cd D:\code\novel_read\src-tauri
cargo build 2>&1 | Select-String -Pattern "error|warning|Finished"
```

Expected: 0 errors, 0 warnings, 1 `Finished` line.

- [ ] **Step 2: Final `cargo test` (every suite)**

```bash
cd D:\code\novel_read\src-tauri
cargo test --lib --test p0_pragmas_and_indices --test p1_app_state --test p2_pragmas_recycled --test p2_pool_stress --test p3_command_shape 2>&1 | Select-String "test result"
```

Expected: 6 `ok` lines; 80 total passed; 0 failed.

- [ ] **Step 3: Frontend regression**

```bash
cd D:\code\novel_read
pnpm build 2>&1 | Select-String -Pattern "error|built"
pnpm lint 2>&1 | Select-String -Pattern "error|warning"
```

Expected:
- `pnpm build` shows `built in <Nms>` and no errors. (The "chunks larger than 500 kB" warning is pre-existing and not an error.)
- `pnpm lint` shows no errors.

- [ ] **Step 4: Edit `docs/p3-spec.md` Status line**

Change:
```
> Status: 🟡 draft (awaiting review)
```
to:
```
> Status: ✅ approved & shipped (P3-T4, commit <sha>)
```

(Use the actual short SHA of the T3 commit.)

- [ ] **Step 5: Fill in the "What P3 changed" section**

Replace the placeholder in `docs/p3-spec.md` with:

```markdown
# What P3 changed

- `src/commands.rs`: 11 `pub fn` → `pub async fn`; 19 `ApiResponse { … }`
  literals → `ok(…)` / `err(…)`; net source delta: roughly −40 lines.
- `src-tauri/tests/p3_command_shape.rs`: new file, ~150 lines, three
  `#[test]` cases (all-async invariant; expected-count constant;
  DB-toucher carries `app_handle`).
- `src-tauri/Cargo.toml`: unchanged.
- Frontend: unchanged.
- `docs/p3-spec.md`: this section added at T4.
- Test count: 66 lib + 3 P0 + 4 P1 + 2 P2 recycled + 2 P2 stress + 3 P3
  = **80 passed** (was 77 before P3; +3 from p3_command_shape).
- Commits on top of P2's `12da627c8`:
  - `42b772921` (P3 spec, already in master)
  - T1 commit (11 sync → async)
  - T2 commit (19 verbose literals → helpers)
  - T3 commit (p3_command_shape.rs)
  - T4 commit (this closeout)
```

- [ ] **Step 6: Commit**

```bash
cd D:\code\novel_read
$body = "docs(p3): mark P3 spec as shipped; record final test count (80)

P3 closeout. All 5 tasks landed:
  T0   verified no T0.5 contingency needed
  T1   11 sync -> async
  T2   19 verbose ApiResponse -> ok()/err()
  T3   p3_command_shape.rs regression test
  T4   this commit (spec closeout)

Final state:
  - cargo build: 0 errors, 0 warnings
  - cargo test (all suites): 80 passed, 0 failed
  - pnpm build: clean
  - pnpm lint: clean
  - src/commands.rs: 0 sync tauri commands; 0 verbose ApiResponse
    literals outside the struct/helper definitions.

P3-T4."
$body | Out-File -Encoding utf8 "$env:TEMP\commit_t4.txt"
git add docs/p3-spec.md
git commit -F "$env:TEMP\commit_t4.txt"
```

Expected: one new commit on top of T3. The new top of `git log --oneline -8`:

```
<new-sha> docs(p3): mark P3 spec as shipped; record final test count (80)
<...>     test(p3): regression for IPC command shape (...)
<...>     refactor(commands): replace verbose ApiResponse literals (...)
<...>     refactor(commands): convert 11 remaining sync IPC commands (...)
42b772921 docs(p3): P3 spec — finish the async/consistency pass (...)
12da627c8 test(p2): pool concurrency + recycle stress
```

---

## Self-Review

**1. Spec coverage:**

| Spec section | Covered by |
|---|---|
| § "The 11 commands to convert" | Task 1, Steps 1-11 |
| § "The 19 verbose `ApiResponse { … }` literals" | Task 2, Steps 1-6 |
| § "The shape test" (3 sub-tests) | Task 3, Step 1 (all three sub-tests in the test file body) |
| § "Tech Stack" (no new deps) | Throughout — no `Cargo.toml` change in any task |
| § "Project Structure" (no other files) | Throughout |
| § "Code Style (target shape)" | Task 1 + Task 2; locked in by Task 3 |
| § "Testing Strategy" (78→80 tests) | Task 1, Step 13 (77 after T1) + Task 2, Step 5 (77 after T2) + Task 3, Step 3 (80 after T3) + Task 4, Step 2 (80 final) |
| § "Boundaries" (no frontend, no protocol change) | Throughout — no `src/` or `tools/` changes |
| § "Success Criteria" (5 checks) | Task 4, Steps 1-5 (all 5) |
| § "Open Questions" (T0.5 contingency) | Task 0 (full investigation) |

**2. Placeholder scan:** no TBD / TODO / "implement later" / "similar to Task N" in the plan body. Every step has concrete code or commands.

**3. Type consistency:** all references to `db_op`, `state.db`, `app_handle: tauri::AppHandle`, `ApiResponse<T>`, `ok()` / `err()` are consistent across tasks. The test's `EXPECTED_COMMAND_COUNT = 114` matches the spec; if T0.5 fires the count is unchanged (it doesn't add commands, it migrates existing ones).

**4. Scope check:** P3 is 4-5 commits in one Rust file plus one new test file. Well within the "single implementation plan" envelope.

---

## Execution Handoff

Plan complete and saved to `docs/p3-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints

Per the user's original instruction "针对P3任务，先写 spec 和 plan，不要直接改代码", this handoff is **paused** until the user reviews the spec at `docs/p3-spec.md` (committed as `42b772921`) and this plan at `docs/p3-plan.md` (uncommitted; will be committed at T4 if user wants it tracked separately, or at T1 if user wants it in master before code).
