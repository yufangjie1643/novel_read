import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './FullBookSearchPanel.module.css';
import {
  startFullBookSearch,
  type FullBookSearchHit,
  type FullBookSearchChapterScanned,
} from './fullbookSearch';

export type FullBookSearchPanelProps = {
  bookUrl: string;
  initialKeyword?: string;
  onJumpTo: (chapterIndex: number, position: number, length: number) => void;
  onClose: () => void;
};

export default function FullBookSearchPanel({
  bookUrl,
  initialKeyword = '',
  onJumpTo,
  onClose,
}: FullBookSearchPanelProps) {
  const { t } = useTranslation();
  const [keyword, setKeyword] = useState(initialKeyword);
  const [hits, setHits] = useState<FullBookSearchHit[]>([]);
  const [progress, setProgress] = useState<{ scanned: number; total: number } | null>(null);
  const [done, setDone] = useState<{ total_hits: number; elapsed_ms: number } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  /// Keep the latest Channel reference in a ref so an in-flight search
  /// can be cancelled if the user closes the panel or starts a new
  /// search before the previous one resolves.
  const searchTokenRef = useRef(0);

  const doSearch = (kw: string) => {
    const trimmed = kw.trim();
    if (!trimmed) return;
    const token = ++searchTokenRef.current;
    setHits([]);
    setProgress(null);
    setDone(null);
    setFailed(null);
    startFullBookSearch(bookUrl, trimmed, {
      onStarted: (e) => {
        if (token !== searchTokenRef.current) return;
        setProgress({ scanned: 0, total: e.total_chapters });
      },
      onHit: (e) => {
        if (token !== searchTokenRef.current) return;
        setHits((prev) => [...prev, e]);
      },
      onProgress: (e: FullBookSearchChapterScanned) => {
        if (token !== searchTokenRef.current) return;
        setProgress({ scanned: e.scanned, total: e.total });
      },
      onDone: (e) => {
        if (token !== searchTokenRef.current) return;
        setDone(e);
      },
      onFailed: (e) => {
        if (token !== searchTokenRef.current) return;
        setFailed(e.error);
      },
    }).promise.catch((err) => {
      if (token !== searchTokenRef.current) return;
      setFailed(String(err));
    });
  };

  // Auto-trigger search on mount when an initial keyword is supplied
  // (e.g. user right-clicked selected text → "Search in Book").
  useEffect(() => {
    if (initialKeyword) doSearch(initialKeyword);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trimmedKw = keyword.trim();
  const showProgress = progress && !done;
  const pct =
    progress && progress.total > 0 ? (progress.scanned / progress.total) * 100 : 0;

  return (
    <div
      className={styles.panel}
      role="dialog"
      aria-label={t('reader.fullBookSearch.title')}
      data-testid="fullbook-search-panel"
    >
      <div className={styles.header}>{t('reader.fullBookSearch.title')}</div>
      <div className={styles.inputRow}>
        <input
          type="text"
          value={keyword}
          placeholder={t('reader.fullBookSearch.keyword')}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') doSearch(keyword);
            if (e.key === 'Escape') onClose();
          }}
          autoFocus
        />
        <button
          type="button"
          onClick={() => doSearch(keyword)}
          disabled={!trimmedKw}
        >
          {t('reader.fullBookSearch.search')}
        </button>
      </div>

      {showProgress && (
        <div className={styles.progress}>
          {t('reader.fullBookSearch.chapterScanned', {
            scanned: progress!.scanned,
            total: progress!.total,
          })}
          <div className={styles.bar}>
            <div className={styles.barFill} style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {done && hits.length === 0 && (
        <div className={styles.empty}>{t('reader.fullBookSearch.noResults')}</div>
      )}

      {failed && (
        <div className={styles.empty} role="alert">
          {failed}
        </div>
      )}

      <div className={styles.results}>
        {hits.map((h, i) => (
          <div
            key={`${h.chapter_index}-${i}`}
            className={styles.item}
            onClick={() => onJumpTo(h.chapter_index, h.position, h.snippet.length)}
          >
            <div className={styles.itemTitle}>
              第 {h.chapter_index + 1} 章 · {h.chapter_title}
            </div>
            <div
              className={styles.itemSnippet}
              dangerouslySetInnerHTML={{ __html: highlightSnippet(h.snippet, trimmedKw) }}
            />
            <div className={styles.itemMeta}>
              {t('reader.fullBookSearch.matches', { count: h.match_count })}
              <button
                type="button"
                style={{ marginLeft: 8 }}
                onClick={(e) => {
                  e.stopPropagation();
                  onJumpTo(h.chapter_index, h.position, h.snippet.length);
                }}
              >
                {t('reader.fullBookSearch.jumpTo')}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className={styles.cancel}>
        <button type="button" onClick={onClose}>
          {t('common.close', { defaultValue: 'Close' })}
        </button>
      </div>
    </div>
  );
}

function highlightSnippet(snippet: string, keyword: string): string {
  if (!keyword) return escapeHtml(snippet);
  const re = new RegExp(escapeRegExp(keyword), 'gi');
  return escapeHtml(snippet).replace(re, (m) => `<mark>${escapeHtml(m)}</mark>`);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
