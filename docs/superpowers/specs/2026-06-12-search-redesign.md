# 搜索功能重设计 — Spec

| 字段 | 值 |
|---|---|
| Spec ID | `2026-06-12-search-redesign` |
| 作者 | opencode |
| 日期 | 2026-06-12 |
| 状态 | Draft (待 review) |
| 范围 | `src/`、`src-tauri/src/`、`docs/`、`db/migrations.rs` (新增表) |
| 不在范围 | Book 详情、Reader、RSS、本地导入、WebDAV |
| 关联文档 | `docs/research/multi-source-book-search-ux-research.md` |
| 预计周期 | 12-16 周 (分 4 阶段, subagent 并行) |

---

## 1. 背景

`legado-desktop` 的搜索功能由 `src/pages/Home.tsx` (694 行) 实现。当前痛点:

1. **结果慢且乱**: 必须等所有源都返回才一次性显示; 排序是源返回顺序, 无相关性
2. **去重弱**: 仅按 `name|author` 字符串去重, 跨源同名不同 URL 无法合并
3. **失败源静默**: 一个源挂了, 用户完全不知道, 只能去 debug 页面挨个查
4. **没有源健康状态**: 不知道哪个源最近 503 多、哪个快
5. **职责混杂**: 搜索页同时管搜索结果 + 书源订阅 (rule sub)
6. **封面阻塞**: 同步等封面图片加载, 慢源会卡住整个结果列表

目标: 把搜索做成 **流式 + 相关性 + 源感知** 的现代体验, 同时为后续规则调试、批量管理打好架构基础。

---

## 2. 设计原则

| 原则 | 体现 |
|---|---|
| **流式优先** | Tauri `Channel<T>` 推事件, UI 边收边画 |
| **相关性优先于顺序** | 7-rule cascade, 用户能调权重 |
| **源是第一类公民** | 每个结果带 `source_url` + `score_breakdown`; 源健康是可见、可监控的 |
| **失败可见** | 失败源在 UI 上必须标出来, 不能静默 |
| **职责分离** | `/search` 只搜; `/sources` 主管书源 + 订阅 |
| **小步并行** | subagent 切任务, 每个独立可验证, 最后集成测试 |

---

## 3. 架构

```
┌─────────────────────────────┐
│ React SearchPage            │
│  - SearchBar (debounce)     │
│  - SourceStatusStrip        │
│  - ResultList (virtualized) │
│  - FailureFooter            │
└────────────┬────────────────┘
             │ invoke('search_books_stream',
             │   { query, sources }, channel)
             ▼
┌──────────────────────────────────────────────┐
│ Tauri Command (Rust)                          │
│  search_books_stream                         │
│  ┌──────────────────────────────────────┐    │
│  │ SearchStreamer                       │    │
│  │  - tokio::Semaphore(8)               │    │
│  │  - per-source timeout: 2s            │    │
│  │  - global timeout: 3.5s              │    │
│  │  - spawn N tasks (1 per source)      │    │
│  │  - mpsc::Sender<SearchEvent>         │    │
│  └──────────────────────────────────────┘    │
└──────────────┬───────────────────────────────┘
               │ channel.send(SearchEvent)
               ▼
┌─────────────────────────────┐
│ Channel<SearchEvent>        │
│  onmessage(event) =>        │
│   - state machine update    │
│   - append to result list   │
│   - update source pill      │
└─────────────────────────────┘
```

### 3.1 关键 Rust 代码骨架 (示意)

```rust
// src-tauri/src/book_source/search_streamer.rs

pub async fn run_stream(
    query: String,
    sources: Vec<BookSource>,
    channel: Channel<SearchEvent>,
    stats: Arc<SourceStatsDao>,
    request_id: Uuid,
    mut cancel: tokio::sync::watch::Receiver<bool>,
) {
    let started = Instant::now();
    let total = sources.len();
    let _ = channel.send(SearchEvent::Started { request_id, query: query.clone(), total_sources: total });

    let sem = Arc::new(Semaphore::new(8));
    let mut tasks = Vec::with_capacity(total);

    for src in sources {
        let sem = sem.clone();
        let channel = channel.clone();
        let stats = stats.clone();
        let q = query.clone();
        let rid = request_id;
        tasks.push(tokio::spawn(async move {
            let _permit = sem.acquire().await.unwrap();
            let _ = channel.send(SearchEvent::SourceStarted { source_url: src.book_source_url.clone(), source_name: src.book_source_name.clone() });
            let t0 = Instant::now();
            let outcome = tokio::time::timeout(
                Duration::from_secs(2),
                tokio::task::spawn_blocking(move || {
                    let web_book = WebBook::new(JsExtState::global());
                    web_book.search(&src, &q, Some(1))
                }),
            ).await;
            let latency_ms = t0.elapsed().as_millis() as u64;
            match outcome {
                Ok(Ok(Ok(books))) => {
                    stats.record_success(&src.book_source_url, latency_ms).await;
                    for book in books {
                        let score = relevance::score(&book, &q, &src);
                        let _ = channel.send(SearchEvent::Result { source_url: src.book_source_url.clone(), book, score });
                    }
                    let _ = channel.send(SearchEvent::SourceFinished { source_url: src.book_source_url.clone(), count: 0, latency_ms });
                }
                Ok(Ok(Err(e))) => {
                    stats.record_error(&src.book_source_url, &e.to_string(), latency_ms).await;
                    let _ = channel.send(SearchEvent::SourceFailed { source_url: src.book_source_url.clone(), error: e.to_string(), latency_ms, kind: FailureKind::Http });
                }
                Ok(Err(_join)) => {
                    stats.record_error(&src.book_source_url, "task join error", latency_ms).await;
                    let _ = channel.send(SearchEvent::SourceFailed { source_url: src.book_source_url.clone(), error: "join error".into(), latency_ms, kind: FailureKind::Parse });
                }
                Err(_timeout) => {
                    stats.record_timeout(&src.book_source_url, latency_ms).await;
                    let _ = channel.send(SearchEvent::SourceFailed { source_url: src.book_source_url.clone(), error: "timeout".into(), latency_ms, kind: FailureKind::Timeout });
                }
            }
        }));
    }

    // Global timeout 3.5s
    let _ = tokio::time::timeout(
        Duration::from_millis(3500),
        futures::future::join_all(tasks),
    ).await;

    let _ = channel.send(SearchEvent::Done { request_id: rid, succeeded: 0, failed: 0, total_results: 0, duration_ms: started.elapsed().as_millis() as u64 });
}
```

### 3.2 关键 TS 代码骨架 (示意)

```ts
// src/pages/Home.tsx (新的搜索状态机)
const channel = new Channel<SearchEvent>();
channel.onmessage = (event) => {
  switch (event.event) {
    case 'Started':
      setSearchState({ kind: 'streaming', total: event.total_sources, results: [], sourceStatuses: new Map() });
      break;
    case 'Result':
      setSearchState((s) => s.kind === 'streaming'
        ? { ...s, results: dedupAndSort([...s.results, event.book]) }
        : s);
      break;
    case 'SourceFailed':
      // mark source pill, accumulate for FailureFooter
      break;
    case 'Done':
      setSearchState((s) => s.kind === 'streaming' ? { ...s, kind: 'done' } : s);
      break;
  }
};

const handleSearch = useCallback(async (q: string) => {
  if (searchAbortRef.current) searchAbortRef.current();
  const reqId = crypto.randomUUID();
  searchAbortRef.current = reqId;
  const ch = new Channel<SearchEvent>();
  ch.onmessage = makeHandler(reqId);
  await invoke('search_books_stream', { query: q, sources: enabledSources, channel: ch });
}, [enabledSources]);
```

---

## 4. 数据模型变更

### 4.1 新增表 `source_stats`

```sql
-- File: src-tauri/src/db/migrations.rs (追加到文件末尾)
-- 重要: book_sources 表用 bookSourceUrl (TEXT) 作主键, 没有整数 id,
-- 所以 source_stats 也用 URL 作主键 (与现有 schema 约定一致)
CREATE TABLE IF NOT EXISTS source_stats (
  source_url             TEXT PRIMARY KEY REFERENCES book_sources(bookSourceUrl) ON DELETE CASCADE,
  total_queries          INTEGER NOT NULL DEFAULT 0,
  successful_queries     INTEGER NOT NULL DEFAULT 0,
  timed_out_queries      INTEGER NOT NULL DEFAULT 0,
  errored_queries        INTEGER NOT NULL DEFAULT 0,
  total_latency_ms       INTEGER NOT NULL DEFAULT 0,
  last_success_at        INTEGER,
  last_error_at          INTEGER,
  last_error_message     TEXT,
  last_checked_at        INTEGER NOT NULL DEFAULT 0,
  -- Rolling window (last 50 queries; updated by application logic, not SQL trigger)
  rolling_success_count  INTEGER NOT NULL DEFAULT 0,
  rolling_total_count    INTEGER NOT NULL DEFAULT 0,
  health_score           REAL    NOT NULL DEFAULT 1.0  -- 0.0 ~ 1.0
);

CREATE INDEX IF NOT EXISTS idx_source_stats_health ON source_stats(health_score DESC);
```

### 4.2 迁移方式

- 在 `migrations.rs` 末尾**追加**新表常量 `CREATE_SOURCE_STATS_TABLE`,在 `run_migrations` 函数末尾 `conn.execute_batch(CREATE_SOURCE_STATS_TABLE)?` 一行
- 旧库升级: `IF NOT EXISTS` 保证幂等, 无需写升级脚本
- **不引入** 版本号系统 (与现有约定一致: 22 张表全部平铺, 无 version 列)

### 4.3 不动 `books` / `book_sources` 表结构

健康分只放在 `source_stats`, 不污染 `book_sources` (那是用户编辑的字段, 改它要小心)。

---

## 5. 后端组件 (Rust, 新增)

### 5.1 `src-tauri/src/book_source/relevance.rs` (新)

| 函数 | 签名 | 职责 |
|---|---|---|
| `score` | `pub fn score(book: &SearchBook, query: &str, source: &BookSource) -> ScoreBreakdown` | 计算 7-rule 分数 |
| `ScoreBreakdown` | `#[derive(Serialize)] struct { words: u8, typo: u8, proximity: u8, source_weight: u8, attribute_rank: u8, word_position: u8, source_health: u8 }` | 7 个 u8 + 派生 Ord |
| `compare` | `impl Ord for ScoreBreakdown` | 字典序比较 (固定顺序) |
| `normalize_text` | `fn normalize_text(s: &str) -> String` | 去标点、空格、括注, 转小写 |
| `damerau_levenshtein` | `fn dl(a: &str, b: &str) -> usize` | 编辑距离 (不限制范围) |

**依赖**:
- `unicode-segmentation` 1.x (新增, 用于分词)
- 不引入新 crate 做模糊匹配 (strsim 太重; 我们手写 DL)

**测试** (`#[cfg(test)] mod tests`):
- `dl_known_pairs`: `(kitten, sitten) → 1`, `(book, back) → 2`
- `score_exact_title_match`: "三体" 搜 "三体" → `words=1, typo=255, proximity=0`
- `score_author_only`: "刘慈欣" 搜 → `attribute_rank < title_match`
- `score_typo_tolerance`: "三体" 搜 "三题" → typo=254
- `compare_lex_order`: 两个结果按 7 个 rule 字典序

**DL 算法实现要点**:
- 字符串最长 64 字符 (中文 title 通常 4-20 字, 设上限防 O(n²) 爆炸)
- 4-row DP 数组 (Damerau 含 transpositions)
- 全部 ASCII 时按 byte; 含非 ASCII 时按 char (用 `chars().count()`)

### 5.2 `src-tauri/src/book_source/search_streamer.rs` (新)

| 函数 | 职责 |
|---|---|
| `run_stream` | 主入口, 编排并发、超时、Channel 发送; 接受 `cancel: watch::Receiver<bool>`, 收到 `true` 后停止 spawn 新 task |
| `FailureKind` | enum `Timeout \| Http \| Parse` |
| 内嵌常量 | `PER_SOURCE_TIMEOUT = Duration::from_secs(2)`, `GLOBAL_TIMEOUT = Duration::from_millis(3500)`, `MAX_CONCURRENCY = 8` |

**取消机制**:
```rust
pub async fn run_stream(
    query: String,
    sources: Vec<BookSource>,
    channel: Channel<SearchEvent>,
    stats: Arc<SourceStatsDao>,
    request_id: Uuid,
    mut cancel: tokio::sync::watch::Receiver<bool>,
) {
    // 在 spawn loop 中每次获取下一 source 前检查 cancel
    // 已发出的 HTTP 请求不强制 abort (会让 reqwest 任务析构时报警), 等其自然返回后丢弃结果
    // 全局 join 改用 select! 监听 cancel
}
```

**依赖**:
- `tokio` (已有, 用 `sync::Semaphore`、`sync::watch`、`time::timeout`、`spawn`、`select!`)
- `uuid` 1.x (已有, 用于 request_id)
- `tauri::ipc::Channel` (Tauri 2 已有)

**测试** (mock BookSource):
- `all_sources_succeed`: 3 mock source 各返回 2 本书 → 收到 6 个 Result + 3 个 SourceFinished + Done
- `one_source_times_out`: 一个 source 永远 hang → 2s 后收到 SourceFailed{Timeout} + 继续等其余
- `global_timeout`: 一个 source 慢 5s → 3.5s 后全局 Done, 慢源标记为 Timeout
- `events_ordered`: Started → SourceStarted × N → Result × ... → SourceFinished × N → Done
- `cancel_before_start`: 立即 `cancel.send(true)`, 不应收到任何 SourceStarted/Result, 只收到 Started + 立即 Done

### 5.3 `src-tauri/src/db/source_stats_dao.rs` (新)

| 函数 | 职责 |
|---|---|
| `get_all` | 返回所有 source 的 stats (供 `/sources` 页面) |
| `get_by_id(source_url)` | 单条 |
| `record_success(source_url, latency_ms)` | `total_queries++, successful_queries++, total_latency_ms += latency_ms, rolling_success_count++, rolling_total_count++, last_success_at = now, last_checked_at = now`, 重算 `health_score` |
| `record_timeout(source_url, latency_ms)` | 同上, 字段不同 |
| `record_error(source_url, err_msg, latency_ms)` | 同上, 存 `last_error_message` |
| `compute_health(success_rate, p99_latency, recency)` | 公式见 §2, 返回 `[0.0, 1.0]` |
| `prune_rolling_window(source_url)` | 当 `rolling_total_count > 50` 时按比例缩 (保守实现: 直接 `/=2`) |

**测试**:
- `record_success_increments`: 字段正确++
- `rolling_window_caps_at_50`: 模拟 60 次查询, `rolling_total_count` 收敛到 ≤ 50
- `health_score_bounds`: 输入极端值, 输出在 `[0, 1]`
- `compute_health_formula`: 手算 1 个 case 验证

### 5.4 `src-tauri/src/commands.rs` (改)

新增命令:

```rust
#[tauri::command]
pub async fn search_books_stream(
    query: String,
    sources: Vec<BookSource>,
    channel: tauri::ipc::Channel<SearchEvent>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let stats = state.source_stats.clone();
    let (cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);
    // 把 cancel_tx 存到 AppState.search_cancel_tx (Mutex<Option<Sender>>)
    // 下一次 invoke 时, 如果存在旧 sender, 先 send(true), 再替换
    if let Some(old) = state.search_cancel_tx.lock().await.take() {
        let _ = old.send(true);
    }
    *state.search_cancel_tx.lock().await = Some(cancel_tx);
    search_streamer::run_stream(query, sources, channel, stats, Uuid::new_v4(), cancel_rx).await;
    Ok(())
}
```

注册到 `invoke_handler` 列表。

`AppState` 新增字段:
```rust
pub search_cancel_tx: Arc<tokio::sync::Mutex<Option<tokio::sync::watch::Sender<bool>>>>,
```

**保留** 旧的 `search_books` 命令 (用于一次性非流式调用, 如调试面板)。

### 5.5 `src-tauri/src/state.rs` (改)

`AppState` 增加字段:

```rust
pub struct AppState {
    pub db: AppPool,
    pub source_stats: Arc<SourceStatsDao>,  // 新
    pub search_cancel_tx: Arc<tokio::sync::Mutex<Option<tokio::sync::watch::Sender<bool>>>>,  // 新
}
```

`AppState::build` 签名更新为 `build(db, source_stats)`。`init_app_state` (在 `db/mod.rs`) 创建 SourceStatsDao 并传入。

### 5.6 `src-tauri/src/types.rs` (改) — Frontend

新增 `SearchEvent` 联合类型 (mirrors Rust):

```ts
export type SearchEvent =
  | { event: 'Started'; requestId: string; query: string; totalSources: number }
  | { event: 'SourceStarted'; sourceUrl: string; sourceName: string }
  | { event: 'Result'; sourceUrl: string; book: SearchBook; score: ScoreBreakdown }
  | { event: 'SourceFinished'; sourceUrl: string; count: number; latencyMs: number }
  | { event: 'SourceFailed'; sourceUrl: string; error: string; latencyMs: number; kind: 'Timeout' | 'Http' | 'Parse' }
  | { event: 'Done'; requestId: string; succeeded: number; failed: number; totalResults: number; durationMs: number };

export interface ScoreBreakdown {
  words: number;
  typo: number;
  proximity: number;
  sourceWeight: number;
  attributeRank: number;
  wordPosition: number;
  sourceHealth: number;
}

// Rust 端用 book_source_url (Text) 作源标识, 不是整数 id
export type SourceKey = string;
```

---

## 6. 前端组件 (React, 改造 + 新增)

### 6.1 `src/pages/Home.tsx` (改)

| 改动 | 说明 |
|---|---|
| 状态机 | 引入 `searchState: { kind: 'idle' \| 'typing' \| 'streaming' \| 'stalled' \| 'done' \| 'error', ... }` |
| Channel 消费 | `new Channel<SearchEvent>()`, `onmessage` 分发到 reducer |
| 取消机制 | 每次 `invoke` 前调 `channel.close()` 关闭旧 channel; 旧 `run_stream` 通过 `tokio::sync::watch` 收到 cancel 信号后停止 spawn 新 task (已发出的 HTTP 不打断, 完成后丢弃) |
| 去掉 | 订阅管理 UI (移走) |
| 去掉 | 简单 dedup (`name|author`) — 改用 relevance sort |
| 改用 | Channel 流式追加; 新结果合并到 React state 用 `useTransition` + reducer (避免流式期间 UI 卡顿) |
| 保留 | 搜索历史、debounce 450ms (硬编码, 不暴露 UI) |

### 6.2 `src/components/search/SourceStatusStrip.tsx` (新)

横向胶囊条 (mobile 时竖向), 每个源一个 pill:

| 状态 | 颜色 | 文本 | 可点击 |
|---|---|---|---|
| pending | `#e0e0e0` | 源名 | 否 |
| running | `#1976d2` (脉动动画) | 源名 + spinner | 否 |
| ok | `#4caf50` | 源名 + 命中数 | 否 |
| timeout | `#ff9800` | 源名 + "超时" | **是** (重试) |
| http_error | `#f44336` | 源名 + 错误码 | **是** (重试 + 查看) |
| parse_error | `#9c27b0` | 源名 + "解析" | **是** (查看原始响应) |
| zero_results | `#9e9e9e` | 源名 + "0" | 否 |

Props: `statuses: Map<sourceUrl, SourceStatus>`, `onRetry(sourceUrl)`

### 6.3 `src/components/search/FailureFooter.tsx` (新)

默认折叠, 显示徽章 `X 个源失败`; 展开后:

```
┌─ 搜索完成,但有 2 个源失败 ─────────────────┐
│ ⚠ 书源A: 请求超时 (2.0s)        [重试]    │
│ ⚠ 书源B: HTTP 502 (0.3s)         [重试]    │
│                            [重试全部]    │
└──────────────────────────────────────────┘
```

### 6.4 `src/components/search/ResultCard.tsx` (拆出来, 原来内联在 Home.tsx)

| 改动 | 说明 |
|---|---|
| Cover 渲染 | `<img loading="lazy" decoding="async" />` + `IntersectionObserver` 包裹容器, 视口外不加载 |
| 占位 | 默认纯色 + 标题前 2 字; 失败不显示 |
| Score badge | hover 显示 `ScoreBreakdown` tooltip (可关闭) |
| 源 badge | 角标显示源名 (缩短到 8 字符) |

### 6.5 `src/pages/Sources.tsx` (新) — 取代 rule sub

| 模块 | 说明 |
|---|---|
| 顶部 | "+ 添加书源"、批量启用/停用、导入订阅 |
| 表格 | 列: 名称 / URL / 启用 / 健康分 / 命中率 / 平均延迟 / 最近错误 / 最后检查 |
| 排序 | 默认按 `health_score DESC`; 列点击切换 |
| 行点击 | 跳 `/sources/:id` |
| 健康 < 0.5 | 红色徽章 "降级" |
| 健康 < 0.2 | 红色徽章 "建议停用" (用户手动停) |

### 6.6 `src/pages/SourceEdit.tsx` (新)

| 区块 | 说明 |
|---|---|
| 基本信息 | 名称、URL、启用、权重 (`source_weight`, 0.5-2.0) |
| 搜索规则 | 粘贴 legado 规则 JSON |
| 实时测试 | 输入关键词, 后端执行 search_books 同步调用, 显示原始响应 + 解析结果 |

### 6.7 快捷键 (在 `ResultList`)

| 键 | 动作 |
|---|---|
| `/` | 聚焦搜索框 (输入框外) |
| `↑` / `↓` | 上下选择结果 |
| `Enter` | 打开选中结果 (选中时) / 触发搜索 (搜索框中) |
| `Esc` | 取消搜索 (streaming 中) / 清空 (idle 时) |

---

## 7. 相关性排序

### 7.1 7-Rule Cascade

| 顺序 | 规则 | 公式 | 范围 | 方向 |
|---|---|---|---|---|
| 1 | `words` | `query 词在 title + author 中命中数` | 0~N | DESC |
| 2 | `typo` | `255 - min(dl(query, title), dl(query, author))` | 0~255 | DESC |
| 3 | `proximity` | `query 词在 title 中最小跨度` | 0~∞ | ASC (转 u8) |
| 4 | `source_weight` | `user-defined weight × 100` | 50~200 | DESC |
| 5 | `attribute_rank` | `(title 命中 ? 3 : 0) + (author 命中 ? 2 : 0) + (intro 命中 ? 1 : 0)` | 0~3 | DESC |
| 6 | `word_position` | `title 中第一个命中词的位置` | 0~N | ASC |
| 7 | `source_health` | `health_score × 100` | 0~100 | DESC |

### 7.2 实现

```rust
// book_source/relevance.rs
pub fn score(book: &SearchBook, query: &str, source: &BookSource) -> ScoreBreakdown {
    let q = normalize_text(query);
    let title = normalize_text(&book.name);
    let author = normalize_text(book.author.as_deref().unwrap_or(""));
    let intro = normalize_text(book.intro.as_deref().unwrap_or(""));
    let q_words: Vec<&str> = q.split_whitespace().collect();

    let title_hits = q_words.iter().filter(|w| title.contains(*w)).count();
    let author_hits = q_words.iter().filter(|w| author.contains(*w)).count();
    let intro_hits = q_words.iter().filter(|w| intro.contains(*w)).count();
    let words = (title_hits + author_hits).min(255) as u8;

    let typo_title = 255u8.saturating_sub(damerau_levenshtein(&q, &title).min(255) as u8);
    let typo_author = 255u8.saturating_sub(damerau_levenshtein(&q, &author).min(255) as u8);
    let typo = typo_title.max(typo_author);

    let proximity = proximity_score(&q_words, &title).min(255) as u8;
    let source_weight = (source.weight.unwrap_or(1.0) * 100.0).clamp(50.0, 200.0) as u8;
    let attribute_rank = (if title_hits > 0 { 3 } else { 0 })
        + (if author_hits > 0 { 2 } else { 0 })
        + (if intro_hits > 0 { 1 } else { 0 });
    let word_position = first_match_position(&q_words, &title).min(255) as u8;
    let source_health = (source.health_score.unwrap_or(1.0) * 100.0) as u8;

    ScoreBreakdown { words, typo, proximity, source_weight, attribute_rank, word_position, source_health }
}

impl Ord for ScoreBreakdown {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        // DESC for words/typo/weight/rank/health; ASC for proximity/position
        other.words.cmp(&self.words)
            .then(other.typo.cmp(&self.typo))
            .then(self.proximity.cmp(&other.proximity))  // ASC
            .then(other.source_weight.cmp(&self.source_weight))
            .then(other.attribute_rank.cmp(&self.attribute_rank))
            .then(self.word_position.cmp(&other.word_position))  // ASC
            .then(other.source_health.cmp(&self.source_health))
    }
}
```

### 7.3 权重可调 (v2)

v1 用硬编码顺序和权重。v2 暴露到 `/settings` 让用户调整 `source_weight` (per-source)。

---

## 8. 失败源处理

| 失败类型 | 检测位置 | UI | 是否更新 stats |
|---|---|---|---|
| `Timeout` (per-source >2s) | `tokio::time::timeout` | 黄色 pill "源 X 超时" + 重试 | 是 (`timed_out_queries++`) |
| `HTTP 4xx/5xx` | `reqwest` 返回 Err | 橙色 pill "源 X HTTP 502" + 重试 | 是 (`errored_queries++`) |
| `Parse` (rule 执行失败 / 返回非预期 JSON) | `book_source::analyze_*` 返回 Err | 紫色 pill "源 X 解析失败" + 查看原始 | 是 (`errored_queries++`) |
| 0 结果 | `search()` 返回 Ok(vec![]) | 灰色 pill "源 X: 0" | 是 (`successful_queries++`, 但 `count=0`) |
| 全局超时 (3.5s) | `tokio::time::timeout` 包裹 `join_all` | Done 事件 + 未返回的源标记 Timeout | 是 |

**重试**: 点击重试 = 仅对该源重新跑一次 `search_books_stream` (单源版本, 见 §11 未来工作)。

---

## 9. 路由变更

| 路由 | 当前 | 改造后 |
|---|---|---|
| `/search` | Home.tsx (含订阅管理) | Home.tsx (纯搜索) |
| `/sources` | 不存在 | **新** Sources.tsx (列表) |
| `/sources/:id` | 不存在 | **新** SourceEdit.tsx (编辑 + 实时测试) |
| `/sources/import` | 不存在 | **新** (rule sub 导入, 从 Home 移过来) |
| `/book-sources` | BookSources.tsx (旧) | **保留** (兼容, 但显示 deprecation 提示) |

**过渡**: `/book-sources` 在 P3 阶段保留为 alias, 跳 `/sources`; P4 阶段移除。

**导航**: `Layout.tsx` 顶栏 (桌面) / 底部 tab (mobile) 调整:
- 把 "搜索" 链接不变
- 把 "书源" 链接改到 `/sources`
- 移除分散的 "导入" 入口 (统一到 `/sources/import`)

---

## 10. 测试策略

### 10.1 Rust 单元测试 (强制, 每个 subagent 任务交付前必须 `cargo test` 通过)

| 模块 | 测试用例数 | 关键 case |
|---|---|---|
| `relevance.rs` | ≥ 8 | `dl_known_pairs`, `score_exact_title`, `score_typo`, `score_author`, `score_phrase`, `compare_lex`, `normalize_chinese_punct`, `proximity_zero` |
| `search_streamer.rs` | ≥ 4 | `all_ok`, `one_timeout`, `global_cap`, `events_ordered` |
| `source_stats_dao.rs` | ≥ 4 | `record_success_increments`, `rolling_caps_50`, `health_score_bounds`, `compute_health_formula` |

### 10.2 TypeScript 检查 (强制, `pnpm build` 通过)

每个 TS subagent 必须:
- `pnpm build` exit 0
- `pnpm lint` 无 error (warning 可接受, 写明原因)

### 10.3 集成测试 (手动, 每个阶段完成时跑一遍)

| 阶段 | 集成验证 |
|---|---|
| P1 | `cargo test` 全部通过; 启动 dev, 在 tauri 终端看 search 行为 (旧命令) |
| P2 | `pnpm build` 通过; 启动 dev, 输入搜索词, 看到 SourceStatusStrip 出现, 失败源标红色 |
| P3 | `/sources` 页加载所有源, 健康分表可排序; 改一个源 URL → 健康分变化 |
| P4 | 完整流程: 输入 → 流式结果 → 选源失败 → 重试 → 健康分刷新 |

### 10.4 性能基线 (P4 验收)

- 10 源全启用, 中位查询 → 首结果 < 500ms (UI 可视)
- 10 源全启用, 中位查询 → 全 Done < 3.5s
- 关闭封面 (或本地缓存) → 首结果 < 200ms

---

## 11. 实施计划 (subagent 任务切分)

> 实施时用 `subagent-driven-development` skill。每个任务独立可测, **交付前必须**:
> 1. 在自己的工作区跑 `cargo test` / `pnpm build` / `pnpm lint`, 全过
> 2. 输出 "完成报告" (改了哪些文件, 测试结果, 已知限制)

### Phase 1: 基础骨架 (并行, 3-4 天)

| 任务 | 输出 | 依赖 | 子代理验证 |
|---|---|---|---|
| **1A** 加 `source_stats` 表 + DAO | `db/migrations.rs` (新表), `db/source_stats_dao.rs` (CRUD + 滚动窗口) | 无 | `cargo test` |
| **1B** 写 `relevance.rs` 7-rule cascade | `book_source/relevance.rs` + 单测 | 无 | `cargo test` ≥ 8 通过 |
| **1C** 写 `search_streamer.rs` 骨架 | `book_source/search_streamer.rs` + 4 单测 (用 mock source) | 无 | `cargo test` |

### Phase 2: 串接 (并行, 3-4 天)

| 任务 | 输出 | 依赖 | 子代理验证 |
|---|---|---|---|
| **2A** Tauri command `search_books_stream` | `commands.rs` 新增 + 注册 | P1.1A, P1.1C | `cargo build` |
| **2B** `Home.tsx` 状态机 + Channel 消费 | `pages/Home.tsx` 重写状态层 | P1.1A (类型), P1.1C (事件类型) | `pnpm build` |
| **2C** `SourceStatusStrip` + `FailureFooter` | 2 个新组件 + 集成到 Home | P1.1C (事件类型) | `pnpm build` |
| **2D** 懒加载封面 | `ResultCard` 拆出, IntersectionObserver | 无 (UI only) | `pnpm build` |

### Phase 3: 源健康 (并行, 2-3 天)

| 任务 | 输出 | 依赖 | 子代理验证 |
|---|---|---|---|
| **3A** search flow 中 hook stats 更新 | `search_streamer.rs` 集成 `SourceStatsDao` | P1.1A, P1.1C | `cargo test` |
| **3B** `/sources` 页面 | `pages/Sources.tsx` + DAO 查询 | P1.1A (stats) | `pnpm build` |
| **3C** 书源列表健康徽章 | `BookSources.tsx` 加列 (或 Sources 页面) | P1.1A | `pnpm build` |
| **3D** 健康分接入 cascade 第 7 rule | `relevance.rs` 接 `source.health_score` | P1.1A, P1.1B | `cargo test` |

### Phase 4: 打磨 (顺序, 2-3 天)

| 任务 | 输出 | 依赖 |
|---|---|---|
| **4A** 快捷键 (`/`, `↑↓`, `Enter`, `Esc`) | `ResultList` 监听 | P2.2B |
| **4B** 权重调优 (按真实数据) | 调整 cascade 顺序 / 默认权重 | P3.3A 跑一周数据后 |
| **4C** 完整 E2E 手动测试 | 录屏 / 截图 | P4.4A + P4.4B |

---

## 12. 风险与权衡

| 风险 | 缓解 |
|---|---|
| **Channel<T> 在 React 中断线导致丢事件** | 加 `Done` 事件做 sentinel; 断线时前端按超时兜底显示 |
| **mock source 与真实 source 行为差异** | 单测覆盖 happy path + 错误 path; 集成测试在真实书源上跑 |
| **滚动窗口 SQL 简化为 `/=2`** | 50 次后归一化, 简单但粗; v2 用 FIFO 表 |
| **7-rule cascade 权重不优** | P4.4B 收集用户反馈后调, v1 不暴露 UI |
| **前端测试缺** | 当前项目无测试运行器, 写在本 spec 但**不强求** P3 前完成; 优先级低于 type-check + lint |
| **mobile UI 适配** | 现有 mobile mode 走 `isMobileUi` 分支, 新组件按相同模式做 (横向 → 竖向) |
| **rule sub 路由拆分破坏老用户** | `/book-sources` 保留为 alias, 显示 "已迁移到 /sources" 提示 |

### 12.1 已知不做 (v1)

- 跨源 book-level 合并 (用户已确认 v1 不做)
- 失败源自动暂停 (用户已确认 v1 不做)
- BlurHash 封面占位 (用户已确认用纯色)
- 单源重试的独立 UI (只做 "重试此源" 按钮, 复用 search_books_stream 单源模式)
- 全文搜索 (intro 字段匹配, 但不建索引, 用 ILIKE)
- 拼写纠正 ("你是不是要找: 三体")
- 搜索建议下拉 (Google 风格)

### 12.2 v2 候选 (out of scope for this spec)

- 跨源 book-level fuzzy merge
- 用户自定义 cascade 权重 UI
- 全文搜索引擎 (Tantivy) 索引本地书库
- 搜索历史聚类 / 标签
- 搜索结果分享 (URL encode)

---

## 13. 验收标准 (Definition of Done)

### 13.1 功能

- [ ] 用户输入搜索词, 看到结果在 500ms 内开始出现
- [ ] 失败源在结果区下方明确标出, 不静默
- [ ] `/sources` 页面显示所有源的健康分, 可按健康排序
- [ ] 旧的 `/book-sources` 路由不再被新代码使用
- [ ] 搜索结果按相关性排序 (不是源返回顺序)
- [ ] 封面不阻塞结果渲染 (滚动到底才加载视口外的图)

### 13.2 工程

- [ ] `pnpm build` 通过
- [ ] `pnpm lint` 无 error
- [ ] `cargo test` 全部通过
- [ ] `cargo build` (debug) 通过
- [ ] 所有新增 Rust 模块有单元测试
- [ ] 5 个新组件 / 页面有 TypeScript strict 兼容的类型
- [ ] 路由表更新到 `App.tsx`

### 13.3 文档

- [ ] `docs/superpowers/specs/2026-06-12-search-redesign.md` (本文件) commit
- [ ] `docs/research/multi-source-book-search-ux-research.md` (已存在) commit
- [ ] `docs/superpowers/plans/2026-06-12-search-redesign.md` (writing-plans 产出) commit

---

## 14. 参考资料

- `docs/research/multi-source-book-search-ux-research.md` — 竞品分析
- Tauri 2 Channel<T>: https://v2.tauri.app/develop/calling-rust/#channels
- Meilisearch 7 ranking rules: https://www.meilisearch.com/docs/learn/relevancy/ranking_rules
- Algolia relevance criteria: https://www.algolia.com/doc/guides/managing-results/relevance-overview/in-depth/ranking-criteria/
- SearXNG MainResult.engines: https://docs.searxng.org/dev/result_types/main/mainresult.html
- Legado Android (参考): 行为重构自社区 wiki, 源码已 DMCA

---

**End of Spec**
