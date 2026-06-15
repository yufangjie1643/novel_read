# Reader 核心增强包 + 全书搜索 & 进度同步设计

**日期**：2026-06-16
**项目**：Legado Desktop (Tauri v2 + React + TypeScript + Rust)
**范围**：在 Desktop 端实现阅读器核心增强（A）+ 全书搜索与按书进度同步（C）

> 本设计在功能层与 Android 版对等，但交互层全部按桌面端习惯（鼠标、键盘、大屏、参考起点中文网桌面网页版）重新设计，不做 1:1 复刻。

---

## 1. 目标与原则

### 1.1 目标

在 Desktop Reader 中补齐以下能力，让桌面端的「核心阅读 + 高阶辅助」体验与 Android 版对等：

1. **Reader 核心增强包 A**
   - 书签：阅读过程中添加/编辑书签
   - 右键上下文菜单：选中文本→文本操作，空白处→页面操作（统一入口）
   - 仿起点桌面版导航：顶部 sticky 工具栏、右侧浮动按钮、章节末自动加载
2. **全书搜索与进度同步 C**
   - 全书搜索：跨所有章节搜索关键字
   - 按书进度同步：通过 WebDAV 同步当前书籍的阅读进度（与 Android 行为一致）

### 1.2 原则

- **后端优先复用**：A 全部功能后端已具备（书签 CRUD 已注册于 `commands.rs:679-724`），只补前端；C 需要新增后端能力。
- **交互适配桌面**：参考 `C:\Users\pc\Desktop\test.html`（起点中文网桌面阅读页），使用浮动工具栏、sticky 顶部栏、滚动加载、右侧固定按钮的模式。
- **效率优先**：搜索走 Rust 端 SQL LIKE 匹配 + Tauri `Channel<SearchEvent>` 流式返回，避免前端逐章拉取。
- **按时间戳覆盖同步**：与 Android Legado `syncBookProgress` 行为一致。

---

## 2. 架构总览

### 2.1 模块划分

| 模块 | 类型 | 责任 |
|------|------|------|
| `BookmarkButton` | 新组件 | 右侧固定书签按钮（仿起点），点击后弹出现有 `Bookmarks` 弹层 |
| `ContextMenu` | 新组件 | 监听 `contextmenu`，按选区状态分流：选中文本→文本操作菜单，空白处→页面操作菜单 |
| `ShortcutsHelpModal` | 新组件 | `?` 触发的快捷键帮助模态弹层 |
| `NavSettingsPopover` | 新组件 | 顶部菜单「导航设置」弹层，含 4 个 checkbox |
| `FullBookSearchPanel` | 新组件 | 全书搜索面板，进度条 + 结果列表，点击跳转章节并高亮 |
| `bookmarkActions.ts` | 新模块 | 书签 CRUD 包装（`add_bookmark` / `update_bookmark` / `delete_bookmark`） |
| `domHighlight.ts` | 新模块 | DOM Range 位置高亮辅助（搜索结果跳转、字典查询） |
| `navPrefs.ts` | 新模块 | 导航偏好定义（sticky 工具栏、自动加载、浮动按钮、键盘快捷键） |
| `shortcuts.ts` | 新模块 | 键盘快捷键统一注册与分派 |
| `fullbookSearch.ts` | 新模块 | 全书搜索 IPC 客户端，订阅 Tauri Channel 事件 |
| `commands::fullbook_search` | 新命令 | 流式全书搜索 |
| `commands::sync_book_progress` | 新命令 | 单书进度上传/下载/状态查询 |
| `db::dao::BookProgressDao` | 新 DAO | 同步元数据表（`book_progress_sync`） |
| `db::migrations::vXX` | 新迁移 | `book_progress_sync` 表 |

### 2.2 数据流

**书签添加**（右键菜单路径）：

```
User → 选中文本 → 右键点击
     → 文本操作菜单（§3.2.3）出现
     → 点击「添加书签」
     → bookmarkActions.addBookmark({
         bookName, bookAuthor, chapterName, bookUrl, chapterUrl,
         chapterIndex, pageIndex: 0, content: selectedText
       })
     → invoke('add_bookmark', { bookmark })
     → BookmarkDao::insert → 返回 id
     → 显示 toast「书签已添加」
```

**全文搜索**：

```
User → 打开 FullBookSearchPanel
     → 输入关键字 → 触发搜索
     → invoke('fullbook_search', { bookUrl, keyword, channel })
     → Rust 端:
         1. 查询 book_chapters JOIN chapter_contents
         2. 按 chapterIndex 顺序 LIKE '%keyword%' 匹配
         3. 每命中一条 → channel.send(SearchHit { chapterIndex, title, snippet, position })
         4. 结束 → channel.send(SearchDone { total })
     → 前端: 收到 event → 追加到结果列表
     → 用户点击结果 → 跳转章节 + 滚动到高亮位置
```

**按书进度同步**：

```
User → 在设置中点击「同步进度到 WebDAV」
     → invoke('sync_book_progress', { bookUrl, direction: 'upload' })
     → Rust 端:
         1. 读 Book 表 → 取 dur_chapter_index/pos/title/time + readTime
         2. 读 book_progress_sync 表 → 取 last_local_time / last_remote_time
         3. 若本地时间 > 远端时间 → 上传 JSON 到 WebDAV `/legado-progress/{bookName}.json`
         4. 更新 last_remote_time = upload time
     → 返回 SyncResult { direction, status: 'uploaded' | 'skipped-remote-newer' }
```

---

## 3. 详细设计

### 3.1 书签（Reader 内添加）

#### 3.1.1 入口（3 个）

1. **顶部菜单「书签」按钮**：仿起点的"添加书签"按钮（页面右侧 `position: sticky; top: 0; right: 64px;`），点击后弹出 `bookmarkForm`。
2. **右键菜单「添加书签」**：选中文本后右键 → 文本操作菜单 → 添加书签（见 §3.2.3）。
3. **快捷键 `Ctrl+D`**：添加当前章节书签（位置 = 滚动百分比 × 1000，转 `pageIndex`）。

#### 3.1.2 Bookmark 数据结构（沿用后端 `Bookmark` 模型）

```rust
pub struct Bookmark {
    pub id: Option<i64>,
    pub book_name: String,
    pub book_author: String,
    pub chapter_name: Option<String>,
    pub book_url: Option<String>,
    pub chapter_url: Option<String>,
    pub chapter_index: i32,
    pub page_index: i32,    // Reader 当前为 0（无真实分页）；为未来预留
    pub content: Option<String>,  // 选中文字；整章添加时 = 章节首 200 字
}
```

#### 3.1.3 UI 形态

- 顶部菜单点击「添加书签」→ 弹出小型 Modal：
  - 字段：标题（默认章节名）、正文（默认选中文字 / 章节首 200 字）、提交 / 取消
  - 提交后调 `add_bookmark`，toast 提示成功
- 弹层用现有 `Bookmarks` 列表里抽出的 `BookmarkListItem` 子组件，避免重复。

### 3.2 文字选择浮动工具栏

#### 3.2.1 设计原则：取消独立浮动工具栏，统一走右键菜单

经过桌面端交互模式对比（见 §3.6.2），决定**取消 `SelectionToolbar` 浮动工具栏**，**全部走右键菜单**。理由：

1. **学习成本低**：所有操作都集中在右键里，用户只需掌握一种入口。
2. **与桌面端主流一致**：Notion、微信读书网页、VS Code 都用右键菜单承担文本操作。
3. **Webview 兼容性**：Tauri Webview 中右键默认会触发系统菜单，必须 `preventDefault` 拦截；拦截后我们完全控制，避免和系统菜单冲突。
4. **避免双重 UI**：浮动工具栏 + 右键菜单同时存在会让用户困惑该用哪个。

#### 3.2.2 触发与分流逻辑

```ts
useEffect(() => {
  const handler = (e: MouseEvent) => {
    // 仅在阅读内容容器内拦截
    if (!contentRef.current?.contains(e.target as Node)) return;
    e.preventDefault();

    const sel = window.getSelection();
    const selectedText = sel ? sel.toString().trim() : '';
    const hasSelection = selectedText.length >= 1 && selectedText.length <= 500;

    if (hasSelection) {
      // 路径 A：选中后右键 → 文本操作菜单
      setContextMenu({
        x: e.clientX, y: e.clientY, kind: 'text', selectedText
      });
    } else {
      // 路径 B：空白处右键 → 页面操作菜单
      setContextMenu({ x: e.clientX, y: e.clientY, kind: 'page' });
    }
  };
  document.addEventListener('contextmenu', handler);
  return () => document.removeEventListener('contextmenu', handler);
}, []);
```

**关闭条件**（统一）：点击菜单外部 / `Esc` / 滚轮 / 任意鼠标按键（左中右）。

#### 3.2.3 路径 A：文本操作菜单

固定 5 项 + 1 项可选：

| 项 | 选中非空 | 说明 |
|---|---------|------|
| 复制 | ✓ | 调 `navigator.clipboard.writeText(selectedText)`，toast 提示 |
| 添加书签 | ✓ | 调 `bookmarkActions.addBookmark({ ..., content: selectedText })` |
| 添加替换规则 | ✓ | 打开 `ReplaceRuleEditDialog`，预填 `pattern=selectedText` |
| 在书中搜索 | ✓ | 以 selectedText 作为关键字，打开 `FullBookSearchPanel` |
| 朗读选中 | ✓ | 仅当 TTS 未在朗读时启用；调 TTS 朗读 selectedText（不切换章节） |
| 字典查询 | ✓ | 调 Tauri `open` 打开 `https://dict.baidu.com/s?wd={urlencode(selectedText)}` |

#### 3.2.4 路径 B：页面操作菜单

| 项 | 选中非空 | 说明 |
|---|---------|------|
| 上一章 | - | 跳到上一章 |
| 下一章 | - | 跳到下一章 |
| --- 分隔线 | - | |
| 打开目录 | - | 打开目录面板 |
| 切换主题 | - | 在 day/night/eink 间循环 |
| --- 分隔线 | - | |
| 打开设置 | - | 打开样式面板 |
| 退出阅读 | - | 返回书架（react-router back） |

#### 3.2.5 菜单 UI 形态

- React 组件 `ContextMenu`，单一组件接收 `kind: 'text' | 'page'` 决定渲染哪一组
- 定位：`position: fixed; left: x; top: y; z-index: 100;`
- 边界处理：若 `x + 200 > window.innerWidth` → `left = window.innerWidth - 210`；`y + 280 > window.innerHeight` → `top = window.innerHeight - 290`
- 主题色：跟读 reader theme（day/night/eink），背景 `var(--bg) + 8px blur`，文字 `var(--text)`
- 鼠标 hover 背景：`rgba(0, 0, 0, 0.06)`；键盘 `↑/↓` 选中项 `rgba(primary, 0.12)`
- 选中项带 `aria-selected="true"`，整个菜单 `role="menu"`，每项 `role="menuitem"`

### 3.3 导航交互（仿起点桌面版）

#### 3.3.1 设计原则

参考 `C:\Users\pc\Desktop\test.html`（起点中文网桌面阅读页），桌面版采用**滚动流式浏览**而非翻页：
- 顶部 64px sticky 工具栏
- 右侧固定按钮（书签、目录、设置）
- 章节末自动加载下一章（类似起点的"加载中..."占位）
- 不使用 3 区域点击翻页（桌面端滚动更自然）

#### 3.3.2 Reader 顶部 sticky 工具栏

仿起点 `<nav id="navbar" class="sticky top-0 z-2 ...">`：

- 64px 高，背景半透明 `rgba(bg, 0.92)` + `backdrop-filter: blur(8px)`，底部 1px 边框
- 内容：`[←] 书名 · 第N章 [≡目录] [Aa样式] [⚙更多] [📖书签] [↗退出]`
- 自动显隐：滚动 100px 向上 → 隐藏；滚动 100px 向下 → 显示；停止滚动 3 秒 → 显示
- 鼠标移到顶部 16px 区域 → 强制显示

#### 3.3.3 右侧固定按钮组

仿起点 `<div class="tooltip-wrapper relative flex hover-mode !absolute top-0 right-64px z-1">`：

- 位置：`position: fixed; right: 16px; top: 80px; z-index: 50;`
- 自上而下排列：
  - 书签按钮（icon: 🔖）
  - 回到顶部按钮（icon: ⬆，滚动 500px 后出现）
  - 全书搜索按钮（icon: 🔍）
- 每个按钮 44×44px，圆形，背景半透明
- hover 显示 tooltip："添加书签 / 回到顶部 / 全书搜索"

#### 3.3.4 章节末自动加载

仿起点 `<div class="flex justify-center items-center text-s-gray-400 border-t border-outline-black-8 h-152px">加载中...</div>`：

- Reader 内容容器底部预留 200px 触发区
- `IntersectionObserver` 监听触发区，进入视口后：
  1. 若有下一章 → 静默加载并 append 到内容流（不重置滚动）
  2. 若已是最后一章 → 显示「已是最后一章 + 按钮返回书架」
- 加载中显示圆形 spinner + "加载下一章..."，高度 152px，居中

#### 3.3.5 顶部「← 上一章 / 下一章 →」按钮

仿起点 breadcrumbs 的章节链：

- 顶部工具栏左侧放 `[←上一章] [当前章序号/总数] [下一章→]`
- 上一章不可用时灰显；下一章不可用时灰显
- 快捷键：`PageUp` 上一章 / `PageDown` 下一章 / `Home` 第一章 / `End` 最后一章
- 滚轮触发：滚到接近内容顶部（30px 内）+ 向上滚 → 跳到上一章（带平滑滚动回当前章末尾）

#### 3.3.6 持久化

```ts
// localStorage key: reader_nav_prefs
type ReaderNavPrefs = {
  stickyToolbar: boolean;       // 顶部 sticky 工具栏开关（默认 true）
  autoLoadNext: boolean;        // 章节末自动加载（默认 true）
  showFloatingButtons: boolean; // 右侧浮动按钮组（默认 true）
  keyboardShortcuts: boolean;   // 键盘快捷键（默认 true）
};
```

#### 3.3.7 设置入口

顶部菜单「更多」→「导航设置」→ 弹出 4 个 checkbox 配置项。

### 3.4 全书搜索

#### 3.4.1 Rust 后端命令

```rust
#[tauri::command]
pub async fn fullbook_search(
    app_handle: tauri::AppHandle,
    book_url: String,
    keyword: String,
    on_event: tauri::Channel<FullBookSearchEvent>,
) -> ApiResponse<()> {
    // ...
}
```

事件类型：

```rust
#[derive(Serialize, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum FullBookSearchEvent {
    Started { total_chapters: i32 },
    Hit {
        chapter_index: i32,
        chapter_title: String,
        snippet: String,     // 命中前后各 30 字
        position: i32,       // 字符偏移
        match_count: i32,    // 该章命中数
    },
    ChapterScanned { chapter_index: i32, scanned: i32, total: i32 },
    Done { total_hits: i32, elapsed_ms: i32 },
    Failed { error: String },
}
```

#### 3.4.2 搜索 SQL

```sql
SELECT bc.chapterIndex, bc.chapterName, cc.content
FROM book_chapters bc
LEFT JOIN chapter_contents cc
  ON cc.bookUrl = bc.bookUrl AND cc.chapterUrl = bc.chapterUrl
WHERE bc.bookUrl = ?1 AND cc.content LIKE ?2
ORDER BY bc.chapterIndex
```

参数 `?2` = `'%' || keyword || '%'`（使用参数化避免注入）。对每章内容用 Rust 端 `str::match_indices` 找出所有命中位置，构造 snippet。

#### 3.4.3 性能保障

- 单次匹配阈值：每章 >1000 命中则跳过剩余匹配，仅发第一个 + `truncated: true`，避免大章阻塞。
- 流式返回：每扫一章就发 `ChapterScanned` + 立即 `Hit`（如果命中），UI 能立即看到进度。
- 取消：复用现有 `search_cancel_tx` 模式，新增 `fullbook_search_cancel_tx: watch::Sender<bool>` 在 `AppState`。
- 前端超时：30 秒无任何事件 → 显示「搜索卡住」提示并提供取消按钮。

#### 3.4.4 前端 UI

`FullBookSearchPanel` 组件结构（替换现有章内搜索按钮触发的新面板）：

```
┌──────────────────────────────────┐
│  搜索关键字：____________  [搜索] │
│  进度：▓▓▓▓▓▓░░░░ 60% (120/200)   │
│  ─────────────────────────────── │
│  第 23 章 标题...                  │
│    "...命中片段...关键字...片段..."│
│    [跳转到此处]                   │
│  第 45 章 标题...                  │
│    ...                             │
└──────────────────────────────────┘
```

点击「跳转到此处」→ 跳章节 + Reader 滚动到 `position` 偏移，并用 `domHighlight.flashRange` 闪黄色高亮 1.5 秒。

### 3.5 按书进度同步

#### 3.5.1 新增表 `book_progress_sync`

```sql
CREATE TABLE IF NOT EXISTS book_progress_sync (
    bookUrl TEXT PRIMARY KEY,
    lastLocalTime INTEGER NOT NULL,   -- 本地 dur_chapter_time
    lastRemoteTime INTEGER NOT NULL,  -- 远端上次上传时间
    lastSyncedAt INTEGER NOT NULL,    -- 同步操作时间
    remoteEtag TEXT                    -- WebDAV ETag（可选）
);
```

#### 3.5.2 新增命令

```rust
#[tauri::command]
pub async fn sync_book_progress(
    app_handle: tauri::AppHandle,
    book_url: String,
    direction: String,  // "upload" | "download" | "auto"
) -> ApiResponse<SyncBookProgressResult> { ... }

#[tauri::command]
pub async fn get_book_sync_status(
    app_handle: tauri::AppHandle,
    book_url: String,
) -> ApiResponse<BookProgressSyncStatus> { ... }
```

#### 3.5.3 同步流程（auto 模式）

```
1. 读本地 Book → 取 (dur_chapter_index, dur_chapter_pos, dur_chapter_title, dur_chapter_time)
2. 读 book_progress_sync → 取 (lastLocalTime, lastRemoteTime, remoteEtag)
3. 下载远端 JSON: GET {webdavRoot}/legado-progress/{bookName}.json
4. 比较 lastRemoteTime:
   - 若远端不存在或 lastLocalTime > remoteJson.dur_chapter_time → 上传
   - 若 remoteJson.dur_chapter_time > lastLocalTime → 下载并应用到 Book 表
   - 相同时间戳 → 跳过
5. 更新 book_progress_sync
6. 返回 SyncBookProgressResult { status, localTime, remoteTime }
```

#### 3.5.4 WebDAV JSON 格式

```json
{
  "schemaVersion": 1,
  "bookUrl": "...",
  "bookName": "...",
  "chapterIndex": 23,
  "chapterPos": 1200,
  "chapterTitle": "第 023 章 标题",
  "chapterTime": 1718544000000,
  "readTime": 3600
}
```

#### 3.5.5 前端触发入口

- Reader 顶部菜单「云端进度」按钮 → 调 `sync_book_progress({ direction: 'auto' })`，toast 显示结果。
- 设置页「WebDAV 同步」区域新增「按书同步进度」开关，开启后每次关闭 Reader 自动触发。

### 3.6 桌面端交互补充

参考主流桌面阅读器（Calibre、微信读书网页版、起点/纵横网页版、Notion Reader）和用户研究，补充以下桌面特有交互：

#### 3.6.1 完整键盘交互表

| 快捷键 | 动作 | 备注 |
|--------|------|------|
| `←/→` | 上一章 / 下一章 | 主导航 |
| `PageUp/PageDown` | 上一章 / 下一章 | 与方向键冗余，但符合阅读器习惯 |
| `Home/End` | 第一章 / 最后一章 | 跳到首尾 |
| `Space` | 向下滚动一屏 | **不与 TTS 冲突**（按 Ctrl+Space 启停 TTS） |
| `Shift+Space` | 向上滚动一屏 | |
| `↑/↓` | 平滑滚动 | 持续按住连续滚动 |
| `Ctrl+F` | 打开搜索面板 | |
| `F3/Shift+F3` | 章内搜索下一处 / 上一处 | 沿用已有 |
| `Ctrl+D` | 添加书签 | |
| `Ctrl+Shift+D` | 打开书签列表 | |
| `Esc` | 关闭弹层 / 退出全屏 / 取消选中 | 优先级：弹层 → 全屏 → 选中 |
| `F11` | 切换全屏 | 调 Tauri `window.toggleMaximize` 不可逆时不合适，用 CSS 全屏 |
| `Ctrl+B` | 切换顶部 sticky 工具栏 | 快捷开关 |
| `?` | 弹出快捷键帮助 | 模态弹层 |

实现：用单一 `useEffect` 集中注册 `keydown` 监听，按表格分派动作；事件 preventDefault 仅在该快捷键确实生效时。

#### 3.6.2 右键上下文菜单

> 完整设计见 §3.2。本节仅列出与桌面端用户习惯的对照要点。

桌面端用右键操作是核心习惯：

- **路径分流**：选中文本后右键 → 文本操作菜单（§3.2.3）；空白处右键 → 页面操作菜单（§3.2.4）。统一拦截 `contextmenu`，按 `selection.isCollapsed` 区分。
- **拦截范围**：仅当 `event.target` 在阅读内容容器内时 `preventDefault`；其他区域（顶部工具栏、设置弹层、目录面板）保留浏览器/Tauri 默认右键行为。
- **键盘可达性**：菜单项可用 `↑/↓/Enter/Esc` 操作；菜单外用 `Shift+F10`（Windows 标准）也可调出，相当于右键键位。
- **关闭条件**：点击菜单外部 / `Esc` / 滚轮 / 任意鼠标按键（左中右）→ 关闭。

#### 3.6.3 滚轮行为

桌面端滚轮是高频交互入口：

- **滚轮向下 / 向上** → 平滑滚动内容容器（默认行为），不改
- **滚到内容容器顶部 + 继续向上滚** → 触发"跳到上一章"（节流：500ms 内最多触发一次）
- **滚到内容容器底部 + 继续向下滚** → 触发"加载下一章"（与 §3.3.4 自动加载并存；手动滚到底也算一次"主动加载"）
- **`Shift + 滚轮`** → 横向滚动（用于超宽屏双页布局预留；当前未实现双页，但保留语义）

#### 3.6.4 大屏与窗口适配

- 内容最大宽度：CSS `max-width: 720px; margin: 0 auto;`（仿 Calibre、Kindle PC 默认）
- 超宽屏（≥1920px）：内容两侧 24px 背景色留白
- 窗口宽度变化：CSS `clamp()` 控制字体/行距/段距
- 最小窗口宽度建议 600px（App 启动时不强约束；用户拖到更窄会触发横向滚动条）

#### 3.6.5 段落 hover 反馈

桌面端 hover 是核心反馈通道：

- 阅读内容容器内 `<p>` 在 `:hover` 时加 `background: rgba(0, 0, 0, 0.03)`（暗色主题 `rgba(255, 255, 255, 0.05)`）
- 鼠标 cursor 在内容容器内显示 `text`；在工具栏/按钮上显示 `pointer`
- 章节标题 hover 时显示下划线 + `cursor: pointer`，点击滚动到章节顶部（单章内 anchors）

#### 3.6.6 系统集成

- **关闭前确认**：Tauri `onCloseRequested` 拦截，弹 `confirm("保存阅读进度并退出？")`，确认后调 `update_book` 存最新进度再退出
- **窗口失焦处理**：
  - `document.visibilitychange === 'hidden'` → 暂停 TTS、暂停自动翻页、停止 autoLoadNext IntersectionObserver
  - 恢复 `'visible'` → 可选恢复（自动翻页恢复，TTS 不自动恢复，避免用户错过）
- **多窗口**：本期不实现（React app 共享单 BookContext 状态，但 Tauri 多窗口需要 IPC 桥接，工作量超出范围）

#### 3.6.7 无障碍与减少动画

- 所有按钮 / 工具栏项目带 `aria-label`，图标按钮必填
- `prefers-reduced-motion: reduce` 媒体查询：禁用 pageAnim 切换、selectionToolbar 弹入动画、章节 fade-in
- 章节内容容器设 `tabindex="-1"`，让 `Esc` 焦点回到内容区
- 焦点环：`:focus-visible` 用 CSS 主题色描边，不移除默认 outline

#### 3.6.8 状态栏 / 阅读统计

仿起点 `字数 / 发布时间` 元信息，顶部工具栏折叠态显示：

- 章节字数（来自后端 `BookChapter.wordCount`，已在 schema）
- 本章已读时间（`useEffect` 累计 `time`）
- 章节进度百分比
- 当前时间（`TipValue` 已有）

### 3.7 i18n

新增 key（zh.json + en.json）：

```json
"reader": {
  "addBookmark": "添加书签",
  "bookmarkTitle": "书签标题",
  "bookmarkContent": "书签内容（可选）",
  "bookmarkAdded": "书签已添加",
  "selection": {
    "copy": "复制",
    "addBookmark": "添加书签",
    "addReplace": "添加替换规则",
    "searchBook": "在书中搜索"
  },
  "nav": {
    "stickyToolbar": "顶部工具栏常驻",
    "autoLoadNext": "章末自动加载下一章",
    "floatingButtons": "右侧浮动按钮",
    "keyboardShortcuts": "键盘快捷键"
  },
  "contextMenu": {
    "copy": "复制",
    "addBookmark": "添加书签",
    "addReplace": "添加替换规则",
    "searchBook": "在书中搜索",
    "readAloud": "朗读选中",
    "dictionaryLookup": "字典查询"
  },
  "shortcuts": {
    "title": "键盘快捷键",
    "prevNext": "←/→ 上一章/下一章",
    "pageUpDown": "PageUp/PageDown 上一章/下一章",
    "firstLast": "Home/End 第一章/最后一章",
    "scrollDown": "Space 向下滚动一屏",
    "scrollUp": "Shift+Space 向上滚动一屏",
    "find": "Ctrl+F 搜索",
    "findNext": "F3 / Shift+F3 下一处/上一处",
    "bookmark": "Ctrl+D 添加书签",
    "bookmarkList": "Ctrl+Shift+D 书签列表",
    "close": "Esc 关闭弹层/退出全屏",
    "fullscreen": "F11 切换全屏",
    "toggleToolbar": "Ctrl+B 切换顶部工具栏",
    "help": "? 弹出快捷键帮助"
  },
  "fullBookSearch": {
    "title": "全书搜索",
    "keyword": "搜索关键字",
    "search": "搜索",
    "scanning": "正在扫描章节",
    "noResults": "未找到匹配",
    "cancel": "取消搜索",
    "jumpTo": "跳转到此处"
  },
  "sync": {
    "uploaded": "进度已上传",
    "downloaded": "进度已下载",
    "skipped": "无需同步",
    "failed": "同步失败：{error}"
  }
}
```

---

## 4. 错误处理

| 场景 | 行为 |
|------|------|
| `add_bookmark` 失败 | toast `error`，弹层不关闭（让用户重试） |
| WebDAV 连接失败 | 同步命令返回 `{ status: 'failed', error: ... }`，前端 toast |
| 全文搜索超过 30 秒无事件 | 前端显示「搜索卡住」+ 取消按钮，调取消 IPC |
| 章节内容未缓存 | SQL JOIN 命中 NULL 的章节会被跳过；前端显示「该书有 N 章未缓存」 |
| selection 选中超出 500 字 | 工具栏不显示（避免大段选择造成操作歧义） |

---

## 5. 测试策略

### 5.1 单元测试（Rust）

- `bookmarkActions` 已有 DAO 测试，本次无需新增。
- `BookProgressDao`：插入 / 更新 / 查询。
- `fullbook_search` SQL：用 sqlite-mem 构造 5 章的 fixture，验证 LIKE 匹配和流式事件。
- `sync_book_progress`：用 mock WebDAV server（已有 `e2e_health` 二进制可参考）验证 upload/download/auto 三种分支。

### 5.2 前端验证

- `pnpm build` 通过 + `pnpm test:smoke` 通过。
- 手动启动 `pnpm dev`，在 Chromium 中验证：
  - 选中文字后工具栏出现且 4 个按钮可点击。
  - 添加书签后 `Bookmarks` 列表立即显示新条目。
  - 全书搜索进度条正常推进，命中片段正确显示，点击跳转能正确滚动。
  - 4 区域点击动作修改后立即生效。
  - WebDAV 同步能在 dev 环境跑通（用 `python -m http.server` 模拟 WebDAV）。

### 5.3 E2E 已有

- 跑 `cargo run --bin e2e_smoke -- path/to/legado.db <sourceUrl> <bookUrl> <chapterUrl>` 确认现有流程不退化。

---

## 6. 关键文件

### 6.1 新增

- `src/components/reader/BookmarkButton.tsx`
- `src/components/reader/ContextMenu.tsx`
- `src/components/reader/ShortcutsHelpModal.tsx`
- `src/components/reader/NavSettingsPopover.tsx`
- `src/components/reader/FullBookSearchPanel.tsx`
- `src/components/reader/bookmarkActions.ts`
- `src/components/reader/domHighlight.ts`
- `src/components/reader/navPrefs.ts`
- `src/components/reader/shortcuts.ts`
- `src/components/reader/fullbookSearch.ts`
- `src/components/reader/ContextMenu.module.css`
- `src/components/reader/ShortcutsHelpModal.module.css`
- `src/components/reader/NavSettingsPopover.module.css`
- `src/components/reader/FullBookSearchPanel.module.css`
- `src-tauri/src/db/dao.rs`：新增 `BookProgressDao`
- `src-tauri/src/commands.rs`：新增 `fullbook_search`、`sync_book_progress`、`get_book_sync_status`
- `src-tauri/src/db/migrations.rs`：新增 `book_progress_sync` 表
- `src-tauri/src/webdav.rs`：新增 `download_to_string` / `upload_string` 辅助方法
- `src/i18n/locales/zh.json` + `en.json`：新增 reader.* key
- `docs/superpowers/specs/2026-06-16-reader-core-and-fullbook-search-design.md`（本文件）

### 6.2 修改

- `src/pages/Reader.tsx`：集成新组件，引入 `navPrefs` 替换现有的硬编码左右点击
- `src/components/reader/TipValue.tsx`：无需改动
- `src-tauri/src/lib.rs`：`invoke_handler!` 注册新命令
- `src-tauri/src/state.rs`：新增 `fullbook_search_cancel_tx`

---

## 7. 实施顺序（建议）

1. **任务 1：文字选择工具栏 + 书签添加入口**（前端，后端已就绪）
2. **任务 2：导航改造（顶部 sticky 工具栏 + 右侧浮动按钮 + 章末自动加载）**（前端）
3. **任务 3：WebDAV JSON 上传下载辅助**（后端）
4. **任务 4：book_progress_sync 表 + DAO + 命令**（后端）
5. **任务 5：sync_book_progress 前端入口**（前端）
6. **任务 6：fullbook_search 后端实现**（后端）
7. **任务 7：FullBookSearchPanel 前端实现**（前端）
8. **任务 8：i18n + 主题适配**
9. **任务 9：smoke test + 手动验证**

---

## 8. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 大书（1000+ 章）全文搜索慢 | 流式返回 + 进度条 + 30s 提示 + 取消按钮；单章超过 1000 命中截断 |
| 右键菜单在暗色主题下不清晰 | 主题色用 CSS var，跟随 reader theme |
| WebDAV 同步冲突 | 按时间戳简单覆盖（与 Android 一致），不做冲突 UI |
| 右键菜单定位超出视口 | 启动时算 `x + width / y + height` 是否超出 `window.innerWidth/Height`，超出则反向定位 |
| Bookmark `content` 字段无索引 | 不需要：仅按 bookUrl 索引，已存在 |

---

## 9. 不在范围内（明确划界）

- TTS / 朗读系统改造（独立计划 B）
- 排版/处理选项面板（独立计划 D）
- 真实分页（独立计划 E）
- Android 端代码改动（本仓库是 Desktop）
