export interface BookSource {
  book_source_url: string;
  book_source_name: string;
  book_source_group?: string;
  book_source_type?: number;
  book_url_pattern?: string;
  custom_order?: number;
  enabled: boolean;
  enabled_explore: boolean;
  js_lib?: string;
  enabled_cookie_jar?: boolean;
  concurrent_rate?: string;
  header?: string;
  login_url?: string;
  login_ui?: string;
  login_check_js?: string;
  cover_decode_js?: string;
  book_source_comment?: string;
  variable_comment?: string;
  last_update_time?: number;
  respond_time?: number;
  weight?: number;
  explore_url?: string;
  explore_screen?: string;
  search_url?: string;
  rule_search?: string;
  rule_book_info?: string;
  rule_toc?: string;
  rule_content?: string;
  rule_explore?: string;
  rule_review?: string;
}

export interface ExploreItem {
  id: string;
  source_url: string;
  source_name: string;
  label: string;
  url: string;
  hasLoginUrl: boolean;
}

export interface ExploreItemsPage {
  items: ExploreItem[];
  total: number;
}

export interface ExploreKind {
  title: string;
  url?: string;
}

export interface BookSourceSummary {
  bookSourceUrl: string;
  bookSourceName: string;
  bookSourceGroup?: string;
  bookSourceType: number;
  enabled: boolean;
  enabledExplore: boolean;
  weight: number;
  customOrder: number;
}

export interface BookSourceGroup {
  sourceUrl: string;
  sourceName: string;
  sourceGroup: string | null;
  hasLoginUrl: boolean;
  weight: number;
  customOrder: number;
}

export interface SearchBook {
  name: string;
  author?: string;
  book_url: string;
  cover_url?: string;
  intro?: string;
  kind?: string;
  latest_chapter_title?: string;
  origin_name?: string;
  origin?: string;
  toc_url?: string;
}

export interface Book {
  book_url: string;
  toc_url: string;
  origin: string;
  origin_name: string;
  name: string;
  author: string;
  intro?: string;
  cover_url?: string;
  latest_chapter_title?: string;
  dur_chapter_title?: string;
  dur_chapter_index?: number;
  dur_chapter_pos?: number;
  dur_chapter_time?: number;
  total_chapter_num?: number;
  can_update?: boolean;
  group?: number;
  order?: number;
  read_config?: string;
  sync_time?: number;
}

export interface BookChapter {
  url: string;
  book_url: string;
  index: number;
  title: string;
}

export interface BookGroup {
  group_id: number;
  group_name: string;
  order: number;
  show: boolean;
  enable_refresh: boolean;
}

export interface ReplaceRule {
  id?: number;
  name?: string;
  pattern?: string;
  replacement?: string;
  scope?: string;
  is_regex: boolean;
  enabled: boolean;
  order: number;
}

export interface SearchKeyword {
  id?: number;
  keyword: string;
  usage_count: number;
  last_use_time: number;
}

export interface RssSource {
  source_url: string;
  source_name: string;
  source_group?: string;
  source_icon?: string;
  enabled: boolean;
  variable?: string;
  custom_order: number;
  last_update_time: number;
  login_url?: string;
  login_ui?: string;
  header?: string;
  sort_url?: string;
  rule_articles?: string;
  rule_next_page?: string;
  rule_title?: string;
  rule_pub_date?: string;
  rule_description?: string;
  rule_image?: string;
  rule_link?: string;
  rule_content?: string;
  single_url?: boolean;
}

export interface SourceLink {
  raw_url: string;
  source_url: string;
  link_type: string;
  label?: string;
}

export interface RuleSub {
  id?: number;
  name?: string;
  url?: string;
  sub_type: number;
  custom_order: number;
  enabled: boolean;
  auto_update: boolean;
  last_update_time: number;
}

export interface RssArticle {
  id?: number;
  origin: string;
  sort?: string;
  title: string;
  content?: string;
  description?: string;
  link?: string;
  pub_date?: string;
  variable?: string;
}

export interface Bookmark {
  id?: number;
  book_name: string;
  book_author: string;
  chapter_name?: string;
  book_url?: string;
  chapter_url?: string;
  chapter_index: number;
  page_index: number;
  content?: string;
}

export interface ReadRecord {
  book_name: string;
  read_time: number;
  last_read: number;
}

export interface HttpTTS {
  id?: number;
  name?: string;
  url?: string;
  content_type?: string;
  login_url?: string;
  login_ui?: string;
  header?: string;
  enabled: boolean;
  concurrent_rate?: string;
  last_update_time: number;
}

export interface TxtTocRule {
  id?: number;
  name?: string;
  rule?: string;
  example?: string;
  enabled: boolean;
  order: number;
}

export interface DictRule {
  id?: number;
  name?: string;
  url?: string;
  show_rule?: string;
  enabled: boolean;
  sort_number: number;
}

export interface ManagedFile {
  name: string;
  relative_path: string;
  is_dir: boolean;
  size: number;
  modified?: number;
}

export interface ManagedFileList {
  current_path: string;
  parent_path?: string;
  files: ManagedFile[];
}

export interface KeyboardAssist {
  id?: number;
  assist_type: number;
  key?: string;
  value?: string;
  serial_no: number;
}

export interface Server {
  id?: number;
  name?: string;
  url?: string;
  enabled: boolean;
}

export interface RssStar {
  id?: number;
  origin: string;
  sort?: string;
  title: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// --- search-redesign: streaming + relevance (T5/T8) ---

export type SourceKey = string;

export type FailureKind = 'Timeout' | 'Http' | 'Parse';

export interface ScoreBreakdown {
  allQueryPresent: number;
  words: number;
  typo: number;
  proximity: number;
  sourceWeight: number;
  attributeRank: number;
  wordPosition: number;
  sourceHealth: number;
}

export type SearchEvent =
  | { event: 'Started'; requestId: string; query: string; totalSources: number }
  | { event: 'SourceStarted'; sourceUrl: SourceKey; sourceName: string }
  | { event: 'Result'; sourceUrl: SourceKey; book: SearchBook; score: ScoreBreakdown }
  | { event: 'SourceFinished'; sourceUrl: SourceKey; count: number; latencyMs: number }
  | {
      event: 'SourceFailed';
      sourceUrl: SourceKey;
      error: string;
      latencyMs: number;
      kind: FailureKind;
    }
  | {
      event: 'Progress';
      requestId: string;
      running: number;
      ok: number;
      failed: number;
      total: number;
    }
  | {
      event: 'Done';
      requestId: string;
      succeeded: number;
      failed: number;
      totalResults: number;
      durationMs: number;
    };

export interface SearchProgress {
  running: number;
  ok: number;
  failed: number;
  total: number;
}

export type SourceStatus =
  | { state: 'pending'; sourceUrl: SourceKey; sourceName: string }
  | { state: 'running'; sourceUrl: SourceKey; sourceName: string }
  | { state: 'ok'; sourceUrl: SourceKey; sourceName: string; count: number; latencyMs: number }
  | {
      state: 'failed';
      sourceUrl: SourceKey;
      sourceName: string;
      error: string;
      latencyMs: number;
      kind: FailureKind;
    };

export interface SearchFailure {
  sourceUrl: SourceKey;
  sourceName: string;
  error: string;
  kind: FailureKind;
}

export type SearchState =
  | { kind: 'idle' }
  | { kind: 'typing' }
  | {
      kind: 'streaming';
      query: string;
      results: SearchBook[];
      statuses: Record<SourceKey, SourceStatus>;
      failures: SearchFailure[];
      progress: SearchProgress;
      startedAt: number;
      requestId: string;
    }
  | {
      kind: 'stalled';
      query: string;
      results: SearchBook[];
      statuses: Record<SourceKey, SourceStatus>;
      failures: SearchFailure[];
      progress: SearchProgress;
      startedAt: number;
      requestId: string;
      stalledSince: number;
    }
  | {
      kind: 'done';
      query: string;
      results: SearchBook[];
      statuses: Record<SourceKey, SourceStatus>;
      failures: SearchFailure[];
      progress: SearchProgress;
      totalResults: number;
      durationMs: number;
      requestId: string;
    }
  | { kind: 'error'; message: string };

export interface SourceStats {
  sourceUrl: string;
  totalQueries: number;
  successfulQueries: number;
  timedOutQueries: number;
  erroredQueries: number;
  totalLatencyMs: number;
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  lastErrorMessage: string | null;
  lastCheckedAt: number;
  rollingSuccessCount: number;
  rollingTotalCount: number;
  healthScore: number;
  // Per-operation health: tells the user *which stage* of a source
  // pipeline is broken (search, explore, chapter list, chapter
  // content), not just a single number.
  searchOk: number;
  searchErr: number;
  searchTimeout: number;
  lastSearchError: string | null;
  lastSearchAt: number | null;
  exploreOk: number;
  exploreErr: number;
  exploreTimeout: number;
  lastExploreError: string | null;
  lastExploreAt: number | null;
  chapterListOk: number;
  chapterListErr: number;
  chapterListTimeout: number;
  lastChapterListError: string | null;
  lastChapterListAt: number | null;
  chapterContentOk: number;
  chapterContentErr: number;
  chapterContentTimeout: number;
  lastChapterContentError: string | null;
  lastChapterContentAt: number | null;
}

/// One row of per-operation health, used by the Sources page
/// to render a small status indicator (✓ / ⚠ / ✗) for each
/// stage of a book-source pipeline.
export interface OpHealth {
  ok: number;
  err: number;
  timeout: number;
  lastError: string | null;
  lastAt: number | null;
}

export type SourceOpHealth = {
  search: OpHealth;
  explore: OpHealth;
  chapterList: OpHealth;
  chapterContent: OpHealth;
};

export function pickOpHealth(s: SourceStats | null | undefined): SourceOpHealth {
  const empty: OpHealth = { ok: 0, err: 0, timeout: 0, lastError: null, lastAt: null };
  if (!s) {
    return { search: empty, explore: empty, chapterList: empty, chapterContent: empty };
  }
  return {
    search: {
      ok: s.searchOk,
      err: s.searchErr,
      timeout: s.searchTimeout,
      lastError: s.lastSearchError,
      lastAt: s.lastSearchAt,
    },
    explore: {
      ok: s.exploreOk,
      err: s.exploreErr,
      timeout: s.exploreTimeout,
      lastError: s.lastExploreError,
      lastAt: s.lastExploreAt,
    },
    chapterList: {
      ok: s.chapterListOk,
      err: s.chapterListErr,
      timeout: s.chapterListTimeout,
      lastError: s.lastChapterListError,
      lastAt: s.lastChapterListAt,
    },
    chapterContent: {
      ok: s.chapterContentOk,
      err: s.chapterContentErr,
      timeout: s.chapterContentTimeout,
      lastError: s.lastChapterContentError,
      lastAt: s.lastChapterContentAt,
    },
  };
}

/// Symbol + color for a per-op health status. A simple "ever
/// observed a non-zero error count for this op" rule is enough
/// for the indicator — the user can hover for exact counts.
export type OpSymbol = 'ok' | 'warn' | 'err' | 'untested';

export function opSymbol(op: OpHealth): OpSymbol {
  if (op.ok === 0 && op.err === 0 && op.timeout === 0) return 'untested';
  if (op.err > 0 || op.timeout > 0) return 'err';
  if (op.ok > 0) return 'ok';
  return 'untested';
}
