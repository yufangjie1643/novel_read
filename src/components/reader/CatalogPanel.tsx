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
        maxHeight: 360,
        overflowY: 'auto',
        margin: '0 -8px',
        padding: '0 8px',
      }}
    >
      {visible.map((ch) => {
        const isCurrent = ch.index === currentIndex;
        return (
          <button
            key={ch.url ?? ch.index}
            ref={isCurrent ? activeRef : undefined}
            type="button"
            onClick={() => onPick(ch.index)}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '10px 12px',
              border: 'none',
              background: isCurrent ? 'rgba(25, 118, 210, 0.12)' : 'transparent',
              color: isCurrent ? '#1976d2' : '#333',
              fontSize: 14,
              fontWeight: isCurrent ? 600 : 400,
              cursor: 'pointer',
              borderRadius: 6,
              margin: '2px 0',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => {
              if (!isCurrent) e.currentTarget.style.background = 'rgba(0,0,0,0.04)';
            }}
            onMouseLeave={(e) => {
              if (!isCurrent) e.currentTarget.style.background = 'transparent';
            }}
          >
            {ch.title || t('reader.chapterTitle', { idx: ch.index })}
          </button>
        );
      })}
    </div>
  );
}
