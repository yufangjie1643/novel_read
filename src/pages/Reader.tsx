import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import type { ApiResponse, Book, BookChapter, BookSource, ReplaceRule } from '../types';
import { useUiMode } from '../uiMode';
import ChapterSlider from '../components/reader/ChapterSlider';
import CatalogPanel from '../components/reader/CatalogPanel';
import TTSOverlay from '../components/reader/TTSOverlay';
import TipValue, { readTipKind, TipKind } from '../components/reader/TipValue';
import '../styles/reader-animations.css';
import { useReaderNav } from '../hooks/useReaderNav';
import ContextMenu, { type ContextMenuState } from '../components/reader/ContextMenu';
import NavSettingsPopover from '../components/reader/NavSettingsPopover';
import SettingsPanel from '../components/reader/SettingsPanel';
import ShortcutsHelpModal from '../components/reader/ShortcutsHelpModal';
import BookmarkButton from '../components/reader/BookmarkButton';
import FullBookSearchPanel from '../components/reader/FullBookSearchPanel';
import { flashRange } from '../components/reader/domHighlight';
import { addBookmark } from '../components/reader/bookmarkActions';

/// Reader theme — chosen by the FAB theme-cycler button.
/// `day`   — bright background, dark text (default light reading).
/// `night` — dark background, light text.
/// `eink`  — sepia palette tuned for e-ink devices (warm beige + brown).
///
/// Each mode persists its own palette via `reader_theme_<mode>_bg/text`
/// keys so day / night / eink users keep their own per-mode tweaks.
type ReaderTheme = 'day' | 'night' | 'eink';

/// Page-transition animation style. Mirrors the legacy Legado fork's
/// `PageAnim` enum (cover / slide / simulation / scroll / none) so the
/// two clients share the same vocabulary. CSS-transform based — no real
/// pagination — so the visual is decorative.
type PageAnim = 'cover' | 'slide' | 'simulation' | 'scroll' | 'none';

const themeStyles: Record<ReaderTheme, { bg: string; text: string; border: string; button: string }> = {
  day: { bg: '#fff', text: '#1a1a2e', border: '#e8e8f0', button: '#f5f7fa' },
  night: { bg: '#1a1a2e', text: '#e0e0e0', border: '#333', button: '#2a2a3e' },
  eink: { bg: '#f4ecd8', text: '#5b4636', border: '#d4c5a9', button: '#e8dec0' },
};

const THEME_CYCLE: ReaderTheme[] = ['day', 'night', 'eink'];

/// Detect e-ink-like devices at startup so we can default to the eink
/// theme if no preference is stored yet. Cheap UA / media-query check.
function detectEinkDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/kindle|boox|reMarkable|kobo/i.test(ua)) return true;
  if (typeof window !== 'undefined' && window.matchMedia) {
    // Reflective displays hint — not yet standardised but harmless to probe.
    if (window.matchMedia('(reflective: true)').matches) return true;
  }
  return false;
}

/// Convert `#rrggbb` to `r, g, b` so we can wrap it in `rgba(...)` for
/// the reader's per-mode alpha control. Falls back to the original
/// string when not a valid 6-digit hex (e.g. named colors — we don't
/// use those, but defensive).
function hexToRgb(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff}`;
}

/// Menu state for the mobile bottom sheet.
/// `null` = sheet collapsed (only the FAB row + slider + menu buttons show).
/// Other values = an inner panel is rendered inside the sheet. The 4 main
/// menu buttons each open a different mode; the FAB row "search" button
/// also opens 'search' (so it can be reached from either place).
/// `readaloud` is reserved for a future mini-player panel.
type ReaderPanel = 'style' | 'more' | 'search' | 'catalog' | 'readaloud' | null;
type WakeLockSentinelLike = { release: () => Promise<void> | void };
type NavigatorWithWakeLock = Navigator & {
  wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
};

export default function Reader() {
  const { t } = useTranslation();
  const { bookUrl, chapterIndex } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { isMobileUi } = useUiMode();
  const decodedUrl = decodeURIComponent(bookUrl || '');
  const idx = Math.max(0, parseInt(chapterIndex || '0', 10) || 0);
  const contentRef = useRef<HTMLDivElement>(null);
  // Where we should return when the user leaves the reader for the
  // book's detail page. Captured on mount so subsequent in-reader
  // chapter navigation (which mutates location.pathname) doesn't
  // change the value.
  const readerParentPath = useRef(location.pathname);
  useEffect(() => {
    readerParentPath.current = location.pathname;
    // intentionally run on mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [book, setBook] = useState<Book | null>(null);
  const [chapters, setChapters] = useState<BookChapter[]>([]);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [replaceRules, setReplaceRules] = useState<ReplaceRule[]>([]);
  const currentChapter = chapters.find((c) => c.index === idx);
  const prevChapter = chapters.find((c) => c.index === idx - 1);
  const nextChapter = chapters.find((c) => c.index === idx + 1);

  const [fontSize, setFontSize] = useState(() => {
    return parseInt(localStorage.getItem('reader_font_size') || '18', 10);
  });
  const [theme, setTheme] = useState<ReaderTheme>(() => {
    const stored = (localStorage.getItem('reader_theme') || 'day') as ReaderTheme;
    if (stored === 'day' || stored === 'night' || stored === 'eink') return stored;
    return detectEinkDevice() ? 'eink' : 'day';
  });
  const [lineHeight, setLineHeight] = useState(() => {
    return parseFloat(localStorage.getItem('reader_line_height') || '1.8');
  });
  const [paragraphSpacing, setParagraphSpacing] = useState(() => {
    return parseFloat(localStorage.getItem('reader_paragraph_spacing') || '0.5');
  });
  const [showSettings, setShowSettings] = useState(false);
  const [readerPanel, setReaderPanel] = useState<ReaderPanel>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [showNavSettings, setShowNavSettings] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [selectedText, setSelectedText] = useState('');
  /// `null` = search panel closed; `''` = open with empty input;
  /// non-empty string = open with prefilled keyword (right-click
  /// "Search in Book" passes the selected text here).
  const [searchKeyword, setSearchKeyword] = useState<string | null>(null);
  const [toast, setToast] = useState<string>('');

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2000);
  }, []);
  const [pageAnim, setPageAnim] = useState<PageAnim>(() => {
    const raw = localStorage.getItem('reader_page_anim');
    if (raw === 'cover' || raw === 'slide' || raw === 'simulation' || raw === 'scroll' || raw === 'none') {
      return raw;
    }
    return 'scroll';
  });
  const [useReplaceRules, setUseReplaceRules] = useState(() => {
    return localStorage.getItem('reader_use_replace_rules') !== 'false';
  });
  const [showReadProgress, setShowReadProgress] = useState(() => {
    return localStorage.getItem('reader_show_progress') !== 'false';
  });
  const [textSelectable, setTextSelectable] = useState(() => {
    return localStorage.getItem('reader_text_selectable') !== 'false';
  });
  const [keepScreenAwake, setKeepScreenAwake] = useState(() => {
    return localStorage.getItem('reader_keep_screen_awake') === 'true';
  });
  const [clickRegionMode, setClickRegionMode] = useState(() => {
    return localStorage.getItem('reader_click_region_mode') || 'scroll';
  });
  const [autoPageActive, setAutoPageActive] = useState(false);
  const [autoPageInterval, setAutoPageInterval] = useState(() => {
    const stored = parseInt(localStorage.getItem('reader_auto_page_interval') || '2800', 10);
    return Number.isFinite(stored) ? stored : 2800;
  });
  const [readerSearchQuery, setReaderSearchQuery] = useState('');
  /// Live ordered list of every <mark data-rs> element created by the
  /// most recent runReaderSearch(). goToMatch() walks this list.
  const searchMarksRef = useRef<HTMLElement[]>([]);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [totalSearchMatches, setTotalSearchMatches] = useState(0);
  /// Mirror of activeMatchIndex so the keydown handler can read the
  /// latest value without re-binding on every state change.
  const activeMatchIndexRef = useRef(0);

  const [fontFamily, setFontFamily] = useState(() => {
    return localStorage.getItem('reader_font_family') || 'system';
  });
  const [textAlign, setTextAlign] = useState(() => {
    return localStorage.getItem('reader_text_align') || 'justify';
  });
  const [contentWidth, _setContentWidth] = useState(() => {
    return parseInt(localStorage.getItem('reader_content_width') || '760', 10);
  });
  /// Background opacity 0-100. 100 = solid theme bg; 0 = transparent
  /// (shows the body background bleeding through). Persisted per-mode
  /// would be nicer but for v1 we keep one global value.
  const [bgAlpha, setBgAlpha] = useState(() => {
    const raw = parseInt(localStorage.getItem('reader_bg_alpha') || '100', 10);
    return Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 100;
  });

  const [headerVisible, setHeaderVisible] = useState(() => !isMobileUi);
  const [toolbarPinned, setToolbarPinned] = useState(() => {
    return localStorage.getItem('reader_toolbar_pinned') === 'true';
  });
  const lastScrollY = useRef(0);
  const headerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [ttsRate, setTtsRate] = useState(() => {
    return parseFloat(localStorage.getItem('reader_tts_rate') || '1');
  });
  /// TTS overlay state — surfaces the mini-player UI in TTSOverlay.
  const [ttsOverlayOpen, setTtsOverlayOpen] = useState(false);
  const [ttsChunkIndex, setTtsChunkIndex] = useState(0);
  const [ttsTotalChunks, setTtsTotalChunks] = useState(0);
  const [ttsCurrentText, setTtsCurrentText] = useState('');
  /// Refs to the chunk list and current index that live inside the
  /// `startTTS` closure (so the speech chain can iterate). The refs
  /// let us keep a single startTTS() body while still letting the
  /// overlay read the live values.
  const ttsChunksRef = useRef<string[]>([]);
  const ttsIndexRef = useRef(0);
  /// Tip-slot state for the reader chrome (Block 1-4). We keep
  /// these in React state so the chrome re-renders on change, but
  /// the values are also persisted to localStorage so user changes
  /// survive a reload.
  const [tipHeaderLeft, setTipHeaderLeft] = useState<TipKind>(() => readTipKind('reader_tip_header_left', 1));
  const [tipHeaderRight, setTipHeaderRight] = useState<TipKind>(() => readTipKind('reader_tip_header_right', 2));
  const [tipFooterLeft, setTipFooterLeft] = useState<TipKind>(() => readTipKind('reader_tip_footer_left', 5));
  const [tipFooterRight, setTipFooterRight] = useState<TipKind>(() => readTipKind('reader_tip_footer_right', 7));
  const [tipScrollPct, setTipScrollPct] = useState(0);
  useEffect(() => {
    function recompute() {
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      setTipScrollPct(Math.max(0, Math.min(100, (window.scrollY / max) * 100)));
    }
    window.addEventListener('scroll', recompute, { passive: true });
    window.addEventListener('resize', recompute);
    recompute();
    return () => {
      window.removeEventListener('scroll', recompute);
      window.removeEventListener('resize', recompute);
    };
  }, []);
  /// Listen for synthetic 'storage' events from TipSettingsSection
  /// so the user can re-pick a slot value and the chrome re-renders
  /// without a full page reload.
  useEffect(() => {
    function sync() {
      setTipHeaderLeft(readTipKind('reader_tip_header_left', 1));
      setTipHeaderRight(readTipKind('reader_tip_header_right', 2));
      setTipFooterLeft(readTipKind('reader_tip_footer_left', 5));
      setTipFooterRight(readTipKind('reader_tip_footer_right', 7));
    }
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const readTimeRef = useRef(0);
  const readTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bookRef = useRef<Book | null>(null);
  const isSpeakingRef = useRef(isSpeaking);
  const isPausedRef = useRef(isPaused);
  const prevChapterRef = useRef(prevChapter);
  const nextChapterRef = useRef(nextChapter);
  const loadSeqRef = useRef(0);
  /// In-memory cache of the next chapter's content. Populated when the
  /// current chapter finishes loading so switching to the next chapter
  /// is instantaneous. Cleared when the user navigates away from the
  /// adjacent next index (e.g. they jump chapters).
  const prefetchedNextRef = useRef<{ index: number; content: string } | null>(null);
  const prefetchSeqRef = useRef(0);
  /// Debounce plumbing for saveProgress. We only want to write the
  /// last chapter of a fast burst to the DB, not every intermediate
  /// one.
  const pendingProgressRef = useRef<Book | null>(null);
  const progressSaveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    bookRef.current = book;
  }, [book]);

  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
  }, [isSpeaking]);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    prevChapterRef.current = prevChapter;
  }, [prevChapter]);

  useEffect(() => {
    nextChapterRef.current = nextChapter;
  }, [nextChapter]);

  useEffect(() => {
    return () => {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, [idx]);

  // Stop TTS when leaving the reader page (not just switching chapters)
  useEffect(() => {
    return () => {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      setAutoPageActive(false);
    };
  }, []);

  useEffect(() => {
    let wakeLock: WakeLockSentinelLike | null = null;
    let cancelled = false;

    async function requestWakeLock() {
      if (!keepScreenAwake || document.visibilityState !== 'visible') return;
      try {
        wakeLock = (await (navigator as NavigatorWithWakeLock).wakeLock?.request('screen')) ?? null;
        if (cancelled) {
          await wakeLock?.release();
        }
      } catch {
        // Android WebView support depends on the host; keep the setting persisted even if unsupported.
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void requestWakeLock();
      }
    };

    void requestWakeLock();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      void wakeLock?.release();
    };
  }, [keepScreenAwake]);

  // Reading time tracking
  useEffect(() => {
    if (!loading && !message && book) {
      readTimerRef.current = setInterval(() => {
        readTimeRef.current += 30;
      }, 30000);
    }
    return () => {
      if (readTimerRef.current) {
        clearInterval(readTimerRef.current);
        readTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, message, book?.book_url, idx]);

  // Immersive mode: auto-hide header on scroll down, show on scroll up
  useEffect(() => {
    function handleScroll() {
      if (toolbarPinned) return;
      const y = window.scrollY;
      const delta = y - lastScrollY.current;
      lastScrollY.current = y;
      if (y < 60) {
        setHeaderVisible(true);
        return;
      }
      if (delta > 10) {
        setHeaderVisible(false);
      } else if (delta < -10) {
        setHeaderVisible(true);
      }
    }
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [toolbarPinned]);

  // Show header when mouse is near top edge (desktop)
  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (toolbarPinned) return;
      if (e.clientY < 40) {
        setHeaderVisible(true);
        if (headerTimeoutRef.current) clearTimeout(headerTimeoutRef.current);
        headerTimeoutRef.current = setTimeout(() => {
          if (window.scrollY > 60) {
            setHeaderVisible(false);
          }
        }, 2500);
      }
    }
    if (!isMobileUi) {
      window.addEventListener('mousemove', handleMouseMove);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        if (headerTimeoutRef.current) clearTimeout(headerTimeoutRef.current);
      };
    }
    return undefined;
  }, [isMobileUi, toolbarPinned]);

  useEffect(() => {
    return () => {
      const currentBook = bookRef.current;
      if (readTimeRef.current > 0 && currentBook) {
        invoke('add_read_record', {
          record: {
            book_name: currentBook.name,
            read_time: readTimeRef.current,
            last_read: Date.now(),
          },
        }).catch(() => {
          // ignore
        });
        readTimeRef.current = 0;
      }
    };
  }, [book?.book_url, idx]);

  function startTTS() {
    if (!window.speechSynthesis) {
      setMessage(t('reader.ttsNotSupported'));
      return;
    }
    window.speechSynthesis.cancel();
    const text = applyReplaceRules(content);
    if (!text.trim()) return;
    const chunks = text
      .split(/\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (chunks.length === 0) return;
    ttsChunksRef.current = chunks;
    ttsIndexRef.current = 0;
    setTtsTotalChunks(chunks.length);
    setTtsChunkIndex(0);
    setTtsCurrentText(chunks[0]);
    setTtsOverlayOpen(true);
    function speakNext() {
      if (ttsIndexRef.current >= ttsChunksRef.current.length) {
        setIsSpeaking(false);
        setIsPaused(false);
        setTtsOverlayOpen(false);
        return;
      }
      const utterance = new SpeechSynthesisUtterance(ttsChunksRef.current[ttsIndexRef.current]);
      utterance.rate = ttsRate;
      utterance.lang = 'zh-CN';
      utterance.onstart = () => {
        setTtsChunkIndex(ttsIndexRef.current);
        setTtsCurrentText(ttsChunksRef.current[ttsIndexRef.current]);
      };
      utterance.onend = () => {
        ttsIndexRef.current += 1;
        speakNext();
      };
      utterance.onerror = () => {
        setIsSpeaking(false);
        setIsPaused(false);
        setTtsOverlayOpen(false);
      };
      window.speechSynthesis.speak(utterance);
    }
    setIsSpeaking(true);
    setIsPaused(false);
    speakNext();
  }

  function pauseTTS() {
    if (window.speechSynthesis && isSpeaking) {
      window.speechSynthesis.pause();
      setIsPaused(true);
    }
  }

  function resumeTTS() {
    if (window.speechSynthesis && isPaused) {
      window.speechSynthesis.resume();
      setIsPaused(false);
    }
  }

  function stopTTS() {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
    setIsPaused(false);
  }

  async function saveProgress(index: number, activeBook = book, activeChapters = chapters) {
    if (!activeBook) return;
    const chapter = activeChapters.find((c) => c.index === index);
    const updatedBook = {
      ...activeBook,
      dur_chapter_title: chapter?.title || '',
      dur_chapter_index: index,
      dur_chapter_pos: 0,
      dur_chapter_time: Date.now(),
    };
    // Debounce rapid chapter changes (slider scrub, fast next/next) so
    // we only persist once per ~600ms burst. The final chapter is
    // always flushed in the beforeunload handler below.
    pendingProgressRef.current = updatedBook;
    if (progressSaveTimerRef.current !== null) return;
    progressSaveTimerRef.current = window.setTimeout(() => {
      progressSaveTimerRef.current = null;
      const toSave = pendingProgressRef.current;
      pendingProgressRef.current = null;
      if (!toSave) return;
      invoke('update_book', { book: toSave }).then(
        () => {
          setBook(toSave);
          bookRef.current = toSave;
        },
        (e) => console.error('Failed to save progress:', e)
      );
    }, 600);
  }

  /// Flush any pending debounced progress save on tab close / refresh
  /// so the user doesn't lose their last chapter.
  useEffect(() => {
    function flush() {
      const toSave = pendingProgressRef.current;
      pendingProgressRef.current = null;
      if (progressSaveTimerRef.current !== null) {
        window.clearTimeout(progressSaveTimerRef.current);
        progressSaveTimerRef.current = null;
      }
      if (!toSave) return;
      // Fire-and-forget IPC — the Tauri runtime will deliver it
      // synchronously enough for an unload-time write.
      void invoke('update_book', { book: toSave }).catch((e) =>
        console.error('Failed to flush progress:', e)
      );
    }
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('pagehide', flush);
    };
  }, []);

  async function loadChaptersFromSource(
    activeBook: Book,
    seq: number
  ): Promise<BookChapter[] | null> {
    if (activeBook.origin === 'local') return [];
    const sourcesResp = await invoke<ApiResponse<BookSource[]>>('get_book_sources');
    if (seq !== loadSeqRef.current) return null;
    if (!sourcesResp.success || !sourcesResp.data) {
      setMessage(t('reader.loadSourcesFailed'));
      return null;
    }
    const source = sourcesResp.data.find((s) => s.book_source_url === activeBook.origin);
    if (!source) {
      setMessage(t('reader.sourceNotFound'));
      return null;
    }
    const chapResp = await invoke<ApiResponse<BookChapter[]>>('fetch_chapter_list', {
      source,
      book: activeBook,
    });
    if (seq !== loadSeqRef.current) return null;
    if (chapResp.success && chapResp.data) {
      await invoke('add_chapters', { chapters: chapResp.data });
      if (chapResp.data.length === 0) {
        // Surface the actual rule that was tried so the user can
        // diagnose the source without opening devtools.
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
      }
      return chapResp.data;
    }
    setMessage(t('reader.loadChaptersFailed', { error: chapResp.error || '' }));
    return null;
  }

  async function loadContent(
    index: number,
    seq: number,
    activeBook: Book | null,
    activeChapters: BookChapter[]
  ) {
    if (seq !== loadSeqRef.current) return;
    setMessage(t('reader.loadingContent'));
    const activeBookUrl = activeBook?.book_url || decodedUrl;
    try {
      // Fast path: the prefetcher may have stashed this chapter already.
      const prefetched = prefetchedNextRef.current;
      if (prefetched && prefetched.index === index) {
        prefetchedNextRef.current = null;
        setContent(prefetched.content);
        setMessage('');
        await saveProgress(index, activeBook, activeChapters);
        return;
      }
      const cacheResp = await invoke<ApiResponse<string | null>>('get_local_chapter_content', {
        bookUrl: activeBookUrl,
        chapterIndex: index,
      });
      if (seq !== loadSeqRef.current) return;
      if (cacheResp.success && cacheResp.data) {
        setContent(cacheResp.data);
        setMessage('');
        await saveProgress(index, activeBook, activeChapters);
        return;
      }
      const chapter = activeChapters.find((c) => c.index === index);
      if (!chapter) {
        if (seq === loadSeqRef.current) {
          setMessage(t('reader.chapterNotFound'));
        }
        return;
      }
      if (!activeBook) {
        if (seq === loadSeqRef.current) {
          setMessage(t('reader.bookNotLoaded'));
        }
        return;
      }
      if (activeBook.origin === 'local') {
        if (seq === loadSeqRef.current) {
          setMessage(t('reader.localContentMissing'));
        }
        return;
      }
      const sourcesResp = await invoke<ApiResponse<BookSource[]>>('get_book_sources');
      if (seq !== loadSeqRef.current) return;
      if (!sourcesResp.success || !sourcesResp.data) {
        if (seq === loadSeqRef.current) {
          setMessage(t('reader.loadSourcesFailed'));
        }
        return;
      }
      const source = sourcesResp.data.find((s) => s.book_source_url === activeBook.origin);
      if (!source) {
        if (seq === loadSeqRef.current) {
          setMessage(t('reader.sourceNotFound'));
        }
        return;
      }
      const resp = await invoke<ApiResponse<string>>('fetch_chapter_content', {
        source,
        book: activeBook,
        chapter,
      });
      if (seq !== loadSeqRef.current) return;
      if (resp.success && resp.data !== undefined) {
        setContent(resp.data);
        setMessage('');
        await invoke('save_local_chapter_content', {
          bookUrl: activeBookUrl,
          chapterIndex: index,
          content: resp.data,
        });
        await saveProgress(index, activeBook, activeChapters);
      } else {
        if (seq === loadSeqRef.current) {
          // Truncate the raw error so the message stays readable.
          // The full error is in the source's `last_chapter_content_error`
          // health column for power users to inspect.
          const raw = resp.error || '';
          const maxLen = 240;
          const truncated =
            raw.length > maxLen ? raw.slice(0, maxLen) + '…' : raw;
          setMessage(
            t('reader.loadContentFailedWithSource', {
              source: source.book_source_name,
              error: truncated,
            })
          );
        }
      }
    } catch (e) {
      if (seq === loadSeqRef.current) {
        setMessage(t('common.error', { message: String(e) }));
      }
    }
  }

  useEffect(() => {
    const seq = ++loadSeqRef.current;
    async function loadData() {
      if (!decodedUrl) return;
      setLoading(true);
      setContent('');
      try {
        let loadedBook: Book | null = null;
        let loadedChapters: BookChapter[] = [];
        const bookResp = await invoke<ApiResponse<Book[]>>('get_books');
        if (seq !== loadSeqRef.current) return;
        if (bookResp.success && bookResp.data) {
          const found = bookResp.data.find((b) => b.book_url === decodedUrl);
          if (found) {
            loadedBook = found;
            setBook(found);
          } else {
            setBook(null);
          }
        }
        const chapResp = await invoke<ApiResponse<BookChapter[]>>('get_chapters', {
          bookUrl: decodedUrl,
        });
        if (seq !== loadSeqRef.current) return;
        if (chapResp.success && chapResp.data) {
          loadedChapters = chapResp.data;
        }
        if (loadedBook && loadedChapters.length === 0 && loadedBook.origin !== 'local') {
          const fetchedChapters = await loadChaptersFromSource(loadedBook, seq);
          if (seq !== loadSeqRef.current) return;
          if (fetchedChapters === null) {
            return;
          }
          loadedChapters = fetchedChapters;
        }
        setChapters(loadedChapters);
        const rulesResp = await invoke<ApiResponse<ReplaceRule[]>>('get_replace_rules');
        if (seq !== loadSeqRef.current) return;
        if (rulesResp.success && rulesResp.data) {
          setReplaceRules(rulesResp.data);
        }
        await loadContent(idx, seq, loadedBook, loadedChapters);

        // Pre-download the next chapter in the background. Best-effort —
        // any failure just means the next chapter will fetch normally on
        // demand. We invalidate any stale prefetch from a previous
        // mount by clearing the ref and bumping the prefetch seq.
        prefetchSeqRef.current += 1;
        prefetchedNextRef.current = null;
        if (loadedBook && loadedBook.origin !== 'local' && loadedChapters.length > idx + 1) {
          const nextChapter = loadedChapters[idx + 1];
          const mySeq = prefetchSeqRef.current;
          void (async () => {
            try {
              const cached = await invoke<ApiResponse<string | null>>('get_local_chapter_content', {
                bookUrl: decodedUrl,
                chapterIndex: nextChapter.index,
              });
              if (mySeq !== prefetchSeqRef.current) return;
              if (cached.success && typeof cached.data === 'string' && cached.data.length > 0) {
                prefetchedNextRef.current = { index: nextChapter.index, content: cached.data };
                return;
              }
              // Network fetch for prefetch — reuse the source list lookup.
              const sourcesResp = await invoke<ApiResponse<BookSource[]>>('get_book_sources');
              if (mySeq !== prefetchSeqRef.current) return;
              const source = sourcesResp.data?.find((s) => s.book_source_url === loadedBook.origin);
              if (!source) return;
              const resp = await invoke<ApiResponse<string>>('fetch_chapter_content', {
                source,
                book: { ...loadedBook, dur_chapter_index: nextChapter.index },
                chapter: nextChapter,
              });
              if (mySeq !== prefetchSeqRef.current) return;
              if (resp.success && typeof resp.data === 'string') {
                prefetchedNextRef.current = { index: nextChapter.index, content: resp.data };
                void invoke('save_local_chapter_content', {
                  bookUrl: decodedUrl,
                  chapterIndex: nextChapter.index,
                  content: resp.data,
                }).catch(() => {});
              }
            } catch {
              /* ignore prefetch failures */
            }
          })();
        }
      } catch (e) {
        if (seq === loadSeqRef.current) {
          setMessage(t('common.error', { message: String(e) }));
        }
      }
      if (seq === loadSeqRef.current) {
        setLoading(false);
      }
    }
    loadData();
    // Bump the seq on cleanup too — the next effect run will
    // also bump, but if the component unmounts while the inflight
    // request is in flight, the new cleanup catches the unmount
    // path and the seq check inside the async body short-circuits
    // any state writes.
    return () => {
      loadSeqRef.current += 1;
      prefetchSeqRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decodedUrl, idx]);

  function sanitizeHtml(html: string): string {
    // Use DOMParser for robust XSS filtering instead of regex
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const allowedTags = new Set([
      'p',
      'br',
      'div',
      'span',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'img',
      'a',
      'b',
      'strong',
      'i',
      'em',
      'u',
      's',
      'strike',
      'sub',
      'sup',
      'blockquote',
      'pre',
      'code',
      'ul',
      'ol',
      'li',
      'table',
      'thead',
      'tbody',
      'tr',
      'td',
      'th',
      'hr',
    ]);
    const allowedAttrs: Record<string, Set<string>> = {
      img: new Set(['src', 'alt']),
      a: new Set(['href']),
    };

    function walk(node: Node) {
      const children = Array.from(node.childNodes);
      for (const child of children) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          const el = child as HTMLElement;
          const tag = el.tagName.toLowerCase();

          if (!allowedTags.has(tag)) {
            // Replace disallowed tag with its text content
            const text = doc.createTextNode(el.textContent || '');
            node.replaceChild(text, el);
            continue;
          }

          // Remove event handlers and unwanted attributes
          const attrsToRemove: string[] = [];
          for (const attr of Array.from(el.attributes)) {
            const name = attr.name.toLowerCase();
            if (name.startsWith('on')) {
              attrsToRemove.push(attr.name);
            } else if (name === 'href' && tag === 'a') {
              const val = attr.value.trim().toLowerCase();
              if (val.startsWith('javascript:') || val.startsWith('data:')) {
                attrsToRemove.push(attr.name);
              }
            } else {
              const allowed = allowedAttrs[tag];
              if (!allowed || !allowed.has(name)) {
                attrsToRemove.push(attr.name);
              }
            }
          }
          for (const name of attrsToRemove) {
            el.removeAttribute(name);
          }

          walk(el);
        }
      }
    }

    walk(doc.body);
    return doc.body.innerHTML;
  }

  function applyReplaceRules(rawContent: string): string {
    if (!useReplaceRules || !replaceRules.length) return rawContent;
    const sortedRules = [...replaceRules]
      .filter((r) => r.enabled)
      .sort((a, b) => a.order - b.order);
    let result = rawContent;
    for (const rule of sortedRules) {
      if (!rule.pattern) continue;
      if (rule.scope && book) {
        const scopes = rule.scope.split(/[,|]/).map((s) => s.trim());
        const match = scopes.some(
          (s) => s === book.name || s === book.origin || s === book.book_url || s === book.author
        );
        if (!match) continue;
      }
      try {
        if (rule.is_regex) {
          const regex = new RegExp(rule.pattern, 'g');
          result = result.replace(regex, rule.replacement || '');
        } else {
          result = result.split(rule.pattern).join(rule.replacement || '');
        }
      } catch {
        // Skip invalid regex
      }
    }
    return result;
  }

  const readerSearchResults = useMemo(() => {
    const query = readerSearchQuery.trim().toLowerCase();
    if (!query) return [];
    const text = applyReplaceRules(content)
      .replace(/<[^>]+>/g, '\n')
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    const results: Array<{ key: string; text: string }> = [];
    text.forEach((line, lineIndex) => {
      const lower = line.toLowerCase();
      const matchIndex = lower.indexOf(query);
      if (matchIndex < 0) return;
      const start = Math.max(0, matchIndex - 28);
      const end = Math.min(line.length, matchIndex + query.length + 42);
      const prefix = start > 0 ? '...' : '';
      const suffix = end < line.length ? '...' : '';
      results.push({
        key: `${lineIndex}-${matchIndex}`,
        text: `${prefix}${line.slice(start, end)}${suffix}`,
      });
    });
    return results.slice(0, 24);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readerSearchQuery, content, replaceRules, useReplaceRules, book?.book_url]);

  /// Page-transition phase. `fading-out` is the brief window where the
  /// current content plays the out-animation before the chapter URL
  /// flips; `fading-in` is the window where the new content plays the
  /// in-animation. `idle` = no transition active.
  const [transitionPhase, setTransitionPhase] = useState<'idle' | 'fading-out' | 'fading-in'>('idle');

  function goToChapter(index: number) {
    if (transitionPhase !== 'idle') return;
    if (index === idx) return;
    // If the user picked a non-decorative animation, fade out first.
    // For scroll/none we keep the existing instant behaviour — no point
    // adding latency when there's no transform to animate.
    if (pageAnim === 'scroll' || pageAnim === 'none') {
      navigate(`/reader/${encodeURIComponent(decodedUrl)}/${index}`);
      window.scrollTo(0, 0);
      return;
    }
    setTransitionPhase('fading-out');
    // Wait long enough for the CSS keyframe (max 450ms in our stylesheet)
    // to mostly finish, then push the URL and trigger the in animation.
    window.setTimeout(() => {
      navigate(`/reader/${encodeURIComponent(decodedUrl)}/${index}`);
      window.scrollTo(0, 0);
      setTransitionPhase('fading-in');
      window.setTimeout(() => setTransitionPhase('idle'), 450);
    }, 220);
  }

  const goToNextChapter = useCallback(() => {
    if (nextChapter) goToChapter(nextChapter.index);
  }, [nextChapter, goToChapter]);

  const cycleTheme = useCallback(() => {
    const idx = THEME_CYCLE.indexOf(theme);
    const next = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
    setTheme(next);
    localStorage.setItem('reader_theme', next);
  }, [theme]);

  const doAddBookmark = useCallback(async (content: string) => {
    if (!book || !currentChapter) return;
    try {
      await addBookmark({
        book_name: book.name,
        book_author: book.author ?? '',
        chapter_name: currentChapter.title ?? null,
        book_url: book.book_url,
        chapter_url: currentChapter.url ?? null,
        chapter_index: currentChapter.index,
        page_index: 0,
        content: content || currentChapter.title?.slice(0, 200) || '',
      });
      showToast(t('reader.bookmarkAdded'));
    } catch (e) {
      showToast(t('reader.bookmarkAddFailed', { error: String(e) }));
    }
  }, [book, currentChapter, showToast, t]);

  function scrollReaderPage(direction: 1 | -1) {
    const distance = Math.max(160, window.innerHeight * 0.72) * direction;
    window.scrollBy({ top: distance, behavior: pageAnim === 'none' ? 'auto' : 'smooth' });
  }

  function turnPrevious() {
    if (clickRegionMode === 'scroll' && window.scrollY > window.innerHeight * 0.18) {
      scrollReaderPage(-1);
      return;
    }
    if (prevChapterRef.current) {
      goToChapter(prevChapterRef.current.index);
    }
  }

  function turnNext() {
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    if (clickRegionMode === 'scroll' && window.scrollY < maxScroll - 8) {
      scrollReaderPage(1);
      return;
    }
    if (nextChapterRef.current) {
      goToChapter(nextChapterRef.current.index);
    } else if (autoPageActive) {
      setAutoPageActive(false);
    }
  }

  function autoTurnNext() {
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    if (window.scrollY < maxScroll - 8) {
      scrollReaderPage(1);
      return;
    }
    if (nextChapterRef.current) {
      goToChapter(nextChapterRef.current.index);
    } else {
      setAutoPageActive(false);
    }
  }

  function toggleReaderMenu() {
    setHeaderVisible((visible) => {
      const next = !visible;
      if (!next) setReaderPanel(null);
      return next;
    });
  }

  function openReaderPanel(panel: Exclude<ReaderPanel, null>) {
    setHeaderVisible(true);
    setReaderPanel((current) => (current === panel ? null : panel));
  }

  function updateStoredBool(key: string, setter: (value: boolean) => void, value: boolean) {
    setter(value);
    localStorage.setItem(key, String(value));
  }

  function runReaderSearch() {
    const query = readerSearchQuery.trim();
    if (!query) return;
    // Tauri WebView / modern Chromium have no `window.find` — highlight
    // matches directly inside the rendered chapter DOM and scroll the
    // first match into view. We replace any earlier search highlight
    // span we tagged so we can clean them up on the next query.
    const root = contentRef.current;
    if (!root) return;
    // Clear previous highlights.
    root.querySelectorAll('mark[data-rs]').forEach((m) => {
      const parent = m.parentNode;
      if (!parent) return;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
      parent.normalize();
    });
    const lower = query.toLowerCase();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const targets: Text[] = [];
    let node = walker.nextNode();
    while (node) {
      if (node.nodeValue && node.nodeValue.toLowerCase().includes(lower)) {
        targets.push(node as Text);
      }
      node = walker.nextNode();
    }
    if (targets.length === 0) {
      searchMarksRef.current = [];
      setTotalSearchMatches(0);
      setActiveMatchIndex(0);
      return;
    }
    const marks: HTMLElement[] = [];
    targets.forEach((textNode) => {
      const value = textNode.nodeValue ?? '';
      const lowerValue = value.toLowerCase();
      let cursor = 0;
      const frag = document.createDocumentFragment();
      while (true) {
        const idx = lowerValue.indexOf(lower, cursor);
        if (idx < 0) {
          if (cursor < value.length) frag.appendChild(document.createTextNode(value.slice(cursor)));
          break;
        }
        if (idx > cursor) frag.appendChild(document.createTextNode(value.slice(cursor, idx)));
        const mark = document.createElement('mark');
        mark.setAttribute('data-rs', '1');
        mark.style.background = 'rgba(255, 235, 59, 0.55)';
        mark.style.color = 'inherit';
        mark.appendChild(document.createTextNode(value.slice(idx, idx + lower.length)));
        frag.appendChild(mark);
        marks.push(mark);
        cursor = idx + lower.length;
      }
      const parent = textNode.parentNode;
      if (parent) {
        parent.replaceChild(frag, textNode);
      }
    });
    searchMarksRef.current = marks;
    setTotalSearchMatches(marks.length);
    activeMatchIndexRef.current = 0;
    setActiveMatchIndex(0);
    if (marks[0]) {
      marks[0].setAttribute('data-rs-active', '1');
      marks[0].style.background = 'rgba(255, 152, 0, 0.7)';
      marks[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  /// Step the active match index, modulo the total count, and scroll
  /// the new active mark into view. The previous mark loses its
  /// active highlight.
  function goToMatch(idx: number) {
    const marks = searchMarksRef.current;
    if (marks.length === 0) return;
    const next = ((idx % marks.length) + marks.length) % marks.length;
    const prev = marks[activeMatchIndexRef.current];
    if (prev) {
      prev.removeAttribute('data-rs-active');
      prev.style.background = 'rgba(255, 235, 59, 0.55)';
    }
    const target = marks[next];
    target.setAttribute('data-rs-active', '1');
    target.style.background = 'rgba(255, 152, 0, 0.7)';
    activeMatchIndexRef.current = next;
    setActiveMatchIndex(next);
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  useEffect(() => {
    if (!autoPageActive || loading || message) return undefined;
    const timer = window.setInterval(() => {
      autoTurnNext();
    }, autoPageInterval);
    return () => window.clearInterval(timer);
    // autoTurnNext intentionally reads live refs and viewport state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPageActive, autoPageInterval, loading, message, idx, pageAnim]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case 'ArrowLeft':
        case 'a':
        case 'A':
          if (prevChapterRef.current) {
            e.preventDefault();
            goToChapter(prevChapterRef.current.index);
          }
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          if (nextChapterRef.current) {
            e.preventDefault();
            goToChapter(nextChapterRef.current.index);
          }
          break;
        case ' ':
          e.preventDefault();
          if (isSpeakingRef.current) {
            if (isPausedRef.current) resumeTTS();
            else pauseTTS();
          } else {
            startTTS();
          }
          break;
        case '+':
        case '=':
          e.preventDefault();
          setFontSize((s) => {
            const ns = Math.min(32, s + 2);
            localStorage.setItem('reader_font_size', String(ns));
            return ns;
          });
          break;
        case '-':
        case '_':
          e.preventDefault();
          setFontSize((s) => {
            const ns = Math.max(12, s - 2);
            localStorage.setItem('reader_font_size', String(ns));
            return ns;
          });
          break;
        case 's':
        case 'S':
          e.preventDefault();
          setShowSettings((prev) => !prev);
          break;
        case 't':
        case 'T':
          e.preventDefault();
          if (isSpeakingRef.current) stopTTS();
          else startTTS();
          break;
        case 'F3':
          e.preventDefault();
          goToMatch(activeMatchIndex + (e.shiftKey ? -1 : 1));
          break;
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // All mutable state is accessed via refs to avoid re-attaching the listener on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mount the keyboard / wheel / mouse-nav hook once all callbacks are
  // stable. The hook reads `nav.prefs.stickyToolbar` etc. to drive its
  // own effects; the callbacks below close over `doAddBookmark`,
  // `goToNextChapter`, `goToChapter`, `prevChapter`, `nextChapter`,
  // `setReaderPanel`, `setShowSettings`, `setShowShortcuts`,
  // `setShowNavSettings`, `setContextMenu`, `nav`, and `navigate`.
  const nav = useReaderNav({
    contentRef,
    hasPrevChapter: !!prevChapter,
    hasNextChapter: !!nextChapter,
    onPrevChapter: () => prevChapter && goToChapter(prevChapter.index),
    onNextChapter: () => nextChapter && goToNextChapter(),
    onFirstChapter: () => chapters[0] && goToChapter(0),
    onLastChapter: () => chapters.length > 0 && goToChapter(chapters.length - 1),
    onOpenSearch: () => setSearchKeyword(''),
    onAddBookmark: () => doAddBookmark(''),
    onOpenBookmarkList: () => navigate('/bookmarks'),
    onToggleToolbar: () => nav.setPrefs({ ...nav.prefs, stickyToolbar: !nav.prefs.stickyToolbar }),
    onShowShortcuts: () => setShowShortcuts(true),
    onFullscreen: () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.();
    },
    onClose: () => {
      if (contextMenu) setContextMenu(null);
      else if (showShortcuts) setShowShortcuts(false);
      else if (showNavSettings) setShowNavSettings(false);
      else if (readerPanel) setReaderPanel(null);
      else if (document.fullscreenElement) document.exitFullscreen();
    },
  });

  /// Right-click on the content pane opens the contextual menu. Text
  /// selection yields a `text` menu (copy / bookmark / replace / search);
  /// a bare click yields a `page` menu (chapter nav, catalog, theme,
  /// settings, exit).
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!contentRef.current?.contains(e.target as Node)) return;
      e.preventDefault();
      const sel = window.getSelection();
      const text = sel ? sel.toString().trim() : '';
      const hasSel = text.length >= 1 && text.length <= 500;
      setSelectedText(text);
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        kind: hasSel ? 'text' : 'page',
        selectedText: text,
      });
    };
    document.addEventListener('contextmenu', handler);
    return () => document.removeEventListener('contextmenu', handler);
  }, []);

  const tStyleBase = themeStyles[theme] || themeStyles.day;
  /// Apply the global background alpha to the theme's `bg` color so the
  /// content area can be made translucent (e.g. for showing an
  /// underlying paper texture or letting a custom image bleed through).
  const tStyle = {
    ...tStyleBase,
    bg: `rgba(${hexToRgb(tStyleBase.bg)}, ${bgAlpha / 100})`,
  };

  const btnStyle = (active?: boolean): React.CSSProperties => ({
    padding: isMobileUi ? '7px 10px' : '6px 14px',
    borderRadius: 8,
    border: `1px solid ${tStyle.border}`,
    background: active ? '#1976d2' : tStyle.button,
    color: active ? '#fff' : tStyle.text,
    fontSize: 13,
    cursor: 'pointer',
    fontWeight: 500,
    transition: 'all 0.2s',
    whiteSpace: 'nowrap',
    maxWidth: '100%',
  });

  const chapterProgressPercent = Math.min(
    100,
    Math.max(0, ((idx + 1) / Math.max(1, chapters.length)) * 100)
  );

  function updatePageAnim(mode: PageAnim) {
    setPageAnim(mode);
    localStorage.setItem('reader_page_anim', mode);
  }

  const mobileRoundButtonStyle = (active?: boolean): React.CSSProperties => ({
    width: 38,
    minWidth: 38,
    height: 38,
    border: `1px solid ${active ? '#1976d2' : tStyle.border}`,
    borderRadius: 20,
    background: active ? '#1976d2' : tStyle.bg,
    color: active ? '#fff' : tStyle.text,
    fontSize: 15,
    fontWeight: 600,
    display: 'grid',
    placeItems: 'center',
    boxShadow: theme === 'night' ? '0 4px 14px rgba(0,0,0,0.35)' : '0 4px 14px rgba(0,0,0,0.08)',
    cursor: 'pointer',
    opacity: active ? 1 : 0.9,
    transition: 'all 0.2s ease',
  });

  const mobileMenuButtonStyle = (active?: boolean): React.CSSProperties => ({
    width: 56,
    minHeight: 48,
    border: 0,
    borderRadius: 8,
    background: 'transparent',
    color: active ? '#1976d2' : tStyle.text,
    display: 'grid',
    justifyItems: 'center',
    alignContent: 'center',
    gap: 2,
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    opacity: active ? 1 : 0.75,
  });

  const mobileSettingBlockStyle: React.CSSProperties = {
    display: 'grid',
    gap: 6,
    minWidth: 0,
  };

  const mobilePanelTitleStyle: React.CSSProperties = {
    fontSize: 11,
    opacity: 0.55,
    fontWeight: 600,
    letterSpacing: '0.02em',
    textTransform: 'uppercase',
  };

  const mobileOptionRowStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    alignItems: 'center',
    gap: 12,
    minHeight: 36,
    padding: '0 4px',
  };

  return (
    <div
      style={{
        background: tStyle.bg,
        color: tStyle.text,
        minHeight: '100dvh',
        overflowX: 'hidden',
      }}
    >
      {/* TTS mini player overlay — opens when reading aloud starts. */}
      <TTSOverlay
        visible={ttsOverlayOpen}
        bookTitle={book?.name ?? ''}
        chapterTitle={currentChapter?.title ?? ''}
        currentText={ttsCurrentText}
        currentChunkIndex={ttsChunkIndex}
        totalChunks={ttsTotalChunks}
        isPlaying={isSpeaking}
        isPaused={isPaused}
        rate={ttsRate}
        onClose={() => {
          stopTTS();
          setTtsOverlayOpen(false);
        }}
        onPlayPause={() => {
          if (isPaused) {
            resumeTTS();
          } else if (isSpeaking) {
            pauseTTS();
          } else {
            startTTS();
          }
        }}
        onStop={() => {
          stopTTS();
          setTtsOverlayOpen(false);
        }}
        onAdjustRate={(delta) => {
          setTtsRate((r) => {
            const next = Math.max(0.5, Math.min(2, r + delta));
            localStorage.setItem('reader_tts_rate', String(next));
            return next;
          });
        }}
        onPrevChapter={prevChapter ? () => { stopTTS(); turnPrevious(); } : undefined}
        onNextChapter={nextChapter ? () => { stopTTS(); turnNext(); } : undefined}
        theme={{
          bg: tStyle.bg,
          text: tStyle.text,
          border: tStyle.border,
          button: tStyle.button,
        }}
      />
      {/* Fixed header: toolbar + settings with immersive hide/show */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          background: tStyleBase.bg,
          transform: headerVisible ? 'translateY(0)' : 'translateY(-100%)',
          transition: 'transform 0.25s ease',
          boxShadow: headerVisible
            ? `0 2px 8px ${theme === 'night' ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.06)'}`
            : 'none',
        }}
      >
        {/* Toolbar — ReadAny-style: left controls | center title | right controls */}
        <div
          style={{
            borderBottom: `1px solid ${tStyle.border}`,
            padding: isMobileUi
              ? 'calc(8px + var(--legado-safe-top)) calc(12px + var(--legado-safe-right)) 8px calc(12px + var(--legado-safe-left))'
              : '10px 20px',
            display: 'flex',
            flexDirection: isMobileUi ? 'column' : 'row',
            justifyContent: isMobileUi ? 'flex-start' : 'space-between',
            alignItems: isMobileUi ? 'stretch' : 'center',
            gap: isMobileUi ? 8 : 0,
            boxSizing: 'border-box',
            position: 'relative',
          }}
        >
          {/* Left */}
          <div
            style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0, flexShrink: 0 }}
          >
            <button
              onClick={() => { if (window.history.length > 1) navigate(-1); else navigate("/bookshelf"); }}
              title={t('common.back')}
              aria-label={t('common.back')}
              data-testid="reader-back-btn"
              style={{ ...btnStyle(), minWidth: 36, fontSize: 16, padding: '6px 12px' }}
            >
              ←
            </button>
            <button
              onClick={() =>
                isMobileUi
                  ? openReaderPanel('catalog')
                  : setReaderPanel(readerPanel === 'catalog' ? null : 'catalog')
              }
              style={btnStyle()}
            >
              {t('reader.chapters')}
            </button>
            <TipValue
              kind={tipHeaderLeft}
              chapterTitle={currentChapter?.title}
              bookName={book?.name}
              scrollPct={tipScrollPct}
              chapterProgressPct={chapterProgressPercent}
              color={tStyle.text}
            />
          </div>

          {/* Center: chapter title (absolute on desktop to truly center) */}
          {!isMobileUi && (
            <span
              style={{
                position: 'absolute',
                left: '50%',
                transform: 'translateX(-50%)',
                maxWidth: '40%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: 13,
                fontWeight: 600,
                color: tStyle.text,
                opacity: 0.85,
                pointerEvents: 'none',
              }}
            >
              {currentChapter?.title || t('reader.chapterTitle', { idx })}
            </span>
          )}
          {isMobileUi && (
            <span
              style={{
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: 14,
                fontWeight: 700,
              }}
            >
              {currentChapter?.title || t('reader.chapterTitle', { idx })}
            </span>
          )}

          {/* Right */}
          <div
            style={{
              gap: 6,
              justifyContent: isMobileUi ? 'flex-start' : 'flex-end',
              flexWrap: 'wrap',
              minWidth: 0,
              display: isMobileUi ? 'none' : 'flex',
              alignItems: 'center',
              flexShrink: 0,
            }}
          >
            <TipValue
              kind={tipHeaderRight}
              chapterTitle={currentChapter?.title}
              bookName={book?.name}
              scrollPct={tipScrollPct}
              chapterProgressPct={chapterProgressPercent}
              color={tStyle.text}
            />
            {isSpeaking ? (
              <button
                onClick={isPaused ? resumeTTS : pauseTTS}
                style={btnStyle(true)}
              >
                {isPaused ? t('common.resume') : t('common.pause')}
              </button>
            ) : (
              <button onClick={startTTS} disabled={!content} style={btnStyle()}>
                {t('reader.tts')}
              </button>
            )}
            <button
              onClick={() => {
                const next = !toolbarPinned;
                setToolbarPinned(next);
                localStorage.setItem('reader_toolbar_pinned', String(next));
              }}
              title={toolbarPinned ? 'Unpin toolbar' : 'Pin toolbar'}
              style={{
                ...btnStyle(),
                padding: '4px 8px',
                fontSize: 16,
                background: toolbarPinned ? '#1976d2' : tStyle.button,
                color: toolbarPinned ? '#fff' : tStyle.text,
                borderColor: toolbarPinned ? '#1976d2' : tStyle.border,
              }}
            >
              {toolbarPinned ? '✕' : '📌'}
            </button>
            <button
              onClick={async () => {
                try {
                  const { getCurrentWindow } = await import('@tauri-apps/api/window');
                  const win = getCurrentWindow();
                  const fs = await win.isFullscreen();
                  await win.setFullscreen(!fs);
                } catch {
                  // fallback to browser fullscreen
                  if (!document.fullscreenElement) {
                    document.documentElement.requestFullscreen().catch(() => {});
                  } else {
                    document.exitFullscreen().catch(() => {});
                  }
                }
              }}
              title="Fullscreen"
              style={{ ...btnStyle(), padding: '4px 8px', fontSize: 16 }}
            >
              ⛶
            </button>
            <button
              onClick={() => setShowSettings(!showSettings)}
              style={showSettings ? btnStyle(true) : btnStyle()}
            >
              {t('common.settings')}
            </button>
          </div>
        </div>

        <SettingsPanel
          open={showSettings}
          isMobileUi={isMobileUi}
          baseBg={tStyleBase.bg}
          border={tStyle.border}
          text={tStyle.text}
          fontSize={fontSize}
          setFontSize={setFontSize}
          fontFamily={fontFamily}
          setFontFamily={setFontFamily}
          lineHeight={lineHeight}
          setLineHeight={setLineHeight}
          paragraphSpacing={paragraphSpacing}
          setParagraphSpacing={setParagraphSpacing}
          theme={theme}
          setTheme={setTheme}
          pageAnim={pageAnim}
          updatePageAnim={updatePageAnim}
          ttsRate={ttsRate}
          setTtsRate={setTtsRate}
          bgAlpha={bgAlpha}
          setBgAlpha={setBgAlpha}
          tipHeaderLeft={tipHeaderLeft}
          setTipHeaderLeft={setTipHeaderLeft}
          tipHeaderRight={tipHeaderRight}
          setTipHeaderRight={setTipHeaderRight}
          tipFooterLeft={tipFooterLeft}
          setTipFooterLeft={setTipFooterLeft}
          tipFooterRight={tipFooterRight}
          setTipFooterRight={setTipFooterRight}
          onClose={() => setShowSettings(false)}
        />

        {/* Desktop catalog popover — opened by the top-bar "Chapters" button.
            Anchored under the top bar; closes on chapter pick or on
            toggling the top-bar "Chapters" button again. Mobile uses the
            bottom-sheet catalog panel instead. */}
        {!isMobileUi && readerPanel === 'catalog' && headerVisible && (
          <div
            style={{
              borderBottom: `1px solid ${tStyle.border}`,
              background: tStyle.bg,
              padding: '12px 20px 16px',
              boxShadow: `0 4px 16px ${theme === 'night' ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.08)'}`,
              maxHeight: '60vh',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <span style={mobilePanelTitleStyle}>{t('reader.readerPanelCatalog')}</span>
            <CatalogPanel
              chapters={chapters}
              currentIndex={idx}
              onPick={(newIdx) => {
                setReaderPanel(null);
                goToChapter(newIdx);
              }}
            />
          </div>
        )}
      </div>

      {/* Reading progress bar - vertical, right edge */}
      {!loading && !message && showReadProgress && (
        <div
          aria-hidden
          style={{
            position: 'fixed',
            top: 0,
            right: 0,
            bottom: 0,
            width: 4,
            zIndex: 55,
            background: 'rgba(128, 128, 128, 0.18)',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: `${tipScrollPct}%`,
              background: theme === 'night' ? '#82b1ff' : '#1976d2',
              opacity: 0.85,
              transition: 'height 0.3s ease',
            }}
          />
        </div>
      )}

      <style>{`
        .reader-content p, .reader-content div:not(:last-child) {
          margin-bottom: ${paragraphSpacing}em;
          text-align: ${textAlign};
        }
        .reader-content p:last-child, .reader-content div:last-child {
          margin-bottom: 0;
        }
      `}</style>

      {/* Tap zones for page turn (mobile/tablet) */}
      {isMobileUi && !loading && !message && (
        <>
          <div
            onClick={turnPrevious}
            style={{
              position: 'fixed',
              top: '20%',
              left: 0,
              width: '18%',
              height: '60%',
              zIndex: 10,
              cursor: prevChapter ? 'pointer' : 'default',
            }}
          />
          <div
            onClick={turnNext}
            style={{
              position: 'fixed',
              top: '20%',
              right: 0,
              width: '18%',
              height: '60%',
              zIndex: 10,
              cursor: nextChapter ? 'pointer' : 'default',
            }}
          />
          {/* Center tap toggles header */}
          <div
            onClick={toggleReaderMenu}
            style={{
              position: 'fixed',
              top: '20%',
              left: '18%',
              width: '64%',
              height: '60%',
              zIndex: 10,
            }}
          />
        </>
      )}

      {/* Qidian-style breadcrumb: 书架 > 书名 > 章节 */}
      {!loading && book && (
        <div
          style={{
            maxWidth: isMobileUi ? '100%' : contentWidth,
            width: '100%',
            margin: '0 auto',
            padding: isMobileUi
              ? '8px calc(20px + var(--legado-safe-right)) 0 calc(20px + var(--legado-safe-left))'
              : '14px 24px 0',
            boxSizing: 'border-box',
            fontSize: 13,
            color: tStyle.text,
            opacity: 0.55,
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span
            style={{ cursor: 'pointer' }}
            onClick={() => navigate('/bookshelf')}
            role="link"
            tabIndex={0}
          >
            {t('layout.bookshelf')}
          </span>
          <span style={{ opacity: 0.5 }}>›</span>
          <span
            style={{ cursor: 'pointer' }}
            onClick={() =>
              navigate(`/book/${encodeURIComponent(decodedUrl)}`, {
                state: { parent: readerParentPath.current },
              })
            }
            role="link"
            tabIndex={0}
          >
            {book.name}
          </span>
          {currentChapter?.title && (
            <>
              <span style={{ opacity: 0.5 }}>›</span>
              <span style={{ color: tStyle.text, opacity: 0.8 }}>
                {currentChapter.title}
              </span>
            </>
          )}
        </div>
      )}

      {/* Content */}
      <div
        ref={contentRef}
        className="reader-content"
        onClick={(e) => {
          if (isMobileUi && !loading && !message) {
            const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
            const x = e.clientX - rect.left;
            const width = rect.width;
            if (x < width * 0.2) {
              turnPrevious();
            } else if (x > width * 0.8) {
              turnNext();
            } else {
              toggleReaderMenu();
            }
          }
        }}
        style={{
          maxWidth: isMobileUi ? '100%' : contentWidth,
          width: '100%',
          margin: '0 auto',
          padding: isMobileUi
            ? 'calc(24px + var(--legado-safe-top)) calc(20px + var(--legado-safe-right)) calc(38px + var(--legado-safe-bottom)) calc(20px + var(--legado-safe-left))'
            : '56px 24px 120px',
          boxSizing: 'border-box',
          lineHeight,
          fontSize,
          whiteSpace: 'pre-wrap',
          userSelect: textSelectable ? 'text' : 'none',
          WebkitUserSelect: textSelectable ? 'text' : 'none',
          fontFamily:
            fontFamily === 'serif'
              ? '"Noto Serif SC", "Source Han Serif SC", "SimSun", "STSong", serif'
              : fontFamily === 'sans'
                ? '"Noto Sans SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif'
                : 'inherit',
          // Chapter transition — out animation during fade-out, in during
          // fade-in. `idle` returns to normal rendering.
          opacity: transitionPhase === 'fading-out' ? 0 : 1,
          transform:
            transitionPhase === 'fading-out'
              ? pageAnim === 'cover'
                ? 'perspective(1200px) rotateY(-30deg)'
                : pageAnim === 'slide'
                  ? 'translateX(-30%)'
                  : pageAnim === 'simulation'
                    ? 'perspective(1500px) rotateY(-15deg) translateX(-15%)'
                    : 'none'
              : transitionPhase === 'fading-in'
                ? pageAnim === 'cover'
                  ? 'perspective(1200px) rotateY(-15deg)'
                  : pageAnim === 'slide'
                    ? 'translateX(15%)'
                    : pageAnim === 'simulation'
                      ? 'perspective(1500px) rotateY(8deg) translateX(8%)'
                      : 'none'
                : 'none',
          transformOrigin: 'left center',
          transition: transitionPhase === 'idle' ? 'transform 0s, opacity 0s' : 'transform 200ms ease, opacity 200ms ease',
        }}
      >
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: '#888' }}>
            <div
              style={{
                width: 28,
                height: 28,
                border: '3px solid #e8e8f0',
                borderTopColor: '#1976d2',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
                margin: '0 auto 12px',
              }}
            />
            <p>{t('common.loading')}</p>
          </div>
        ) : message ? (
          <div
            style={{
              background: message.includes(t('common.error')) ? '#ffebee' : '#e3f2fd',
              color: message.includes(t('common.error')) ? '#c62828' : '#1565c0',
              padding: '16px 20px',
              boxSizing: 'border-box',
              width: '100%',
              maxWidth: isMobileUi ? 320 : '100%',
              borderRadius: 8,
              fontSize: 15,
              fontWeight: 500,
              textAlign: 'center',
              whiteSpace: 'normal',
              overflowWrap: 'anywhere',
              wordBreak: 'break-all',
            }}
          >
            <span
              style={{
                display: 'inline-block',
                maxWidth: '100%',
                overflowWrap: 'anywhere',
                wordBreak: 'break-all',
              }}
            >
              {message}
            </span>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '24px',
            }}
          >
            {/* Qidian-style: chapter title as a big H1, then metadata row */}
            {currentChapter?.title && (
              <h1
                style={{
                  fontSize: '1.6em',
                  fontWeight: 600,
                  color: tStyle.text,
                  margin: 0,
                  lineHeight: 1.35,
                  letterSpacing: '0.02em',
                }}
              >
                {currentChapter.title}
              </h1>
            )}
            {book && (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: '14px',
                  fontSize: 13,
                  color: tStyle.text,
                  opacity: 0.65,
                }}
              >
                <span>
                  <span style={{ opacity: 0.5 }}>📖 </span>
                  {book.name}
                </span>
                <span>
                  <span style={{ opacity: 0.5 }}>✍ </span>
                  {book.author}
                </span>
                {content && (
                  <span>
                    <span style={{ opacity: 0.5 }}>字数 </span>
                    {content.length}
                  </span>
                )}
              </div>
            )}
            {/* A thin divider line, like Qidian's border-t */}
            <div
              style={{
                height: 1,
                background: tStyle.border,
                margin: '0 0 8px',
              }}
            />
            {/* The actual chapter body, Qidian-style: each blank-line
                delimited block becomes a <p> with text-indent: 2em
                (matching the Chinese first-line indent the source uses). */}
            {(() => {
              const safe = sanitizeHtml(applyReplaceRules(content));
              // Split on blank lines (\n\n or more).
              const blocks = safe.split(/\n{2,}/);
              return (
                <div
                  style={{
                    textAlign: 'justify',
                    textIndent: '2em',
                    wordBreak: 'break-word',
                  }}
                >
                  {blocks.map((block, i) => (
                    <p
                      key={i}
                      style={{
                        margin: '0 0 1em 0',
                        textIndent: '2em',
                        lineHeight: 'inherit',
                      }}
                    >
                      {block.split('\n').map((line, j, arr) => (
                        <span key={j}>
                          {line}
                          {j < arr.length - 1 && <br />}
                        </span>
                      ))}
                    </p>
                  ))}
                </div>
              );
            })()}

            {/* Qidian-style "本章完" + author note + chapter-end nav */}
            {(() => {
              // Look for "本章完" / "（本章完）" at the end of the
              // content. Authors often append it. Detect so we can
              // surface it as a separate "chapter finished" marker.
              const trimmed = content.trimEnd();
              const isComplete =
                /[（(]?本章完[)）]?\s*$/.test(trimmed);
              // Pull a trailing author note (lines that look like
              // "求月票", "求推荐", "求收藏" etc. — the standard
              // Qidian "作者说" prompts).
              const noteMatch = content.match(
                /[（(]?\s*(求[月度推票藏订赏].{0,30}?)[)）]?\s*$/m,
              );
              if (!isComplete && !noteMatch) return null;
              return (
                <div
                  style={{
                    marginTop: 16,
                    padding: '14px 18px',
                    background:
                      theme === 'night'
                        ? 'rgba(255,255,255,0.04)'
                        : 'rgba(0,0,0,0.03)',
                    borderRadius: 8,
                    border: `1px dashed ${tStyle.border}`,
                    fontSize: 13,
                    color: tStyle.text,
                    opacity: 0.7,
                  }}
                >
                  {isComplete && (
                    <div
                      style={{
                        fontWeight: 600,
                        marginBottom: noteMatch ? 6 : 0,
                        letterSpacing: '0.1em',
                      }}
                    >
                      ✦ 本章完 ✦
                    </div>
                  )}
                  {noteMatch && (
                    <div style={{ lineHeight: 1.6 }}>{noteMatch[1]}</div>
                  )}
                </div>
              );
            })()}

            {/* Qidian-style: prev / next chapter buttons */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 12,
                marginTop: 20,
                paddingBottom: 24,
              }}
            >
              <button
                onClick={turnPrevious}
                disabled={!prevChapter}
                style={{
                  ...btnStyle(),
                  padding: '10px 12px',
                  fontSize: 13,
                  textAlign: 'left',
                  opacity: prevChapter ? 1 : 0.4,
                  cursor: prevChapter ? 'pointer' : 'not-allowed',
                  overflow: 'hidden',
                }}
                title={prevChapter?.title}
              >
                <div
                  style={{
                    fontSize: 11,
                    opacity: 0.55,
                    marginBottom: 2,
                  }}
                >
                  ‹ 上一章
                </div>
                <div
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {prevChapter?.title || t('reader.firstChapter')}
                </div>
              </button>
              <button
                onClick={turnNext}
                disabled={!nextChapter}
                style={{
                  ...btnStyle(),
                  padding: '10px 12px',
                  fontSize: 13,
                  textAlign: 'right',
                  opacity: nextChapter ? 1 : 0.4,
                  cursor: nextChapter ? 'pointer' : 'not-allowed',
                  overflow: 'hidden',
                }}
                title={nextChapter?.title}
              >
                <div
                  style={{
                    fontSize: 11,
                    opacity: 0.55,
                    marginBottom: 2,
                  }}
                >
                  下一章 ›
                </div>
                <div
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {nextChapter?.title || t('reader.lastChapter')}
                </div>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Navigation footer — ReadAny-style mobile bottom sheet */}
      {isMobileUi ? (
        <div
          style={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 50,
            transform: headerVisible ? 'translateY(0)' : 'translateY(100%)',
            transition: 'transform 0.28s cubic-bezier(0.32, 0.72, 0, 1)',
            color: tStyle.text,
            pointerEvents: headerVisible ? 'auto' : 'none',
          }}
        >
          {/* Floating quick-action buttons */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding:
                '0 calc(18px + var(--legado-safe-right)) 10px calc(18px + var(--legado-safe-left))',
            }}
          >
            <button
              type="button"
              onClick={() => openReaderPanel('search')}
              style={mobileRoundButtonStyle(readerPanel === 'search')}
              aria-label={t('reader.searchContent')}
              title={t('reader.searchContent')}
            >
              ⌕
            </button>
            <button
              type="button"
              onClick={() => setAutoPageActive((active) => !active)}
              disabled={!content}
              style={{
                ...mobileRoundButtonStyle(autoPageActive),
                opacity: content ? 1 : 0.5,
                cursor: content ? 'pointer' : 'not-allowed',
              }}
              aria-label={t('reader.autoPage')}
              title={t('reader.autoPage')}
            >
              {autoPageActive ? '■' : '▶'}
            </button>
            <button
              type="button"
              onClick={() => {
                const next = !useReplaceRules;
                updateStoredBool('reader_use_replace_rules', setUseReplaceRules, next);
              }}
              style={mobileRoundButtonStyle(useReplaceRules)}
              aria-label={
                useReplaceRules ? t('reader.replaceRulesOn') : t('reader.replaceRulesOff')
              }
              title={useReplaceRules ? t('reader.replaceRulesOn') : t('reader.replaceRulesOff')}
            >
              ≋
            </button>
            <button
              type="button"
              onClick={() => {
                const idx = THEME_CYCLE.indexOf(theme);
                const next = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
                setTheme(next);
                localStorage.setItem('reader_theme', next);
              }}
              style={mobileRoundButtonStyle(theme === 'night')}
              aria-label={t(`reader.themeCycle.${theme}`)}
              title={t(`reader.themeCycle.${theme}`)}
            >
              {theme === 'day' ? '☀' : theme === 'night' ? '☾' : '✦'}
            </button>
          </div>

          {/* Bottom sheet with rounded top corners */}
          <div
            style={{
              background: tStyle.bg,
              borderTop: `1px solid ${tStyle.border}`,
              borderRadius: '16px 16px 0 0',
              boxShadow:
                theme === 'night'
                  ? '0 -8px 32px rgba(0,0,0,0.45), 0 -1px 0 rgba(255,255,255,0.04)'
                  : '0 -8px 32px rgba(0,0,0,0.10), 0 -1px 0 rgba(0,0,0,0.04)',
              padding: readerPanel
                ? '12px calc(16px + var(--legado-safe-right)) calc(10px + var(--legado-safe-bottom)) calc(16px + var(--legado-safe-left))'
                : '8px calc(14px + var(--legado-safe-right)) calc(6px + var(--legado-safe-bottom)) calc(14px + var(--legado-safe-left))',
              boxSizing: 'border-box',
            }}
          >
            {readerPanel === 'search' && (
              <div
                style={{
                  display: 'grid',
                  gap: 10,
                  marginBottom: 12,
                }}
              >
                <span style={mobilePanelTitleStyle}>{t('reader.readerPanelSearch')}</span>
                <div
                  style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8 }}
                >
                  <input
                    value={readerSearchQuery}
                    onChange={(e) => setReaderSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') runReaderSearch();
                    }}
                    placeholder={t('reader.searchPlaceholder')}
                    style={{
                      minWidth: 0,
                      border: `1px solid ${tStyle.border}`,
                      borderRadius: 8,
                      background: tStyle.button,
                      color: tStyle.text,
                      padding: '9px 10px',
                      fontSize: 14,
                      boxSizing: 'border-box',
                    }}
                  />
                  <button type="button" onClick={runReaderSearch} style={btnStyle(true)}>
                    {t('reader.searchNext')}
                  </button>
                </div>
                {readerSearchQuery.trim() && (
                  <div style={{ display: 'grid', gap: 6, maxHeight: '24dvh', overflowY: 'auto' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 12, opacity: 0.78 }}>
                      <span>
                        {totalSearchMatches > 0
                          ? t('reader.searchMatches', { count: totalSearchMatches })
                          : t('reader.noSearchMatches')}
                      </span>
                      {totalSearchMatches > 1 && (
                        <>
                          <button
                            type="button"
                            onClick={() => goToMatch(activeMatchIndex - 1)}
                            aria-label={t('reader.searchPrev')}
                            style={{ ...btnStyle(), padding: '2px 8px', fontSize: 12 }}
                          >
                            ‹
                          </button>
                          <span style={{ minWidth: 36, textAlign: 'center' }}>
                            {activeMatchIndex + 1} / {totalSearchMatches}
                          </span>
                          <button
                            type="button"
                            onClick={() => goToMatch(activeMatchIndex + 1)}
                            aria-label={t('reader.searchNext')}
                            style={{ ...btnStyle(), padding: '2px 8px', fontSize: 12 }}
                          >
                            ›
                          </button>
                        </>
                      )}
                    </div>
                    {readerSearchResults.map((result) => (
                      <button
                        key={result.key}
                        type="button"
                        onClick={runReaderSearch}
                        style={{
                          ...btnStyle(),
                          justifyContent: 'flex-start',
                          textAlign: 'left',
                          whiteSpace: 'normal',
                          lineHeight: 1.45,
                        }}
                      >
                        {result.text}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {readerPanel === 'catalog' && (
              <div
                style={{
                  display: 'grid',
                  gap: 8,
                  marginBottom: 12,
                }}
              >
                <span style={mobilePanelTitleStyle}>{t('reader.readerPanelCatalog')}</span>
                <CatalogPanel
                  chapters={chapters}
                  currentIndex={idx}
                  onPick={(newIdx) => {
                    setReaderPanel(null);
                    goToChapter(newIdx);
                  }}
                />
              </div>
            )}

            {readerPanel === 'style' && (
              <div
                style={{
                  display: 'grid',
                  gap: 14,
                  marginBottom: 12,
                }}
              >
                <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
                  {[
                    { key: 'cover', label: t('reader.pageAnimCover') },
                    { key: 'slide', label: t('reader.pageAnimSlide') },
                    { key: 'simulation', label: t('reader.pageAnimSimulation') },
                    { key: 'scroll', label: t('reader.pageAnimScroll') },
                    { key: 'none', label: t('reader.pageAnimNone') },
                  ].map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => updatePageAnim(item.key as PageAnim)}
                      style={pageAnim === item.key ? btnStyle(true) : btnStyle()}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <div style={mobileSettingBlockStyle}>
                  <span style={{ fontSize: 12, opacity: 0.75 }}>{t('reader.fontSize')}</span>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '44px 1fr 44px',
                      gap: 8,
                      alignItems: 'center',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        const s = Math.max(12, fontSize - 2);
                        setFontSize(s);
                        localStorage.setItem('reader_font_size', String(s));
                      }}
                      style={btnStyle()}
                    >
                      −
                    </button>
                    <input
                      type="range"
                      min={12}
                      max={32}
                      step={1}
                      value={fontSize}
                      onChange={(e) => {
                        const s = parseInt(e.target.value, 10);
                        setFontSize(s);
                        localStorage.setItem('reader_font_size', String(s));
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const s = Math.min(32, fontSize + 2);
                        setFontSize(s);
                        localStorage.setItem('reader_font_size', String(s));
                      }}
                      style={btnStyle()}
                    >
                      +
                    </button>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div style={mobileSettingBlockStyle}>
                    <span style={{ fontSize: 12, opacity: 0.75 }}>{t('reader.lineHeight')}</span>
                    <input
                      type="range"
                      min={1.2}
                      max={2.5}
                      step={0.1}
                      value={lineHeight}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        setLineHeight(v);
                        localStorage.setItem('reader_line_height', String(v));
                      }}
                    />
                  </div>
                  <div style={mobileSettingBlockStyle}>
                    <span style={{ fontSize: 12, opacity: 0.75 }}>
                      {t('reader.paragraphSpacing')}
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={2}
                      step={0.1}
                      value={paragraphSpacing}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        setParagraphSpacing(v);
                        localStorage.setItem('reader_paragraph_spacing', String(v));
                      }}
                    />
                  </div>
                  {/* Background opacity (mobile style panel) */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    <span style={{ fontSize: 12, opacity: 0.75 }}>
                      {t('reader.bgAlpha')}
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={bgAlpha}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        setBgAlpha(v);
                        localStorage.setItem('reader_bg_alpha', String(v));
                      }}
                      style={{ flex: 1, minWidth: 80 }}
                    />
                    <span style={{ fontSize: 12, opacity: 0.6, minWidth: 36, textAlign: 'right' }}>
                      {bgAlpha}%
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {THEME_CYCLE.map((tName) => (
                    <button
                      key={tName}
                      type="button"
                      onClick={() => {
                        setTheme(tName);
                        localStorage.setItem('reader_theme', tName);
                      }}
                      style={theme === tName ? btnStyle(true) : btnStyle()}
                    >
                      {t(`reader.themeCycle.${tName}`)}
                    </button>
                  ))}
                  {[
                    { key: 'system', label: t('reader.fontFamilySystem') },
                    { key: 'serif', label: t('reader.fontFamilySerif') },
                    { key: 'sans', label: t('reader.fontFamilySans') },
                  ].map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => {
                        setFontFamily(f.key);
                        localStorage.setItem('reader_font_family', f.key);
                      }}
                      style={fontFamily === f.key ? btnStyle(true) : btnStyle()}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {[
                    { key: 'left', label: t('reader.alignLeft') },
                    { key: 'justify', label: t('reader.alignJustify') },
                  ].map((a) => (
                    <button
                      key={a.key}
                      type="button"
                      onClick={() => {
                        setTextAlign(a.key);
                        localStorage.setItem('reader_text_align', a.key);
                      }}
                      style={textAlign === a.key ? btnStyle(true) : btnStyle()}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {readerPanel === 'more' && (
              <div
                style={{
                  display: 'grid',
                  gap: 12,
                  marginBottom: 12,
                }}
              >
                <span style={mobilePanelTitleStyle}>{t('reader.moreSetting')}</span>
                <div style={mobileOptionRowStyle}>
                  <span>{t('reader.keepScreenAwake')}</span>
                  <button
                    type="button"
                    onClick={() =>
                      updateStoredBool(
                        'reader_keep_screen_awake',
                        setKeepScreenAwake,
                        !keepScreenAwake
                      )
                    }
                    style={keepScreenAwake ? btnStyle(true) : btnStyle()}
                  >
                    {keepScreenAwake ? t('common.enabled') : t('common.disabled')}
                  </button>
                </div>
                <div style={mobileOptionRowStyle}>
                  <span>{t('reader.showReadProgress')}</span>
                  <button
                    type="button"
                    onClick={() =>
                      updateStoredBool(
                        'reader_show_progress',
                        setShowReadProgress,
                        !showReadProgress
                      )
                    }
                    style={showReadProgress ? btnStyle(true) : btnStyle()}
                  >
                    {showReadProgress ? t('common.enabled') : t('common.disabled')}
                  </button>
                </div>
                <div style={mobileOptionRowStyle}>
                  <span>{t('reader.textSelectable')}</span>
                  <button
                    type="button"
                    onClick={() =>
                      updateStoredBool('reader_text_selectable', setTextSelectable, !textSelectable)
                    }
                    style={textSelectable ? btnStyle(true) : btnStyle()}
                  >
                    {textSelectable ? t('common.enabled') : t('common.disabled')}
                  </button>
                </div>
                <div style={mobileOptionRowStyle}>
                  <span>{t('reader.useReplaceRules')}</span>
                  <button
                    type="button"
                    onClick={() =>
                      updateStoredBool(
                        'reader_use_replace_rules',
                        setUseReplaceRules,
                        !useReplaceRules
                      )
                    }
                    style={useReplaceRules ? btnStyle(true) : btnStyle()}
                  >
                    {useReplaceRules ? t('common.enabled') : t('common.disabled')}
                  </button>
                </div>
                <div style={mobileSettingBlockStyle}>
                  <span style={mobilePanelTitleStyle}>{t('reader.clickRegion')}</span>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {[
                      { key: 'chapter', label: t('reader.clickRegionChapter') },
                      { key: 'scroll', label: t('reader.clickRegionScroll') },
                    ].map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => {
                          setClickRegionMode(item.key);
                          localStorage.setItem('reader_click_region_mode', item.key);
                        }}
                        style={clickRegionMode === item.key ? btnStyle(true) : btnStyle()}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={mobileSettingBlockStyle}>
                  <span style={mobilePanelTitleStyle}>
                    {t('reader.autoPageInterval')} ·{' '}
                    {t('reader.secondsValue', { value: (autoPageInterval / 1000).toFixed(1) })}
                  </span>
                  <input
                    type="range"
                    min={1200}
                    max={8000}
                    step={200}
                    value={autoPageInterval}
                    onChange={(e) => {
                      const value = parseInt(e.target.value, 10);
                      setAutoPageInterval(value);
                      localStorage.setItem('reader_auto_page_interval', String(value));
                    }}
                  />
                </div>
                <div style={mobileSettingBlockStyle}>
                  <span style={mobilePanelTitleStyle}>
                    {t('reader.ttsSpeed')} {ttsRate.toFixed(1)}x
                  </span>
                  <input
                    type="range"
                    min={0.5}
                    max={2}
                    step={0.1}
                    value={ttsRate}
                    onChange={(e) => {
                      const r = parseFloat(e.target.value);
                      setTtsRate(r);
                      localStorage.setItem('reader_tts_rate', String(r));
                    }}
                  />
                </div>
              </div>
            )}

            {/* Chapter slider — ReadAny-style thin track */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '32px minmax(0, 1fr) 32px',
                gap: 10,
                alignItems: 'center',
                padding: '4px 4px 10px',
              }}
            >
              <ChapterSlider
                idx={idx}
                total={chapters.length}
                onChange={goToChapter}
                variant="mobile"
                trackBg={tStyle.border}
                thumbBorder={tStyle.bg}
              />
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                justifyItems: 'center',
                alignItems: 'center',
              }}
            >
              <button
                type="button"
                onClick={() => openReaderPanel('catalog')}
                style={mobileMenuButtonStyle(readerPanel === 'catalog')}
              >
                <span style={{ fontSize: 18 }}>☰</span>
                <span>{t('reader.catalog')}</span>
              </button>
              <button
                type="button"
                onClick={isSpeaking ? (isPaused ? resumeTTS : pauseTTS) : startTTS}
                disabled={!content}
                style={{
                  ...mobileMenuButtonStyle(isSpeaking),
                  opacity: content ? 1 : 0.45,
                }}
              >
                <span style={{ fontSize: 18 }}>{isSpeaking && !isPaused ? 'Ⅱ' : '▶'}</span>
                <span>{t('reader.readAloud')}</span>
              </button>
              <button
                type="button"
                onClick={() => openReaderPanel('style')}
                style={mobileMenuButtonStyle(readerPanel === 'style')}
              >
                <span style={{ fontSize: 18 }}>Aa</span>
                <span>{t('reader.interfaceSetting')}</span>
              </button>
              <button
                type="button"
                onClick={() => openReaderPanel('more')}
                style={mobileMenuButtonStyle(readerPanel === 'more')}
              >
                <span style={{ fontSize: 18 }}>设</span>
                <span>{t('reader.readerSetting')}</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Desktop footer bar — ReadAny-style with progress slider */
        <div
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            background: tStyle.bg,
            borderTop: `1px solid ${tStyle.border}`,
            padding: '10px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            zIndex: 50,
            boxSizing: 'border-box',
          }}
        >
          {/* Prev chapter + slider + next chapter — extracted to <ChapterSlider> */}
          <ChapterSlider
            idx={idx}
            total={chapters.length}
            onChange={goToChapter}
            variant="desktop"
            trackBg={tStyle.border}
            thumbBorder={tStyle.bg}
          />
          <TipValue
            kind={tipFooterLeft}
            chapterTitle={currentChapter?.title}
            bookName={book?.name}
            scrollPct={tipScrollPct}
            chapterProgressPct={chapterProgressPercent}
            color="#888"
          />

          {/* Footer-right tip — when the user picks `bookName` (default)
              or any other kind, the slot value renders here. We keep
              the static `idx+1 / chapters.length` text as a fallback
              when the slot is set to `none` so the user never loses
              basic chapter context. */}
          <span
            style={{
              fontSize: 11,
              color: '#888',
              fontWeight: 500,
              whiteSpace: 'nowrap',
              width: 50,
              textAlign: 'right',
            }}
          >
            {tipFooterRight === 0
              ? `${idx + 1} / ${chapters.length}`
              : null}
          </span>
          <TipValue
            kind={tipFooterRight}
            chapterTitle={currentChapter?.title}
            bookName={book?.name}
            scrollPct={tipScrollPct}
            chapterProgressPct={chapterProgressPercent}
            color="#888"
          />
          <span
            style={{
              fontSize: 11,
              color: '#888',
              fontWeight: 500,
              whiteSpace: 'nowrap',
              width: 36,
              textAlign: 'right',
            }}
          >
            {Math.round(chapterProgressPercent)}%
          </span>
        </div>
      )}

      {/* Floating bookmark FAB — mirrors the legacy Legado "+" button
          that used to live in the reader chrome. Uses the snake_case
          `book.book_url` field per the IPC contract. */}
      {book && currentChapter && (
        <BookmarkButton
          book={book}
          chapter={currentChapter}
          selectedText={selectedText}
          onAdded={() => showToast(t('reader.bookmarkAdded'))}
          onError={(msg) => showToast(t('reader.bookmarkAddFailed', { error: msg }))}
        />
      )}

      {/* Right-click context menu — rendered at the document root so
          its absolute position tracks the cursor coordinates directly. */}
      <ContextMenu
        state={contextMenu}
        onClose={() => setContextMenu(null)}
        buildActions={(kind, text) => {
          const isText = kind === 'text';
          const hasText = text.length > 0;
          type Action = {
            id: string;
            labelKey: string;
            icon?: string;
            disabled?: boolean;
            onSelect: () => void;
          };
          const items: Action[] = [];
          if (isText) {
            items.push({
              id: 'copy',
              labelKey: 'reader.contextMenu.copy',
              icon: '📋',
              onSelect: () =>
                navigator.clipboard.writeText(text).then(() => showToast(t('reader.copied'))),
            });
            items.push({
              id: 'bm',
              labelKey: 'reader.contextMenu.addBookmark',
              icon: '🔖',
              disabled: !hasText,
              onSelect: () => doAddBookmark(text),
            });
            items.push({
              id: 'rep',
              labelKey: 'reader.contextMenu.addReplace',
              icon: '🔁',
              disabled: !hasText,
              onSelect: () => navigate('/replace-rules', { state: { newPattern: text } }),
            });
            items.push({
              id: 'srch',
              labelKey: 'reader.contextMenu.searchBook',
              icon: '🔍',
              disabled: !hasText,
              onSelect: () => setSearchKeyword(text),
            });
          } else {
            items.push({
              id: 'prev',
              labelKey: 'reader.contextMenu.prevChapter',
              icon: '◀',
              disabled: !prevChapter,
              onSelect: () => prevChapter && goToChapter(prevChapter.index),
            });
            items.push({
              id: 'next',
              labelKey: 'reader.contextMenu.nextChapter',
              icon: '▶',
              disabled: !nextChapter,
              onSelect: () => nextChapter && goToNextChapter(),
            });
            items.push({ id: 'cat', labelKey: 'reader.contextMenu.openCatalog', icon: '≡', onSelect: () => setReaderPanel('catalog') });
            items.push({ id: 'theme', labelKey: 'reader.contextMenu.cycleTheme', icon: '◐', onSelect: () => cycleTheme() });
            items.push({ id: 'set', labelKey: 'reader.contextMenu.openSettings', icon: '⚙', onSelect: () => setShowSettings(true) });
            items.push({ id: 'exit', labelKey: 'reader.contextMenu.exitReader', icon: '↗', onSelect: () => navigate(readerParentPath.current) });
          }
          return items;
        }}
      />

      {showNavSettings && (
        <NavSettingsPopover
          prefs={nav.prefs}
          onChange={nav.setPrefs}
          onClose={() => setShowNavSettings(false)}
        />
      )}

      <ShortcutsHelpModal open={showShortcuts} onClose={() => setShowShortcuts(false)} />

      {/* Full-book search panel — opened by the nav-hook search shortcut
          or by the right-click "Search in Book" item. Stays open across
          chapter changes so the user can keep an eye on results while
          we navigate. */}
      {searchKeyword !== null && (
        <FullBookSearchPanel
          bookUrl={book?.book_url ?? ''}
          initialKeyword={searchKeyword}
          onJumpTo={(chapterIndex, position, length) => {
            setSearchKeyword(null);
            if (chapterIndex !== idx) {
              goToChapter(chapterIndex);
            }
            // Wait for the chapter DOM to mount before attempting to
            // flash — the navigate() above triggers a content swap.
            window.setTimeout(() => {
              flashRange(contentRef.current, position, length);
            }, 400);
          }}
          onClose={() => setSearchKeyword(null)}
        />
      )}

      {toast && (
        <div
          role="status"
          data-testid="reader-toast"
          style={{
            position: 'fixed',
            bottom: 32,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '8px 16px',
            borderRadius: 8,
            background: 'rgba(0, 0, 0, 0.75)',
            color: '#fff',
            fontSize: 14,
            zIndex: 300,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
