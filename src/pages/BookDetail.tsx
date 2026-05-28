import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import type { ApiResponse, Book, BookChapter, BookSource, SearchBook } from '../types';

interface PreviewState {
  preview?: boolean;
  source?: BookSource;
  searchBook?: SearchBook;
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
          setMessage(t('bookDetail.loadedChapters', { count: chapResp.data.length }));
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
  }, [decodedUrl, t, fetchChaptersFromSource, isPreview, previewSource, previewSearchBook, loadPreviewBook]);

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

  async function cacheChapters() {
    if (!book || book.origin === 'local') return;
    setCaching(true);
    setMessage(t('bookDetail.caching'));
    try {
      const resp = await invoke<ApiResponse<{ cached_count: number; total_chapters: number }>>(
        'batch_cache_chapters',
        { bookUrl: decodedUrl, count: 20 }
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
    setCaching(false);
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
        onClick={() => navigate(-1)}
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
                {book.dur_chapter_title
                  ? t('bookshelf.continueReading')
                  : t('bookshelf.read')}
              </button>
            )}
            {book.origin !== 'local' && inBookshelf && (
              <button
                onClick={cacheChapters}
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
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f5f7fa')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                {ch.title}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
