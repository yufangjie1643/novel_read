# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Legado Desktop is a desktop reimplementation of the [Legado (开源阅读)](https://github.com/gedoor/legado) novel reader app, built with **Tauri v2 + React + TypeScript + Rust**. It preserves compatibility with the original Android app's book source rule engine and SQLite database schema (Room v75).

- **Repository**: https://github.com/yufangjie1643/novel_read
- **Upstream reference**: https://github.com/gedoor/legado (Android Kotlin)
- **Frontend**: React 18 + TypeScript + Vite
- **Backend**: Rust (Tauri v2)
- **Data layer**: SQLite via rusqlite (bundled)
- **JS engine**: rquickjs (QuickJS bindings) for executing user-defined book source rules

## Build Commands

Requires Rust >= 1.77.2, Node.js >= 20, pnpm >= 9.

```bash
# Install frontend dependencies
pnpm install

# Development (hot reload both frontend and Rust backend)
cargo tauri dev

# Or run separately:
# Terminal 1: pnpm dev
# Terminal 2: cd src-tauri && cargo run

# Build release bundle
cargo tauri build
# Output: src-tauri/target/release/bundle/

# Frontend-only (lint, format, build)
pnpm lint
pnpm lint:fix
pnpm format
pnpm build              # tsc + vite build

# End-to-end smoke test (headless Chrome + Vite + mocked Tauri IPC)
pnpm test:smoke         # requires Chrome/Edge on PATH or CHROME_PATH env
# Set SMOKE_PORT to override the default 5190

# Rust helper binaries (operate on an existing legado.db)
# Built via `cargo run --bin <name> -- <db> [args]`
cargo run --bin peek_schema -- path/to/legado.db
cargo run --bin peek_stats -- path/to/legado.db
cargo run --bin peek_rule -- path/to/legado.db <sourceUrl>
cargo run --bin peek_raw -- path/to/legado.db <bookUrl> <chapterIndex>
cargo run --bin peek_book -- path/to/legado.db <sourceUrl> <bookUrl>
cargo run --bin fetch_chapter -- path/to/legado.db <sourceUrl> <bookUrl> <chapterUrl>
cargo run --bin fetch_chapter -- ... [-- <bookUrl> <chapterUrl>]
cargo run --bin pipeline_smoke -- path/to/legado.db
cargo run --bin e2e_smoke -- path/to/legado.db <sourceUrl> <bookUrl> <chapterUrl>
cargo run --bin e2e_health
cargo run --bin bump_reversed -- path/to/legado.db
cargo run --bin dash_chapter_list -- path/to/legado.db
cargo run --bin write_rule -- path/to/legado.db
cargo run --bin append_rule -- path/to/legado.db
cargo run --bin patch_rule -- path/to/legado.db
```

## Architecture

### Frontend (`src/`)

- **Pages**: Bookshelf, BookDetail, Reader, Search (Home), Explore, DebugPage, RssPage
- **Routing**: react-router-dom with 7 routes (`/`, `/explore`, `/search`, `/book/:url`, `/reader/:url/:idx`, `/debug`, `/rss`)
- **State**: React hooks + localStorage for reader settings
- **IPC**: All backend calls go through `invoke("command_name", args)`

### Rust Backend (`src-tauri/src/`)

| Module | Responsibility |
|--------|---------------|
| `lib.rs` | Tauri builder, plugin init, `invoke_handler!` registration, window setup |
| `commands.rs` | All Tauri IPC commands exposed to frontend (~100+ commands) |
| `state.rs` | `AppState` injected into commands; holds the DB pool and search-cancel channel |
| `db/` | SQLite DAO layer — `mod.rs` (pool + PRAGMAs + `init_app_state`), `dao.rs` (raw SQL per entity), `models.rs` (structs), `migrations.rs` (Room v75 schema), `seed.rs` (first-run defaults), `source_stats_dao.rs` |
| `book_source/` | Rule engine: `rule_parser.rs`, `analyzers.rs`, `analyze_url.rs`, `js_extensions.rs`, `js_runtime.rs`, `rule_executor.rs`, `relevance.rs`, `search_streamer.rs`, `source_loader.rs`, `web_book.rs` |
| `local_book/` | TXT/EPUB import with regex-based chapter detection |
| `server.rs` | Built-in HTTP server (tiny_http) for exposing bookshelf via REST API |
| `http.rs` | Process-wide shared `reqwest` clients (async/blocking × proxy/no-proxy) — reused to keep keep-alive connections |
| `webdav.rs` | WebDAV backup/restore |
| `content_processor.rs` | Chapter content post-processing pipeline |
| `chinese_utils.rs` | Chinese text utilities (TOC parsing, encoding hints) |
| `bin/` | Standalone CLI tools that operate on a `legado.db` directly — see Build Commands |

### Book Source Rule Engine

The core feature inherited from Android. Users define `BookSource` entities with rule strings:

- **CSS selectors** via `scraper` crate
- **XPath / JSONPath** via string parsing + navigation
- **JavaScript** via `rquickjs` with `JsExtensions` utility functions
- **Regex** via `regex` crate
- Rule syntax: `&&` chaining, `##match##replace` replacement, `{{js}}` interpolation

### Database

- Single SQLite file managed by rusqlite (bundled feature, no external SQLite needed)
- Schema ported from Android Room v75 — 20+ entities (`Book`, `BookSource`, `BookChapter`, `ReplaceRule`, `RssSource`, etc.)
- No ORM — raw SQL queries in `db/dao.rs`

## Cross-Cutting Patterns

### IPC Contract

All frontend→backend calls use Tauri's `invoke()` and return a uniform `ApiResponse<T>`:

```rust
// Rust side (commands.rs)
#[tauri::command]
pub fn get_books() -> ApiResponse<Vec<Book>> { ... }

// Frontend side
const books = await invoke<ApiResponse<Book[]>>("get_books");
if (books.success) { /* use books.data */ }
```

Every command follows this pattern: `success: bool`, `data: Option<T>`, `error: Option<String>`. When adding a new command, register it in both `commands.rs` and `lib.rs`'s `invoke_handler!` macro.

### Database Access

The DB layer is built around `deadpool-sqlite` (pool of 8, `PragmaManager` reapplies tuned PRAGMAs on every `create`/`recycle`) and lives in `AppState.db: AppPool`. Init happens in `db::init_app_state()` (called from `lib.rs`'s `setup` hook) which: creates `app_data_dir`, applies any pending `legado.db.restore` swap, runs migrations on a one-shot bootstrap connection, then builds the pool and seeds default rule subs / RSS sources. DAOs take a `&Connection` — all queries are blocking (rusqlite's synchronous API) and run on Tauri's command thread pool via the `db_op` helper in `commands.rs` (which uses `Object::interact` to push the closure onto a deadpool worker, keeping the Tauri IPC runtime non-blocking).

The `book_source` schema uses snake_case model fields on the Rust side that map to `camelCase` `BookSource` JSON in the frontend (`types.ts`). SQLite column names follow the Android Room convention (`bookUrl`, `bookSourceUrl`, etc.) — DAOs translate between them, do not rename.

### WebBook Lifecycle

Web book operations (search, explore, fetch info/chapters/content) are stateless per call. Each command constructs a fresh `JsExtState` + `WebBook` pair (`src-tauri/src/commands.rs` lines 916–1003). There is no persistent JS runtime across calls — state is carried through the database (`Cookie`, `Cache` tables) and the `JsExtState` clone passed into `AnalyzeUrl`.

`JsExtState` does have a process-wide shared instance via `JsExtState::global()` (an `OnceLock<Arc<…>>`) so cookies/cache populated by one IPC call (e.g. login, first search) survive into subsequent calls. Tests that need isolation should still construct `JsExtState::new()` directly.

Concurrent search is orchestrated by `book_source/search_streamer.rs` with a global timeout of 3.5 s, per-source timeout of 2 s, and a semaphore of 8. Results stream to the frontend through a Tauri `Channel<SearchEvent>` and can be cancelled via the `search_cancel_tx` watch channel in `AppState`.

### Vite HMR

`vite.config.ts` uses `TAURI_DEV_HOST` for cross-platform HMR during `cargo tauri dev`. Do not change `strictPort: true` or port `1420` without also updating `tauri.conf.json`.

### Frontend UI Mode

`UiModeProvider` (`src/UiModeProvider.tsx`) drives a desktop/mobile toggle: `desktop` shows the left-rail nav from `Layout`, `mobile` shows the bottom tab bar. Resolution order: `VITE_APP_UI_MODE_FORCE=1` env → UA detection → `localStorage[app_ui_mode]` → `VITE_APP_UI_MODE` env → runtime heuristic (narrow viewport + coarse pointer). Set `LEGADO_WINDOW_PREVIEW=1` (with `LEGADO_WINDOW_WIDTH` / `LEGADO_WINDOW_HEIGHT`) before `cargo tauri dev` to constrain the OS window — `lib.rs::apply_preview_window_size` reads it.

## Development Rules

### 1. Reference vs Development Code

The upstream Android project (`gedoor/legado`) is **reference only**. Do not commit Android Kotlin code, Gradle files, or Android-specific assets to this repository. The Android codebase is only used to understand business logic and database schema.

### 2. Git Push — Source Only

Never commit build artifacts or dependency directories:

- `target/` — Rust compilation output
- `node_modules/` — Node dependencies
- `dist/` — Frontend build output
- `.claude/`, `.codegraph/` — AI tool artifacts
- `*.exe`, `*.log` — binaries and logs

`.gitignore` is enforced at the repository root and must cover all subdirectories. If a directory was previously tracked, use `git rm -r --cached <dir>` to remove it from the index.

### 3. Code Layout — Flat Root

All desktop code lives at the repository root. Do not wrap code in a `legado-desktop/` subdirectory:

```
✅ Correct:
  src/              ← React frontend
  src-tauri/src/    ← Rust backend
  Cargo.toml
  package.json

❌ Wrong:
  legado-desktop/src/
  legado-desktop/src-tauri/src/
```

## Important File Locations

- `src/` — React frontend pages, components, types
- `src-tauri/src/` — Rust source (commands, db, book_source, local_book, server)
- `src-tauri/Cargo.toml` — Rust dependencies
- `src-tauri/tauri.conf.json` — Tauri configuration
- `package.json` — Node dependencies and scripts
- `.gitignore` — Must exclude target/, node_modules/, dist/ at root level

## Dependency Notes

Key pinned versions (verify compatibility before upgrading):

- **rusqlite** `0.38` (with `bundled`, `chrono`) — schema locked to Room v75
- **deadpool-sqlite** `0.13` + **deadpool-sync** `0.2` — shared connection pool
- **rquickjs** `0.9` (with `futures`, `macro`) — JS engine for book source rules
- **scraper** `0.22` — CSS selector HTML parsing
- **reqwest** `0.12` (blocking + rustls-tls, no default features) — HTTP client
- **regex** `1`, **encoding_rs** `0.8`, **url** `2`, **base64** `0.22` — rule/text utilities
- **tiny_http** `0.12` — built-in web server
- **epub** `2`, **zip** `3` — local book import
- **tokio** `1` (full) — async runtime, search streamer
- **chrono** `0.4` (with `serde`) — timestamps

The desktop build defaults to a single-feature `reqwest` config; do not enable `default-features` without re-checking proxy/TLS behavior on the user's machine.
