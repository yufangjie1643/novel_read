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
| `commands.rs` | All Tauri IPC commands exposed to frontend |
| `db/` | SQLite DAO layer — `dao.rs` (all queries), `models.rs` (structs), `migrations.rs` |
| `book_source/` | Rule engine: `rule_parser.rs`, `analyzers.rs`, `analyze_url.rs`, `js_extensions.rs`, `js_runtime.rs`, `rule_executor.rs`, `source_loader.rs`, `web_book.rs` |
| `local_book/` | TXT import with regex-based chapter detection |
| `server.rs` | Built-in HTTP server (tiny_http) for exposing bookshelf via REST API |

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

The database is a global singleton accessed via `db::db()` (`src-tauri/src/db/mod.rs`). It is initialized at app startup in `lib.rs` via `db::init_db()` and stored in a `static mut DB`. DAOs take a `&Database` reference — all queries are blocking (rusqlite's synchronous API) and run on Tauri's command thread pool.

### WebBook Lifecycle

Web book operations (search, explore, fetch info/chapters/content) are stateless per call. Each command constructs a fresh `JsExtState` + `WebBook` pair (`src-tauri/src/commands.rs` lines 916–1003). There is no persistent JS runtime across calls — state is carried through the database (`Cookie`, `Cache` tables) and the `JsExtState` clone passed into `AnalyzeUrl`.

### Vite HMR

`vite.config.ts` uses `TAURI_DEV_HOST` for cross-platform HMR during `cargo tauri dev`. Do not change `strictPort: true` or port `1420` without also updating `tauri.conf.json`.

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

- **rusqlite** `0.32` — SQLite bundled, schema locked to Room v75
- **rquickjs** `0.9` — JS engine for book source rules
- **scraper** `0.22` — CSS selector HTML parsing
- **reqwest** `0.12` — HTTP client with blocking, cookies, gzip
- **tiny_http** `0.12` — Built-in web server
