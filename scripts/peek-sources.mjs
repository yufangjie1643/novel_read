import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const SOURCES = Array.from({ length: 5 }, (_, i) => ({
  bookSourceUrl: 'https://x.com/s' + i,
  bookSourceName: '源' + i,
  bookSourceType: 0,
  bookSourceGroup: '默认',
  enabled: true,
  enabledExplore: true,
  customOrder: i,
  weight: 0,
  lastUpdateTime: 0,
  respondTime: 0,
  loginUrl: '', loginUi: '', loginCheckJs: '', coverDecodeJs: '',
  searchUrl: 'https://x.com/s', exploreUrl: '',
  ruleSearch: { bookList: '', name: '', author: '', intro: '', kind: '', lastChapter: '', bookUrl: '', coverUrl: '', wordCount: '' },
  ruleExplore: {}, ruleBookInfo: {}, ruleToc: {}, ruleContent: {},
  header: '', enabledCookieJar: false, customTag: '', lastErrorMessage: '',
}));

const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox'] });
const page = await b.newPage();
await page.setViewport({ width: 1400, height: 800 });
await page.evaluateOnNewDocument((sources) => {
  window.__TAURI_INTERNALS__ = {
    transformCallback: (c) => c,
    invoke: async (cmd) => {
      if (cmd === 'get_book_sources') return { success: true, data: sources };
      if (cmd === 'get_source_stats') return { success: true, data: [] };
      if (cmd === 'get_book_source_groups') return { success: true, data: [] };
      if (cmd.startsWith('plugin:')) return 0;
      return { success: true, data: null };
    },
  };
}, SOURCES);
await page.goto('http://localhost:1420/sources', { waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 800));
const text = await page.evaluate(() => document.body.innerText);
console.log('=== body text (first 1500 chars) ===');
console.log(text.slice(0, 1500));
await page.screenshot({ path: 'D:\\code\\novel_read\\.claude\\sources-raw.png' });
await b.close();
