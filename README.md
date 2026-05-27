# Legado Desktop / 开源阅读桌面版

基于 [Legado（开源阅读）](https://github.com/gedoor/legado) 的桌面端重构，使用 **Tauri v2 + React + TypeScript + Rust** 实现，保留与 Android 版兼容的书源规则引擎。

> **注意：** 这是一个将 Android 版开源阅读迁移到桌面端的实验性项目。书源规则、数据库 schema 与 Android 版保持兼容，但 UI 和架构完全重写。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + TypeScript + Vite |
| 桌面框架 | Tauri v2 (Rust) |
| 数据层 | SQLite (rusqlite, bundled) |
| JS 引擎 | rquickjs (QuickJS bindings) |
| HTTP 客户端 | reqwest |
| HTML 解析 | scraper (CSS selectors) |
| 内置服务器 | tiny_http |

## 核心功能

- **兼容书源规则** — 完整支持 Android 版的书源规则语法（CSS/XPath/JSON/JS/Regex），通过 rquickjs 执行用户自定义规则
- **书架管理** — 分组、封面、阅读进度同步
- **本地 TXT 导入** — 内置中文章节检测算法，自动拆分章节
- **在线搜索** — 并发多源搜索，自动去重
- **阅读器** — 字体/主题/TTS/替换规则/键盘快捷键
- **RSS 订阅** — 独立 RSS 源管理
- **书源调试** — 可视化调试工具，查看每一步的请求和解析结果
- **内置 Web 服务器** — 通过 HTTP API 暴露书架数据

## 快速开始

### 环境要求

- [Rust](https://rustup.rs/) >= 1.77.2
- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) >= 9

### 安装依赖

```bash
pnpm install
```

### 开发运行

```bash
# 方式一：使用 Tauri CLI
cargo tauri dev

# 方式二：分别运行前后端
# 终端 1：前端 dev server
pnpm dev

# 终端 2：Tauri 后端
cd src-tauri && cargo run
```

### 构建发布版

```bash
cargo tauri build
```

构建产物位于 `src-tauri/target/release/bundle/`。

## 项目结构

```
.
├── src/                    # React 前端
│   ├── pages/              # 页面组件（Bookshelf, Reader, Search, Debug, RSS）
│   ├── components/         # 通用组件
│   └── types.ts            # TypeScript 类型定义
├── src-tauri/src/          # Rust 后端
│   ├── book_source/        # 书源规则引擎（rquickjs + scraper + reqwest）
│   ├── db/                 # SQLite DAO 层（兼容 Room v75 schema）
│   ├── local_book/         # 本地书籍导入（TXT 章节检测）
│   ├── server.rs           # 内置 HTTP 服务器
│   └── commands.rs         # Tauri IPC 命令
├── src-tauri/Cargo.toml    # Rust 依赖
├── package.json            # Node 依赖
└── vite.config.ts          # Vite 配置
```

## 数据库兼容性

桌面版使用 SQLite 存储数据，schema 基于 Android 版 Room 数据库 v75 版本移植。可以导入 Android 版的备份数据库（需手动迁移）。

## 键盘快捷键

| 快捷键 | 功能 |
|--------|------|
| `←` / `A` | 上一章 |
| `→` / `D` | 下一章 |
| `Space` | TTS 播放/暂停 |
| `T` | TTS 开始/停止 |
| `+` / `-` | 字体大小 |
| `S` | 设置面板 |
| `Esc` | 返回书架 |

## 相关项目

- [gedoor/legado](https://github.com/gedoor/legado) — 原版 Android 开源阅读
- [Legado 书源规则文档](https://mgz0227.github.io/The-tutorial-of-Legado/)

## License

GPL-3.0
