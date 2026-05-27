export interface BookSource {
  book_source_url: string;
  book_source_name: string;
  book_source_group?: string;
  enabled: boolean;
  enabled_explore: boolean;
  explore_url?: string;
  search_url?: string;
  rule_book_info?: string;
  rule_toc?: string;
  rule_content?: string;
  rule_explore?: string;
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
  group?: number;
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

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
