import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ApiResponse, Bookmark, Book } from '../types';

export default function Bookmarks() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [books, setBooks] = useState<Book[]>([]);
  const [selectedBookUrl, setSelectedBookUrl] = useState<string>('');
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    loadBooks();
  }, []);

  useEffect(() => {
    if (selectedBookUrl) {
      loadBookmarks(selectedBookUrl);
    } else {
      loadAllBookmarks();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBookUrl, books]);

  async function loadBooks() {
    try {
      const resp = await invoke<ApiResponse<Book[]>>('get_books');
      if (resp.success && resp.data) {
        setBooks(resp.data);
      }
    } catch (e) {
      console.error('Failed to load books:', e);
    }
  }

  async function loadAllBookmarks() {
    try {
      const allBookmarks: Bookmark[] = [];
      for (const book of books) {
        const resp = await invoke<ApiResponse<Bookmark[]>>('get_bookmarks', {
          book_url: book.book_url,
        });
        if (resp.success && resp.data) {
          allBookmarks.push(...resp.data);
        }
      }
      setBookmarks(allBookmarks);
    } catch (e) {
      setMessage(t('common.error', { message: String(e) }));
    }
  }

  async function loadBookmarks(bookUrl: string) {
    try {
      const resp = await invoke<ApiResponse<Bookmark[]>>('get_bookmarks', {
        book_url: bookUrl,
      });
      if (resp.success && resp.data) {
        setBookmarks(resp.data);
      }
    } catch (e) {
      setMessage(t('common.error', { message: String(e) }));
    }
  }

  async function deleteBookmark(id: number) {
    if (!confirm(t('bookmarks.deleteConfirm'))) return;
    try {
      await invoke('delete_bookmark', { id });
      if (selectedBookUrl) {
        await loadBookmarks(selectedBookUrl);
      } else {
        await loadAllBookmarks();
      }
    } catch (e) {
      setMessage(t('common.error', { message: String(e) }));
    }
  }

  function goToReader(bookUrl: string, chapterIndex: number) {
    navigate(`/reader/${encodeURIComponent(bookUrl)}/${chapterIndex}`);
  }

  return (
    <div style={{ display: 'flex', gap: 20, minHeight: '70vh' }}>
      {/* Books sidebar */}
      <div style={{ width: 260, flexShrink: 0 }}>
        <div
          style={{
            background: '#fff',
            borderRadius: 12,
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
            padding: 16,
          }}
        >
          <h3 style={{ margin: '0 0 14px', fontSize: 16, fontWeight: 700, color: '#1a1a2e' }}>
            {t('bookmarks.books')}
          </h3>
          <div
            onClick={() => setSelectedBookUrl('')}
            style={{
              padding: '10px 12px',
              cursor: 'pointer',
              borderRadius: 8,
              marginBottom: 4,
              background: selectedBookUrl === '' ? '#eef4fd' : 'transparent',
              fontWeight: selectedBookUrl === '' ? 600 : 500,
              fontSize: 14,
              color: selectedBookUrl === '' ? '#1976d2' : '#333',
              transition: 'background 0.15s',
            }}
          >
            {t('common.all')}
          </div>
          {books.map((book) => (
            <div
              key={book.book_url}
              onClick={() => setSelectedBookUrl(book.book_url)}
              style={{
                padding: '10px 12px',
                cursor: 'pointer',
                borderRadius: 8,
                marginBottom: 4,
                background: selectedBookUrl === book.book_url ? '#eef4fd' : 'transparent',
                fontWeight: selectedBookUrl === book.book_url ? 600 : 500,
                fontSize: 14,
                color: selectedBookUrl === book.book_url ? '#1976d2' : '#333',
                transition: 'background 0.15s',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={book.name}
            >
              {book.name}
            </div>
          ))}
        </div>
      </div>

      {/* Bookmarks panel */}
      <div style={{ flex: 1 }}>
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
              fontSize: 16,
              fontWeight: 700,
              color: '#1a1a2e',
            }}
          >
            {t('bookmarks.title')}
            {bookmarks.length > 0 && (
              <span style={{ fontSize: 14, color: '#888', fontWeight: 500, marginLeft: 8 }}>
                ({bookmarks.length})
              </span>
            )}
          </div>

          {message && (
            <div
              style={{
                padding: '10px 20px',
                color: '#c62828',
                background: '#ffebee',
                fontSize: 14,
                fontWeight: 500,
              }}
            >
              {message}
            </div>
          )}

          {bookmarks.length === 0 ? (
            <div style={{ padding: '60px 20px', textAlign: 'center', color: '#888' }}>
              <p style={{ fontSize: 16 }}>{t('bookmarks.noBookmarks')}</p>
            </div>
          ) : (
            <div>
              {bookmarks.map((bm) => (
                <div
                  key={bm.id}
                  style={{
                    padding: '14px 20px',
                    borderBottom: '1px solid #f8f8f8',
                    cursor: 'pointer',
                    transition: 'background 0.15s',
                  }}
                  onClick={() => bm.book_url && goToReader(bm.book_url, bm.chapter_index)}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#f5f7fa')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: 15,
                          color: '#1a1a2e',
                          marginBottom: 4,
                        }}
                      >
                        {bm.book_name}
                        {bm.chapter_name && (
                          <span style={{ color: '#888', fontWeight: 500, marginLeft: 8 }}>
                            · {bm.chapter_name}
                          </span>
                        )}
                      </div>
                      {bm.content && (
                        <div
                          style={{
                            fontSize: 13,
                            color: '#666',
                            lineHeight: 1.5,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {bm.content}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (bm.id) deleteBookmark(bm.id);
                      }}
                      style={{
                        padding: '4px 10px',
                        fontSize: 12,
                        color: '#f44336',
                        border: '1px solid #ffcdd2',
                        background: '#fff0f0',
                        borderRadius: 6,
                        cursor: 'pointer',
                        fontWeight: 500,
                        marginLeft: 12,
                        flexShrink: 0,
                      }}
                    >
                      {t('common.delete')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
