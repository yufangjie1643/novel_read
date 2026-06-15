import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useTranslation } from 'react-i18next';
import { isTauri } from '../utils/tauri';
import type { ApiResponse, Book, BookChapter, BookSource, SearchBook } from '../types';

interface PreviewState {
  preview?: boolean;
  source?: BookSource;
  searchBook?: SearchBook;
  /// Absolute path the user was on when they opened this BookDetail.
  /// The "← back" button goes here so it returns to the *parent* of
  /// the detail page (Bookshelf, Explore, Reader, …) rather than the
  /// browser's last history entry — which can be a deeper sub-page
  /// (e.g. another chapter in Reader) that isn't actually the parent.
  parent?: string;
}

export default function BookDetail() {
  const { t } = useTranslation();
  const { bookUrl } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const decodedUrl = decodeURIComponent(bookUrl || '');
  const previewState = (location.state as PreviewState | null) || {};
  const isPreview = !!previewState.preview;
  const previewSource = previewState.source;
  const previewSearchBook = previewState.searchBook;

  const [book, setBook] = useState<Book | null>(null);
  const [chapters, setChapters] = useState<BookChapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [caching, setCaching] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [cacheProgress, setCacheProgress] = useState<{
    done: number;
    total: number;
    chapterTitle: string;
  } | null>(null);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState('');
  const [chapterFilter, setChapterFilter] = useState('');
  const [inBookshelf, setInBookshelf] = useState(false);

  const fetchChaptersFromSource = useCallback(
    async (book: Book, source: BookSource) => {
      setMessage(t('bookDetail.loadChapters'));
      try {
        const chapResp = await invoke<ApiResponse<BookChapter[]>>('fetch_chapter_list', {
          source,
          book,
        });
        if (chapResp.success && chapResp.data) {
          setChapters(chapResp.data);
          await invoke('add_chapters', { chapters: chapResp.data });
          if (chapResp.data.length === 0) {
            // Surface the actual rule the source tried, so the user
            // can see whether it's a CSS / XPath / regex that just
            // didn't match this page.
            let chapterList = '';
            try {
              const parsed = JSON.parse(source.rule_toc || '{}');
              chapterList = parsed.chapterList || '';
            } catch {
              /* ignore */
            }
            setMessage(
              t('bookDetail.emptyChapterListWithRule', {
                source: source.book_source_name,
                rule: chapterList || '(empty)',
              })
            );
          } else {
            setMessage(t('bookDetail.loadedChapters', { count: chapResp.data.length }));
          }
        } else {
          setMessage(t('bookDetail.loadChaptersFailed', { error: chapResp.error || '' }));
        }
      } catch (e) {
        setMessage(t('common.error', { message: String(e) }));
      }
    },
    [t]
  );

  const loadPreviewBook = useCallback(
    async (source: BookSource, searchBook: SearchBook) => {
      setMessage(t('explore.loadBookInfo'));
      try {
        const resp = await invoke<ApiResponse<Book>>('fetch_book_info', {
          source,
          book: {
            book_url: searchBook.book_url,
            toc_url: searchBook.toc_url || searchBook.book_url,
            origin: searchBook.origin || '',
            origin_name: searchBook.origin_name || '',
            name: searchBook.name,
            author: searchBook.author || '',
            intro: searchBook.intro,
            cover_url: searchBook.cover_url,
            latest_chapter_title: searchBook.latest_chapter_title,
          },
        });
        if (resp.success && resp.data) {
          setBook(resp.data);
          await fetchChaptersFromSource(resp.data, source);
        } else {
          setMessage(t('reader.fetchBookInfoFailed', { error: resp.error || '' }));
        }
      } catch (e) {
        setMessage(t('common.error', { message: String(e) }));
      }
    },
    [t, fetchChaptersFromSource]
  );

  const loadBookAndChapters = useCallback(async () => {
    if (!decodedUrl) return;
    setLoading(true);

    try {
      const bookResp = await invoke<ApiResponse<Book[]>>('get_books');
      if (bookResp.success && bookResp.data) {
        const found = bookResp.data.find((b) => b.book_url === decodedUrl);
        if (found) {
          setBook(found);
          setInBookshelf(true);
          const chapResp = await invoke<ApiResponse<BookChapter[]>>('get_chapters', {
            bookUrl: decodedUrl,
          });
          if (chapResp.success && chapResp.data && chapResp.data.length > 0) {
            setChapters(chapResp.data);
            setLoading(false);
            return;
          }
          const sourcesResp = await invoke<ApiResponse<BookSource[]>>('get_book_sources');
          if (sourcesResp.success && sourcesResp.data) {
            const source = sourcesResp.data.find((s) => s.book_source_url === found.origin);
            if (source) {
              await fetchChaptersFromSource(found, source);
            }
          }
          setLoading(false);
          return;
        }
      }

      if (isPreview && previewSource && previewSearchBook) {
        await loadPreviewBook(previewSource, previewSearchBook);
      } else {
        setMessage(t('bookDetail.notFound'));
      }
    } catch (e) {
      setMessage(t('common.error', { message: String(e) }));
    }
    setLoading(false);
  }, [
    decodedUrl,
    t,
    fetchChaptersFromSource,
    isPreview,
    previewSource,
    previewSearchBook,
    loadPreviewBook,
  ]);

  useEffect(() => {
    loadBookAndChapters();
  }, [loadBookAndChapters]);

  async function addToBookshelf() {
    if (!book) return;
    setAdding(true);
    try {
      await invoke('add_book', { book });
      await invoke('add_chapters', { chapters });
      setInBookshelf(true);
      setMessage(t('bookDetail.addedToBookshelf'));
    } catch (e) {
      setMessage(t('bookDetail.addFailed', { error: String(e) }));
    }
    setAdding(false);
  }

  function readChapter(chapter: BookChapter) {
    navigate(`/reader/${encodeURIComponent(decodedUrl)}/${chapter.index}`);
  }

  function continueReading() {
    if (!book) return;
    const idx = book.dur_chapter_index ?? 0;
    navigate(`/reader/${encodeURIComponent(decodedUrl)}/${idx}`);
  }

  // Configurable cache count, persisted to localStorage.
  const [cacheCount, setCacheCount] = useState<number>(() => {
    try {
      const v = Number.parseInt(localStorage.getItem('cache.count') || '20', 10);
      if (Number.isFinite(v) && v >= 1 && v <= 10000) return v;
    } catch {
      /* ignore */
    }
    return 20;
  });
  useEffect(() => {
    try {
      localStorage.setItem('cache.count', String(cacheCount));
    } catch {
      /* ignore */
    }
  }, [cacheCount]);

  async function cacheChapters(count: number) {
    if (!book || book.origin === 'local') return;
    setCaching(true);
    setCacheProgress({ done: 0, total: 0, chapterTitle: '' });

    // Subscribe to per-chapter progress events from the backend.
    const unlistenRef: { current: (() => void) | null } = { current: null };
    try {
      if (isTauri()) {
        const { listen } = await import('@tauri-apps/api/event');
        const unlisten = await listen<{
          book_url: string;
          book_name: string;
          done: number;
          total: number;
          chapter_index: number;
          chapter_title: string;
        }>('cache-progress', (event) => {
          // Filter to *our* book; multiple books could be caching in parallel.
          if (event.payload.book_url === decodedUrl) {
            setCacheProgress({
              done: event.payload.done,
              total: event.payload.total,
              chapterTitle: event.payload.chapter_title,
            });
          }
        });
        unlistenRef.current = unlisten;
      }
    } catch (e) {
      // Event subscription is best-effort; progress bar just won't update.
      console.warn('Failed to subscribe cache-progress:', e);
    }

    setMessage(t('bookDetail.caching'));
    try {
      const resp = await invoke<ApiResponse<{ cached_count: number; total_chapters: number }>>(
        'batch_cache_chapters',
        { bookUrl: decodedUrl, count }
      );
      if (resp.success && resp.data) {
        setMessage(
          t('bookDetail.cacheResult', {
            cached: resp.data.cached_count,
            total: resp.data.total_chapters,
          })
        );
      } else {
        setMessage(t('bookDetail.cacheFailed', { error: resp.error || '' }));
      }
    } catch (e) {
      setMessage(t('common.error', { message: String(e) }));
    }

    if (unlistenRef.current) unlistenRef.current();
    setCacheProgress(null);
    setCaching(false);
  }

  async function exportBook() {
    if (!book || book.origin === 'local') return;
    setExporting(true);
    setMessage(t('bookDetail.exporting'));
    try {
      const resp = await invoke<
        ApiResponse<{
          text: string;
          filename: string;
          chapter_count: number;
          total_chapters: number;
        }>
      >('export_book_text', { bookUrl: decodedUrl });
      if (resp.success && resp.data) {
        const { text, filename, chapter_count } = resp.data;
        // Add UTF-8 BOM so Notepad and other Windows tools display Chinese
        // correctly when opening the file directly.
        const BOM = '\uFEFF';
        const blob = new Blob([BOM + text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Revoke after a tick so the browser has time to start the download.
        setTimeout(() => URL.revokeObjectURL(url), 0);
        setMessage(
          t('bookDetail.exportResult', {
            count: chapter_count,
            filename,
          })
        );
      } else {
        setMessage(t('bookDetail.exportFailed', { error: resp.error || '' }));
      }
    } catch (e) {
      setMessage(t('common.error', { message: String(e) }));
    }
    setExporting(false);
  }

  async function openOriginal() {
    if (!book) return;
    // The bookUrl is the source-side TOC page. tocUrl is what Legado
    // would actually use to fetch chapters; prefer it when set.
    const url = book.toc_url || book.book_url;
    if (!url) {
      setMessage(t('common.error', { message: 'book has no url' }));
      return;
    }
    if (isTauri()) {
      try {
        await openUrl(url);
      } catch (e) {
        setMessage(t('common.error', { message: String(e) }));
      }
    } else {
      // Browser-mode fallback so devs can click without Tauri runtime.
      window.open(url, '_blank', 'noopener');
    }
  }

  async function openChapterInBrowser(url: string) {
    if (isTauri()) {
      try {
        await openUrl(url);
      } catch (e) {
        setMessage(t('common.error', { message: String(e) }));
      }
    } else {
      window.open(url, '_blank', 'noopener');
    }
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 20px', color: '#888' }}>
        <div
          style={{
            width: 32,
            height: 32,
            border: '3px solid #e8e8f0',
            borderTopColor: '#1976d2',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
            margin: '0 auto 16px',
          }}
        />
        <p>{t('bookDetail.loading')}</p>
      </div>
    );
  }

  if (!book) {
    return (
      <div
        style={{
          textAlign: 'center',
          padding: '60px 20px',
          color: '#c62828',
          background: '#ffebee',
          borderRadius: 12,
          fontSize: 16,
          fontWeight: 500,
        }}
      >
        {message || t('bookDetail.notFound')}
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={() => {
          const parent = previewState.parent;
          // Use the explicit parent recorded by the caller. Only
          // fall back to history back if the user landed here via
          // a deep link (no parent recorded) AND the previous entry
          // is the BookDetail's own URL — that means the user typed
          // /book/... directly and we have no better idea where to
          // go. Default to "/" (Bookshelf) in every other ambiguous
          // case, so we never bounce the user back into a deeper
          // sub-page like Reader.
          if (parent) {
            navigate(parent);
            return;
          }
          navigate('/');
        }}
        style={{
          marginBottom: 20,
          padding: '6px 14px',
          borderRadius: 8,
          border: '1px solid #e0e0e0',
          background: '#fff',
          cursor: 'pointer',
          fontSize: 14,
          color: '#555',
          fontWeight: 500,
          transition: 'all 0.2s',
        }}
      >
        ← {t('common.back')}
      </button>

      {/* Book Info Card */}
      <div
        style={{
          background: '#fff',
          borderRadius: 12,
          padding: 24,
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          marginBottom: 24,
          display: 'flex',
          gap: 20,
        }}
      >
        {book.cover_url ? (
          <img
            src={book.cover_url}
            alt="cover"
            style={{
              width: 140,
              height: 180,
              objectFit: 'cover',
              borderRadius: 10,
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              flexShrink: 0,
            }}
            onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
          />
        ) : (
          <div
            style={{
              width: 140,
              height: 180,
              borderRadius: 10,
              background: 'linear-gradient(135deg, #e3f2fd 0%, #f3e5f5 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#1976d2',
              fontSize: 20,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {book.name.slice(0, 2)}
          </div>
        )}
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 700, color: '#1a1a2e' }}>
            {book.name}
          </h1>
          <p style={{ color: '#666', margin: '0 0 12px', fontSize: 15 }}>
            {book.author}
            {book.latest_chapter_title && (
              <span style={{ color: '#888' }}> · {book.latest_chapter_title}</span>
            )}
          </p>
          {book.intro && (
            <p style={{ color: '#555', fontSize: 14, lineHeight: 1.6, margin: '0 0 16px' }}>
              {book.intro}
            </p>
          )}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {!inBookshelf ? (
              <button
                onClick={addToBookshelf}
                disabled={adding}
                style={{
                  padding: '8px 18px',
                  background: adding ? '#f5f5f5' : '#4caf50',
                  color: adding ? '#999' : '#fff',
                  border: 'none',
                  borderRadius: 8,
                  cursor: adding ? 'not-allowed' : 'pointer',
                  fontSize: 13,
                  fontWeight: 600,
                  transition: 'background 0.2s',
                }}
              >
                {adding ? t('common.loading') : t('bookDetail.addToBookshelf')}
              </button>
            ) : (
              <button
                onClick={continueReading}
                style={{
                  padding: '8px 18px',
                  background: '#1976d2',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 600,
                  transition: 'background 0.2s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#1565c0')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '#1976d2')}
              >
                {book.dur_chapter_title ? t('bookshelf.continueReading') : t('bookshelf.read')}
              </button>
            )}
            {book.origin !== 'local' && inBookshelf && (
              <>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    background: '#fff',
                    border: '1px solid #d0d0d0',
                    borderRadius: 8,
                    padding: '2px 10px',
                  }}
                >
                  <span style={{ fontSize: 12, color: '#666' }}>
                    {t('bookDetail.cacheCountLabel')}
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={10000}
                    value={cacheCount}
                    onChange={(e) => {
                      const v = Number.parseInt(e.target.value, 10);
                      if (Number.isFinite(v) && v >= 1 && v <= 10000) {
                        setCacheCount(v);
                      }
                    }}
                    style={{
                      width: 64,
                      padding: '4px 6px',
                      border: 'none',
                      outline: 'none',
                      fontSize: 13,
                      fontFamily: 'inherit',
                    }}
                    disabled={caching}
                  />
                  <span style={{ fontSize: 12, color: '#666' }}>{t('bookDetail.cacheUnit')}</span>
                </div>
                <button
                  onClick={() => cacheChapters(cacheCount)}
                  disabled={caching}
                  style={{
                    padding: '8px 18px',
                    background: caching ? '#f5f5f5' : '#e3f2fd',
                    color: caching ? '#999' : '#1565c0',
                    border: `1px solid ${caching ? '#e0e0e0' : '#bbdefb'}`,
                    borderRadius: 8,
                    cursor: caching ? 'not-allowed' : 'pointer',
                    fontSize: 13,
                    fontWeight: 600,
                    transition: 'all 0.2s',
                  }}
                >
                  {caching ? t('bookDetail.cachingShort') : t('bookDetail.cacheChapters')}
                </button>
                <button
                  onClick={() => cacheChapters(10000)}
                  disabled={caching}
                  title={t('bookDetail.cacheAllHint')}
                  style={{
                    padding: '8px 14px',
                    background: caching ? '#f5f5f5' : '#fff',
                    color: caching ? '#999' : '#1565c0',
                    border: `1px solid ${caching ? '#e0e0e0' : '#bbdefb'}`,
                    borderRadius: 8,
                    cursor: caching ? 'not-allowed' : 'pointer',
                    fontSize: 13,
                    fontWeight: 600,
                    transition: 'all 0.2s',
                  }}
                >
                  {t('bookDetail.cacheAll')}
                </button>
                <button
                  onClick={exportBook}
                  disabled={exporting}
                  title={t('bookDetail.exportHint')}
                  style={{
                    padding: '8px 14px',
                    background: exporting ? '#f5f5f5' : '#fff',
                    color: exporting ? '#999' : '#1565c0',
                    border: `1px solid ${exporting ? '#e0e0e0' : '#bbdefb'}`,
                    borderRadius: 8,
                    cursor: exporting ? 'not-allowed' : 'pointer',
                    fontSize: 13,
                    fontWeight: 600,
                    transition: 'all 0.2s',
                  }}
                >
                  {exporting ? t('bookDetail.exporting') : t('bookDetail.export')}
                </button>
              </>
            )}
            {caching && cacheProgress && cacheProgress.total > 0 && (
              <div
                style={{
                  width: '100%',
                  marginTop: 4,
                  background: '#f5f5f5',
                  borderRadius: 6,
                  padding: '8px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 12,
                    color: '#555',
                  }}
                >
                  <span>
                    {t('bookDetail.cacheProgress', {
                      done: cacheProgress.done,
                      total: cacheProgress.total,
                    })}
                  </span>
                  <span>{Math.round((cacheProgress.done / cacheProgress.total) * 100)}%</span>
                </div>
                <div
                  style={{
                    height: 8,
                    background: '#e0e0e0',
                    borderRadius: 4,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${(cacheProgress.done / cacheProgress.total) * 100}%`,
                      background: 'linear-gradient(90deg, #1976d2, #42a5f5)',
                      transition: 'width 0.2s ease',
                    }}
                  />
                </div>
                {cacheProgress.chapterTitle && (
                  <div
                    style={{
                      fontSize: 11,
                      color: '#888',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {t('bookDetail.cacheCurrent', {
                      title: cacheProgress.chapterTitle,
                    })}
                  </div>
                )}
              </div>
            )}
            {book.book_url && (
              <button
                onClick={openOriginal}
                title={t('bookDetail.openOriginalHint')}
                style={{
                  padding: '8px 18px',
                  background: '#fff',
                  color: '#555',
                  border: '1px solid #d0d0d0',
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#f5f5f5';
                  e.currentTarget.style.borderColor = '#999';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#fff';
                  e.currentTarget.style.borderColor = '#d0d0d0';
                }}
              >
                <span style={{ fontSize: 14 }}>↗</span>
                {t('bookDetail.openOriginal')}
              </button>
            )}
          </div>
        </div>
      </div>

      {message && (
        <div
          style={{
            background: message.includes(t('common.error')) ? '#ffebee' : '#e3f2fd',
            color: message.includes(t('common.error')) ? '#c62828' : '#1565c0',
            padding: '10px 16px',
            borderRadius: 8,
            marginBottom: 16,
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          {message}
        </div>
      )}

      {/* Chapters */}
      <div
        style={{
          background: '#fff',
          borderRadius: 12,
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #f0f0f0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <span style={{ fontSize: 16, fontWeight: 700, color: '#1a1a2e' }}>
            {t('bookDetail.chaptersCount', { count: chapters.length })}
          </span>
          <input
            type="text"
            placeholder={t('bookDetail.searchChapters')}
            value={chapterFilter}
            onChange={(e) => setChapterFilter(e.target.value)}
            style={{
              padding: '6px 12px',
              borderRadius: 8,
              border: '1px solid #e0e0e0',
              fontSize: 13,
              outline: 'none',
              width: 200,
              fontFamily: 'inherit',
            }}
          />
        </div>
        <div
          style={{
            maxHeight: 520,
            overflow: 'auto',
          }}
        >
          {chapters
            .filter((ch) => {
              if (!chapterFilter.trim()) return true;
              return ch.title.toLowerCase().includes(chapterFilter.toLowerCase());
            })
            .map((ch) => (
              <div
                key={ch.url}
                onClick={() => readChapter(ch)}
                style={{
                  padding: '10px 20px',
                  cursor: 'pointer',
                  borderBottom: '1px solid #f8f8f8',
                  fontSize: 14,
                  color: '#333',
                  transition: 'background 0.15s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f5f7fa')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <span
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {ch.title}
                </span>
                {ch.url && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void openChapterInBrowser(ch.url);
                    }}
                    title={t('bookDetail.openChapter')}
                    aria-label={t('bookDetail.openChapter')}
                    style={{
                      padding: '2px 8px',
                      background: 'transparent',
                      color: '#888',
                      border: '1px solid transparent',
                      borderRadius: 4,
                      cursor: 'pointer',
                      fontSize: 12,
                      lineHeight: 1,
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = '#1976d2';
                      e.currentTarget.style.borderColor = '#bbdefb';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = '#888';
                      e.currentTarget.style.borderColor = 'transparent';
                    }}
                  >
                    ↗
                  </button>
                )}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
