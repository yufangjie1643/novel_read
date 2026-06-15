# 按书进度同步 WebDAV 实施计划（C）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Desktop Reader 中实现按书的阅读进度 WebDAV 同步。Rust 端新增 `book_progress_sync` 表 + `sync_book_progress` / `get_book_sync_status` 命令；WebDAV JSON 格式与 Android Legado 一致；按时间戳简单覆盖（与 Android `syncBookProgress` 行为对等）；Reader 顶部菜单「云端进度」按钮触发。

**Architecture:**
- 新表 `book_progress_sync` 记录 `bookUrl / lastLocalTime / lastRemoteTime / lastSyncedAt / remoteEtag`。
- 新增 `BookProgressDao` 提供 `get / upsert / delete`。
- `webdav.rs` 新增 `download_to_string(remote_path) -> Result<Option<String>>` 与 `upload_string(remote_path, body) -> Result<()>`。
- `sync_book_progress` 命令：根据 `direction = "upload" | "download" | "auto"` 三种分支执行；返回 `SyncBookProgressResult`。
- Reader 顶部菜单「云端进度」按钮 → 调 `sync_book_progress({ direction: 'auto' })`，toast 显示结果。

**Tech Stack:** Tauri v2 + rusqlite + reqwest + serde + React 18 + i18next

**Spec:** [`docs/superpowers/specs/2026-06-16-reader-core-and-fullbook-search-design.md`](../../specs/2026-06-16-reader-core-and-fullbook-search-design.md) §3.5

---

## File Structure

### 新增文件

| 文件 | 责任 |
|------|------|
| `src-tauri/src/db/migrations_v76.rs` | `book_progress_sync` 表迁移脚本（按现有 migrations.rs 风格） |
| （无新文件） | DAO 直接追加到 `db/dao.rs` 末尾 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `src-tauri/src/db/dao.rs` | 新增 `BookProgressSync` 模型 + `BookProgressDao` |
| `src-tauri/src/db/migrations.rs` | 注册新迁移 |
| `src-tauri/src/webdav.rs` | 新增 `download_to_string` / `upload_string` |
| `src-tauri/src/commands.rs` | 新增 `sync_book_progress` / `get_book_sync_status` |
| `src-tauri/src/lib.rs` | `invoke_handler!` 注册 |
| `src/types.ts` | 新增 `BookProgressSync` / `SyncBookProgressResult` TS 类型 |
| `src/components/reader/syncActions.ts` | 同步 IPC 客户端 |
| `src/pages/Reader.tsx` | 顶部菜单新增「云端进度」按钮 + toast |
| `src/pages/SettingsBackup.tsx`（如存在） | 新增「按书同步进度」开关 |
| `src/i18n/locales/zh.json` + `en.json` | 新增 reader.sync.* key |

---

## Task 1: 后端 `BookProgressSync` 模型

**Files:**
- Modify: `src-tauri/src/db/models.rs`

- [ ] **Step 1: 在文件末尾追加模型**

```rust
// ============================================================================
// BookProgressSync
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BookProgressSync {
    pub book_url: String,
    pub last_local_time: i64,
    pub last_remote_time: i64,
    pub last_synced_at: i64,
    pub remote_etag: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookProgressSnapshot {
    pub schema_version: i32,
    pub book_url: String,
    pub book_name: String,
    pub chapter_index: i32,
    pub chapter_pos: i32,
    pub chapter_title: String,
    pub chapter_time: i64,
    pub read_time: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SyncDirection {
    Upload,
    Download,
    Auto,
}

impl Default for SyncDirection {
    fn default() -> Self {
        SyncDirection::Auto
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum SyncBookProgressResult {
    Uploaded {
        book_url: String,
        local_time: i64,
        remote_time: i64,
    },
    Downloaded {
        book_url: String,
        local_time: i64,
        remote_time: i64,
    },
    Skipped {
        book_url: String,
        reason: String,
    },
    Failed {
        book_url: String,
        error: String,
    },
}
```

- [ ] **Step 2: 编译**

Run: `cd src-tauri && cargo check`
Expected: 编译通过。

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/db/models.rs
git commit -m "feat(backend): add BookProgressSync model and result types"
```

---

## Task 2: 数据库迁移

**Files:**
- Modify: `src-tauri/src/db/migrations.rs`

- [ ] **Step 1: 读取现有迁移列表定位**

Run: `grep -n "CREATE TABLE.*bookmarks\|v75\|fn migrate_v" src-tauri/src/db/migrations.rs | head -20`
Expected: 找到现有迁移函数。

- [ ] **Step 2: 在最新迁移函数后追加新函数 `migrate_v76_book_progress_sync`**

```rust
pub fn migrate_v76_book_progress_sync(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS book_progress_sync (
            bookUrl TEXT PRIMARY KEY,
            lastLocalTime INTEGER NOT NULL,
            lastRemoteTime INTEGER NOT NULL,
            lastSyncedAt INTEGER NOT NULL,
            remoteEtag TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_book_progress_sync_synced
            ON book_progress_sync(lastSyncedAt DESC);
        "#,
    )?;
    Ok(())
}
```

- [ ] **Step 3: 在主 `migrate` 函数末尾追加对新函数的调用**

找到现有的 `migrate` 函数（按顺序调用 `migrate_vXX_*`），追加：

```rust
migrate_v76_book_progress_sync(conn)?;
```

- [ ] **Step 4: 编译**

Run: `cd src-tauri && cargo check`
Expected: 编译通过。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db/migrations.rs
git commit -m "feat(backend): add book_progress_sync table migration v76"
```

---

## Task 3: BookProgressDao

**Files:**
- Modify: `src-tauri/src/db/dao.rs`

- [ ] **Step 1: 在文件末尾追加 DAO**

```rust
// ============================================================================
// BookProgressDao
// ============================================================================

pub struct BookProgressDao<'a> {
    conn: &'a Connection,
}

impl<'a> BookProgressDao<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    pub fn get(&self, book_url: &str) -> Result<Option<BookProgressSync>> {
        let mut stmt = self.conn.prepare(
            "SELECT bookUrl, lastLocalTime, lastRemoteTime, lastSyncedAt, remoteEtag
             FROM book_progress_sync WHERE bookUrl = ?1",
        )?;
        let mut rows = stmt.query(params![book_url])?;
        if let Some(row) = rows.next()? {
            Ok(Some(BookProgressSync {
                book_url: row.get(0)?,
                last_local_time: row.get(1)?,
                last_remote_time: row.get(2)?,
                last_synced_at: row.get(3)?,
                remote_etag: row.get(4).ok(),
            }))
        } else {
            Ok(None)
        }
    }

    pub fn upsert(&self, item: &BookProgressSync) -> Result<()> {
        self.conn.execute(
            r#"INSERT INTO book_progress_sync
                 (bookUrl, lastLocalTime, lastRemoteTime, lastSyncedAt, remoteEtag)
               VALUES (?1, ?2, ?3, ?4, ?5)
               ON CONFLICT(bookUrl) DO UPDATE SET
                 lastLocalTime = excluded.lastLocalTime,
                 lastRemoteTime = excluded.lastRemoteTime,
                 lastSyncedAt = excluded.lastSyncedAt,
                 remoteEtag = excluded.remoteEtag"#,
            params![
                item.book_url,
                item.last_local_time,
                item.last_remote_time,
                item.last_synced_at,
                item.remote_etag
            ],
        )?;
        Ok(())
    }

    pub fn delete(&self, book_url: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM book_progress_sync WHERE bookUrl = ?1",
            params![book_url],
        )?;
        Ok(())
    }
}
```

- [ ] **Step 2: 在文件顶部 `use super::models::*;` 之后追加（如果文件按 `pub use` 风格）**

确保 `BookProgressSync` 在 models 模块里已导出。检查 `src-tauri/src/db/mod.rs` 的 `pub use models::*;` 是否存在；如无，添加：

```rust
pub use models::*;
```

- [ ] **Step 3: 编译**

Run: `cd src-tauri && cargo check`
Expected: 编译通过。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/db/dao.rs src-tauri/src/db/mod.rs
git commit -m "feat(backend): add BookProgressDao for per-book sync metadata"
```

---

## Task 4: WebDAV `download_to_string` / `upload_string`

**Files:**
- Modify: `src-tauri/src/webdav.rs`

- [ ] **Step 1: 在 `WebDavClient` impl 块中追加方法**

找到现有 `upload` 和 `download` 方法（任务 4 引用原计划看到 `pub async fn upload` 在第 56 行），在 `impl WebDavClient` 内追加：

```rust
pub async fn download_to_string(&self, remote_path: &str) -> Result<Option<String>, WebDavError> {
    let url = self.full_url(remote_path);
    let resp = self
        .client
        .get(&url)
        .basic_auth(&self.username, Some(&self.password))
        .send()
        .await
        .map_err(|e| WebDavError::Request(e.to_string()))?;
    if resp.status().as_u16() == 404 {
        return Ok(None);
    }
    if !resp.status().is_success() {
        return Err(WebDavError::Status(resp.status().as_u16()));
    }
    let etag = resp
        .headers()
        .get("etag")
        .and_then(|v| v.to_str().ok())
        .map(String::from);
    let body = resp
        .text()
        .await
        .map_err(|e| WebDavError::Request(e.to_string()))?;
    Ok(Some(body))
}

pub async fn upload_string(
    &self,
    remote_path: &str,
    body: &str,
) -> Result<(), WebDavError> {
    let url = self.full_url(remote_path);
    let resp = self
        .client
        .put(&url)
        .basic_auth(&self.username, Some(&self.password))
        .body(body.to_string())
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| WebDavError::Request(e.to_string()))?;
    if !resp.status().is_success() {
        return Err(WebDavError::Status(resp.status().as_u16()));
    }
    Ok(())
}

fn full_url(&self, remote_path: &str) -> String {
    if remote_path.starts_with("http") {
        remote_path.to_string()
    } else {
        format!("{}{}", self.base_url.trim_end_matches('/'), remote_path)
    }
}
```

> 实际可能需要按现有 `WebDavClient` 的字段名（`self.base_url` / `self.username` / `self.password` / `self.client`）做调整。先 Read `webdav.rs` 现有 struct 字段。

- [ ] **Step 2: 编译**

Run: `cd src-tauri && cargo check`
Expected: 编译通过。

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/webdav.rs
git commit -m "feat(backend): add WebDAV download_to_string and upload_string"
```

---

## Task 5: 同步命令 `sync_book_progress` + `get_book_sync_status`

**Files:**
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: 在文件顶部 use 块追加**

```rust
use crate::db::models::{BookProgressSnapshot, BookProgressSync, SyncBookProgressResult, SyncDirection};
use crate::db::BookProgressDao;
use crate::webdav::WebDavClient;
use crate::http::CLIENT;
```

（按现有 use 风格调整）

- [ ] **Step 2: 在文件中追加命令**

```rust
#[tauri::command]
pub async fn sync_book_progress(
    app_handle: tauri::AppHandle,
    book_url: String,
    direction: String,
) -> ApiResponse<SyncBookProgressResult> {
    // 1. 读 WebDAV 配置
    let webdav_cfg = match read_webdav_config(&app_handle) {
        Ok(c) => c,
        Err(e) => {
            return ApiResponse::ok(SyncBookProgressResult::Failed {
                book_url,
                error: format!("WebDAV 未配置: {e}"),
            });
        }
    };

    // 2. 读本地 Book + 进度
    let pool = crate::state::get_app_state(&app_handle).map_err(|e| e.to_string())?.db.clone();
    let conn = pool.get().map_err(|e| e.to_string())?;
    let book = BookDao::new(&conn).get(&book_url).map_err(|e| e.to_string())?;
    let book = match book {
        Some(b) => b,
        None => {
            return ApiResponse::ok(SyncBookProgressResult::Failed {
                book_url,
                error: "book not found".to_string(),
            });
        }
    };
    let local = BookProgressSnapshot {
        schema_version: 1,
        book_url: book.url.clone(),
        book_name: book.name.clone(),
        chapter_index: book.dur_chapter_index,
        chapter_pos: book.dur_chapter_pos,
        chapter_title: book.dur_chapter_title.clone().unwrap_or_default(),
        chapter_time: book.dur_chapter_time,
        read_time: book.read_time,
    };

    let client = WebDavClient::new(&webdav_cfg);
    let remote_path = format!("/legado-progress/{}.json", sanitize_filename(&book.name));

    // 3. 按 direction 分支
    let dir = match direction.as_str() {
        "upload" => SyncDirection::Upload,
        "download" => SyncDirection::Download,
        _ => SyncDirection::Auto,
    };

    let now = chrono::Utc::now().timestamp_millis();
    let result = match dir {
        SyncDirection::Upload => do_upload(&client, &conn, &book_url, &local, &remote_path, now).await,
        SyncDirection::Download => do_download(&client, &conn, &book, &remote_path, now).await,
        SyncDirection::Auto => {
            // Auto: 读远端 + 比较时间戳
            let remote_body = client.download_to_string(&remote_path).await.ok().flatten();
            let remote_time: i64 = remote_body
                .as_ref()
                .and_then(|b| serde_json::from_str::<BookProgressSnapshot>(b).ok())
                .map(|s| s.chapter_time)
                .unwrap_or(0);
            if remote_time == 0 {
                do_upload(&client, &conn, &book_url, &local, &remote_path, now).await
            } else if local.chapter_time > remote_time {
                do_upload(&client, &conn, &book_url, &local, &remote_path, now).await
            } else if remote_time > local.chapter_time {
                do_download(&client, &conn, &book, &remote_path, now).await
            } else {
                Ok(SyncBookProgressResult::Skipped {
                    book_url: book_url.clone(),
                    reason: "in sync".to_string(),
                })
            }
        }
    };

    match result {
        Ok(r) => ApiResponse::ok(r),
        Err(e) => ApiResponse::ok(SyncBookProgressResult::Failed {
            book_url,
            error: e,
        }),
    }
}

async fn do_upload(
    client: &WebDavClient,
    conn: &rusqlite::Connection,
    book_url: &str,
    local: &BookProgressSnapshot,
    remote_path: &str,
    now: i64,
) -> Result<SyncBookProgressResult, String> {
    let body = serde_json::to_string(local).map_err(|e| e.to_string())?;
    client.upload_string(remote_path, &body).await.map_err(|e| e.to_string())?;
    BookProgressDao::new(conn)
        .upsert(&BookProgressSync {
            book_url: book_url.to_string(),
            last_local_time: local.chapter_time,
            last_remote_time: local.chapter_time,
            last_synced_at: now,
            remote_etag: None,
        })
        .map_err(|e| e.to_string())?;
    Ok(SyncBookProgressResult::Uploaded {
        book_url: book_url.to_string(),
        local_time: local.chapter_time,
        remote_time: local.chapter_time,
    })
}

async fn do_download(
    client: &WebDavClient,
    conn: &rusqlite::Connection,
    book: &Book,
    remote_path: &str,
    now: i64,
) -> Result<SyncBookProgressResult, String> {
    let body = client.download_to_string(remote_path).await.map_err(|e| e.to_string())?;
    let body = body.ok_or_else(|| "remote file not found".to_string())?;
    let snapshot: BookProgressSnapshot =
        serde_json::from_str(&body).map_err(|e| e.to_string())?;
    BookDao::new(conn)
        .update(&Book {
            dur_chapter_index: snapshot.chapter_index,
            dur_chapter_pos: snapshot.chapter_pos,
            dur_chapter_title: Some(snapshot.chapter_title.clone()),
            dur_chapter_time: snapshot.chapter_time,
            read_time: snapshot.read_time,
            ..book.clone()
        })
        .map_err(|e| e.to_string())?;
    BookProgressDao::new(conn)
        .upsert(&BookProgressSync {
            book_url: book.url.clone(),
            last_local_time: snapshot.chapter_time,
            last_remote_time: snapshot.chapter_time,
            last_synced_at: now,
            remote_etag: None,
        })
        .map_err(|e| e.to_string())?;
    Ok(SyncBookProgressResult::Downloaded {
        book_url: book.url.clone(),
        local_time: snapshot.chapter_time,
        remote_time: snapshot.chapter_time,
    })
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect()
}

fn read_webdav_config(_app: &tauri::AppHandle) -> Result<crate::webdav::WebDavConfig, String> {
    // 复用现有的 WebDAV 设置读取逻辑
    // 实际实现：读 localStorage / db 中的 webdav_config
    // 占位：从 settings 表读
    Err("not implemented: read from settings".to_string())
}

#[tauri::command]
pub async fn get_book_sync_status(
    app_handle: tauri::AppHandle,
    book_url: String,
) -> ApiResponse<Option<BookProgressSync>> {
    let pool = match crate::state::get_app_state(&app_handle) {
        Ok(s) => s.db.clone(),
        Err(e) => return ApiResponse::error(e.to_string()),
    };
    let result = pool.get().ok().and_then(|c| {
        BookProgressDao::new(&c).get(&book_url).ok().flatten()
    });
    ApiResponse::ok(result)
}
```

- [ ] **Step 3: 编译 + 修复**

Run: `cd src-tauri && cargo check`
Expected: 编译通过（`read_webdav_config` 是占位，需要根据项目现有方式补全）。

- [ ] **Step 4: 实现 `read_webdav_config`**

读取 `grep -rn "WebDavConfig\|webdav_config" src-tauri/src/` 找到现有配置结构与读取入口，替换 `read_webdav_config` 的占位实现。

- [ ] **Step 5: 重新编译**

Run: `cd src-tauri && cargo check`
Expected: 编译通过。

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands.rs
git commit -m "feat(backend): add sync_book_progress and get_book_sync_status"
```

---

## Task 6: lib.rs 注册命令

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 在 invoke_handler 加入新命令**

```rust
sync_book_progress,
get_book_sync_status,
```

- [ ] **Step 2: 编译**

Run: `cd src-tauri && cargo check`
Expected: 编译通过。

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(backend): register sync_book_progress commands"
```

---

## Task 7: 后端单元测试

**Files:**
- Modify: `src-tauri/src/db/dao.rs`

- [ ] **Step 1: 在文件末尾追加 `#[cfg(test)]`**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn book_progress_dao_upsert_and_get() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE book_progress_sync (
                bookUrl TEXT PRIMARY KEY,
                lastLocalTime INTEGER NOT NULL,
                lastRemoteTime INTEGER NOT NULL,
                lastSyncedAt INTEGER NOT NULL,
                remoteEtag TEXT
            )",
        )
        .unwrap();

        let dao = BookProgressDao::new(&conn);
        let item = BookProgressSync {
            book_url: "b1".to_string(),
            last_local_time: 100,
            last_remote_time: 200,
            last_synced_at: 300,
            remote_etag: Some("etag1".to_string()),
        };
        dao.upsert(&item).unwrap();
        let got = dao.get("b1").unwrap().unwrap();
        assert_eq!(got.last_local_time, 100);
        assert_eq!(got.remote_etag.as_deref(), Some("etag1"));

        // upsert 覆盖
        let updated = BookProgressSync {
            last_local_time: 150,
            ..item.clone()
        };
        dao.upsert(&updated).unwrap();
        let got = dao.get("b1").unwrap().unwrap();
        assert_eq!(got.last_local_time, 150);

        // delete
        dao.delete("b1").unwrap();
        assert!(dao.get("b1").unwrap().is_none());
    }
}
```

- [ ] **Step 2: 跑测试**

Run: `cd src-tauri && cargo test book_progress`
Expected: 1 test passed.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/db/dao.rs
git commit -m "test(backend): add BookProgressDao unit test"
```

---

## Task 8: 前端类型 + IPC 客户端

**Files:**
- Modify: `src/types.ts`
- Create: `src/components/reader/syncActions.ts`

- [ ] **Step 1: 在 types.ts 追加**

```ts
export type BookProgressSync = {
  book_url: string;
  last_local_time: number;
  last_remote_time: number;
  last_synced_at: number;
  remote_etag: string | null;
};

export type SyncBookProgressResult =
  | { status: 'uploaded'; book_url: string; local_time: number; remote_time: number }
  | { status: 'downloaded'; book_url: string; local_time: number; remote_time: number }
  | { status: 'skipped'; book_url: string; reason: string }
  | { status: 'failed'; book_url: string; error: string };
```

- [ ] **Step 2: 创建 syncActions.ts**

```ts
import { invoke } from '@tauri-apps/api/core';
import type { ApiResponse, BookProgressSync, SyncBookProgressResult } from '../../types';

export type SyncDirection = 'upload' | 'download' | 'auto';

export async function syncBookProgress(
  bookUrl: string,
  direction: SyncDirection = 'auto',
): Promise<SyncBookProgressResult> {
  const resp = await invoke<ApiResponse<SyncBookProgressResult>>('sync_book_progress', {
    bookUrl,
    direction,
  });
  if (!resp.success || !resp.data) {
    throw new Error(resp.error ?? 'sync_book_progress failed');
  }
  return resp.data;
}

export async function getBookSyncStatus(bookUrl: string): Promise<BookProgressSync | null> {
  const resp = await invoke<ApiResponse<BookProgressSync | null>>('get_book_sync_status', { bookUrl });
  if (!resp.success) return null;
  return resp.data ?? null;
}
```

- [ ] **Step 3: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/components/reader/syncActions.ts
git commit -m "feat(reader): add sync actions IPC client"
```

---

## Task 9: i18n key 补齐（reader.sync）

**Files:**
- Modify: `src/i18n/locales/zh.json`
- Modify: `src/i18n/locales/en.json`

- [ ] **Step 1: 在 zh.json 的 `reader` 下补齐**

```json
"sync": {
  "title": "云端进度",
  "uploaded": "进度已上传",
  "downloaded": "进度已下载",
  "skipped": "无需同步",
  "failed": "同步失败：{error}",
  "syncNow": "立即同步"
}
```

- [ ] **Step 2: 在 en.json 补齐**

```json
"sync": {
  "title": "Cloud Progress",
  "uploaded": "Progress uploaded",
  "downloaded": "Progress downloaded",
  "skipped": "Already in sync",
  "failed": "Sync failed: {error}",
  "syncNow": "Sync now"
}
```

- [ ] **Step 3: 验证 JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/i18n/locales/zh.json'))" && node -e "JSON.parse(require('fs').readFileSync('src/i18n/locales/en.json'))"`
Expected: 无输出。

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales/zh.json src/i18n/locales/en.json
git commit -m "feat(reader): add i18n keys for cloud progress sync"
```

---

## Task 10: Reader.tsx 加入「云端进度」按钮

**Files:**
- Modify: `src/pages/Reader.tsx`

- [ ] **Step 1: import 同步 client**

```tsx
import { syncBookProgress } from '../components/reader/syncActions';
```

- [ ] **Step 2: 在顶部菜单的合适位置（与「更多」平级）加入按钮**

```tsx
<button
  type="button"
  onClick={async () => {
    if (!book) return;
    try {
      const r = await syncBookProgress(book.url, 'auto');
      const key = r.status === 'uploaded' ? 'reader.sync.uploaded'
        : r.status === 'downloaded' ? 'reader.sync.downloaded'
        : r.status === 'skipped' ? 'reader.sync.skipped'
        : 'reader.sync.failed';
      const msg = r.status === 'failed' ? t(key, { error: r.error }) : t(key);
      showToast(msg);
    } catch (e) {
      showToast(t('reader.sync.failed', { error: String(e) }));
    }
  }}
  data-testid="cloud-progress-btn"
>
  {t('reader.sync.syncNow')}
</button>
```

- [ ] **Step 3: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
git add src/pages/Reader.tsx
git commit -m "feat(reader): add Cloud Progress sync button in top menu"
```

---

## Task 11: Lint + Smoke

- [ ] **Step 1: Lint**

Run: `pnpm lint`
Expected: 无 error。

- [ ] **Step 2: Smoke**

Run: `pnpm test:smoke`
Expected: 通过。

- [ ] **Step 3: 手动验证（dev）**

1. 打开任一本书
2. 点击顶部「云端进度」按钮
3. 如果未配置 WebDAV：toast 显示「同步失败：WebDAV 未配置」
4. 在 `SettingsBackup.tsx` 配置 WebDAV 后再试：toast 显示「进度已上传」

- [ ] **Step 4: 修复 + commit**

```bash
git add -A
git commit -m "fix(reader): address sync smoke/lint findings"
```

---

## Spec Coverage Check

| Spec § | 任务 | 状态 |
|--------|------|------|
| §3.5.1 book_progress_sync 表 | Task 2 | ✅ |
| §3.5.2 sync_book_progress / get_book_sync_status | Task 5-6 | ✅ |
| §3.5.3 auto 模式流程 | Task 5 | ✅ |
| §3.5.4 WebDAV JSON 格式 | Task 1 + Task 5 | ✅ |
| §3.5.5 前端入口 | Task 10 | ✅ |
| §3.7 i18n（sync） | Task 9 | ✅ |
