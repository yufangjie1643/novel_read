import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { access } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const PORT = Number(process.env.SMOKE_PORT || 5190);
const BASE_URL = `http://127.0.0.1:${PORT}`;

const routeCases = [
  { path: '/', text: ['书架', '测试小说'] },
  { path: '/explore', text: ['发现', '热门'] },
  { path: '/search', text: ['搜索', '书源（1 个）'] },
  { path: '/book-sources', text: ['书源管理', '测试书源'] },
  { path: '/config-market', text: ['配置市场', '网站预览', '导入清单'] },
  { path: '/rss', text: ['RSS 源', '测试 RSS'] },
  { path: '/replace-rules', text: ['替换规则', '去广告'] },
  { path: '/bookmarks', text: ['书签', '测试书签'] },
  { path: '/stats', text: ['阅读统计', '测试小说'] },
  { path: '/settings', text: ['设置', '界面设置', '阅读设置'] },
  { path: '/debug', text: ['书源调试工具', '加载书源'] },
  { path: '/book/mock-book', text: ['测试小说', '目录（2 章）'] },
  { path: '/reader/mock-book/0', text: ['第一章', '这是第一章正文'] },
];

const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

async function findChrome() {
  for (const candidate of chromeCandidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // try next candidate
    }
  }
  throw new Error('Chrome/Edge executable not found. Set CHROME_PATH to run smoke tests.');
}

async function isPortFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

function startVite() {
  const command = process.platform === 'win32' ? 'cmd.exe' : 'pnpm';
  const args =
    process.platform === 'win32'
      ? [
          '/c',
          'pnpm',
          'exec',
          'vite',
          '--host',
          '127.0.0.1',
          '--port',
          String(PORT),
          '--strictPort',
        ]
      : ['exec', 'vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'];
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, BROWSER: 'none' },
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.once('exit', (code) => {
    if (code !== null && code !== 0) {
      console.error(output);
    }
  });
  return { child, getOutput: () => output };
}

async function waitForServer(server, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (server.child.exitCode !== null) {
      throw new Error(`Vite exited before ready:\n${server.getOutput()}`);
    }
    try {
      const response = await fetch(BASE_URL);
      if (response.ok) return;
    } catch {
      // server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${BASE_URL}\n${server.getOutput()}`);
}

async function stopVite(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
      });
      killer.once('exit', resolve);
      killer.once('error', resolve);
    });
  } else {
    child.kill('SIGTERM');
  }
}

function installTauriMock(page, uiMode) {
  return page.evaluateOnNewDocument((mode) => {
    localStorage.setItem('i18nextLng', 'zh');
    localStorage.setItem('app_ui_mode', mode);
    localStorage.setItem('reader_font_size', '18');
    localStorage.setItem('reader_theme', 'light');
    localStorage.setItem('reader_line_height', '1.8');
    localStorage.setItem('reader_paragraph_spacing', '0.5');

    const source = {
      book_source_url: 'mock-source',
      book_source_name: '测试书源',
      book_source_group: '默认',
      enabled: true,
      enabled_explore: true,
      explore_url: '热门::mock://explore/hot',
      search_url: 'mock://search',
      rule_search: '{}',
      rule_book_info: '{}',
      rule_toc: '{}',
      rule_content: '{}',
    };
    const importedSource = {
      ...source,
      book_source_url: 'mock-imported-source',
      book_source_name: '导入书源',
    };
    const book = {
      book_url: 'mock-book',
      toc_url: 'mock-toc',
      origin: source.book_source_url,
      origin_name: source.book_source_name,
      name: '测试小说',
      author: '测试作者',
      intro: '自动化测试用书籍简介',
      latest_chapter_title: '第二章',
      dur_chapter_title: '第一章',
      dur_chapter_index: 0,
      dur_chapter_pos: 0,
      dur_chapter_time: Date.now(),
      total_chapter_num: 2,
      group: 1,
    };
    const chapters = [
      { book_url: book.book_url, url: 'mock-chapter-1', index: 0, title: '第一章' },
      { book_url: book.book_url, url: 'mock-chapter-2', index: 1, title: '第二章' },
    ];
    const chapterContents = {
      'mock-book:0': '这是第一章正文。\n广告内容会被替换规则处理。',
      'mock-book:1': '这是第二章正文。',
    };

    const state = {
      books: [book],
      groups: [{ group_id: 1, group_name: '默认分组', order: 0, show: true, enable_refresh: true }],
      sources: [source],
      chapters: [...chapters],
      replaceRules: [
        {
          id: 1,
          name: '去广告',
          pattern: '广告内容',
          replacement: '',
          scope: '',
          is_regex: false,
          enabled: true,
          order: 1,
        },
      ],
      bookmarks: [
        {
          id: 1,
          book_name: '测试小说',
          book_author: '测试作者',
          chapter_name: '第一章',
          book_url: 'mock-book',
          chapter_url: 'mock-chapter-1',
          chapter_index: 0,
          page_index: 0,
          content: '测试书签',
        },
      ],
      readRecords: [{ book_name: '测试小说', read_time: 3660, last_read: Date.now() }],
      rssSources: [
        {
          source_url: 'mock-rss',
          source_name: '测试 RSS',
          enabled: true,
          custom_order: 0,
          last_update_time: Date.now(),
          single_url: true,
        },
      ],
      rssArticles: [
        {
          id: 1,
          origin: 'mock-rss',
          title: 'RSS 测试文章',
          content: '<p>测试订阅内容</p>',
          description: '测试订阅摘要',
          link: 'https://example.com/article',
          pub_date: '2026-05-28',
        },
      ],
      searchKeywords: [{ id: 1, keyword: '测试', usage_count: 3, last_use_time: Date.now() }],
      ruleSubs: [
        {
          id: 1,
          name: '测试订阅',
          url: 'https://example.com/source.json',
          sub_type: 0,
          custom_order: 0,
          enabled: true,
          auto_update: true,
          last_update_time: Date.now(),
        },
      ],
      webServerRunning: false,
      readArticleIds: [],
      httpTts: [],
    };

    function ok(data = null) {
      return { success: true, data };
    }

    window.__TAURI_INTERNALS__ = {
      invoke: async (cmd, args = {}) => {
        switch (cmd) {
          case 'get_books':
            return ok([...state.books]);
          case 'get_book_groups':
            return ok([...state.groups]);
          case 'add_book_group':
            state.groups.push({ ...args.group, group_id: state.groups.length + 1 });
            return ok(null);
          case 'update_book_group':
            state.groups = state.groups.map((g) =>
              g.group_id === args.group.group_id ? args.group : g
            );
            return ok(null);
          case 'delete_book_group':
            state.groups = state.groups.filter((g) => g.group_id !== args.group_id);
            return ok(null);
          case 'get_book_sources':
            return ok([...state.sources]);
          case 'add_book_source':
            state.sources.push(args.source);
            return ok(null);
          case 'update_book_source':
            state.sources = state.sources.map((s) =>
              s.book_source_url === args.source.book_source_url ? args.source : s
            );
            return ok(null);
          case 'delete_book_source':
            state.sources = state.sources.filter((s) => s.book_source_url !== args.url);
            return ok(null);
          case 'import_source_from_url':
          case 'import_source_from_json':
            return ok([importedSource]);
          case 'get_chapters':
            return ok(state.chapters.filter((chapter) => chapter.book_url === args.bookUrl));
          case 'fetch_chapter_list':
            return ok([...chapters]);
          case 'add_chapters':
            state.chapters = [...args.chapters];
            return ok(null);
          case 'get_local_chapter_content':
            return ok(chapterContents[`${args.bookUrl}:${args.chapterIndex}`] || null);
          case 'fetch_chapter_content':
            return ok(
              chapterContents[`${args.book.book_url}:${args.chapter.index}`] || '远程章节正文'
            );
          case 'save_local_chapter_content':
            chapterContents[`${args.bookUrl}:${args.chapterIndex}`] = args.content;
            return ok(null);
          case 'update_book':
            state.books = state.books.map((b) =>
              b.book_url === args.book.book_url ? args.book : b
            );
            return ok(null);
          case 'add_book':
            if (!state.books.some((b) => b.book_url === args.book.book_url))
              state.books.push(args.book);
            return ok(null);
          case 'delete_book':
            state.books = state.books.filter((b) => b.book_url !== (args.book_url || args.bookUrl));
            return ok(null);
          case 'check_book_update':
            return ok({
              book_url: args.book.book_url,
              has_update: true,
              new_chapter_count: 1,
              latest_chapter_title: '新章节',
            });
          case 'batch_cache_chapters':
            return ok({ cached_count: 2, total_chapters: 2 });
          case 'import_txt_book':
          case 'import_epub_book':
            return ok({ book_url: 'local-book', name: '本地测试书', chapter_count: 1 });
          case 'search_books':
            return ok([
              {
                name: '搜索结果小说',
                author: '测试作者',
                book_url: 'search-book',
                toc_url: 'search-toc',
                origin: source.book_source_url,
                origin_name: source.book_source_name,
                latest_chapter_title: '最新章',
              },
            ]);
          case 'fetch_book_info':
            return ok({
              ...book,
              book_url: args.book.book_url,
              toc_url: args.book.toc_url || args.book.book_url,
              name: args.book.name,
            });
          case 'explore_books':
            return ok([
              {
                name: '发现小说',
                author: '测试作者',
                book_url: 'explore-book',
                toc_url: 'explore-toc',
                origin: source.book_source_url,
                origin_name: source.book_source_name,
                latest_chapter_title: '探索章',
              },
            ]);
          case 'get_search_keywords':
            return ok([...state.searchKeywords]);
          case 'add_search_keyword':
            state.searchKeywords.unshift({
              id: Date.now(),
              keyword: args.keyword,
              usage_count: 1,
              last_use_time: Date.now(),
            });
            return ok(null);
          case 'clear_search_keywords':
            state.searchKeywords = [];
            return ok(null);
          case 'get_rule_subs':
            return ok([...state.ruleSubs]);
          case 'add_rule_sub':
            state.ruleSubs.push({ ...args.sub, id: Date.now() });
            return ok(null);
          case 'delete_rule_sub':
            state.ruleSubs = state.ruleSubs.filter((sub) => sub.id !== args.id);
            return ok(null);
          case 'get_rss_sources':
            return ok([...state.rssSources]);
          case 'get_rss_articles':
            return ok(state.rssArticles.filter((article) => article.origin === args.origin));
          case 'fetch_rss_articles':
            return ok(null);
          case 'add_rss_source':
            state.rssSources.push(args.source);
            return ok(null);
          case 'delete_rss_source':
            state.rssSources = state.rssSources.filter((item) => item.source_url !== args.url);
            return ok(null);
          case 'mark_rss_read':
            state.readArticleIds.push(args.record.article_id);
            return ok(null);
          case 'get_rss_read_article_ids':
            return ok([...state.readArticleIds]);
          case 'parse_source_links_from_html':
            return ok([
              {
                raw_url: 'mock://source-link',
                source_url: 'mock://source-link',
                link_type: 'bookSource',
                label: 'RSS 安装书源',
              },
            ]);
          case 'fetch_import_links_from_url':
            return ok([
              {
                raw_url: 'legado://import/bookSource?src=mock://book-source',
                source_url: 'mock://book-source',
                link_type: 'bookSource',
                label: '一键导入',
              },
              {
                raw_url: 'legado://import/rssSource?src=mock://rss-source',
                source_url: 'mock://rss-source',
                link_type: 'rssSource',
                label: '一键导入',
              },
              {
                raw_url: 'legado://import/replaceRule?src=mock://replace-rule',
                source_url: 'mock://replace-rule',
                link_type: 'replaceRule',
                label: '一键导入',
              },
              {
                raw_url: 'legado://import/httpTTS?src=mock://tts',
                source_url: 'mock://tts',
                link_type: 'httpTTS',
                label: '一键导入',
              },
              {
                raw_url: 'legado://import/theme?src=mock://theme',
                source_url: 'mock://theme',
                link_type: 'theme',
                label: '一键导入',
              },
            ]);
          case 'import_rss_source_from_url':
            return ok([
              {
                source_url: 'mock-imported-rss',
                source_name: '导入订阅源',
                enabled: true,
                custom_order: 0,
                last_update_time: Date.now(),
              },
            ]);
          case 'import_replace_rules_from_url':
            return ok([
              {
                name: '导入净化规则',
                pattern: '广告',
                replacement: '',
                is_regex: false,
                enabled: true,
                order: 10,
              },
            ]);
          case 'import_http_tts_from_url':
            return ok([
              {
                name: '导入 TTS',
                url: 'mock://tts',
                enabled: true,
                last_update_time: Date.now(),
              },
            ]);
          case 'get_replace_rules':
            return ok([...state.replaceRules]);
          case 'add_replace_rule': {
            const next = { ...args.rule, id: Date.now() };
            state.replaceRules.push(next);
            return ok(null);
          }
          case 'update_replace_rule':
            state.replaceRules = state.replaceRules.map((rule) =>
              rule.id === args.rule.id ? args.rule : rule
            );
            return ok(null);
          case 'delete_replace_rule':
            state.replaceRules = state.replaceRules.filter((rule) => rule.id !== args.id);
            return ok(null);
          case 'add_http_tts':
            state.httpTts.push({ ...args.tts, id: Date.now() });
            return ok(null);
          case 'get_http_tts_list':
            return ok([...state.httpTts]);
          case 'get_bookmarks':
            return ok(state.bookmarks.filter((bookmark) => bookmark.book_url === args.book_url));
          case 'delete_bookmark':
            state.bookmarks = state.bookmarks.filter((bookmark) => bookmark.id !== args.id);
            return ok(null);
          case 'get_read_records':
            return ok([...state.readRecords]);
          case 'add_read_record':
            state.readRecords.push(args.record);
            return ok(null);
          case 'delete_read_record':
            state.readRecords = state.readRecords.filter(
              (record) => record.book_name !== args.bookName
            );
            return ok(null);
          case 'get_web_server_status':
            return ok(state.webServerRunning);
          case 'start_web_server':
            state.webServerRunning = true;
            return ok(`http://127.0.0.1:${args.port || 1122}`);
          case 'stop_web_server':
            state.webServerRunning = false;
            return ok(null);
          case 'test_webdav_connection':
            return ok(null);
          case 'backup_to_webdav':
            return ok('backup.json');
          case 'restore_from_webdav':
            return ok('restore.json');
          case 'debug_book_source':
            return ok({
              request_url: 'mock://debug',
              raw_response: '<html>debug</html>',
              parsed_result: JSON.stringify({ ok: true, step: args.step }, null, 2),
            });
          default:
            throw new Error(`Unmocked invoke: ${cmd}`);
        }
      },
    };
  }, uiMode);
}

async function textContent(page) {
  return page.evaluate(() => document.body.innerText || '');
}

async function assertText(page, expected) {
  const text = await textContent(page);
  for (const item of expected) {
    if (!text.includes(item)) {
      throw new Error(`Expected page to include "${item}". Current text:\n${text.slice(0, 1200)}`);
    }
  }
  if (/Cannot read properties|ReferenceError|TypeError:|Unmocked invoke/.test(text)) {
    throw new Error(`Page displayed runtime error:\n${text.slice(0, 1200)}`);
  }
}

async function clickByText(page, text) {
  const handle = await page.waitForFunction(
    (label) => {
      const direct = Array.from(document.querySelectorAll('button, a, [role="button"]'));
      const directMatch = direct.find((element) =>
        (element.textContent || '').trim().includes(label)
      );
      if (directMatch) return directMatch;

      const pointerDivs = Array.from(document.querySelectorAll('div')).filter(
        (element) => getComputedStyle(element).cursor === 'pointer'
      );
      return pointerDivs.find((element) => (element.textContent || '').trim().includes(label));
    },
    {},
    text
  );
  const element = handle.asElement();
  if (!element) throw new Error(`Could not click text: ${text}`);
  await element.click();
}

async function clickButtonByText(page, text) {
  const handle = await page.waitForFunction(
    (label) =>
      Array.from(document.querySelectorAll('button')).find(
        (element) =>
          (element.textContent || '').trim() === label ||
          (element.textContent || '').trim().includes(label)
      ),
    {},
    text
  );
  const element = handle.asElement();
  if (!element) throw new Error(`Could not click button text: ${text}`);
  await element.click();
}

async function fillInput(page, selector, value, index = 0) {
  await page.waitForSelector(selector);
  const elements = await page.$$(selector);
  const element = elements[index];
  if (!element) throw new Error(`Input not found: ${selector} at index ${index}`);
  await element.click({ clickCount: 3 });
  await element.press('Backspace');
  await element.type(value);
}

async function assertNoHorizontalOverflow(page, label) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  if (overflow > 2) {
    throw new Error(`${label} has horizontal overflow: ${overflow}px`);
  }
}

async function visit(page, route, mode) {
  await page.goto(`${BASE_URL}${route.path}`, { waitUntil: 'networkidle0' });
  await assertText(page, route.text);
  if (mode === 'mobile') {
    await assertNoHorizontalOverflow(page, `${mode} ${route.path}`);
  }
}

async function runFunctionalChecks(page, mode) {
  await page.goto(`${BASE_URL}/search`, { waitUntil: 'networkidle0' });
  await fillInput(page, 'input[placeholder="输入书名"]', '测试');
  await clickButtonByText(page, '搜索');
  await page.waitForFunction(() => document.body.innerText.includes('搜索结果小说'));
  await assertText(page, ['搜索结果（1 条）', '搜索结果小说']);

  await page.goto(`${BASE_URL}/explore`, { waitUntil: 'networkidle0' });
  await clickByText(page, '热门');
  await page.waitForFunction(() => document.body.innerText.includes('发现小说'));
  await assertText(page, ['找到 1 本书', '发现小说']);

  await page.goto(`${BASE_URL}/rss`, { waitUntil: 'networkidle0' });
  await clickByText(page, '测试 RSS');
  await page.waitForFunction(() => document.body.innerText.includes('RSS 安装书源'));
  await assertText(page, ['1 篇文章', '可安装书源', 'RSS 安装书源']);

  await page.goto(`${BASE_URL}/config-market`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.body.innerText.includes('发现 5 个可导入项'));
  await assertText(page, ['配置市场', '网站预览', '导入清单', '书源', '订阅源', '净化规则', 'TTS', '主题', '未支持']);
  await clickByText(page, '导入所选');
  await page.waitForFunction(() => document.body.innerText.includes('导入完成'));
  await assertText(page, ['成功 4 项']);

  await page.goto(`${BASE_URL}/replace-rules`, { waitUntil: 'networkidle0' });
  await fillInput(page, 'input', '测试规则', 0);
  await fillInput(page, 'input', '屏蔽词', 1);
  await clickByText(page, '添加');
  await page.waitForFunction(() => document.body.innerText.includes('测试规则'));
  await assertText(page, ['测试规则']);

  await page.goto(`${BASE_URL}/debug`, { waitUntil: 'networkidle0' });
  await clickByText(page, '加载书源');
  await page.waitForFunction(() => document.body.innerText.includes('测试书源'));
  await fillInput(page, 'input[placeholder="输入搜索关键词"]', '测试');
  await clickByText(page, '运行调试');
  await page.waitForFunction(() => document.body.innerText.includes('mock://debug'));
  await assertText(page, ['请求地址', 'mock://debug']);

  await page.goto(`${BASE_URL}/reader/mock-book/0`, { waitUntil: 'networkidle0' });
  await clickByText(page, '设置');
  await page.waitForFunction(() => document.body.innerText.includes('字体大小'));
  await assertText(page, ['字体大小', '行间距', '段间距']);

  await page.goto(`${BASE_URL}/settings`, { waitUntil: 'networkidle0' });
  await clickByText(page, mode === 'mobile' ? '桌面端' : '移动端');
  await assertText(page, ['界面设置', '阅读设置', 'Legado 配置导入']);
  await clickByText(page, '读取');
  await page.waitForFunction(() => document.body.innerText.includes('发现 5 个可导入项'));
  await assertText(page, ['书源', '订阅源', '净化规则', 'TTS', '主题', '未支持']);
  await clickByText(page, '批量导入');
  await page.waitForFunction(() => document.body.innerText.includes('导入完成'));
  await assertText(page, ['成功 4 项', '未支持 0 项']);
}

async function runSuite(browser, uiMode) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.stack || error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setViewport(
    uiMode === 'mobile' ? { width: 390, height: 844 } : { width: 1365, height: 900 }
  );
  await installTauriMock(page, uiMode);

  for (const route of routeCases) {
    await visit(page, route, uiMode);
  }
  await runFunctionalChecks(page, uiMode);

  if (errors.length > 0) {
    throw new Error(`${uiMode} console/page errors:\n${errors.join('\n')}`);
  }
  await page.close();
}

async function main() {
  if (!(await isPortFree(PORT))) {
    throw new Error(`Port ${PORT} is already in use. Set SMOKE_PORT to another free port.`);
  }
  const chromePath = await findChrome();
  const vite = startVite();
  let browser;
  try {
    await waitForServer(vite);
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: 'new',
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    });
    for (const mode of ['desktop', 'mobile']) {
      await runSuite(browser, mode);
      console.log(`✓ ${mode} smoke suite passed`);
    }
  } finally {
    if (browser) await browser.close();
    await stopVite(vite.child);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
