import { invoke, Channel } from '@tauri-apps/api/core';

export type FullBookSearchHit = {
  type: 'hit';
  chapter_index: number;
  chapter_title: string;
  snippet: string;
  position: number;
  match_count: number;
};

export type FullBookSearchStarted = {
  type: 'started';
  total_chapters: number;
};

export type FullBookSearchChapterScanned = {
  type: 'chapter_scanned';
  chapter_index: number;
  scanned: number;
  total: number;
};

export type FullBookSearchDone = {
  type: 'done';
  total_hits: number;
  elapsed_ms: number;
};

export type FullBookSearchFailed = {
  type: 'failed';
  error: string;
};

export type FullBookSearchEvent =
  | FullBookSearchStarted
  | FullBookSearchHit
  | FullBookSearchChapterScanned
  | FullBookSearchDone
  | FullBookSearchFailed;

export type FullBookSearchHandlers = {
  onStarted?: (e: FullBookSearchStarted) => void;
  onHit?: (e: FullBookSearchHit) => void;
  onProgress?: (e: FullBookSearchChapterScanned) => void;
  onDone?: (e: FullBookSearchDone) => void;
  onFailed?: (e: FullBookSearchFailed) => void;
};

export function startFullBookSearch(
  bookUrl: string,
  keyword: string,
  handlers: FullBookSearchHandlers,
): { channel: Channel<FullBookSearchEvent>; promise: Promise<void> } {
  const channel = new Channel<FullBookSearchEvent>();
  channel.onmessage = (e) => {
    switch (e.type) {
      case 'started':
        handlers.onStarted?.(e);
        break;
      case 'hit':
        handlers.onHit?.(e);
        break;
      case 'chapter_scanned':
        handlers.onProgress?.(e);
        break;
      case 'done':
        handlers.onDone?.(e);
        break;
      case 'failed':
        handlers.onFailed?.(e);
        break;
    }
  };
  const promise = invoke<void>('fullbook_search', {
    bookUrl,
    keyword,
    onEvent: channel,
  });
  return { channel, promise };
}
