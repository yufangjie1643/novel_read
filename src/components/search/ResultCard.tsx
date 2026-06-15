import { openUrl } from '@tauri-apps/plugin-opener';
import type { SearchBook } from '../../types';
import { isTauri } from '../../utils/tauri';

export function ResultCard({
  book,
  isMobileUi,
  onClick,
  t,
}: {
  book: SearchBook;
  isMobileUi: boolean;
  onClick: () => void;
  t: (key: string) => string;
}) {
  void isMobileUi;
  const tocUrl = book.toc_url || book.book_url;
  return (
    <div
      onClick={onClick}
      style={{
        background: '#fff',
        borderRadius: 14,
        padding: 14,
        display: 'flex',
        gap: 14,
        cursor: 'pointer',
        boxShadow: '0 1px 2px rgba(0,0,0,0.06), 0 3px 10px rgba(0,0,0,0.04)',
      }}
    >
      {book.cover_url ? (
        <div
          style={{
            width: 76,
            height: 96,
            flexShrink: 0,
            aspectRatio: '76 / 96',
            borderRadius: 10,
            overflow: 'hidden',
            background: 'linear-gradient(145deg, #e8eaf6 0%, #f3e5f5 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#5c6bc0',
            fontSize: 18,
            fontWeight: 800,
          }}
        >
          <img
            src={book.cover_url}
            alt="cover"
            loading="lazy"
            decoding="async"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        </div>
      ) : (
        <div
          style={{
            width: 76,
            height: 96,
            borderRadius: 10,
            background: 'linear-gradient(145deg, #e8eaf6 0%, #f3e5f5 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#5c6bc0',
            fontSize: 18,
            fontWeight: 800,
            flexShrink: 0,
          }}
        >
          {book.name.slice(0, 2)}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: '#1a1a2e' }}>{book.name}</div>
        <div style={{ color: '#8a8a9a', fontSize: 13, fontWeight: 500 }}>{book.author}</div>
        {book.intro && (
          <div
            style={{
              color: '#666',
              fontSize: 12,
              marginTop: 4,
              lineHeight: 1.5,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {book.intro}
          </div>
        )}
        <div
          style={{
            color: '#bbb',
            fontSize: 11,
            fontWeight: 500,
            marginTop: 4,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span>{book.origin_name || 'unknown'}</span>
          {tocUrl && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (isTauri()) {
                  void openUrl(tocUrl).catch((err) => console.error('openUrl failed:', err));
                } else {
                  window.open(tocUrl, '_blank', 'noopener');
                }
              }}
              title={tocUrl}
              aria-label={t('bookDetail.openOriginal')}
              style={{
                padding: '2px 8px',
                background: 'transparent',
                color: '#888',
                border: '1px solid transparent',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 11,
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
              ↗ {t('bookDetail.openOriginal')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
