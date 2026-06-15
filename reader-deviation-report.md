# Legado Desktop 阅读器功能偏差报告

**基准版本**：上游 Android Legado（`novel_read-da17bb2bed44f30b12a524c2457e32a20b16fa41`）  
**核对目标**：当前 Tauri Desktop 项目（`D:\code\novel_read`）的 Reader 实现  
**核对日期**：2026-06-16

---

## 1. 总体结论

Desktop Reader 已完成 Android 版最核心的「打开书籍 → 加载章节 → 阅读文字 → 切换章节 → 保存进度」闭环，并且在 UI 上做了适合桌面/网页的改造（沉浸式工具栏、可配置 tip slots、响应式布局）。

但与 Android 版相比，仍有大量阅读器高级功能**尚未实现或只是占位**，主要集中在：

1. **文字选择与操作** —— 只有 CSS `user-select` 开关，没有长按/选中后的操作菜单。
2. **书签** —— 后端已完整支持，但 Reader 内没有添加书签的入口。
3. **TTS/朗读** —— 仅使用浏览器 Web Speech API，未接入后端 `HttpTTS` 与系统引擎。
4. **点击区域与按键** —— 只有简化的「左/中/右」三区和少量快捷键，无 9 区自定义、无音量键/鼠标滚轮/自定义翻页键。
5. **真实分页与排版** —— 使用浏览器滚动流式布局，非 Android 的 `ChapterProvider` 真实分页；无双页、无 padding/行首缩进/字间距等细粒度排版。
6. **进度同步** —— 仅支持 WebDAV 整库备份/恢复，没有按书籍的进度同步（`syncBookProgress`）。
7. **内容处理选项** —— 缺少 re-segment 开关、去 ruby/去 H 标签、图片样式、字符集设置、重复标题移除等。
8. **源相关操作** —— Reader 内无法换源、禁用源、登录、支付、编辑书源。

下面按模块给出详细对照。

---

## 2. 功能偏差详表

### 2.1 核心导航与菜单

| # | 功能 | Android 行为 | Desktop 现状 | 偏差类型 | 关键文件 | 优先级 |
|---|------|--------------|--------------|----------|----------|--------|
| 1.1 | 章节上一页/下一页 | 按钮 + 点击区域 + 按键均可触发 | 有上一章/下一章按钮、点击左右区域、A/D/左右键 | ✅ 已实现 | `Reader.tsx:962-983` | - |
| 1.2 | 目录面板 | 从菜单打开，可筛选、跳转 | 桌面顶栏弹出目录、移动端底部 sheet 目录，支持筛选 | ✅ 已实现 | `CatalogPanel.tsx` | - |
| 1.3 | 进度条/章节滑块 | SeekBar，可拖动到指定章节 | 有 `ChapterSlider`，支持拖动 | ✅ 已实现 | `ChapterSlider.tsx` | - |
| 1.4 | 顶部工具栏菜单 | 源操作、刷新、下载、书签、编辑内容、更多设置等完整菜单 | 只有「目录、TTS、设置、固定工具栏、全屏」 | ⚠️ 大幅简化 | `ReadMenu.kt`, `Reader.tsx:1372-1505` | 中 |
| 1.5 | 换源/禁用源/登录/支付 | Reader 菜单可直接换源、禁用当前源、登录、执行 payAction | 没有入口；换源在书架批量操作里 | ❌ 缺失 | `ReadBookActivity.kt:458-475`, `Bookshelf.tsx:401` | 中 |
| 1.6 | 亮度调节 | 阅读菜单内置亮度 SeekBar | 无 | ❌ 缺失 | `ReadMenu.kt:216-228` | 低 |

### 2.2 翻页动画与滚动

| # | 功能 | Android 行为 | Desktop 现状 | 偏差类型 | 关键文件 | 优先级 |
|---|------|--------------|--------------|----------|----------|--------|
| 2.1 | 动画种类 | Cover / Slide / Simulation / Scroll / None 五种 | 五种名称都有，但实现是 CSS transform 切换章节时的装饰动画 | ⚠️ 视觉效果不等价 | `reader-animations.css`, `PageDelegate.kt` | 低 |
| 2.2 | 真实分页 | `ChapterProvider` 按字体/行距/页边距把文本预分成 `TextPage` | 浏览器流式滚动，没有预分页；chapterProgress 只是 `index / total` | ❌ 架构差异 | `ChapterProvider.kt`, `Reader.tsx:1215-1218` | 高 |
| 2.3 | 动画速度配置 | 可调整动画时长 | 固定时长 | ❌ 缺失 | `PageDelegate.kt:72-82` | 低 |
| 2.4 | 触摸灵敏度 | `pageTouchSlop` 可调 | 无 | ❌ 缺失 | `MoreConfigDialog.kt:186-196` | 低 |

### 2.3 排版与样式

| # | 功能 | Android 行为 | Desktop 现状 | 偏差类型 | 关键文件 | 优先级 |
|---|------|--------------|--------------|----------|----------|--------|
| 3.1 | 字体大小 | 5-95 px 可调 | 12-32 px | ⚠️ 范围小 | `ReadStyleDialog.kt:147`, `Reader.tsx:1544` | 低 |
| 3.2 | 字间距 | 可调 | 无 | ❌ 缺失 | `ReadStyleDialog.kt:151-153` | 低 |
| 3.3 | 行间距/段间距 | 可调 | 可调 | ✅ 已实现 | `Reader.tsx:1601-1638` | - |
| 3.4 | 行首缩进 | 多种预设（0/1/2/3 个全角空格） | 固定 `textIndent: 2em` | ⚠️ 不可配置 | `ReadStyleDialog.kt:120-127`, `Reader.tsx:2085` | 低 |
| 3.5 | 自定义字体文件 | 支持选择本地 TTF/OTF | 只有 system/serif/sans 三种 CSS 字体族 | ❌ 缺失 | `ReadStyleDialog.kt:117-119` | 中 |
| 3.6 | 字体粗细 | 可切换常规/粗体 | 无 | ❌ 缺失 | `ReadStyleDialog.kt:109-116` | 低 |
| 3.7 | 主题/背景 | 多预设 + 自定义背景图 + 文字/背景/边框颜色 + 透明度 | 只有 day/night/eink 三色 + 全局背景透明度 | ⚠️ 简化 | `BgTextConfigDialog.kt`, `Reader.tsx:29-33,1680-1701` | 中 |
| 3.8 | 状态栏图标深色模式 | 可设 | 无 | ❌ 缺失 | `BgTextConfigDialog.kt:203-206` | 低 |
| 3.9 | 下划线 | 可设 | 无 | ❌ 缺失 | `BgTextConfigDialog.kt:207-210` | 低 |
| 3.10 | 页面边距 | `PaddingConfigDialog` 上下左右可设 | 固定 padding，内容宽度可调 | ⚠️ 不可配置 | `PaddingConfigDialog.kt`, `Reader.tsx:1928-1933` | 低 |
| 3.11 | 双页布局 | 横屏双页 | 无 | ❌ 缺失 | `MoreConfigDialog.kt:149-152` | 低 |
| 3.12 | 简繁转换 | 可在阅读界面切换 | 无（后端 `content_processor.rs` 已支持 `chinese_convert`） | ❌ 前端缺失 | `ReadStyleDialog.kt:110-113`, `content_processor.rs:58-63` | 中 |
| 3.13 | 文本对齐 | 左对齐/两端对齐 | 已支持 | ✅ 已实现 | `Reader.tsx:1703-1722` | - |

### 2.4 文字选择与操作

| # | 功能 | Android 行为 | Desktop 现状 | 偏差类型 | 关键文件 | 优先级 |
|---|------|--------------|--------------|----------|----------|--------|
| 4.1 | 长按选词 | 长按后进入选择模式，带左右光标 | 仅依赖浏览器原生选择；`textSelectable` 只是 CSS 开关 | ⚠️ 大偏差 | `ReadView.kt:317-386`, `Reader.tsx:132-134,1938` | 高 |
| 4.2 | 选中后操作菜单 | 复制、书签、替换、搜索、字典、朗读 | 无 | ❌ 缺失 | `TextActionMenu.kt`, `ReadBookActivity.kt:846-897` | 高 |
| 4.3 | 从选中文字创建书签 | 菜单项直接创建 | 无 | ❌ 缺失 | `ReadBookActivity.kt:856-861` | 高 |
| 4.4 | 从选中文字创建替换规则 | 菜单项直接创建 | 无 | ❌ 缺失 | `ReadBookActivity.kt:866-883` | 中 |
| 4.5 | 字典/浏览器搜索 | 选中后搜索/查字典 | 无 | ❌ 缺失 | `TextActionMenu.kt` | 低 |

### 2.5 书签

| # | 功能 | Android 行为 | Desktop 现状 | 偏差类型 | 关键文件 | 优先级 |
|---|------|--------------|--------------|----------|----------|--------|
| 5.1 | 添加书签 | Reader 菜单或选中菜单添加 | 没有入口；后端 `add_bookmark` 已注册但 Reader 未调用 | ❌ 前端缺失 | `Reader.tsx`, `commands.rs:683-724`, `Bookmarks.tsx` | 高 |
| 5.2 | 编辑书签/预览 | `BookmarkDialog` 编辑内容 | 无 | ❌ 缺失 | `BookmarkDialog.kt` | 中 |
| 5.3 | 书签列表 | `AllBookmarkActivity` | `Bookmarks.tsx` 已实现列表和跳转 | ✅ 已实现 | `Bookmarks.tsx` | - |

### 2.6 TTS / 朗读

| # | 功能 | Android 行为 | Desktop 现状 | 偏差类型 | 关键文件 | 优先级 |
|---|------|--------------|--------------|----------|----------|--------|
| 6.1 | 启动朗读 | 使用系统 TTS 或自定义 HttpTTS | 仅 `window.speechSynthesis`，固定 `lang: 'zh-CN'` | ⚠️ 能力弱 | `ReadBookActivity.kt:1326-1377`, `Reader.tsx:399-446` | 高 |
| 6.2 | HttpTTS 支持 | 可配置、导入、选择在线 TTS 引擎 | 后端已支持 CRUD，但 Reader 未接入 | ❌ 前端缺失 | `HttpTtsEditDialog.kt`, `commands.rs:763-800` | 高 |
| 6.3 | 朗读引擎选择 | 系统 TTS / HttpTTS 切换 | 无 | ❌ 缺失 | `SpeakEngineDialog.kt` | 中 |
| 6.4 | 朗读速度 | 0.5x-2.0x | 0.5x-2.0x | ✅ 已实现 | `Reader.tsx:182-184` | - |
| 6.5 | 睡眠定时 | 5-180 分钟定时关闭 | 无 | ❌ 缺失 | `ReadAloudDialog.kt:130-140` | 中 |
| 6.6 | 段落导航 | 上一段/下一段 | 无 | ❌ 缺失 | `ReadAloudDialog.kt:111-112` | 低 |
| 6.7 | 朗读时翻页联动 | 滚动模式朗读自动跟随当前页位置 | 无 | ❌ 缺失 | `ReadBookActivity.kt:1353-1368` | 中 |

### 2.7 自动翻页

| # | 功能 | Android 行为 | Desktop 现状 | 偏差类型 | 关键文件 | 优先级 |
|---|------|--------------|--------------|----------|----------|--------|
| 7.1 | 自动翻页 | `AutoPager` 按真实页翻页 | 只有 `setInterval` 滚动一屏，到章末切下一章 | ⚠️ 实现浅 | `AutoPager.kt`, `Reader.tsx:985-996,1108-1115` | 中 |
| 7.2 | 翻页速度 | 秒/页可调 | 毫秒间隔 1200-8000 | ✅ 已实现 | `Reader.tsx:2717-2728` | - |
| 7.3 | E-Ink 模式自动翻页 | 翻页后额外延迟 | 无 | ❌ 缺失 | `AutoPager.kt:34-35` | 低 |
| 7.4 | 菜单显示时暂停自动翻页 | 有 | 无 | ❌ 缺失 | `ReadBookActivity.kt:1496-1501` | 低 |

### 2.8 章内/全书搜索

| # | 功能 | Android 行为 | Desktop 现状 | 偏差类型 | 关键文件 | 优先级 |
|---|------|--------------|--------------|----------|----------|--------|
| 8.1 | 当前章节搜索 | 可高亮并上下跳转 | 已实现，DOM 高亮 + F3/Shift+F3 | ✅ 已实现 | `Reader.tsx:1016-1105` | - |
| 8.2 | 全书搜索 | `SearchContentActivity` 跨所有章节搜索 | 仅当前章节 | ❌ 缺失 | `SearchContentActivity.kt` | 高 |
| 8.3 | 搜索结果跳转 | 跳到结果所在页并高亮 | 仅当前章结果可跳转 | ⚠️ 部分实现 | `ReadBookActivity.kt:1490-1543` | 高 |

### 2.9 替换规则

| # | 功能 | Android 行为 | Desktop 现状 | 偏差类型 | 关键文件 | 优先级 |
|---|------|--------------|--------------|----------|----------|--------|
| 9.1 | 启用/禁用替换 | 每本书可独立开关 | 全局开关 `reader_use_replace_rules` | ⚠️ 粒度不同 | `ReadBookActivity.kt:527`, `Reader.tsx:126-128` | 中 |
| 9.2 | 查看生效规则 | `EffectiveReplacesDialog` | 无 | ❌ 缺失 | `EffectiveReplacesDialog.kt` | 低 |
| 9.3 | 从选中文字创建规则 | 菜单直接创建 | 无 | ❌ 缺失 | `ReadBookActivity.kt:866-883` | 中 |
| 9.4 | 规则管理页面 | `ReplaceRuleActivity` | `ReplaceRules.tsx` 已实现 | ✅ 已实现 | `ReplaceRules.tsx` | - |

### 2.10 点击区域与按键

| # | 功能 | Android 行为 | Desktop 现状 | 偏差类型 | 关键文件 | 优先级 |
|---|------|--------------|--------------|----------|----------|--------|
| 10.1 | 9 区点击自定义 | 3×3 网格，每格 14 种动作可选 | 只有「左/中/右」三区，动作固定 | ❌ 缺失 | `ClickActionConfigDialog.kt`, `Reader.tsx:1815-1855` | 高 |
| 10.2 | 点击区域模式 | chapter/scroll 切换 | 已支持 | ✅ 已实现 | `Reader.tsx:138-140,2694-2709` | - |
| 10.3 | 音量键翻页 | 可设音量上/下为上一页/下一页 | 无 | ❌ 缺失 | `ReadBookActivity.kt:699-704,927-936` | 中 |
| 10.4 | 鼠标滚轮翻页 | 滚轮上/下翻页 | 无 | ❌ 缺失 | `ReadBookActivity.kt:662-677` | 中 |
| 10.5 | 自定义翻页键 | `PageKeyDialog` 自定义按键 | 无 | ❌ 缺失 | `PageKeyDialog.kt`, `BaseReadBookActivity.kt:377-391` | 低 |
| 10.6 | 空格/PageUp/PageDown | 空格下一页，PageUp/PageDown 翻页 | 只有 Space 控制 TTS，无 PageUp/PageDown | ⚠️ 缺失 | `ReadBookActivity.kt:707-720`, `Reader.tsx:1118-1184` | 中 |
| 10.7 | 快捷键 | A/D/左右/S/T/F3/加减 | 已支持一部分 | ⚠️ 不完整 | `Reader.tsx:1118-1184` | 低 |

### 2.11 高级设置

| # | 功能 | Android 行为 | Desktop 现状 | 偏差类型 | 关键文件 | 优先级 |
|---|------|--------------|--------------|----------|----------|--------|
| 11.1 | 屏幕方向 | 竖屏/横屏/传感器/反向 | 无 | ❌ 缺失 | `BaseReadBookActivity.kt:147-156` | 低 |
| 11.2 | 保持亮屏 | `keepScreenOn` + 自定义超时 | 只有 `navigator.wakeLock` 开关 | ⚠️ 简化 | `BaseReadBookActivity.kt:239-248`, `Reader.tsx:289-318` | 低 |
| 11.3 | 隐藏状态栏/导航栏 | 可设 | 只有全屏按钮 | ⚠️ 简化 | `MoreConfigDialog.kt:119-127`, `Reader.tsx:1478-1498` | 低 |
| 11.4 | 刘海屏适配 | `paddingDisplayCutouts` | 无 | ❌ 缺失 | `MoreConfigDialog.kt:172-176` | 低 |
| 11.5 | 两端对齐/末行对齐/CJK 排版 | 可设 | 只有 CSS `text-align: justify` | ⚠️ 简化 | `MoreConfigDialog.kt:135-139` | 低 |
| 11.6 | 图片样式 | default/full/text/single | 无 | ❌ 缺失 | `ReadBookActivity.kt:575-593` | 中 |
| 11.7 | Re-segment 智能分段 | 可开关；后端 `content_processor.rs` 已实现 | Reader 无开关，是否启用由后端固定逻辑决定 | ❌ 前端缺失 | `ReadBookActivity.kt:528-532`, `content_processor.rs:54-55` | 中 |
| 11.8 | 移除 Ruby/ H 标签 | 可开关 | 无 | ❌ 缺失 | `ReadBookActivity.kt:540-558` | 低 |
| 11.9 | 模拟阅读（每日限制） | 可设每日章节数与起始日期 | 无 | ❌ 缺失 | `BaseReadBookActivity.kt:290-344` | 低 |
| 11.10 | 内容编辑 | `ContentEditDialog` 直接编辑当前章内容 | 无 | ❌ 缺失 | `ContentEditDialog.kt`, `ReadBookActivity.kt:515` | 中 |
| 11.11 | 字符集设置 | 本地书可手动指定编码 | 无 | ❌ 缺失 | `BaseReadBookActivity.kt:574`, `ReadBookActivity.kt:574` | 中 |
| 11.12 | 重复标题移除状态 | 可查看/反转移除状态 | 无 | ❌ 缺失 | `ReadBookActivity.kt:605-618` | 低 |

### 2.12 进度与同步

| # | 功能 | Android 行为 | Desktop 现状 | 偏差类型 | 关键文件 | 优先级 |
|---|------|--------------|--------------|----------|----------|--------|
| 12.1 | 保存阅读进度 | 自动保存 `dur_chapter_index`/`dur_chapter_pos` | 只保存 `dur_chapter_index`，`dur_chapter_pos` 始终写 0 | ⚠️ 精度低 | `Reader.tsx:470-498`, `ReadBookActivity.kt:367` | 中 |
| 12.2 | 阅读时间统计 | `add_read_record` | 已实现 | ✅ 已实现 | `Reader.tsx:321-333,381-397` | - |
| 12.3 | WebDAV 进度同步 | 按书籍同步进度，支持冲突提示 | 无；WebDAV 只用于整库备份/恢复 | ❌ 缺失 | `ReadBookViewModel.kt:240-261`, `webdav.rs`, `SettingsBackup.tsx` | 高 |
| 12.4 | 网络变化自动同步 | 监听网络恢复后同步 | 无 | ❌ 缺失 | `ReadBookActivity.kt:352-359` | 中 |
| 12.5 | 退出搜索后恢复进度 | 保存并恢复搜索前的位置 | 无 | ❌ 缺失 | `ReadBookActivity.kt:191-194` | 低 |

### 2.13 后台与系统

| # | 功能 | Android 行为 | Desktop 现状 | 偏差类型 | 关键文件 | 优先级 |
|---|------|--------------|--------------|----------|----------|--------|
| 13.1 | 自动备份 | 退出阅读时触发 `Backup.autoBack` | 无 | ❌ 缺失 | `ReadBookActivity.kt:377-378` | 中 |
| 13.2 | 下载章节（缓存到本地） | 阅读菜单可下载后续章节 | 书架/详情页有 `batch_cache_chapters`，Reader 内无入口 | ⚠️ 入口缺失 | `ReadBookActivity.kt:512`, `BookDetail.tsx:215-272` | 中 |
| 13.3 | 在线书换源/章节换源 | Reader 内直接换 | 无 | ❌ 缺失 | `ReadBookActivity.kt:458-475` | 中 |
| 13.4 | 刷新当前章/之后章节/全部 | 菜单可刷新缓存 | 无 | ❌ 缺失 | `ReadBookActivity.kt:477-510` | 中 |

---

## 3. 后端已具备但前端 Reader 未接入的能力

这些功能 Rust 后端已经有 IPC 命令或处理逻辑，只需在前端 Reader 增加入口或状态绑定即可：

1. **书签**：`add_bookmark` / `update_bookmark` / `delete_bookmark` / `get_bookmarks` 均已注册（`commands.rs:683-724`）。
2. **HttpTTS**：`get_http_tts_list` / `add_http_tts` / `update_http_tts` / `delete_http_tts` 已注册（`commands.rs:763-800`），并有导入命令。
3. **简繁转换**：`content_processor.rs:58-63` 已支持 `chinese_convert: 0/1/2`，但 `fetch_chapter_content` 流程未暴露该开关。
4. **Re-segment**：`content_processor.rs:54-55` 已支持开关，但 Reader 未暴露。
5. **批量缓存**：`batch_cache_chapters` 已实现，但入口在 `BookDetail.tsx` 而非 Reader。
6. **书籍导出**：`export_book_text` 已实现，入口也在 `BookDetail.tsx`。
7. **更新检查**：`check_book_update` 已实现，入口在 `Bookshelf.tsx`。
8. **WebDAV 备份/恢复**：已实现，但仅整库级别，没有按书进度同步。

---

## 4. 需要后端补强才能对齐的功能

1. **按书籍进度同步**：需要新增 `BookProgress` 模型与 WebDAV 按书同步命令（Android 的 `AppWebDav.getBookProgress` / `uploadProgress`）。
2. **真实分页排版**：需要把 Android `ChapterProvider` 的分页算法移植到 Rust/前端，或在前端用 Canvas 实现类似排版。
3. **系统 TTS / HttpTTS 播放**：Web Speech API 无法接入 HttpTTS；需要 Rust 端用 `reqwest` 拉取音频并播放，或调用系统 TTS。
4. **内容编辑保存**：需要 `update_chapter_content` 命令把用户编辑后的内容写回 `chapter_contents` 表。
5. **图片样式处理**：`content_processor.rs` / `web_book.rs` 需要识别并渲染 `<img>` 的不同模式。
6. **字符集设置**：本地书导入时已做编码探测，但阅读时无手动指定入口；需要后端支持按书籍 `charset` 重新解码。

---

## 5. 修复建议优先级

### 高优先级（建议尽快补）
- **Reader 内添加书签**（后端已支持，工作量小，用户高频需求）。
- **接入 HttpTTS / 朗读引擎选择**（TTS 是阅读器核心功能，当前 Web Speech API 依赖浏览器，体验受限）。
- **全书搜索**（当前只能搜本章，与 Android 差距大）。
- **9 区点击自定义**（ desktop 鼠标/触控板用户也需要灵活的翻页/菜单手势）。

### 中优先级
- **文字选择后的操作菜单**（复制、书签、替换、搜索、朗读）。
- **每本书独立的替换规则开关** 与 **生效规则查看**。
- **Reader 内源操作**（换源、刷新、缓存后续章节）。
- **进度同步**（WebDAV 按书同步）。
- **简繁转换 / Re-segment 开关**。

### 低优先级
- 真实分页/双页/自定义字体文件/高级排版。
- 亮度调节、屏幕方向、模拟阅读、鼠标滚轮/音量键翻页。
- 动画速度、触摸灵敏度、E-Ink 延迟、内容编辑、图片样式、字符集设置等。

---

## 6. 备注

- 本报告以代码静态审查为主，未启动桌面应用做运行时验证。部分 CSS 动画/交互细节以实际效果为准。
- Desktop 项目对部分功能做了 intentionally 简化（如代码注释所说：动画是 decorative、自动翻页是 scroll-based），这些属于设计取舍，不一定需要完全复刻 Android。
- 如果只需要「保证核心阅读体验不落后」，建议优先处理第 5 节中的高优先级项。
