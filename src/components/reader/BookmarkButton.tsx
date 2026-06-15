import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addBookmark, type AddBookmarkInput } from './bookmarkActions';
import type { Book, BookChapter } from '../../types';

export type BookmarkButtonProps = {
  book: Book;
  chapter: BookChapter | undefined;
  selectedText?: string;
  onAdded: () => void;
  onError: (msg: string) => void;
};

const MAX_SNIPPET = 200;

export default function BookmarkButton({
  book,
  chapter,
  selectedText,
  onAdded,
  onError,
}: BookmarkButtonProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    if (busy || !chapter) return;
    setBusy(true);
    try {
      const content = selectedText?.trim() || chapter.title?.slice(0, MAX_SNIPPET) || '';
      const input: AddBookmarkInput = {
        book_name: book.name,
        book_author: book.author ?? '',
        chapter_name: chapter.title ?? null,
        book_url: book.book_url,
        chapter_url: chapter.url ?? null,
        chapter_index: chapter.index,
        page_index: 0,
        content,
      };
      await addBookmark(input);
      onAdded();
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy || !chapter}
      aria-label={t('reader.addBookmark')}
      title={t('reader.addBookmark')}
      data-testid="bookmark-button"
      style={{
        position: 'fixed',
        right: 16,
        top: 80,
        zIndex: 50,
        width: 44,
        height: 44,
        borderRadius: '50%',
        background: 'rgba(0, 0, 0, 0.5)',
        color: '#fff',
        border: 'none',
        cursor: 'pointer',
        fontSize: 18,
      }}
    >
      {busy ? '…' : '🔖'}
    </button>
  );
}
