import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { BookChapter } from '../../types';

interface CatalogPanelProps {
  /** All chapters for the current book. */
  chapters: BookChapter[];
  /** Index of the chapter the reader is currently on. */
  currentIndex: number;
  /** Called when the user picks a chapter. */
  onPick: (index: number) => void;
  /** Optional filter text — when non-empty, hide chapters whose title
   *  doesn't contain it (case-insensitive). */
  filter?: string;
}

/**
 * Inline chapter catalog used inside the reader's mobile bottom sheet
 * (mode === 'catalog') and as the body of the desktop drawer.
 *
 * Renders a scrollable list with the current chapter highlighted.
 * Clicking a row calls `onPick(idx)`. The list auto-scrolls so the
 * current chapter is visible when the panel mounts.
 *
 * No internal state besides the auto-scroll — the parent owns the
 * filter, close button, and animation.
 */
export default function CatalogPanel({
  chapters,
  currentIndex,
  onPick,
  filter,
}: CatalogPanelProps) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  // Scroll the active row into view when the panel mounts.
  useEffect(() => {
    if (activeRef.current && listRef.current) {
      const row = activeRef.current;
      const parent = listRef.current;
      const rowTop = row.offsetTop;
      const rowBottom = rowTop + row.offsetHeight;
      const viewTop = parent.scrollTop;
      const viewBottom = viewTop + parent.clientHeight;
      if (rowTop < viewTop || rowBottom > viewBottom) {
        parent.scrollTop = Math.max(0, rowTop - parent.clientHeight / 3);
      }
    }
  }, [currentIndex]);

  const needle = (filter ?? '').trim().toLowerCase();
  const visible = needle
    ? chapters.filter((c) => (c.title ?? '').toLowerCase().includes(needle))
    : chapters;

  if (chapters.length === 0) {
    return (
      <div
        style={{
          padding: '40px 16px',
          textAlign: 'center',
          color: '#888',
          fontSize: 13,
        }}
      >
        {t('reader.catalogEmpty', 'No chapters yet.')}
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        margin: '0 -8px',
        padding: '0 8px',
      }}
    >
      {visible.map((ch) => {
        const isCurrent = ch.index === currentIndex;
        const isRead = !isCurrent && ch.index < currentIndex;
        const wordText = formatWordCount(ch.wordCount);
        const pubText = formatPubTime(ch.pubTime);
        return (
          <button
            key={ch.url ?? ch.index}
            ref={isCurrent ? activeRef : undefined}
            type="button"
            onClick={() => onPick(ch.index)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              width: '100%',
              textAlign: 'left',
              padding: '10px 12px',
              border: 'none',
              background: isCurrent ? 'rgba(25, 118, 210, 0.12)' : 'transparent',
              color: isCurrent ? '#1976d2' : isRead ? '#888' : '#333',
              fontSize: 14,
              fontWeight: isCurrent ? 600 : 400,
              cursor: 'pointer',
              borderRadius: 6,
              margin: '2px 0',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => {
              if (!isCurrent) e.currentTarget.style.background = 'rgba(0,0,0,0.04)';
            }}
            onMouseLeave={(e) => {
              if (!isCurrent) e.currentTarget.style.background = 'transparent';
            }}
          >
            <span
              aria-hidden
              style={{
                flex: '0 0 auto',
                width: 14,
                textAlign: 'center',
                fontSize: 12,
                color: isRead ? '#888' : 'transparent',
              }}
            >
              ✓
            </span>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {ch.title || t('reader.chapterTitle', { idx: ch.index })}
            </span>
            {(wordText || pubText) && (
              <span
                style={{
                  flex: '0 0 auto',
                  fontSize: 11,
                  color: isCurrent ? '#1976d2' : '#999',
                  opacity: 0.85,
                  whiteSpace: 'nowrap',
                }}
              >
                {[pubText, wordText].filter(Boolean).join(' · ')}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function formatWordCount(raw: string | undefined): string {
  if (!raw) return '';
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return '';
  return `${n.toLocaleString()} 字`;
}

function formatPubTime(unixSeconds: number | undefined): string {
  if (!unixSeconds || unixSeconds <= 0) return '';
  const d = new Date(unixSeconds * 1000);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
