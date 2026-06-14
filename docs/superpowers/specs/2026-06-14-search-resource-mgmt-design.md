# 搜索资源管理 — Spec

| 字段 | 值 |
|---|---|
| Spec ID | `2026-06-14-search-resource-mgmt` |
| 作者 | opencode |
| 日期 | 2026-06-14 |
| 状态 | Draft (待 review) |
| 范围 | `src-tauri/src/search_supervisor.rs`（新）、`src-tauri/src/state.rs`、`src-tauri/src/commands.rs`、`src-tauri/src/lib.rs`、`src-tauri/Cargo.toml`、`src/pages/Home.tsx`、`src/pages/settings/SettingsOther.tsx`、`src/i18n/locales/{zh,en}.json` |
| 不在范围 | 搜索相关性算法、源健康算法、BookDetail、Reader |
| 关联文档 | `docs/superpowers/specs/2026-06-12-search-redesign.md`（上游） |

---

## 1. 背景

`legado-desktop` 的搜索后端由 `search_streamer.rs::run_stream_real` 驱动。当前缺陷:

1. **全局超时 3.5s 太短**：2730 个书源在 8 并发下，最坏情况单源 2s，全局到点时只能完成 1-2 个源的处理；超时后 `tokio::time::timeout` 直接返回，主任务发 `Done` 后函数返回，`join_set` drop，**2728 个源从未发出 `SourceStarted`，前端的进度条永远停在「1 搜索中 · 0 完成 · 0 HTTP 错误 / 2730」**。
2. **没有资源配额**：进程总内存没有上限；高并发 JS 引擎（每源独立 Runtime + 32MB 上限）累积可占 GB 级。
3. **没有显式取消通道**：后端 watch channel 只在「下一次搜索时自动取消」时被使用，前端没有 ⏹ 按钮。
4. **没有跨页面结果保留**：用户离开 Home 再回来，前端状态全部丢失（`useState`），需要重新搜索。
5. **页面离开不释放资源**：react-router-dom 切换路由时 `Home` 组件 unmount，但 `invoke` 是 fire-and-forget，Rust 侧 `search_books_stream` 仍继续跑。

---

## 2. 目标

- 取消 `GLOBAL_TIMEOUT = 3.5s`，所有书源在合理资源预算内被持续派发。
- 引入**资源配额**：进程 RSS 软上限 + 固定信号量并发数，均可在 SettingsOther 调整。
- 引入**自动回收**：当 RSS 超阈值时按 `(started_at 老 + health_score 低)` 调和排序，淘汰 in-flight 任务。
- 引入**显式取消**：前端 ⏹ 按钮调 `cancel_search` IPC，杀所有 in-flight 任务并保留 last_search 缓存。
- 引入**后端 last_search 缓存**：进程内存 `Arc<Mutex<Option<SearchSnapshot>>>`，前端 Home 组件 mount 时 `get_last_search` 拉取，渲染上次结果。

---

## 3. 非目标

- 不改搜索相关性算法（`relevance.rs`）。
- 不改源健康算法（`source_stats_dao.rs::compute_health`）。
- 不改书源规则引擎。
- 不动 BookDetail / Reader / RSS。
- 不持久化 last_search 到 SQLite（仅进程内存）。
- 不在用户离开 Home 时主动取消（用户明确选择离开页面不动作）。

---

## 4. 架构

### 4.1 新模块

`src-tauri/src/search_supervisor.rs`（新文件，约 400 行）：

```
pub struct SearchSupervisor {
    sem: Arc<Semaphore>,
    in_flight: Arc<tokio::sync::RwLock<HashMap<RequestId, InFlightTask>>>,
    last_search: Arc<tokio::sync::Mutex<Option<SearchSnapshot>>>,
    settings: Arc<tokio::sync::RwLock<SearchSettings>>,
    current_request: Arc<tokio::sync::Mutex<Option<RequestId>>>,
    monitor_handle: tokio::sync::Mutex<Option<JoinHandle<()>>>,
    app_handle: tauri::AppHandle,
    source_stats: Arc<SourceStatsDao>,
}

pub struct InFlightTask {
    pub source_url: String,
    pub source_name: String,
    pub health_score: f64,
    pub started_at: Instant,
    pub cancel: tokio::sync::watch::Sender<bool>,
}

pub struct SearchSnapshot { ... }
pub struct SearchSettings { ... }
pub struct ResourceMonitor { ... }   // 内部 tokio task
```

### 4.2 状态机

```
IDLE
  ↓ submit(query, sources, sink)
SUBMITTING
  ├─ if current_request != None: cancel all in_flight[request_id] via watch::Sender
  │     └─ wait up to 500ms for trailing events
  ├─ assign new request_id, write current_request
  ├─ write last_search = snapshot_of_old_request   (if any)
  ↓
STREAMING
  ├─ for each src: spawn src_task
  │     src_task:
  │       1. sem.acquire()
  │       2. insert in_flight[request_id][src.url]
  │       3. send SourceStarted
  │       4. tokio::time::timeout(per_source_ms, spawn_blocking(WebBook::search))
  │       5. on success: send Result (loop), then send SourceFinished
  │          on timeout: send SourceFailed { kind: Timeout }
  │          on panic: send SourceFailed { kind: Parse }
  │          on cancel_rx observed: send SourceFailed { kind: Timeout, error: "cancelled" }
  │       6. remove in_flight
  │       7. drop permit
  ├─ join_collector: when all in_flight gone → write last_search
  ↓
DONE
  ├─ send Done event with final counts
  ├─ write last_search with full snapshot
  ├─ clear current_request
```

### 4.3 数据流

| 触发 | 调用 | 行为 |
|---|---|---|
| 用户点"搜索" | `invoke('search_books_stream_v2', { query, sources, channel })` | supervisor.submit |
| 用户点 ⏹ | `invoke('cancel_search', { requestId? })` | supervisor.cancel |
| Home mount | `invoke('get_last_search')` | 返回 last_search 快照或 None |
| 内存超阈值 | ResourceMonitor 内部 tick | supervisor.reclaim(batch) |
| 用户改 settings | `invoke('update_search_settings', { settings })` | 写 settings，可选地动态调 sem（不支持热调 sem 大小，重启时生效） |
| 新搜索 | submit 内部 | 自动 cancel 上一次所有 in-flight |

### 4.4 取消路径

显式取消：
1. 前端 `invoke('cancel_search', { requestId: currentRequestId })`
2. 后端命令：拿 in_flight RwLock read lock → 收集所有匹配 request_id 的 InFlightTask → 逐个 `cancel.send(true)` → fire-and-forget
3. 源 task 醒过来（`if *cancel_rx.borrow() { send SourceFailed; return; }`）→ 走完清理 → 出 in_flight → 释放 permit
4. join_collector 看到全部 done → 写 last_search → 清 current_request
5. **不删除 last_search**（用户点 ⏹ 后切回页面仍能看到上次结果）

新搜索时取消：
1. submit step 2：fire 所有当前 in-flight 的 cancel，**不区分 request_id**（因为 in_flight 只持有当前 request）
2. 等 ≤ 500ms 让 trailing event 出去
3. detach join handle 继续派新

资源超限回收：
1. monitor task 每 1s 读 `sysinfo` 拿 `current_process.memory()` (RSS)
2. `rss_mb > settings.memory_soft_limit_mb && in_flight.len() > 0` → 触发 reclaim
3. 拿 in_flight RwLock read lock，collect all
4. 排序 key = `(-started_at 老, -health_score 低)`，取前 `settings.memory_reclaim_batch` 个
5. 逐个 `cancel.send(true)`

---

## 5. 错误处理

| 失败 | 处理 |
|---|---|
| 源 task panic | `spawn_blocking` 自身不会传染 panic；JoinError 映射为 `FailureKind::Parse` 错误流（保留现有行为） |
| channel.send 失败 | 现有 `send_failures` 计数（保留现有行为） |
| sysinfo 读失败 | log warn，skip 当前 tick，下 1s 重试 |
| Settings 写脏（用户输入非数字） | 前端 `min=1, max=64`（并发）、`min=50, max=2048`（MB）校验；后端 IPC 命令再校验一次，超出范围返回 `Result::Err` |
| 新搜索时旧 in-flight 还没跑完 | submit 调 cancel_all 后 `tokio::time::timeout(500ms)` 等 trailing event；超时则 detach join handle 继续派新 |
| get_last_search 没快照 | 返回 `Ok(None)` → 前端显示空状态 |

---

## 6. UI 变化

### 6.1 Home（`src/pages/Home.tsx`）

- 搜索按钮旁加 ⏹ 按钮（仅在 `state.kind ∈ {streaming, stalled}` 时显示）
- `useEffect mount` → `invoke('get_last_search')` → 渲染 last snapshot
- 把 `invoke('search_books_stream', ...)` 改为 `invoke('search_books_stream_v2', ...)`
- i18n: 新增 `home.cancel` = "停止"
- 进度条文案不变

### 6.2 SettingsOther

新增分区「搜索资源」：
- 内存上限（MB）默认 400（手机 200，电脑 400）
- 并发数（默认 8）
- 单源超时（ms，默认 2000）
- 自动回收批量（默认 2）

提交时 `invoke('update_search_settings', { settings })`；后端写 `SearchSettings` 并返回新值。

### 6.3 i18n

新增词条（zh / en 各一份）：
- `settings.searchResource` = "搜索资源" / "Search resource"
- `settings.memorySoftLimit` = "进程内存软上限 (MB)" / "Process memory soft limit (MB)"
- `settings.maxConcurrency` = "最大并发请求" / "Max concurrent requests"
- `settings.perSourceTimeout` = "单源超时 (ms)" / "Per-source timeout (ms)"
- `settings.reclaimBatch` = "每次回收数量" / "Reclaim batch size"
- `home.cancel` = "停止" / "Stop"

---

## 7. Cargo.toml 依赖

新增：
```toml
sysinfo = "0.32"
```

`sysinfo` 提供跨平台 RSS 读取（Linux `/proc`，macOS `task_info`，Windows `GetProcessMemoryInfo`）。

---

## 8. 测试

### 8.1 单元测试（`search_supervisor.rs` 同文件 `#[cfg(test)] mod tests`）

- `submit_returns_new_request_id`
- `cancel_fires_in_flight_cancels`
- `reclaim_picks_oldest_low_health_first`
- `last_search_written_on_completion`
- `settings_update_replaces_values`
- `submit_during_in_flight_cancels_old`

### 8.2 集成测试（`commands.rs` 同文件 `#[cfg(test)] mod tests`）

- mock sink，5 个 mock 源 2 fail 3 ok，断言 final SourceStatus 与 last_search
- 模拟 RSS 超阈值：注入 fake rss reader，断言 reclaim 被触发（次数）

### 8.3 前端测试

- Home ⏹ 按钮：点击后调 `cancel_search`
- Home mount：调 `get_last_search` 拿到 last search → 渲染
- SettingsOther 资源分区：表单提交后调 `update_search_settings`

如果项目无 vitest setup，spec 标注 manual verification。

### 8.4 手动 smoke

1. 启动 `cargo tauri dev`
2. 导入 ≥ 100 个 mock book source（fixtures/100-sources.json）
3. 触发搜索，进度条数字应随真实 task 流动（不再卡在「1 搜索中」）
4. SettingsOther 把 memory_soft_limit_mb 调到 100，触发内存超限，看 eprintln monitor 日志
5. 离开 Home 再回来，验证 `get_last_search` 拿到 last search 渲染

---

## 9. 兼容性 / 迁移

- 旧 IPC 命令 `search_books_stream` **保留并转发**到 `search_books_stream_v2`，避免破坏任何其他调用方。当前 grep 确认仅 Home 使用该命令，但保留 redirect 保证 ABI 兼容与回退路径。
- 旧命令的参数 schema 与新命令完全一致（`query: String, sources: Vec<BookSource>, channel: Channel<SearchEvent>`），转发无信息损失。
- `AppState::search_cancel_tx: Arc<Mutex<Option<watch::Sender<bool>>>>` 字段保留但**不再被 search 路径使用**（已废弃，标记 `#[allow(dead_code)]`），等下一版清理。

---

## 10. 风险

| 风险 | 缓解 |
|---|---|
| 取消全局超时后，2730 源最坏情况跑 2s × ⌈2730/8⌉ ≈ 683s 全部串行完 | 资源超限自动 reclaim + 用户手动 ⏹ + 进度条如实反映 |
| sysinfo 在某些 Linux 容器内读 RSS 失败 | log warn 后 skip，不影响主流程 |
| 离开页面后 Rust 继续跑，前端不再 listen | 用户接受此行为；进度条在切回页面时通过 get_last_search 重新拉取 |
| ⏹ 按钮误点 | 行为是"杀进程 + 保留上次结果"，不破坏数据 |
| `max_concurrency` 调小到 1 反而更慢 | 用户主动调，由用户负责 |
| Reclaim 阈值过低导致频繁回收 | 默认 400MB 是经验值，desktop 通常远低于此 |
| 新搜索时旧 in-flight 500ms 没跑完，trailing event 与新搜索事件混在同一 channel | 前端 `currentRequestIdRef` 过滤；旧的 trailing event 不会影响新 search state（applyEvent 检查 requestId） |

---

## 11. 实施顺序

1. Cargo.toml 加 `sysinfo`
2. 新建 `search_supervisor.rs`，含单元测试
3. 改 `state.rs` 加 `supervisor` 字段
4. 改 `commands.rs` 加 3 个新 IPC 命令 + 旧命令 redirect
5. 改 `lib.rs` 注册 + setup 里启动 monitor
6. 前端 Home 改 invoke 名 + ⏹ 按钮 + get_last_search
7. SettingsOther 加分区
8. i18n 加词条
9. 跑 `pnpm build` + `cargo build` + 测试
