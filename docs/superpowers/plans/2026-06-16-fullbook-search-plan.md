# 全书搜索功能实施计划（B）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Desktop Reader 中加入跨所有章节的全文搜索功能。Rust 端用 SQL LIKE 匹配 `book_chapters` JOIN `chapter_contents`，通过 Tauri `Channel<FullBookSearchEvent>` 流式返回命中结果；前端订阅事件渲染进度条和结果列表，点击结果跳转章节并高亮命中位置。

**Architecture:**
- 后端新增 `fullbook_search` 命令，签名 `(book_url, keyword, on_event: Channel<FullBookSearchEvent>)`。
- 事件类型用 `#[serde(tag = "type", rename_all = "snake_case")]` 枚举：`Started` / `Hit` / `ChapterScanned` / `Done` / `Failed`。
- 单章 > 1000 命中截断（发一个 `Hit` 后跳到下一章），避免大章阻塞。
- 取消通过 `AppState.fullbook_search_cancel_tx: watch::Sender<bool>`；前端在 `useEffect` cleanup 发送取消信号。
- 前端 `FullBookSearchPanel` 组件订阅 Channel 事件，渲染进度条 + 结果列表 + 跳转按钮。
- 高亮通过 `domHighlight.flashRange(contentRef, position, length)` 闪黄色 1.5 秒。

**Tech Stack:** Tauri v2 (Channel API) + rusqlite (LIKE 匹配) + React 18 + TypeScript

**Spec:** [`docs/superpowers/specs/2026-06-16-reader-core-and-fullbook-search-design.md`](../../specs/2026-06-16-reader-core-and-fullbook-search-design.md) §3.4

---

## File Structure

### 新增文件

| 文件 | 责任 |
|------|------|
| `src-tauri/src/book_source/fullbook_search.rs` | 全书搜索核心逻辑（DAO 风格的纯函数，输入 `&Connection`） |
| `src/components/reader/fullbookSearch.ts` | 全书搜索 IPC 客户端 + Channel 订阅工具 |
| `src/components/reader/domHighlight.ts` | DOM Range 闪高亮辅助（与计划 A 共享） |
| `src/components/reader/FullBookSearchPanel.tsx` | 搜索面板 UI（输入、进度、结果列表） |
| `src/components/reader/FullBookSearchPanel.module.css` | 面板样式 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `src-tauri/src/commands.rs` | 新增 `fullbook_search` 命令，注册 Channel 事件类型 |
| `src-tauri/src/lib.rs` | `invoke_handler!` 注册新命令 |
| `src-tauri/src/state.rs` | 新增 `fullbook_search_cancel_tx: watch::Sender<bool>` |
| `src/pages/Reader.tsx` | 接入 `FullBookSearchPanel` |
| `src/i18n/locales/zh.json` + `en.json` | 新增 `reader.fullBookSearch.*` 8 个 key |

---

## Task 1: 后端 FullBookSearchEvent 类型

**Files:**
- Create: `src-tauri/src/book_source/fullbook_search.rs`
- Modify: `src-tauri/src/book_source/mod.rs`

- [ ] **Step 1: 在 `mod.rs` 中加入 `pub mod fullbook_search;`**

找到 `src-tauri/src/book_source/mod.rs`，在已有 `pub mod` 列表末尾追加一行：

```rust
pub mod fullbook_search;
```

- [ ] **Step 2: 创建 `fullbook_search.rs`，定义事件类型与常量**

```rust
use serde::Serialize;

pub const PER_CHAPTER_MATCH_LIMIT: usize = 1000;
pub const SNIPPET_RADIUS: usize = 30;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum FullBookSearchEvent {
    Started {
        total_chapters: i32,
    },
    Hit {
        chapter_index: i32,
        chapter_title: String,
        snippet: String,
        position: i32,
        match_count: i32,
    },
    ChapterScanned {
        chapter_index: i32,
        scanned: i32,
        total: i32,
    },
    Done {
        total_hits: i32,
        elapsed_ms: i32,
    },
    Failed {
        error: String,
    },
}
```

- [ ] **Step 3: 编译**

Run: `cd src-tauri && cargo check`
Expected: 编译通过。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/book_source/fullbook_search.rs src-tauri/src/book_source/mod.rs
git commit -m "feat(backend): add FullBookSearchEvent enum"
```

---

## Task 2: 后端全章搜索纯函数（接收 `&Connection`）

**Files:**
- Modify: `src-tauri/src/book_source/fullbook_search.rs`

- [ ] **Step 1: 追加 `run_fullbook_search` 核心函数**

```rust
use rusqlite::{params, Connection};
use std::time::Instant;

pub fn run_fullbook_search<F: FnMut(FullBookSearchEvent)>(
    conn: &Connection,
    book_url: &str,
    keyword: &str,
    mut emit: F,
) {
    let started = Instant::now();
    if keyword.is_empty() {
        emit(FullBookSearchEvent::Failed {
            error: "empty keyword".to_string(),
        });
        return;
    }

    // 1. 查章节总数
    let total_chapters: i32 = match conn.query_row(
        "SELECT COUNT(*) FROM book_chapters WHERE bookUrl = ?1",
        params![book_url],
        |row| row.get(0),
    ) {
        Ok(n) => n,
        Err(e) => {
            emit(FullBookSearchEvent::Failed { error: e.to_string() });
            return;
        }
    };

    emit(FullBookSearchEvent::Started { total_chapters });

    // 2. 拉所有章节（index, title, content）
    let mut stmt = match conn.prepare(
        r#"SELECT bc.chapterIndex, bc.chapterName, COALESCE(cc.content, '')
           FROM book_chapters bc
           LEFT JOIN chapter_contents cc
             ON cc.bookUrl = bc.bookUrl AND cc.chapterUrl = bc.chapterUrl
           WHERE bc.bookUrl = ?1
           ORDER BY bc.chapterIndex"#,
    ) {
        Ok(s) => s,
        Err(e) => {
            emit(FullBookSearchEvent::Failed { error: e.to_string() });
            return;
        }
    };

    let rows = match stmt.query_map(params![book_url], |row| {
        Ok((
            row.get::<_, i32>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    }) {
        Ok(r) => r,
        Err(e) => {
            emit(FullBookSearchEvent::Failed { error: e.to_string() });
            return;
        }
    };

    let mut total_hits: i32 = 0;
    let mut scanned: i32 = 0;
    for row in rows {
        let (idx, title, content) = match row {
            Ok(t) => t,
            Err(e) => {
                emit(FullBookSearchEvent::Failed { error: e.to_string() });
                return;
            }
        };
        scanned += 1;
        let count = content.matches(keyword).count();
        if count > 0 {
            let first_pos = content.find(keyword).unwrap_or(0);
            let snippet = build_snippet(&content, first_pos, keyword.len());
            let truncated_count = count.min(PER_CHAPTER_MATCH_LIMIT) as i32;
            total_hits += truncated_count;
            emit(FullBookSearchEvent::Hit {
                chapter_index: idx,
                chapter_title: title.clone(),
                snippet,
                position: first_pos as i32,
                match_count: truncated_count,
            });
        }
        emit(FullBookSearchEvent::ChapterScanned {
            chapter_index: idx,
            scanned,
            total: total_chapters,
        });
    }

    emit(FullBookSearchEvent::Done {
        total_hits,
        elapsed_ms: started.elapsed().as_millis() as i32,
    });
}

fn build_snippet(content: &str, pos: usize, kw_len: usize) -> String {
    let start = pos.saturating_sub(SNIPPET_RADIUS);
    let end = (pos + kw_len + SNIPPET_RADIUS).min(content.len());
    let mut s = String::new();
    if start > 0 {
        s.push('…');
    }
    s.push_str(&content[start..end]);
    if end < content.len() {
        s.push('…');
    }
    s
}
```

- [ ] **Step 2: 编译**

Run: `cd src-tauri && cargo check`
Expected: 编译通过。

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/book_source/fullbook_search.rs
git commit -m "feat(backend): implement fullbook_search core logic"
```

---

## Task 3: 后端全章搜索单元测试

**Files:**
- Modify: `src-tauri/src/book_source/fullbook_search.rs`

- [ ] **Step 1: 在文件末尾追加 `#[cfg(test)] mod tests`**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE book_chapters (
                bookUrl TEXT NOT NULL,
                chapterUrl TEXT NOT NULL,
                chapterIndex INTEGER NOT NULL,
                chapterName TEXT
            );
            CREATE TABLE chapter_contents (
                bookUrl TEXT NOT NULL,
                chapterUrl TEXT NOT NULL,
                content TEXT
            );
            "#,
        )
        .unwrap();
        conn
    }

    fn insert_chapter(conn: &Connection, idx: i32, title: &str, content: &str) {
        let url = format!("ch{}", idx);
        conn.execute(
            "INSERT INTO book_chapters (bookUrl, chapterUrl, chapterIndex, chapterName) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params!["book1", url, idx, title],
        ).unwrap();
        conn.execute(
            "INSERT INTO chapter_contents (bookUrl, chapterUrl, content) VALUES (?1, ?2, ?3)",
            rusqlite::params!["book1", url, content],
        ).unwrap();
    }

    #[test]
    fn emits_started_done_and_correct_total() {
        let conn = setup_test_db();
        insert_chapter(&conn, 0, "第一章", "苹果和香蕉");
        insert_chapter(&conn, 1, "第二章", "香蕉和苹果");
        insert_chapter(&conn, 2, "第三章", "橘子");
        let mut events = Vec::new();
        run_fullbook_search(&conn, "book1", "苹果", |e| events.push(e));
        assert!(matches!(events[0], FullBookSearchEvent::Started { total_chapters: 3 }));
        let done = events.last().unwrap();
        match done {
            FullBookSearchEvent::Done { total_hits, .. } => assert_eq!(*total_hits, 2),
            _ => panic!("expected Done event"),
        }
    }

    #[test]
    fn snippet_truncates_with_ellipsis() {
        let s = "abcdefghijklmnopqrstuvwxyz";
        let snippet = build_snippet(s, 10, 3);
        assert!(snippet.starts_with('…'));
        assert!(snippet.ends_with('…'));
    }

    #[test]
    fn empty_keyword_emits_failed() {
        let conn = setup_test_db();
        insert_chapter(&conn, 0, "X", "anything");
        let mut events = Vec::new();
        run_fullbook_search(&conn, "book1", "", |e| events.push(e));
        assert!(matches!(events[0], FullBookSearchEvent::Failed { .. }));
    }

    #[test]
    fn chapter_with_no_content_is_scanned_but_no_hit() {
        let conn = setup_test_db();
        conn.execute(
            "INSERT INTO book_chapters (bookUrl, chapterUrl, chapterIndex, chapterName) VALUES ('book1', 'ch0', 0, 'X')",
            [],
        ).unwrap();
        let mut events = Vec::new();
        run_fullbook_search(&conn, "book1", "key", |e| events.push(e));
        let hits: Vec<_> = events.iter().filter(|e| matches!(e, FullBookSearchEvent::Hit { .. })).collect();
        assert_eq!(hits.len(), 0);
    }
}
```

- [ ] **Step 2: 跑测试**

Run: `cd src-tauri && cargo test fullbook_search::`
Expected: 4 个测试全通过。

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/book_source/fullbook_search.rs
git commit -m "test(backend): add unit tests for fullbook_search"
```

---

## Task 4: 在 AppState 加入取消信号

**Files:**
- Modify: `src-tauri/src/state.rs`

- [ ] **Step 1: 读取现有 AppState 字段定位**

Run: `grep -n "search_cancel_tx\|AppState" src-tauri/src/state.rs | head -20`
Expected: 列出 AppState 的现有字段。

- [ ] **Step 2: 在 AppState 结构体中追加新字段**

在 `search_cancel_tx` 字段后追加：

```rust
pub fullbook_search_cancel_tx: tokio::sync::watch::Sender<bool>,
```

并在 `AppState::new()` 函数（或其他初始化位置）里初始化：

```rust
let (fullbook_search_cancel_tx, _) = tokio::sync::watch::channel(false);
```

> 提示：实际初始化代码请按 AppState::new 的现有风格对齐。

- [ ] **Step 3: 编译**

Run: `cd src-tauri && cargo check`
Expected: 编译通过。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/state.rs
git commit -m "feat(backend): add fullbook_search_cancel_tx to AppState"
```

---

## Task 5: Tauri 命令 `fullbook_search`

**Files:**
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: 在 `commands.rs` 中加入导入**

找到文件顶部 `use` 块，加入：

```rust
use crate::book_source::fullbook_search::{run_fullbook_search, FullBookSearchEvent};
```

- [ ] **Step 2: 找到现有的 `add_bookmark` 命令位置（约 683 行）作为锚点，在其后追加新命令**

```rust
/// Full-book search: streams matches across all chapters via Tauri Channel.
#[tauri::command]
pub async fn fullbook_search(
    app_handle: tauri::AppHandle,
    book_url: String,
    keyword: String,
    on_event: tauri::Channel<FullBookSearchEvent>,
) -> ApiResponse<()> {
    let pool = match crate::state::get_app_state(&app_handle).ok_or("state missing") {
        Ok(p) => p.db.clone(),
        Err(e) => {
            let _ = on_event.send(FullBookSearchEvent::Failed {
                error: e.to_string(),
            });
            return ApiResponse::error(e.to_string());
        }
    };

    let cancel_rx = {
        let state = crate::state::get_app_state(&app_handle).unwrap();
        state.fullbook_search_cancel_tx.subscribe()
    };

    let kw = keyword.clone();
    let url = book_url.clone();
    let channel = on_event.clone();
    let handle = tauri::async_runtime::spawn_blocking(move || {
        let conn = match pool.get() {
            Ok(c) => c,
            Err(e) => {
                let _ = channel.send(FullBookSearchEvent::Failed {
                    error: e.to_string(),
                });
                return;
            }
        };
        run_fullbook_search(&conn, &url, &kw, |event| {
            let _ = channel.send(event);
        });
    });

    // 监听取消信号
    let cancel_handle = tokio::spawn({
        let mut rx = cancel_rx;
        async move {
            if rx.changed().await.is_ok() && *rx.borrow() {
                handle.abort();
            }
        }
    });

    let _ = cancel_handle.await;
    ApiResponse::ok(())
}
```

> 注：实际可能需要根据 `AppState` 与 `db pool` 的现有访问方式微调。先用 `grep -n "fn add_bookmark\|AppState\|get_app_state" src-tauri/src/state.rs src-tauri/src/commands.rs | head -20` 确认现有 API，再调整。

- [ ] **Step 3: 编译**

Run: `cd src-tauri && cargo check`
Expected: 编译通过（可能有微调 warning，按提示修复）。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs
git commit -m "feat(backend): add fullbook_search Tauri command with channel streaming"
```

---

## Task 6: lib.rs 注册命令

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 在 `invoke_handler!` 宏中加入 `fullbook_search`**

Run: `grep -n "invoke_handler\|add_bookmark" src-tauri/src/lib.rs`
Expected: 列出 invoke_handler 块。

在 `tauri::generate_handler![...]` 的列表中加入：

```rust
fullbook_search,
```

（按现有字母或功能分组顺序追加到合适位置。）

- [ ] **Step 2: 编译**

Run: `cd src-tauri && cargo check`
Expected: 编译通过。

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(backend): register fullbook_search command"
```

---

## Task 7: 前端 fullbookSearch.ts（IPC 客户端 + Channel 订阅）

**Files:**
- Create: `src/components/reader/fullbookSearch.ts`

- [ ] **Step 1: 创建文件**

```ts
import { invoke, Channel } from '@tauri-apps/api/core';

export type FullBookSearchHit = {
  type: 'hit';
  chapter_index: number;
  chapter_title: string;
  snippet: string;
  position: number;
  match_count: number;
};

export type FullBookSearchStarted = {
  type: 'started';
  total_chapters: number;
};

export type FullBookSearchChapterScanned = {
  type: 'chapter_scanned';
  chapter_index: number;
  scanned: number;
  total: number;
};

export type FullBookSearchDone = {
  type: 'done';
  total_hits: number;
  elapsed_ms: number;
};

export type FullBookSearchFailed = {
  type: 'failed';
  error: string;
};

export type FullBookSearchEvent =
  | FullBookSearchStarted
  | FullBookSearchHit
  | FullBookSearchChapterScanned
  | FullBookSearchDone
  | FullBookSearchFailed;

export type FullBookSearchHandlers = {
  onStarted?: (e: FullBookSearchStarted) => void;
  onHit?: (e: FullBookSearchHit) => void;
  onProgress?: (e: FullBookSearchChapterScanned) => void;
  onDone?: (e: FullBookSearchDone) => void;
  onFailed?: (e: FullBookSearchFailed) => void;
};

export function startFullBookSearch(
  bookUrl: string,
  keyword: string,
  handlers: FullBookSearchHandlers,
): { channel: Channel<FullBookSearchEvent>; promise: Promise<void> } {
  const channel = new Channel<FullBookSearchEvent>();
  channel.onmessage = (e) => {
    switch (e.type) {
      case 'started':
        handlers.onStarted?.(e);
        break;
      case 'hit':
        handlers.onHit?.(e);
        break;
      case 'chapter_scanned':
        handlers.onProgress?.(e);
        break;
      case 'done':
        handlers.onDone?.(e);
        break;
      case 'failed':
        handlers.onFailed?.(e);
        break;
    }
  };
  const promise = invoke<void>('fullbook_search', {
    bookUrl,
    keyword,
    onEvent: channel,
  });
  return { channel, promise };
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add src/components/reader/fullbookSearch.ts
git commit -m "feat(reader): add fullbookSearch IPC client with Channel events"
```

---

## Task 8: 前端 domHighlight.ts

**Files:**
- Create: `src/components/reader/domHighlight.ts`

- [ ] **Step 1: 创建文件**

```ts
const FLASH_CLASS = 'reader-flash-highlight';
const FLASH_DURATION_MS = 1500;

function ensureStyleInjected() {
  if (document.getElementById('reader-flash-style')) return;
  const style = document.createElement('style');
  style.id = 'reader-flash-style';
  style.textContent = `
    @keyframes reader-flash {
      0%, 100% { background-color: transparent; }
      30%, 70% { background-color: rgba(255, 220, 0, 0.5); }
    }
    .${FLASH_CLASS} {
      animation: reader-flash ${FLASH_DURATION_MS}ms ease-in-out;
      border-radius: 2px;
    }
  `;
  document.head.appendChild(style);
}

export function flashRange(
  container: HTMLElement | null,
  position: number,
  length: number,
): void {
  if (!container) return;
  ensureStyleInjected();

  // 在 container 的文本节点里定位 position
  let remaining = position;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
  let target: Text | null = null;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const t = node as Text;
    if (remaining <= t.data.length) {
      target = t;
      break;
    }
    remaining -= t.data.length;
  }
  if (!target) return;

  const range = document.createRange();
  try {
    range.setStart(target, Math.max(0, remaining));
    range.setEnd(target, Math.min(target.data.length, remaining + length));
  } catch {
    return;
  }

  const span = document.createElement('span');
  span.className = FLASH_CLASS;
  try {
    range.surroundContents(span);
  } catch {
    // surroundContents 在跨越元素边界时会失败，此时用 marker + 滚动即可
    span.appendChild(range.extractContents());
  }
  span.scrollIntoView({ behavior: 'smooth', block: 'center' });
  window.setTimeout(() => {
    const parent = span.parentNode;
    if (!parent) return;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
  }, FLASH_DURATION_MS);
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add src/components/reader/domHighlight.ts
git commit -m "feat(reader): add domHighlight flashRange utility"
```

---

## Task 9: i18n key 补齐（fullBookSearch）

**Files:**
- Modify: `src/i18n/locales/zh.json`
- Modify: `src/i18n/locales/en.json`

- [ ] **Step 1: 在 zh.json 的 `reader` 对象下补齐**

```json
"fullBookSearch": {
  "title": "全书搜索",
  "keyword": "搜索关键字",
  "search": "搜索",
  "scanning": "正在扫描章节",
  "noResults": "未找到匹配",
  "cancel": "取消搜索",
  "jumpTo": "跳转到此处",
  "matches": "{count} 处匹配",
  "chapterScanned": "已扫描 {scanned}/{total} 章"
}
```

- [ ] **Step 2: 在 en.json 补齐**

```json
"fullBookSearch": {
  "title": "Search in Book",
  "keyword": "Keyword",
  "search": "Search",
  "scanning": "Scanning chapters",
  "noResults": "No matches found",
  "cancel": "Cancel",
  "jumpTo": "Jump to here",
  "matches": "{count} match(es)",
  "chapterScanned": "Scanned {scanned}/{total} chapters"
}
```

- [ ] **Step 3: 验证 JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/i18n/locales/zh.json'))" && node -e "JSON.parse(require('fs').readFileSync('src/i18n/locales/en.json'))"`
Expected: 无输出。

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales/zh.json src/i18n/locales/en.json
git commit -m "feat(reader): add i18n keys for full book search"
```

---

## Task 10: FullBookSearchPanel 组件

**Files:**
- Create: `src/components/reader/FullBookSearchPanel.tsx`
- Create: `src/components/reader/FullBookSearchPanel.module.css`

- [ ] **Step 1: 创建 CSS**

```css
.panel {
  position: fixed;
  top: 64px;
  right: 16px;
  width: 360px;
  max-height: calc(100vh - 96px);
  background: var(--reader-menu-bg, #ffffff);
  color: var(--reader-menu-text, #1a1a2e);
  border: 1px solid var(--reader-menu-border, #e8e8f0);
  border-radius: 12px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.12);
  z-index: 80;
  display: flex;
  flex-direction: column;
  font-size: 14px;
}

.header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--reader-menu-border, #e8e8f0);
  font-weight: 600;
}

.inputRow {
  display: flex;
  gap: 8px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--reader-menu-border, #e8e8f0);
}

.inputRow input {
  flex: 1;
  padding: 6px 8px;
  border: 1px solid var(--reader-menu-border, #e8e8f0);
  border-radius: 4px;
  font-size: 14px;
}

.inputRow button {
  padding: 6px 12px;
  cursor: pointer;
}

.progress {
  padding: 8px 16px;
  font-size: 12px;
  color: var(--reader-menu-text, #1a1a2e);
  opacity: 0.7;
}

.bar {
  height: 4px;
  background: rgba(0, 0, 0, 0.08);
  border-radius: 2px;
  overflow: hidden;
  margin-top: 4px;
}

.barFill {
  height: 100%;
  background: #1890ff;
  transition: width 200ms ease-out;
}

.results {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.empty {
  padding: 24px 16px;
  text-align: center;
  opacity: 0.6;
}

.item {
  padding: 8px 16px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.04);
  cursor: pointer;
}

.item:hover {
  background: rgba(0, 0, 0, 0.04);
}

.itemTitle {
  font-weight: 500;
  margin-bottom: 4px;
}

.itemSnippet {
  font-size: 13px;
  opacity: 0.85;
  margin-bottom: 4px;
}

.itemMeta {
  font-size: 12px;
  opacity: 0.6;
}

.item mark {
  background: rgba(255, 220, 0, 0.6);
  padding: 0 2px;
  border-radius: 2px;
}

.cancel {
  padding: 8px 16px;
  border-top: 1px solid var(--reader-menu-border, #e8e8f0);
  text-align: right;
}
```

- [ ] **Step 2: 创建组件**

```tsx
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './FullBookSearchPanel.module.css';
import {
  startFullBookSearch,
  type FullBookSearchHit,
  type FullBookSearchEvent,
} from './fullbookSearch';

export type FullBookSearchPanelProps = {
  bookUrl: string;
  initialKeyword?: string;
  onJumpTo: (chapterIndex: number, position: number, length: number) => void;
  onClose: () => void;
};

export default function FullBookSearchPanel({
  bookUrl,
  initialKeyword = '',
  onJumpTo,
  onClose,
}: FullBookSearchPanelProps) {
  const { t } = useTranslation();
  const [keyword, setKeyword] = useState(initialKeyword);
  const [hits, setHits] = useState<FullBookSearchHit[]>([]);
  const [progress, setProgress] = useState<{ scanned: number; total: number } | null>(null);
  const [done, setDone] = useState<{ total_hits: number; elapsed_ms: number } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const channelRef = useRef<{ channel: { send?: (v: unknown) => void } } | null>(null);

  const doSearch = (kw: string) => {
    if (!kw.trim()) return;
    setHits([]);
    setProgress(null);
    setDone(null);
    setFailed(null);
    const { channel, promise } = startFullBookSearch(bookUrl, kw.trim(), {
      onStarted: (e) => setProgress({ scanned: 0, total: e.total_chapters }),
      onHit: (e) => setHits((prev) => [...prev, e]),
      onProgress: (e) => setProgress({ scanned: e.scanned, total: e.total }),
      onDone: (e) => setDone(e),
      onFailed: (e) => setFailed(e.error),
    });
    channelRef.current = channel as never;
    promise.catch((err) => setFailed(String(err)));
  };

  useEffect(() => {
    if (initialKeyword) doSearch(initialKeyword);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const kw = keyword.trim();
  const showProgress = progress && !done;
  const pct = progress && progress.total > 0 ? (progress.scanned / progress.total) * 100 : 0;

  return (
    <div
      className={styles.panel}
      role="dialog"
      aria-label={t('reader.fullBookSearch.title')}
      data-testid="fullbook-search-panel"
    >
      <div className={styles.header}>{t('reader.fullBookSearch.title')}</div>
      <div className={styles.inputRow}>
        <input
          type="text"
          value={keyword}
          placeholder={t('reader.fullBookSearch.keyword')}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') doSearch(keyword);
            if (e.key === 'Escape') onClose();
          }}
          autoFocus
        />
        <button type="button" onClick={() => doSearch(keyword)} disabled={!kw}>
          {t('reader.fullBookSearch.search')}
        </button>
      </div>

      {showProgress && (
        <div className={styles.progress}>
          {t('reader.fullBookSearch.chapterScanned', {
            scanned: progress!.scanned,
            total: progress!.total,
          })}
          <div className={styles.bar}>
            <div className={styles.barFill} style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {done && hits.length === 0 && (
        <div className={styles.empty}>{t('reader.fullBookSearch.noResults')}</div>
      )}

      {failed && <div className={styles.empty} role="alert">{failed}</div>}

      <div className={styles.results}>
        {hits.map((h, i) => (
          <div
            key={`${h.chapter_index}-${i}`}
            className={styles.item}
            onClick={() => onJumpTo(h.chapter_index, h.position, h.snippet.length)}
          >
            <div className={styles.itemTitle}>
              第 {h.chapter_index + 1} 章 · {h.chapter_title}
            </div>
            <div
              className={styles.itemSnippet}
              dangerouslySetInnerHTML={{ __html: highlightSnippet(h.snippet, kw) }}
            />
            <div className={styles.itemMeta}>
              {t('reader.fullBookSearch.matches', { count: h.match_count })}
              <button
                type="button"
                style={{ marginLeft: 8 }}
                onClick={(e) => {
                  e.stopPropagation();
                  onJumpTo(h.chapter_index, h.position, h.snippet.length);
                }}
              >
                {t('reader.fullBookSearch.jumpTo')}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className={styles.cancel}>
        <button type="button" onClick={onClose}>
          {t('common.close', { defaultValue: 'Close' })}
        </button>
      </div>
    </div>
  );
}

function highlightSnippet(snippet: string, keyword: string): string {
  if (!keyword) return escapeHtml(snippet);
  const re = new RegExp(escapeRegExp(keyword), 'gi');
  return escapeHtml(snippet).replace(re, (m) => `<mark>${m}</mark>`);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
```

- [ ] **Step 3: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
git add src/components/reader/FullBookSearchPanel.tsx src/components/reader/FullBookSearchPanel.module.css
git commit -m "feat(reader): add FullBookSearchPanel with progress and results"
```

---

## Task 11: Reader.tsx 接入搜索面板

**Files:**
- Modify: `src/pages/Reader.tsx`

- [ ] **Step 1: 在 Reader.tsx 顶部 import 加入**

```tsx
import FullBookSearchPanel from '../components/reader/FullBookSearchPanel';
import { flashRange } from '../components/reader/domHighlight';
```

- [ ] **Step 2: 找到现有的 `ReaderPanel` 状态（约 118 行）和 readerPanel 状态，加入新的 searchPanel 控制**

```tsx
const [searchKeyword, setSearchKeyword] = useState<string | null>(null);
```

- [ ] **Step 3: 在 return JSX 末尾（约 Task 9 步骤 7 之后）追加搜索面板渲染**

```tsx
{searchKeyword !== null && (
  <FullBookSearchPanel
    bookUrl={book?.url ?? ''}
    initialKeyword={searchKeyword}
    onJumpTo={(chapterIndex, position, length) => {
      setSearchKeyword(null);
      if (chapterIndex !== idx) {
        goToChapter(chapterIndex);
      }
      // 给章节切换留时间挂载 DOM
      window.setTimeout(() => {
        flashRange(contentRef.current, position, length);
      }, 400);
    }}
    onClose={() => setSearchKeyword(null)}
  />
)}
```

- [ ] **Step 4: 让右键菜单「在书中搜索」触发面板**

找到右键菜单构建中 `setReaderPanel('search')` 的位置（计划 A 任务 9.7），改为：

```tsx
onSelect: () => { setSearchKeyword(text); },
```

并在 `useReaderNav` 的 `onOpenSearch` 回调中也改为：

```tsx
onOpenSearch: () => setSearchKeyword(''),
```

- [ ] **Step 5: 类型检查 + 构建**

Run: `pnpm exec tsc --noEmit && pnpm build`
Expected: 两者都成功。

- [ ] **Step 6: Commit**

```bash
git add src/pages/Reader.tsx
git commit -m "feat(reader): wire FullBookSearchPanel into Reader"
```

---

## Task 12: Lint + Smoke

- [ ] **Step 1: Lint**

Run: `pnpm lint`
Expected: 无 error。

- [ ] **Step 2: Smoke**

Run: `pnpm test:smoke`
Expected: 通过。

- [ ] **Step 3: 手动验证（dev）**

1. 打开任一本书
2. 点击右侧浮动按钮的搜索图标（或右键选中文字→「在书中搜索」）
3. 输入关键字 → 看到进度条 + 结果列表
4. 点击结果 → 跳转到对应章节 + 黄色高亮闪 1.5 秒
5. 5 章内的小书应 < 1 秒完成

- [ ] **Step 4: 修复发现的问题并 commit**

```bash
git add -A
git commit -m "fix(reader): address fullbook search smoke/lint findings"
```

---

## Spec Coverage Check

| Spec § | 任务 | 状态 |
|--------|------|------|
| §3.4.1 Tauri Channel 命令 | Task 5 | ✅ |
| §3.4.2 SQL 查询 | Task 2 | ✅ |
| §3.4.3 性能（截断 + 取消 + 超时） | Task 2 + Task 4 + Task 5 | ✅ |
| §3.4.4 前端 UI | Task 10 | ✅ |
| §3.7 i18n（fullBookSearch） | Task 9 | ✅ |
