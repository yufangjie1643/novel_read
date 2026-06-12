# Spec: P3 — Finish the Async/Consistency Pass on the IPC Layer

> Status: 🟡 draft (awaiting review)
> Phase: P3 of the [performance roadmap](../AGENTS.md)
> Supersedes: P2's "Out (deferred)" column lines for 5 server/webdav commands
>             and 13 pure-network commands, plus the implicit "all sync fns
>             should be async" cleanup.

## Objective

P0 introduced the pool, P1 wired `AppState` and migrated 26 commands, P2
finished the migration (68 more) and deleted the `Database` shim. P3 is the
last 10% of that work: there are still **11** `pub fn` IPC commands and
**19** verbose `ApiResponse { success: …, data: …, error: … }` literals
left in `src-tauri/src/commands.rs`, and there is no automated test that
locks in the target shape so a future PR cannot regress it.

P3 is intentionally small: zero protocol changes, zero behaviour changes,
zero frontend changes. The point is to make "every command is `pub async
fn` and uses `ok()`/`err()` helpers" the load-bearing invariant of the IPC
layer, and to enforce it with a regression test.

**No IPC protocol changes.** Frontend requires zero changes (same as P0–P2).

## Scope (in / out)

| In | Out (deferred) |
|---|---|
| Convert the 11 remaining `pub fn` IPC commands to `pub async fn` | `ApiResponse<T>` → `Result<T, ApiError>` migration (touches all 114 cmds + frontend) |
| Systematically replace 19 verbose `ApiResponse { … }` literals with the `ok()` / `err()` helpers that already exist at `commands.rs:97-111` | Virtualized lists, route lazy-split, Channel-streamed chapter content (P2 "Out" column) |
| Add `tests/p3_command_shape.rs` that source-greps `commands.rs` and asserts: every `#[tauri::command]` is `pub async fn`; every command that mentions `db_op(` or `state.db` also declares `app_handle: tauri::AppHandle` | `moka` network cache; configurable pool size (P1/P2 "Out" columns) |
| Full regression: `cargo build`, `cargo test --lib --test p0_* --test p1_* --test p2_*`, `pnpm build`, `pnpm lint` | Frontend type generation from Rust (no `ts-rs` / `specta` adoption) |
| | Build & release pipeline (`cargo tauri build`, code signing, auto-update) |
| | Performance optimizations (P2 "Out" column) |

## The 11 commands to convert

All 11 are in `src-tauri/src/commands.rs`. None touch the DB; converting
them is mechanical:

| Line | Command | Reason it's still sync | Target |
|---:|---|---|---|
| 1169 | `parse_source_links_from_html` | pure HTML parse, returns `ok(parse_import_links(&html))` directly | `pub async fn` (still one line) |
| 1541 | `list_app_files` | FS-only, uses `ok()`/`err()` already | `pub async fn` |
| 1599 | `create_app_folder` | FS-only, uses `ok()`/`err()` already | `pub async fn` |
| 1618 | `delete_app_file` | FS-only, uses `ok()`/`err()` already | `pub async fn` |
| 2753 | `import_source_from_json` | pure JSON parse + insert (DB write inside the function); uses verbose `ApiResponse` literal | `pub async fn` + `app_handle: AppHandle` + `db_op` |
| 2777 | `import_rss_source_from_json` | same as above; already uses `ok()`/`err()` | `pub async fn` + `app_handle: AppHandle` + `db_op` |
| 2793 | `import_replace_rules_from_json` | same as above; already uses `ok()`/`err()` | `pub async fn` + `app_handle: AppHandle` + `db_op` |
| 2809 | `import_http_tts_from_json` | same as above; uses `ok()`/`err()` | `pub async fn` + `app_handle: AppHandle` + `db_op` |
| 2821 | `start_web_server` | calls sync `server::start_server(pool, port)`; already takes `app_handle` | `pub async fn` + `tokio::task::spawn_blocking` for the sync call |
| 2843 | `stop_web_server` | calls sync `server::stop_server()` (no DB) | `pub async fn` |
| 2853 | `get_web_server_status` | calls sync `server::is_server_running()` (no DB) | `pub async fn` |

The 4 `import_*_from_json` commands are in the pure-network import
section. Their bodies are visible in the surrounding context; the spec
assumes they only do JSON parse + insert, but a few use the legacy
`db().as_conn()` shim, which **was deleted in P2-T11**. So those 4
almost certainly need DB migration as well.

> **Open question (resolved at T1 start)**: confirm by `cargo build` that
> the 4 `import_*_from_json` commands don't silently use the now-deleted
> `db()` accessor. If they do, T0.5 (db_op migration) is added before T1
> finishes. The expected answer is "yes they need db_op" — the T0.5
> work is roughly 20 lines of `db_op(app_handle, |conn| { … })` wrappers
> in 4 commands.

## The 19 verbose `ApiResponse { … }` literals

`src-tauri/src/commands.rs:97-111` already defines:

```rust
fn ok<T>(data: T) -> ApiResponse<T> {
    ApiResponse { success: true, data: Some(data), error: None }
}
fn err<T>(message: impl Into<String>) -> ApiResponse<T> {
    ApiResponse { success: false, data: None, error: Some(message.into()) }
}
```

69 `ok(` and 48 `err(` call sites already use them. The 19 left-over
verbose patterns are an inconsistent tail. **T2** is a mechanical,
test-only refactor: replace each `ApiResponse { success: … }` literal with
`ok(…)` / `err(…)`, run `cargo build` + `cargo test` to confirm no
behavioural change. No commit that fixes a bug may be included in T2.

## The shape test

`tests/p3_command_shape.rs` runs at `cargo test` time. It does NOT depend
on the binary, so it can be a pure source-grep test (no runtime required):

1. Read `src/commands.rs` as a string.
2. Find every line `^#\[tauri::command\]`.
3. For each, look at the next non-blank, non-`///` doc line. It must match
   `^pub async fn \w+\(`. If it matches `^pub fn \w+\(`, the test fails
   with the line number.
4. For each, look at the full signature (concatenate lines until the `)`).
   If the body of the function (everything between `{` and the matching
   `}`) contains the substring `db_op(` or `state.db`, the signature must
   contain `app_handle: tauri::AppHandle`. If not, the test fails.
5. Count of `#[tauri::command]` annotations must equal **114** (the
   current total). If the count drifts, the test fails so a contributor
   is forced to update the assertion explicitly.

The test is intentionally textual — no syn / quote / proc-macro machinery.
If parsing commands.rs as a string ever becomes painful, we can switch to
`syn` in a future P-cycle.

## Tech Stack

| Item | Before (P2) | After (P3) |
|---|---|---|
| `commands.rs` total commands | 114 (11 sync + 103 async) | 114 (all async) |
| `commands.rs` `ok()` / `err()` coverage | 117 of 136 sites (86%) | 136 of 136 (100%) |
| `commands.rs` shape test | none | `tests/p3_command_shape.rs` |
| IPC protocol | unchanged | unchanged |
| Frontend | unchanged | unchanged |
| Pool / `db_op` / PragmaManager | unchanged | unchanged |

## Project Structure

```
src-tauri/
├── Cargo.toml                     # (no new deps)
├── src/
│   ├── commands.rs                 # 11 sync → async; 19 verbose ApiResponse → ok()/err()
│   ├── server.rs                   # (no change; T10 of P2 already correct)
│   └── …                           # (no other changes)
└── tests/
    └── p3_command_shape.rs         # NEW: source-grep regression for IPC shape
```

## Code Style (target shape)

The invariant this P-cycle locks in:

```rust
// ✅ correct shape (P3 target)
#[tauri::command]
pub async fn some_command(
    app_handle: tauri::AppHandle,
    arg: String,
) -> ApiResponse<SomeType> {
    db_op(app_handle, move |conn| {
        SomeDao::new(conn).do_thing(&arg)
    })
    .await
}

// ✅ also correct (pure network/parse/FS, no DB)
#[tauri::command]
pub async fn pure_parse(html: String) -> ApiResponse<Vec<SourceLink>> {
    ok(parse_import_links(&html))
}

// ❌ rejected by p3_command_shape.rs
#[tauri::command]
pub fn legacy_sync(...) -> ... { ... }            // must be async
#[tauri::command]
pub async fn missing_handle(...) -> ... {         // touches DB but no app_handle
    db_op(??, ...)
}
#[tauri::command]
pub async fn verbose(...) -> ... {                // inline ApiResponse literal
    ApiResponse { success: true, data: Some(x), error: None }
}
```

## Testing Strategy

| Layer | Test | Run with |
|---|---|---|
| Unit (existing) | 66 lib | `cargo test --lib` |
| P0 regression | 3 (PRAGMAs + indices) | `cargo test --test p0_pragmas_and_indices` |
| P1 regression | 4 (pool + AppState) | `cargo test --test p1_app_state` |
| P2 regression | 4 (recycled + stress) | `cargo test --test p2_pragmas_recycled --test p2_pool_stress` |
| **P3 regression** | **1 (`p3_command_shape`)** | `cargo test --test p3_command_shape` |
| Frontend | build + lint untouched | `pnpm build && pnpm lint` |

Total after P3: **78 tests green** (66 + 3 + 4 + 2 P2 recycled + 2 P2 stress + 1 P3).

## Boundaries

### Always do
- Run the full regression (`cargo build`, `cargo test --lib --test p0_* --test p1_* --test p2_* --test p3_*`, `pnpm build`, `pnpm lint`) before each commit.
- Use `git commit -F <file>` (PowerShell-safe) for messages containing backticks.
- Add a `test(p3):` or `refactor(commands):` prefix to every commit.

### Ask first
- Adding `app_handle` to a command that doesn't currently touch the DB.
- Changing an existing command's error wording (frontend may be matching on it).

### Never do
- Modify the frontend in this P-cycle.
- Add a new dependency.
- Change the IPC protocol (command names, argument shapes, `ApiResponse<T>` envelope).

## Success Criteria

| Check | Criterion |
|---|---|
| `commands.rs` shape | 0 occurrences of `pub fn ` under a `#[tauri::command]` annotation |
| `commands.rs` helpers | 0 occurrences of `ApiResponse { success:` outside the `ApiResponse` struct definition and the `ok()` / `err()` helpers |
| `commands.rs` DB handles | Every command that calls `db_op(` or `state.db` also declares `app_handle: tauri::AppHandle` |
| `p3_command_shape` | passes (114 commands, all async, all DB-touchers carry `app_handle`) |
| `cargo build` | 0 errors, 0 warnings |
| `cargo test` (all suites) | 78 passed; 0 failed |
| `pnpm build && pnpm lint` | 0 errors |
| `git log --oneline -8` | 5 new commits on top of P2's `12da627c8` (T0.5 may add one more if the import_*_from_json contingency fires) |

## Open Questions

| Question | Current decision | Notes |
|---|---|---|
| Do the 4 `import_*_from_json` commands touch the DB? | **Investigate at T1 start** | If yes, migrate to `db_op` (T0.5 added to plan). If no, T1 is just `pub fn` → `pub async fn`. Resolved by a `cargo build` immediately after the first command is touched. |
| Should `start_web_server` / `stop_web_server` / `get_web_server_status` also use `app_handle` if not needed? | No | They don't touch the DB; pure server lifecycle. The shape test only requires `app_handle` for DB-touchers. |
| Future P4 candidate | Auto-generate TS types from the 114 commands via `specta` or `ts-rs` | Deferred; out of scope for P3. |

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `import_*_from_json` is secretly broken (calls removed `db()` shim) | Med | Med | T1 starts with `cargo build` to surface this immediately. If broken, T0.5 is added before T1 finishes. |
| `server::start_server` blocks when called from `spawn_blocking` | Low | Low | The T10 listener thread is the heavy work; the IPC call only kicks off the listener. `spawn_blocking` is the right wrapper. |
| `p3_command_shape` test breaks for legitimate reasons (e.g. a new command that needs a non-async shape) | Low | Low | The test is `#[test]`, not `#[test(should_panic)]`. If a future command needs sync, the test is updated in the same commit that introduces the command. |
| Forgetting to update the `114` count assertion when adding a new command | Low | Low | The assertion fails the build, forcing the contributor to acknowledge the new command. |

---

# Plan: Implementation Order

P3 is small enough to fit in 4 commits. Each is independently buildable
and testable.

```
T1 (1 commit) — sync → async for the 4 import_*_from_json + the 3 file
                management + the 1 pure parse + the 3 server commands.
                Verify the 4 import_*_from_json do not need DB migration
                (the T0.5 contingency is exercised only if cargo build
                complains).

T2 (1 commit) — replace the 19 verbose `ApiResponse { … }` literals
                with `ok()` / `err()` calls. Touch-only; no logic change.

T3 (1 commit) — add `tests/p3_command_shape.rs` regression test that
                fails the build if a future PR regresses the shape.
                The test itself is the deliverable; no production code
                changes.

T4 (1 commit) — verification + docs. Run the full regression (cargo build,
                all cargo test suites, pnpm build, pnpm lint). Update
                this file's Status line to "✅ approved & shipped" and
                add a one-paragraph changelog at the end.
```

## T1 — sync → async (11 commands)

For each of the 11 commands in the table above, change the signature
from `pub fn` to `pub async fn` and adjust the body. The 3 file-management
and the 1 pure-parse commands are one-line: `pub fn list_app_files(...)` →
`pub async fn list_app_files(...)` with no body change (they use
`ok()`/`err()` already).

The 4 `import_*_from_json` commands need a quick `cargo build` after each
one to surface any hidden `db()` reference. If a `db()` reference is
found, the migration is `pub async fn` + `app_handle: AppHandle` + replace
the `db()` call with a `db_op(app_handle, |conn| …)` block. If no
`db()` reference is found, the migration is just the `pub fn` → `pub async
fn` rename.

The 3 server commands need `tokio::task::spawn_blocking` for the actual
`server::start_server` / `server::stop_server` / `server::is_server_running`
calls. `start_web_server` already takes `app_handle` (added in P2-T10);
`stop_web_server` and `get_web_server_status` don't need it (no DB).

Commit message: `refactor(commands): convert 11 remaining sync IPC commands to async`.

## T2 — verbose `ApiResponse { … }` → `ok()` / `err()`

For each of the 19 sites, replace:
```rust
ApiResponse { success: true, data: Some(x), error: None }
```
with:
```rust
ok(x)
```
and:
```rust
ApiResponse { success: false, data: None, error: Some(e.to_string()) }
```
with:
```rust
err(e.to_string())   // or err(e) when e already impls Into<String>
```

After every replacement, run `cargo build`. The replacement is
behaviour-preserving; if a test fails, revert the change in that command
and open an issue.

Commit message: `refactor(commands): replace 19 verbose ApiResponse literals with ok()/err() helpers`.

## T3 — `p3_command_shape.rs` regression test

Add `src-tauri/tests/p3_command_shape.rs`. Pseudocode:

```rust
use std::fs;
use std::path::PathBuf;

const COMMANDS_RS: &str = "src/commands.rs";
const EXPECTED_COMMAND_COUNT: usize = 114;

#[test]
fn every_tauri_command_is_async() {
    let src = fs::read_to_string(commands_path()).unwrap();
    let mut line = 0usize;
    let mut sync_offenders = vec![];
    for (i, raw) in src.lines().enumerate() {
        line = i + 1;
        if raw.trim() == "#[tauri::command]" {
            // Look ahead for the first non-doc, non-blank, non-attr line.
            for j in (i+1)..src.lines().count() {
                let next = src.lines().nth(j).unwrap().trim();
                if next.is_empty() || next.starts_with("//") { continue; }
                if next.starts_with("pub async fn ") { break; }
                if next.starts_with("pub fn ") {
                    sync_offenders.push((line, next.to_string()));
                }
                break;
            }
        }
    }
    assert!(sync_offenders.is_empty(),
        "Found {} sync #[tauri::command]s: {sync_offenders:?}",
        sync_offenders.len());
}

#[test]
fn every_db_touching_command_takes_app_handle() {
    // Similar: find each command, gather its full signature, gather its
    // full body, and assert: if the body contains "db_op(" or "state.db",
    // then the signature must contain "app_handle: tauri::AppHandle".
}

#[test]
fn total_command_count_is_expected() {
    let src = fs::read_to_string(commands_path()).unwrap();
    let count = src.lines().filter(|l| l.trim() == "#[tauri::command]").count();
    assert_eq!(count, EXPECTED_COMMAND_COUNT,
        "Command count drifted from {EXPECTED_COMMAND_COUNT} to {count}; \
         update the constant in p3_command_shape.rs.");
}

fn commands_path() -> PathBuf { /* resolve relative to CARGO_MANIFEST_DIR */ }
```

The signature and body extraction can be done with a simple `()`-balanced
parser; no `syn` needed. (If parsing becomes painful, switch to `syn` in a
follow-up P-cycle.)

Commit message: `test(p3): regression test for IPC command shape (all async, DB-cmds carry app_handle)`.

## T4 — verification + docs

1. `cd src-tauri && cargo build` — 0 errors, 0 warnings.
2. `cd src-tauri && cargo test --lib --test p0_pragmas_and_indices --test p1_app_state --test p2_pragmas_recycled --test p2_pool_stress --test p3_command_shape` — 80 passed.
3. `cd .. && pnpm build && pnpm lint` — 0 errors.
4. Edit `docs/p3-spec.md` Status line: `🟡 draft` → `✅ approved & shipped`.
5. Add a one-paragraph "What P3 changed" section at the bottom of this file.

Commit message: `docs(p3): mark P3 spec as shipped; record final test count`.

---

# What P3 changed (filled in at T4)

> *This section is intentionally left empty in the draft. T4 fills it in
> with the actual numbers and file deltas.*

- `src/commands.rs`: 11 `pub fn` → `pub async fn`; 19 `ApiResponse { … }` literals → `ok(…)` / `err(…)`; net source change: roughly −40 lines (the helpers are more compact than the literals).
- `src-tauri/tests/p3_command_shape.rs`: new file, ~120 lines, three `#[test]` cases.
- `src-tauri/Cargo.toml`: unchanged.
- Frontend: unchanged.
- `docs/p3-spec.md`: this section added at T4.
