import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import CatalogPanel from '../components/reader/CatalogPanel';
import type { ApiResponse, Book, BookChapter } from '../types';

export default function ChapterCatalog() {
  const { bookUrl, chapterIndex } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const idx = Math.max(0, parseInt(chapterIndex || '0', 10) || 0);
  const decodedUrl = decodeURIComponent(bookUrl || '');

  const [book, setBook] = useState<Book | null>(null);
  const [chapters, setChapters] = useState<BookChapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!decodedUrl) return;
    setLoading(true);
    setMessage('');
    (async () => {
      const booksResp = await invoke<ApiResponse<Book[]>>('get_books');
      const found = booksResp.success && booksResp.data
        ? booksResp.data.find((b) => b.book_url === decodedUrl)
        : undefined;
      if (found) setBook(found);

      const chapResp = await invoke<ApiResponse<BookChapter[]>>('get_chapters', {
        bookUrl: decodedUrl,
      });
      if (!chapResp.success || !chapResp.data) {
        setMessage(t('reader.loadChaptersFailed', { error: chapResp.error || '' }));
        setLoading(false);
        return;
      }
      setChapters(chapResp.data);
      setLoading(false);
    })();
  }, [decodedUrl, t]);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--reader-bg, #fff)',
        color: 'var(--reader-text, #1a1a2e)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Top bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 20px',
          borderBottom: '1px solid var(--reader-border, #e8e8f0)',
          background: 'var(--reader-menu-bg, #fff)',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <Link
          to={`/reader/${encodeURIComponent(decodedUrl)}/${idx}`}
          title={t('common.back')}
          aria-label={t('common.back')}
          style={{
            padding: '6px 12px',
            minWidth: 36,
            border: '1px solid var(--reader-menu-border, #e8e8f0)',
            borderRadius: 8,
            background: 'var(--reader-menu-button, #f5f7fa)',
            color: 'var(--reader-menu-text, #1a1a2e)',
            fontSize: 16,
            textDecoration: 'none',
            textAlign: 'center',
          }}
        >
          ←
        </Link>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 16,
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {t('reader.readerPanelCatalog')}
          </div>
          {book && (
            <div
              style={{
                fontSize: 12,
                opacity: 0.65,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {book.name}
            </div>
          )}
        </div>
        <div style={{ fontSize: 12, opacity: 0.65 }}>{chapters.length} 章</div>
      </div>

      {/* Filter input */}
      <div
        style={{
          padding: '10px 20px',
          borderBottom: '1px solid var(--reader-border, #e8e8f0)',
        }}
      >
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('reader.filterCatalog', { defaultValue: '筛选章节…' })}
          style={{
            width: '100%',
            padding: '8px 12px',
            border: '1px solid var(--reader-menu-border, #e8e8f0)',
            borderRadius: 8,
            fontSize: 14,
            boxSizing: 'border-box',
            background: 'var(--reader-menu-bg, #fff)',
            color: 'var(--reader-menu-text, #1a1a2e)',
          }}
        />
      </div>

      {/* Body */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', opacity: 0.65 }}>
          {t('common.loading', { defaultValue: '加载中…' })}
        </div>
      ) : message ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#c62828' }}>{message}</div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, padding: '12px 20px 24px' }}>
          <CatalogPanel
            chapters={chapters}
            currentIndex={idx}
            onPick={(newIdx) => {
              navigate(`/reader/${encodeURIComponent(decodedUrl)}/${newIdx}`);
            }}
            filter={filter}
          />
        </div>
      )}
    </div>
  );
}
