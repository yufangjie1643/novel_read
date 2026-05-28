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
}

export interface ExploreItemsPage {
  items: ExploreItem[];
  total: number;
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
  enabled: boolean;
  order: number;
}

export interface DictRule {
  id?: number;
  name?: string;
  url?: string;
  enabled: boolean;
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
