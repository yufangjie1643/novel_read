import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ApiResponse, Book, BookChapter, BookGroup, BookSource, SearchBook } from '../types';
import { isTauri } from '../utils/tauri';
import { useUiMode } from '../uiMode';

export default function Bookshelf() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isMobileUi } = useUiMode();
  const [books, setBooks] = useState<Book[]>([]);
  const [groups, setGroups] = useState<BookGroup[]>([]);
  const [bookSources, setBookSources] = useState<BookSource[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [message, setMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [editingGroup, setEditingGroup] = useState<number | null>(null);
  const [editGroupName, setEditGroupName] = useState('');
  const [showGroupManage, setShowGroupManage] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedBooks, setSelectedBooks] = useState<Set<string>>(new Set());
  const [batchChangingSource, setBatchChangingSource] = useState(false);

  const loadBookshelf = useCallback(async () => {
    setLoading(true);
    // In browser mode (no Tauri runtime) skip IPC; show empty state.
    if (!isTauri()) {
      setLoading(false);
      return;
    }
    try {
      const [booksResp, groupsResp, sourcesResp] = await Promise.all([
        invoke<ApiResponse<Book[]>>('get_books'),
        invoke<ApiResponse<BookGroup[]>>('get_book_groups'),
        invoke<ApiResponse<BookSource[]>>('get_enabled_book_sources'),
      ]);
      if (booksResp.success && booksResp.data) {
        setBooks(booksResp.data);
      }
      if (groupsResp.success && groupsResp.data) {
        setGroups(groupsResp.data.filter((g) => g.show));
      }
      if (sourcesResp.success && sourcesResp.data) {
        setBookSources(sourcesResp.data);
      }
    } catch (e) {
      setMessage(t('common.error', { message: String(e) }));
    }
    setLoading(false);
  }, [t]);

  useEffect(() => {
    loadBookshelf();
  }, [loadBookshelf]);

  async function checkUpdates() {
    const onlineBooks = books.filter((b) => b.origin !== 'local' && b.can_update !== false);
    if (onlineBooks.length === 0) {
      setMessage(t('bookshelf.noOnlineBooks'));
      return;
    }
    setCheckingUpdates(true);
    setMessage(t('bookshelf.checkingUpdates', { count: onlineBooks.length }));
    let updatedCount = 0;
    let totalNew = 0;

    for (const book of onlineBooks) {
      try {
        const resp = await invoke<
          ApiResponse<{
            book_url: string;
            has_update: boolean;
            new_chapter_count: number;
            latest_chapter_title?: string;
          }>
        >('check_book_update', { book });
        if (resp.success && resp.data && resp.data.has_update) {
          updatedCount++;
          totalNew += resp.data.new_chapter_count;
        }
      } catch (e) {
        console.error(`Failed to check update for ${book.name}:`, e);
      }
    }

    setMessage(t('bookshelf.updateResult', { updated: updatedCount, totalNew }));
    setCheckingUpdates(false);
    await loadBookshelf();
  }

  async function deleteBook(bookUrl: string) {
    if (!confirm(t('bookshelf.deleteConfirm'))) return;
    try {
      const resp = await invoke<ApiResponse<null>>('delete_book', { bookUrl });
      if (resp.success) {
        setBooks((prev) => prev.filter((b) => b.book_url !== bookUrl));
      }
    } catch (e) {
      setMessage(t('common.error', { message: String(e) }));
    }
  }

  async function addGroup() {
    if (!newGroupName.trim()) return;
    try {
      const resp = await invoke<ApiResponse<null>>('add_book_group', {
        group: {
          group_name: newGroupName.trim(),
          order: groups.length,
          show: true,
          enable_refresh: true,
        },
      });
      if (resp.success) {
        setNewGroupName('');
        await loadBookshelf();
      } else {
        setMessage(t('bookshelf.addGroupFailed', { error: resp.error || '' }));
      }
    } catch (e) {
      setMessage(t('common.error', { message: String(e) }));
    }
  }

  async function updateGroup(group: BookGroup) {
    try {
      const resp = await invoke<ApiResponse<null>>('update_book_group', { group });
      if (resp.success) {
        setEditingGroup(null);
        await loadBookshelf();
      } else {
        setMessage(t('bookshelf.updateGroupFailed', { error: resp.error || '' }));
      }
    } catch (e) {
      setMessage(t('common.error', { message: String(e) }));
    }
  }

  async function deleteGroup(groupId: number) {
    if (!confirm(t('bookshelf.deleteGroupConfirm'))) return;
    try {
      const resp = await invoke<ApiResponse<null>>('delete_book_group', {
        group_id: groupId,
      });
      if (resp.success) {
        if (selectedGroup === groupId) setSelectedGroup(null);
        await loadBookshelf();
      } else {
        setMessage(t('bookshelf.deleteGroupFailed', { error: resp.error || '' }));
      }
    } catch (e) {
      setMessage(t('common.error', { message: String(e) }));
    }
  }

  function toggleBookSelection(bookUrl: string) {
    setSelectedBooks((prev) => {
      const next = new Set(prev);
      if (next.has(bookUrl)) {
        next.delete(bookUrl);
      } else {
        next.add(bookUrl);
      }
      return next;
    });
  }

  function selectAllBooks() {
    setSelectedBooks(new Set(filteredBooks.map((b) => b.book_url)));
  }

  function deselectAllBooks() {
    setSelectedBooks(new Set());
  }

  function invertBookSelection() {
    setSelectedBooks((prev) => {
      const next = new Set<string>();
      filteredBooks.forEach((book) => {
        if (!prev.has(book.book_url)) next.add(book.book_url);
      });
      return next;
    });
  }

  function checkSelectedBookInterval() {
    if (selectedBooks.size < 2) return;
    const positions = filteredBooks
      .map((book, index) => (selectedBooks.has(book.book_url) ? index : -1))
      .filter((index) => index >= 0);
    if (positions.length < 2) return;
    const min = Math.min(...positions);
    const max = Math.max(...positions);
    setSelectedBooks((prev) => {
      const next = new Set(prev);
      filteredBooks.slice(min, max + 1).forEach((book) => next.add(book.book_url));
      return next;
    });
  }

  function selectedBookList() {
    const selected = new Set(selectedBooks);
    return books.filter((book) => selected.has(book.book_url));
  }

  async function batchDeleteBooks() {
    if (selectedBooks.size === 0) return;
    if (!confirm(t('bookshelf.batchDeleteConfirm', { count: selectedBooks.size }))) return;
    const succeeded = new Set<string>();
    let failed = 0;
    for (const url of selectedBooks) {
      try {
        const resp = await invoke<ApiResponse<null>>('delete_book', { bookUrl: url });
        if (resp.success) {
          succeeded.add(url);
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }
    setBooks((prev) => prev.filter((b) => !succeeded.has(b.book_url)));
    setSelectedBooks(new Set());
    setMessage(
      t('bookshelf.batchDeleteResult', {
        total: selectedBooks.size,
        failed,
      })
    );
  }

  async function batchMoveToGroup(groupId: number | null) {
    if (selectedBooks.size === 0) return;
    let failed = 0;
    const updatedBooks: Book[] = [];
    for (const url of selectedBooks) {
      const book = books.find((b) => b.book_url === url);
      if (!book) continue;
      const updated = { ...book, group: groupId ?? 0 };
      try {
        const resp = await invoke<ApiResponse<null>>('update_book', { book: updated });
        if (resp.success) {
          updatedBooks.push(updated);
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }
    setBooks((prev) =>
      prev.map((b) => {
        const updated = updatedBooks.find((u) => u.book_url === b.book_url);
        return updated ?? b;
      })
    );
    setSelectedBooks(new Set());
    setMessage(
      t('bookshelf.batchMoveResult', {
        total: selectedBooks.size,
        failed,
      })
    );
  }

  async function batchUpdateCanUpdate(canUpdate: boolean) {
    if (selectedBooks.size === 0) return;
    let failed = 0;
    const updatedBooks: Book[] = [];
    for (const book of selectedBookList()) {
      const updated = { ...book, can_update: canUpdate };
      try {
        const resp = await invoke<ApiResponse<null>>('update_book', { book: updated });
        if (resp.success) updatedBooks.push(updated);
        else failed++;
      } catch {
        failed++;
      }
    }
    setBooks((prev) =>
      prev.map((book) => updatedBooks.find((updated) => updated.book_url === book.book_url) ?? book)
    );
    setMessage(
      t('bookshelf.batchUpdateFlagResult', {
        total: selectedBooks.size,
        failed,
      })
    );
  }

  async function batchClearCache() {
    if (selectedBooks.size === 0) return;
    let failed = 0;
    for (const book of selectedBookList()) {
      try {
        const resp = await invoke<ApiResponse<null>>('clear_book_cache', {
          bookUrl: book.book_url,
        });
        if (!resp.success) failed++;
      } catch {
        failed++;
      }
    }
    setMessage(t('bookshelf.batchClearCacheResult', { total: selectedBooks.size, failed }));
  }

  function buildBookFromSearch(book: Book, source: BookSource, searchBook: SearchBook): Book {
    return {
      ...book,
      book_url: searchBook.book_url,
      toc_url: searchBook.toc_url || searchBook.book_url,
      origin: source.book_source_url,
      origin_name: source.book_source_name,
      name: searchBook.name || book.name,
      author: searchBook.author || book.author,
      intro: searchBook.intro || book.intro,
      cover_url: searchBook.cover_url || book.cover_url,
      latest_chapter_title: searchBook.latest_chapter_title || book.latest_chapter_title,
      dur_chapter_index: 0,
      dur_chapter_title: '',
      dur_chapter_pos: 0,
      total_chapter_num: 0,
    };
  }

  async function batchChangeSource(sourceUrl: string) {
    if (!sourceUrl || selectedBooks.size === 0) return;
    const source = bookSources.find((item) => item.book_source_url === sourceUrl);
    if (!source) return;
    const targets = selectedBookList().filter(
      (book) => book.origin !== 'local' && book.origin !== source.book_source_url
    );
    if (targets.length === 0) {
      setMessage(t('bookshelf.batchChangeSourceNoTarget'));
      return;
    }
    setBatchChangingSource(true);
    let success = 0;
    let failed = 0;
    for (let index = 0; index < targets.length; index++) {
      const book = targets[index];
      setMessage(
        t('bookshelf.batchChangeSourceProgress', {
          current: index + 1,
          total: targets.length,
          name: book.name,
        })
      );
      try {
        const searchResp = await invoke<ApiResponse<SearchBook[]>>('search_books', {
          source,
          key: book.name,
          page: 1,
        });
        const candidates = searchResp.success && searchResp.data ? searchResp.data : [];
        const candidate =
          candidates.find(
            (item) =>
              item.name === book.name &&
              (!book.author || !item.author || item.author === book.author)
          ) ||
          candidates.find((item) => item.name === book.name) ||
          candidates[0];
        if (!candidate) {
          failed++;
          continue;
        }
        const draftBook = buildBookFromSearch(book, source, candidate);
        const infoResp = await invoke<ApiResponse<Book>>('fetch_book_info', {
          source,
          book: draftBook,
        });
        const newBook =
          infoResp.success && infoResp.data
            ? {
                ...draftBook,
                ...infoResp.data,
                origin: source.book_source_url,
                origin_name: source.book_source_name,
              }
            : draftBook;
        const chaptersResp = await invoke<ApiResponse<BookChapter[]>>('fetch_chapter_list', {
          source,
          book: newBook,
        });
        if (!chaptersResp.success || !chaptersResp.data || chaptersResp.data.length === 0) {
          failed++;
          continue;
        }
        const chapters = chaptersResp.data.map((chapter) => ({
          ...chapter,
          book_url: newBook.book_url,
        }));
        const migrateResp = await invoke<ApiResponse<null>>('migrate_book_source', {
          oldBookUrl: book.book_url,
          book: {
            ...newBook,
            total_chapter_num: chapters.length,
            dur_chapter_index: 0,
            dur_chapter_title: chapters[0]?.title || '',
          },
          chapters,
        });
        if (migrateResp.success) success++;
        else failed++;
      } catch {
        failed++;
      }
    }
    setBatchChangingSource(false);
    setSelectedBooks(new Set());
    setMessage(t('bookshelf.batchChangeSourceResult', { success, failed }));
    await loadBookshelf();
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const isTxt = file.name.toLowerCase().endsWith('.txt');
    const isEpub = file.name.toLowerCase().endsWith('.epub');
    if (!isTxt && !isEpub) {
      setMessage(t('bookshelf.selectSupportedFile'));
      return;
    }

    setImporting(true);
    setMessage(t('bookshelf.readingFile'));

    if (isTxt) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const arrayBuffer = event.target?.result as ArrayBuffer;
        if (!arrayBuffer) {
          setMessage(t('bookshelf.readFileFailed'));
          setImporting(false);
          return;
        }

        setMessage(t('bookshelf.importing'));
        try {
          const data = Array.from(new Uint8Array(arrayBuffer));
          const resp = await invoke<
            ApiResponse<{ book_url: string; name: string; chapter_count: number }>
          >('import_txt_book', { data, fileName: file.name });
          if (resp.success && resp.data) {
            setMessage(
              t('bookshelf.importSuccess', { name: resp.data.name, count: resp.data.chapter_count })
            );
            await loadBookshelf();
          } else {
            setMessage(t('bookshelf.importFailed', { error: resp.error || 'unknown error' }));
          }
        } catch (err) {
          setMessage(t('common.error', { message: String(err) }));
        }
        setImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      };
      reader.onerror = () => {
        setMessage(t('bookshelf.readFileFailed'));
        setImporting(false);
      };
      reader.readAsArrayBuffer(file);
    } else {
      // EPUB
      const reader = new FileReader();
      reader.onload = async (event) => {
        const arrayBuffer = event.target?.result as ArrayBuffer;
        if (!arrayBuffer) {
          setMessage(t('bookshelf.readFileFailed'));
          setImporting(false);
          return;
        }

        setMessage(t('bookshelf.importing'));
        try {
          const data = Array.from(new Uint8Array(arrayBuffer));
          const resp = await invoke<
            ApiResponse<{ book_url: string; name: string; chapter_count: number }>
          >('import_epub_book', { data, fileName: file.name });
          if (resp.success && resp.data) {
            setMessage(
              t('bookshelf.importSuccess', { name: resp.data.name, count: resp.data.chapter_count })
            );
            await loadBookshelf();
          } else {
            setMessage(t('bookshelf.importFailed', { error: resp.error || 'unknown error' }));
          }
        } catch (err) {
          setMessage(t('common.error', { message: String(err) }));
        }
        setImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      };
      reader.onerror = () => {
        setMessage(t('bookshelf.readFileFailed'));
        setImporting(false);
      };
      reader.readAsArrayBuffer(file);
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
        <p>{t('bookshelf.loading')}</p>
      </div>
    );
  }

  const filteredBooks =
    selectedGroup === null ? books : books.filter((b) => b.group === selectedGroup);

  if (isMobileUi) {
    return (
      <div className="android-screen">
        <header className="android-top-bar">
          <div>
            <p className="android-eyebrow">{t('bookshelf.appEyebrow')}</p>
            <h1>{t('bookshelf.title')}</h1>
          </div>
          <div className="android-top-actions">
            <button
              type="button"
              aria-label={t('common.search')}
              onClick={() => navigate('/search')}
            >
              <img src="/mobile-media/search.svg" alt="" />
            </button>
            <button
              type="button"
              aria-label={t('bookshelf.importBook')}
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
            >
              <img src="/mobile-media/add.svg" alt="" />
            </button>
          </div>
        </header>

        <button type="button" className="android-search-strip" onClick={() => navigate('/search')}>
          <img src="/mobile-media/search.svg" alt="" />
          <span>{t('bookshelf.mobileSearchPlaceholder')}</span>
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.epub"
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />

        {message && (
          <div
            className={
              message.includes(t('common.error')) ? 'android-message error' : 'android-message'
            }
          >
            {message}
          </div>
        )}

        <div className="android-chip-row">
          <button
            type="button"
            className={selectedGroup === null ? 'active' : undefined}
            onClick={() => setSelectedGroup(null)}
          >
            {t('common.all')}
          </button>
          {groups.map((group) => (
            <button
              key={group.group_id}
              type="button"
              className={selectedGroup === group.group_id ? 'active' : undefined}
              onClick={() => setSelectedGroup(group.group_id)}
            >
              {group.group_name}
            </button>
          ))}
        </div>

        {batchMode && (
          <div className="android-batch-bar">
            <span>{t('bookshelf.selectedCount', { count: selectedBooks.size })}</span>
            <button type="button" onClick={selectAllBooks}>
              {t('bookshelf.selectAll')}
            </button>
            <button type="button" onClick={deselectAllBooks}>
              {t('bookshelf.deselectAll')}
            </button>
            <button type="button" onClick={invertBookSelection}>
              {t('bookshelf.invertSelection')}
            </button>
            <button
              type="button"
              onClick={checkSelectedBookInterval}
              disabled={selectedBooks.size < 2}
            >
              {t('bookshelf.checkSelectedInterval')}
            </button>
            <button
              type="button"
              onClick={() => batchUpdateCanUpdate(true)}
              disabled={selectedBooks.size === 0}
            >
              {t('bookshelf.allowUpdate')}
            </button>
            <button
              type="button"
              onClick={() => batchUpdateCanUpdate(false)}
              disabled={selectedBooks.size === 0}
            >
              {t('bookshelf.disableUpdate')}
            </button>
            <button type="button" onClick={batchClearCache} disabled={selectedBooks.size === 0}>
              {t('bookshelf.clearCache')}
            </button>
            <select
              value=""
              disabled={selectedBooks.size === 0 || batchChangingSource}
              onChange={(e) => {
                batchChangeSource(e.target.value);
                e.target.value = '';
              }}
            >
              <option value="" disabled>
                {batchChangingSource ? t('bookshelf.changingSource') : t('bookshelf.changeSource')}
              </option>
              {bookSources.map((source) => (
                <option key={source.book_source_url} value={source.book_source_url}>
                  {source.book_source_name || source.book_source_url}
                </option>
              ))}
            </select>
            <button type="button" onClick={batchDeleteBooks} disabled={selectedBooks.size === 0}>
              {t('bookshelf.batchDelete')}
            </button>
          </div>
        )}

        <section className="android-shelf-section">
          <div className="android-section-head">
            <h2>{t('bookshelf.recentReading')}</h2>
            <div>
              <button type="button" onClick={checkUpdates} disabled={checkingUpdates}>
                {checkingUpdates
                  ? t('bookshelf.checkingUpdatesShort')
                  : t('bookshelf.checkUpdates')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setBatchMode(!batchMode);
                  setSelectedBooks(new Set());
                }}
              >
                {batchMode ? t('bookshelf.exitBatch') : t('bookshelf.batchMode')}
              </button>
            </div>
          </div>

          {filteredBooks.length === 0 ? (
            <div className="android-empty-panel">
              <p>{t('bookshelf.noBooks')}</p>
              <button type="button" onClick={() => navigate('/search')}>
                {t('bookshelf.goSearch')}
              </button>
            </div>
          ) : (
            <div className="android-book-list">
              {filteredBooks.map((book, idx) => (
                <article
                  key={book.book_url}
                  className="android-book-row"
                  onClick={() => {
                    if (batchMode) toggleBookSelection(book.book_url);
                  }}
                >
                  {batchMode && (
                    <input
                      type="checkbox"
                      checked={selectedBooks.has(book.book_url)}
                      onChange={() => toggleBookSelection(book.book_url)}
                      onClick={(event) => event.stopPropagation()}
                      aria-label={book.name}
                    />
                  )}
                  <div
                    className="android-cover"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (batchMode) {
                        toggleBookSelection(book.book_url);
                        return;
                      }
                      navigate(
                        `/reader/${encodeURIComponent(book.book_url)}/${book.dur_chapter_index ?? 0}`
                      );
                    }}
                  >
                    {book.cover_url ? (
                      <img src={book.cover_url} alt={book.name} />
                    ) : (
                      <img
                        src={`/mobile-media/icon_book_default_cover_${idx % 2 === 0 ? 'one' : 'two'}.svg`}
                        alt=""
                      />
                    )}
                  </div>
                  <div
                    className="android-book-copy"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (batchMode) {
                        toggleBookSelection(book.book_url);
                        return;
                      }
                      navigate(
                        `/reader/${encodeURIComponent(book.book_url)}/${book.dur_chapter_index ?? 0}`
                      );
                    }}
                  >
                    <h3>{book.name}</h3>
                    <p>{book.author || book.origin_name || t('layout.bookshelf')}</p>
                    <span>
                      {book.dur_chapter_title
                        ? t('bookshelf.reading', { chapter: book.dur_chapter_title })
                        : book.latest_chapter_title || t('bookshelf.read')}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={
                      book.dur_chapter_title ? 'android-read-btn' : 'android-read-btn ghost'
                    }
                    onClick={(event) => {
                      event.stopPropagation();
                      if (batchMode) {
                        toggleBookSelection(book.book_url);
                        return;
                      }
                      navigate(
                        `/reader/${encodeURIComponent(book.book_url)}/${book.dur_chapter_index ?? 0}`
                      );
                    }}
                  >
                    {book.dur_chapter_title ? t('common.resume') : t('bookshelf.read')}
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 20,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: '#1a1a2e' }}>
          {t('bookshelf.title')}
        </h1>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            onClick={() => {
              setBatchMode(!batchMode);
              setSelectedBooks(new Set());
            }}
            style={{
              padding: '7px 14px',
              background: batchMode ? '#fff8e1' : '#fff',
              color: batchMode ? '#f9a825' : '#555',
              border: `1px solid ${batchMode ? '#ffe082' : '#e0e0e0'}`,
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 500,
              transition: 'all 0.2s',
            }}
          >
            {batchMode ? t('bookshelf.exitBatch') : t('bookshelf.batchMode')}
          </button>
          <button
            onClick={checkUpdates}
            disabled={checkingUpdates}
            style={{
              padding: '8px 16px',
              background: checkingUpdates ? '#f5f5f5' : '#fff8e1',
              color: checkingUpdates ? '#999' : '#f9a825',
              border: `1px solid ${checkingUpdates ? '#e0e0e0' : '#ffe082'}`,
              borderRadius: 8,
              cursor: checkingUpdates ? 'not-allowed' : 'pointer',
              fontSize: 14,
              fontWeight: 600,
              transition: 'all 0.2s',
            }}
          >
            {checkingUpdates ? t('bookshelf.checkingUpdatesShort') : t('bookshelf.checkUpdates')}
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            style={{
              padding: '8px 16px',
              background: importing ? '#f5f5f5' : '#e8f5e9',
              color: importing ? '#999' : '#2e7d32',
              border: `1px solid ${importing ? '#e0e0e0' : '#a5d6a7'}`,
              borderRadius: 8,
              cursor: importing ? 'not-allowed' : 'pointer',
              fontSize: 14,
              fontWeight: 600,
              transition: 'all 0.2s',
            }}
          >
            {importing ? t('bookshelf.importing') : t('bookshelf.importBook')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.epub"
            style={{ display: 'none' }}
            onChange={handleFileSelect}
          />
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

      {/* Batch action bar */}
      {batchMode && (
        <div
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            marginBottom: 16,
            padding: '10px 14px',
            background: '#fff',
            borderRadius: 8,
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: 13, color: '#555', fontWeight: 500 }}>
            {t('bookshelf.selectedCount', { count: selectedBooks.size })}
          </span>
          <button
            onClick={selectAllBooks}
            style={{
              padding: '5px 12px',
              fontSize: 12,
              border: '1px solid #e0e0e0',
              background: '#fff',
              borderRadius: 6,
              cursor: 'pointer',
              color: '#555',
            }}
          >
            {t('bookshelf.selectAll')}
          </button>
          <button
            onClick={deselectAllBooks}
            style={{
              padding: '5px 12px',
              fontSize: 12,
              border: '1px solid #e0e0e0',
              background: '#fff',
              borderRadius: 6,
              cursor: 'pointer',
              color: '#555',
            }}
          >
            {t('bookshelf.deselectAll')}
          </button>
          <button
            onClick={invertBookSelection}
            style={{
              padding: '5px 12px',
              fontSize: 12,
              border: '1px solid #e0e0e0',
              background: '#fff',
              borderRadius: 6,
              cursor: 'pointer',
              color: '#555',
            }}
          >
            {t('bookshelf.invertSelection')}
          </button>
          <button
            onClick={checkSelectedBookInterval}
            disabled={selectedBooks.size < 2}
            style={{
              padding: '5px 12px',
              fontSize: 12,
              border: '1px solid #e0e0e0',
              background: selectedBooks.size < 2 ? '#f5f5f5' : '#fff',
              borderRadius: 6,
              cursor: selectedBooks.size < 2 ? 'not-allowed' : 'pointer',
              color: selectedBooks.size < 2 ? '#aaa' : '#555',
            }}
          >
            {t('bookshelf.checkSelectedInterval')}
          </button>
          <select
            onChange={(e) => {
              const gid = parseInt(e.target.value, 10);
              batchMoveToGroup(gid === 0 ? null : gid);
              e.target.value = '';
            }}
            value=""
            style={{
              padding: '5px 10px',
              fontSize: 12,
              border: '1px solid #e0e0e0',
              borderRadius: 6,
              background: '#fff',
              cursor: 'pointer',
              color: '#555',
            }}
          >
            <option value="" disabled>
              {t('bookshelf.moveToGroup')}
            </option>
            <option value={0}>{t('common.none')}</option>
            {groups.map((g) => (
              <option key={g.group_id} value={g.group_id}>
                {g.group_name}
              </option>
            ))}
          </select>
          <button
            onClick={() => batchUpdateCanUpdate(true)}
            disabled={selectedBooks.size === 0}
            style={{
              padding: '5px 12px',
              fontSize: 12,
              border: '1px solid #c8e6c9',
              background: selectedBooks.size === 0 ? '#f5f5f5' : '#f4fbf4',
              borderRadius: 6,
              cursor: selectedBooks.size === 0 ? 'not-allowed' : 'pointer',
              color: selectedBooks.size === 0 ? '#aaa' : '#2e7d32',
            }}
          >
            {t('bookshelf.allowUpdate')}
          </button>
          <button
            onClick={() => batchUpdateCanUpdate(false)}
            disabled={selectedBooks.size === 0}
            style={{
              padding: '5px 12px',
              fontSize: 12,
              border: '1px solid #e0e0e0',
              background: selectedBooks.size === 0 ? '#f5f5f5' : '#fff',
              borderRadius: 6,
              cursor: selectedBooks.size === 0 ? 'not-allowed' : 'pointer',
              color: selectedBooks.size === 0 ? '#aaa' : '#555',
            }}
          >
            {t('bookshelf.disableUpdate')}
          </button>
          <button
            onClick={batchClearCache}
            disabled={selectedBooks.size === 0}
            style={{
              padding: '5px 12px',
              fontSize: 12,
              border: '1px solid #bbdefb',
              background: selectedBooks.size === 0 ? '#f5f5f5' : '#eef4fd',
              borderRadius: 6,
              cursor: selectedBooks.size === 0 ? 'not-allowed' : 'pointer',
              color: selectedBooks.size === 0 ? '#aaa' : '#1565c0',
            }}
          >
            {t('bookshelf.clearCache')}
          </button>
          <select
            onChange={(e) => {
              batchChangeSource(e.target.value);
              e.target.value = '';
            }}
            value=""
            disabled={selectedBooks.size === 0 || batchChangingSource}
            style={{
              padding: '5px 10px',
              fontSize: 12,
              border: '1px solid #e0e0e0',
              borderRadius: 6,
              background: selectedBooks.size === 0 || batchChangingSource ? '#f5f5f5' : '#fff',
              cursor: selectedBooks.size === 0 || batchChangingSource ? 'not-allowed' : 'pointer',
              color: selectedBooks.size === 0 || batchChangingSource ? '#aaa' : '#555',
            }}
          >
            <option value="" disabled>
              {batchChangingSource ? t('bookshelf.changingSource') : t('bookshelf.changeSource')}
            </option>
            {bookSources.map((source) => (
              <option key={source.book_source_url} value={source.book_source_url}>
                {source.book_source_name || source.book_source_url}
              </option>
            ))}
          </select>
          <button
            onClick={batchDeleteBooks}
            disabled={selectedBooks.size === 0}
            style={{
              padding: '5px 12px',
              fontSize: 12,
              border: '1px solid #ffcdd2',
              background: selectedBooks.size === 0 ? '#f5f5f5' : '#fff0f0',
              borderRadius: 6,
              cursor: selectedBooks.size === 0 ? 'not-allowed' : 'pointer',
              color: selectedBooks.size === 0 ? '#aaa' : '#f44336',
              marginLeft: 'auto',
            }}
          >
            {t('bookshelf.batchDelete')}
          </button>
        </div>
      )}

      {/* Group tabs */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 20,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <button
          onClick={() => setSelectedGroup(null)}
          style={{
            padding: '5px 14px',
            borderRadius: 20,
            border: '1px solid',
            borderColor: selectedGroup === null ? '#1976d2' : '#e0e0e0',
            background: selectedGroup === null ? '#1976d2' : '#fff',
            color: selectedGroup === null ? '#fff' : '#555',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 500,
            transition: 'all 0.2s',
          }}
        >
          {t('common.all')}
        </button>
        {groups.map((g) => (
          <div key={g.group_id} style={{ position: 'relative' }}>
            {editingGroup === g.group_id ? (
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input
                  type="text"
                  value={editGroupName}
                  onChange={(e) => setEditGroupName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      updateGroup({ ...g, group_name: editGroupName });
                    } else if (e.key === 'Escape') {
                      setEditingGroup(null);
                    }
                  }}
                  autoFocus
                  style={{
                    padding: '4px 8px',
                    borderRadius: 6,
                    border: '1px solid #1976d2',
                    fontSize: 13,
                    width: 100,
                    outline: 'none',
                  }}
                />
                <button
                  onClick={() => updateGroup({ ...g, group_name: editGroupName })}
                  style={{
                    padding: '2px 6px',
                    fontSize: 12,
                    border: 'none',
                    background: 'transparent',
                    color: '#4caf50',
                    cursor: 'pointer',
                  }}
                >
                  ✓
                </button>
              </div>
            ) : (
              <button
                onClick={() => setSelectedGroup(g.group_id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setEditingGroup(g.group_id);
                  setEditGroupName(g.group_name);
                }}
                style={{
                  padding: '5px 14px',
                  borderRadius: 20,
                  border: '1px solid',
                  borderColor: selectedGroup === g.group_id ? '#1976d2' : '#e0e0e0',
                  background: selectedGroup === g.group_id ? '#1976d2' : '#fff',
                  color: selectedGroup === g.group_id ? '#fff' : '#555',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 500,
                  transition: 'all 0.2s',
                }}
              >
                {g.group_name}
              </button>
            )}
            {showGroupManage && editingGroup !== g.group_id && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  marginTop: 4,
                  display: 'flex',
                  gap: 4,
                  zIndex: 10,
                }}
              >
                <button
                  onClick={() => {
                    setEditingGroup(g.group_id);
                    setEditGroupName(g.group_name);
                  }}
                  style={{
                    padding: '2px 8px',
                    fontSize: 11,
                    border: '1px solid #e0e0e0',
                    background: '#fff',
                    borderRadius: 4,
                    cursor: 'pointer',
                    color: '#555',
                  }}
                >
                  {t('common.edit')}
                </button>
                <button
                  onClick={() => deleteGroup(g.group_id)}
                  style={{
                    padding: '2px 8px',
                    fontSize: 11,
                    border: '1px solid #ffcdd2',
                    background: '#fff0f0',
                    borderRadius: 4,
                    cursor: 'pointer',
                    color: '#f44336',
                  }}
                >
                  {t('common.delete')}
                </button>
              </div>
            )}
          </div>
        ))}
        {showGroupManage && (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input
              type="text"
              placeholder={t('bookshelf.newGroupPlaceholder')}
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addGroup();
              }}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: '1px solid #e0e0e0',
                fontSize: 13,
                width: 100,
                outline: 'none',
              }}
            />
            <button
              onClick={addGroup}
              style={{
                padding: '4px 10px',
                fontSize: 12,
                border: '1px solid #a5d6a7',
                background: '#e8f5e9',
                borderRadius: 6,
                cursor: 'pointer',
                color: '#2e7d32',
                fontWeight: 600,
              }}
            >
              +
            </button>
          </div>
        )}
        <button
          onClick={() => {
            setShowGroupManage(!showGroupManage);
            setEditingGroup(null);
          }}
          style={{
            padding: '5px 10px',
            fontSize: 12,
            border: '1px solid #e0e0e0',
            background: showGroupManage ? '#f5f5f5' : '#fff',
            borderRadius: 20,
            cursor: 'pointer',
            color: '#888',
            marginLeft: 'auto',
          }}
        >
          {showGroupManage ? t('bookshelf.done') : t('bookshelf.manageGroups')}
        </button>
      </div>

      {filteredBooks.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '80px 20px',
            color: '#888',
            background: '#fff',
            borderRadius: 12,
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          }}
        >
          <p style={{ fontSize: 16, marginBottom: 12 }}>{t('bookshelf.noBooks')}</p>
          <Link
            to="/search"
            style={{
              color: '#1976d2',
              textDecoration: 'none',
              fontWeight: 600,
              padding: '8px 16px',
              border: '1px solid #bbdefb',
              borderRadius: 8,
              display: 'inline-block',
            }}
          >
            {t('bookshelf.goSearch')}
          </Link>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: 20,
          }}
        >
          {filteredBooks.map((book) => {
            const progressPercent = book.total_chapter_num
              ? Math.min(
                  100,
                  Math.max(
                    0,
                    ((book.dur_chapter_index ?? 0) / Math.max(1, book.total_chapter_num)) * 100
                  )
                )
              : 0;
            return (
              <div
                key={book.book_url}
                className="bookshelf-card"
                style={{
                  background: '#fff',
                  borderRadius: 14,
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04)',
                  transition:
                    'transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.25s ease',
                  cursor: batchMode ? 'pointer' : 'default',
                  position: 'relative',
                  outline: selectedBooks.has(book.book_url) ? '2.5px solid #1976d2' : 'none',
                }}
                onClick={() => {
                  if (batchMode) toggleBookSelection(book.book_url);
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-4px)';
                  e.currentTarget.style.boxShadow =
                    '0 8px 24px rgba(0,0,0,0.1), 0 2px 6px rgba(0,0,0,0.06)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow =
                    '0 1px 2px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04)';
                }}
              >
                {batchMode && (
                  <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 5 }}>
                    <input
                      type="checkbox"
                      checked={selectedBooks.has(book.book_url)}
                      onChange={() => toggleBookSelection(book.book_url)}
                      onClick={(event) => event.stopPropagation()}
                      style={{
                        width: 20,
                        height: 20,
                        cursor: 'pointer',
                        accentColor: '#1976d2',
                      }}
                    />
                  </div>
                )}
                <div
                  onClick={(event) => {
                    event.stopPropagation();
                    if (batchMode) {
                      toggleBookSelection(book.book_url);
                      return;
                    }
                    navigate(
                      `/reader/${encodeURIComponent(book.book_url)}/${book.dur_chapter_index ?? 0}`
                    );
                  }}
                  style={{
                    cursor: 'pointer',
                    overflow: 'hidden',
                    position: 'relative',
                  }}
                >
                  {book.cover_url ? (
                    <CoverImage
                      url={book.cover_url}
                      name={book.name}
                      author={book.author}
                      height={260}
                    />
                  ) : (
                    <PlaceholderCover
                      name={book.name}
                      author={book.author}
                      height={260}
                    />
                  )}
                  {progressPercent > 0 && (
                    <div
                      style={{
                        position: 'absolute',
                        bottom: 0,
                        left: 0,
                        right: 0,
                        height: 3,
                        background: 'rgba(0,0,0,0.12)',
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${progressPercent}%`,
                          background: 'linear-gradient(90deg, #1976d2, #42a5f5)',
                          borderRadius: '0 2px 2px 0',
                          transition: 'width 0.5s ease',
                        }}
                      />
                    </div>
                  )}
                </div>
                <div
                  style={{
                    padding: '14px 16px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    flex: 1,
                  }}
                >
                  <div
                    onClick={(event) => {
                      event.stopPropagation();
                      if (batchMode) {
                        toggleBookSelection(book.book_url);
                        return;
                      }
                      navigate(
                        `/reader/${encodeURIComponent(book.book_url)}/${book.dur_chapter_index ?? 0}`
                      );
                    }}
                    style={{
                      fontWeight: 700,
                      fontSize: 15,
                      color: '#1a1a2e',
                      cursor: 'pointer',
                      lineHeight: 1.4,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={book.name}
                  >
                    {book.name}
                  </div>
                  <div style={{ color: '#8a8a9a', fontSize: 13, fontWeight: 500 }}>
                    {book.author || book.origin_name || '—'}
                  </div>
                  {book.dur_chapter_title && (
                    <div
                      style={{
                        color: '#a0a0b0',
                        fontSize: 12,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontWeight: 500,
                      }}
                      title={book.dur_chapter_title}
                    >
                      {t('bookshelf.reading', { chapter: book.dur_chapter_title })}
                    </div>
                  )}
                  <div
                    style={{
                      marginTop: 'auto',
                      paddingTop: 12,
                      display: 'flex',
                      gap: 8,
                      flexWrap: 'wrap',
                    }}
                  >
                    <Link
                      to={`/reader/${encodeURIComponent(book.book_url)}/${book.dur_chapter_index ?? 0}`}
                      onClick={(event) => {
                        if (batchMode) {
                          event.preventDefault();
                          event.stopPropagation();
                          toggleBookSelection(book.book_url);
                        }
                      }}
                      style={{
                        flex: '1 1 auto',
                        minWidth: 90,
                        textAlign: 'center',
                        padding: '8px 12px',
                        background: '#1976d2',
                        color: '#fff',
                        borderRadius: 10,
                        textDecoration: 'none',
                        fontSize: 13,
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                        transition: 'all 0.2s ease',
                        boxShadow: '0 2px 8px rgba(25,118,210,0.25)',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#1565c0';
                        e.currentTarget.style.boxShadow = '0 4px 12px rgba(25,118,210,0.35)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = '#1976d2';
                        e.currentTarget.style.boxShadow = '0 2px 8px rgba(25,118,210,0.25)';
                      }}
                    >
                      {book.dur_chapter_title
                        ? t('bookshelf.continueReading')
                        : t('bookshelf.read')}
                    </Link>
                    <Link
                      to={`/book/${encodeURIComponent(book.book_url)}`}
                      state={{ parent: '/' }}
                      onClick={(event) => {
                        if (batchMode) {
                          event.preventDefault();
                          event.stopPropagation();
                          toggleBookSelection(book.book_url);
                        }
                      }}
                      style={{
                        flex: '1 1 auto',
                        minWidth: 70,
                        padding: '8px 12px',
                        background: '#f5f7fa',
                        border: '1px solid #e8e8f0',
                        borderRadius: 10,
                        textDecoration: 'none',
                        textAlign: 'center',
                        fontSize: 13,
                        color: '#666',
                        fontWeight: 500,
                        whiteSpace: 'nowrap',
                        transition: 'all 0.2s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#eef1f5';
                        e.currentTarget.style.borderColor = '#d8dce2';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = '#f5f7fa';
                        e.currentTarget.style.borderColor = '#e8e8f0';
                      }}
                    >
                      {t('bookDetail.title')}
                    </Link>
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        if (batchMode) {
                          toggleBookSelection(book.book_url);
                          return;
                        }
                        deleteBook(book.book_url);
                      }}
                      style={{
                        flex: '0 0 auto',
                        padding: '8px 12px',
                        background: 'transparent',
                        border: '1px solid transparent',
                        borderRadius: 10,
                        cursor: 'pointer',
                        fontSize: 13,
                        color: '#bbb',
                        whiteSpace: 'nowrap',
                        transition: 'all 0.2s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = '#f44336';
                        e.currentTarget.style.background = '#fff0f0';
                        e.currentTarget.style.borderColor = '#ffcdd2';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = '#bbb';
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.borderColor = 'transparent';
                      }}
                    >
                      {t('common.delete')}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/// Cover image with a fallback. Tries the remote URL the book source
/// gave us first; on error or short timeout, switches to a
/// `PlaceholderCover` so the card never collapses to a text-only sliver.
function CoverImage({
  url,
  name,
  author,
  height,
}: {
  url: string;
  name: string;
  author?: string;
  height: number;
}) {
  const [errored, setErrored] = useState(false);
  // The Tauri webview doesn't always fire `onError` for failed
  // remote loads (silent CORS / network drops), so also give up
  // after a short window and fall back to the placeholder. The
  // source URL gets a single attempt — we don't retry.
  useEffect(() => {
    if (errored) return;
    const t = setTimeout(() => setErrored(true), 4000);
    return () => clearTimeout(t);
  }, [url, errored]);

  if (errored) {
    return <PlaceholderCover name={name} author={author} height={height} />;
  }
  return (
    <img
      src={url}
      alt={name}
      className="bookshelf-cover-img"
      style={{
        width: '100%',
        height,
        objectFit: 'cover',
        display: 'block',
        background: '#f0f0f5',
        transition: 'transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
      }}
      onError={() => setErrored(true)}
      onLoad={(e) => {
        const img = e.currentTarget;
        // naturalWidth === 0 means the image data is empty
        // (e.g. server returned an HTML error page) — treat as error.
        if (img.naturalWidth === 0 || img.naturalHeight === 0) {
          setErrored(true);
        }
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'scale(1.06)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'scale(1)';
      }}
    />
  );
}

/// Generated cover for books that have no `cover_url`. Renders the
/// title (multi-line) and author as a gradient-tinted book-cover
/// card. Distinct per book via a hash of the title → background hue.
/// Pure CSS, no image data is persisted.
function PlaceholderCover({
  name,
  author,
  height,
}: {
  name: string;
  author?: string;
  height: number;
}) {
  const hue = stringHash(name) % 360;
  const bg = `linear-gradient(160deg, hsl(${hue}, 55%, 78%) 0%, hsl(${(hue + 35) % 360}, 60%, 70%) 50%, hsl(${(hue + 70) % 360}, 65%, 62%) 100%)`;
  // Wrap title into ≤3 lines (max ~10 chars per line for the card width).
  const lines = wrapText(name, 6);
  const authorText = (author || '').trim();
  return (
    <div
      className="bookshelf-cover-placeholder"
      style={{
        width: '100%',
        height,
        background: bg,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '18px 14px',
        boxSizing: 'border-box',
        color: `hsl(${hue}, 35%, 22%)`,
        transition: 'filter 0.3s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.filter = 'brightness(0.97)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.filter = 'brightness(1)';
      }}
    >
      <div
        style={{
          fontSize: 22,
          fontWeight: 800,
          letterSpacing: '0.05em',
          lineHeight: 1.25,
          textAlign: 'center',
          textShadow: '0 1px 0 rgba(255,255,255,0.4)',
          flex: 1,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <div>
          {lines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      </div>
      {authorText && (
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            opacity: 0.78,
            textAlign: 'center',
            maxWidth: '100%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={authorText}
        >
          {authorText}
        </div>
      )}
    </div>
  );
}

/// FNV-1a 32-bit string hash. Stable across runs; cheap.
function stringHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/// Greedy wrap: max `maxChars` CJK / English chars per line, ≤
/// `maxLines` lines. Trailing overflow is dropped (a real cover
/// would clip, too). For our purposes 3 lines is plenty.
function wrapText(s: string, maxChars: number): string[] {
  const out: string[] = [];
  let buf = '';
  for (const ch of s) {
    if (buf.length >= maxChars) {
      out.push(buf);
      buf = '';
      if (out.length >= 3) break;
    }
    buf += ch;
  }
  if (buf && out.length < 3) out.push(buf);
  return out.length > 0 ? out : [s.slice(0, 1) || '书'];
}
