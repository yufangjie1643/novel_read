import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import type { ApiResponse, Book, BookChapter, BookSource, ReplaceRule } from '../types';
import { useUiMode } from '../uiMode';

const themeStyles: Record<string, { bg: string; text: string; border: string; button: string }> = {
  light: { bg: '#fff', text: '#1a1a2e', border: '#e8e8f0', button: '#f5f7fa' },
  dark: { bg: '#1a1a2e', text: '#e0e0e0', border: '#333', button: '#2a2a3e' },
  sepia: { bg: '#f4ecd8', text: '#5b4636', border: '#d4c5a9', button: '#e8dec0' },
};

type ReaderPanel = 'style' | 'more' | 'search' | null;
type WakeLockSentinelLike = { release: () => Promise<void> | void };
type NavigatorWithWakeLock = Navigator & {
  wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
};

export default function Reader() {
  const { t } = useTranslation();
  const { bookUrl, chapterIndex } = useParams();
  const navigate = useNavigate();
  const { isMobileUi } = useUiMode();
  const decodedUrl = decodeURIComponent(bookUrl || '');
  const idx = Math.max(0, parseInt(chapterIndex || '0', 10) || 0);
  const contentRef = useRef<HTMLDivElement>(null);

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
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('reader_theme') || 'light';
  });
  const [lineHeight, setLineHeight] = useState(() => {
    return parseFloat(localStorage.getItem('reader_line_height') || '1.8');
  });
  const [paragraphSpacing, setParagraphSpacing] = useState(() => {
    return parseFloat(localStorage.getItem('reader_paragraph_spacing') || '0.5');
  });
  const [showSettings, setShowSettings] = useState(false);
  const [readerPanel, setReaderPanel] = useState<ReaderPanel>(null);
  const [pageAnim, setPageAnim] = useState(() => {
    return localStorage.getItem('reader_page_anim') || 'scroll';
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

  const [fontFamily, setFontFamily] = useState(() => {
    return localStorage.getItem('reader_font_family') || 'system';
  });
  const [textAlign, setTextAlign] = useState(() => {
    return localStorage.getItem('reader_text_align') || 'justify';
  });
  const [contentWidth, setContentWidth] = useState(() => {
    return parseInt(localStorage.getItem('reader_content_width') || '760', 10);
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
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const readTimeRef = useRef(0);
  const readTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bookRef = useRef<Book | null>(null);
  const isSpeakingRef = useRef(isSpeaking);
  const isPausedRef = useRef(isPaused);
  const prevChapterRef = useRef(prevChapter);
  const nextChapterRef = useRef(nextChapter);
  const loadSeqRef = useRef(0);

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
        wakeLock = await (navigator as NavigatorWithWakeLock).wakeLock?.request('screen') ?? null;
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
    let currentIndex = 0;
    function speakNext() {
      if (currentIndex >= chunks.length) {
        setIsSpeaking(false);
        setIsPaused(false);
        return;
      }
      const utterance = new SpeechSynthesisUtterance(chunks[currentIndex]);
      utterance.rate = ttsRate;
      utterance.lang = 'zh-CN';
      utterance.onend = () => {
        currentIndex++;
        speakNext();
      };
      utterance.onerror = () => {
        setIsSpeaking(false);
        setIsPaused(false);
      };
      utteranceRef.current = utterance;
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
    try {
      await invoke('update_book', { book: updatedBook });
      setBook(updatedBook);
      bookRef.current = updatedBook;
    } catch (e) {
      console.error('Failed to save progress:', e);
    }
  }

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
          setMessage(t('reader.loadContentFailed', { error: resp.error || '' }));
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
      results.push({ key: `${lineIndex}-${matchIndex}`, text: `${prefix}${line.slice(start, end)}${suffix}` });
    });
    return results.slice(0, 24);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readerSearchQuery, content, replaceRules, useReplaceRules, book?.book_url]);

  function goToChapter(index: number) {
    navigate(`/reader/${encodeURIComponent(decodedUrl)}/${index}`);
    window.scrollTo(0, 0);
  }

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
    const finder = window as Window & { find?: (text: string) => boolean };
    finder.find?.(query);
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
        case 'Escape':
          navigate(`/book/${encodeURIComponent(decodedUrl)}`);
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
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // All mutable state is accessed via refs to avoid re-attaching the listener on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tStyle = themeStyles[theme] || themeStyles.light;

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

  function updatePageAnim(mode: string) {
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
    boxShadow: theme === 'dark' ? '0 4px 14px rgba(0,0,0,0.35)' : '0 4px 14px rgba(0,0,0,0.08)',
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
      {/* Fixed header: toolbar + settings with immersive hide/show */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          background: tStyle.bg,
          transform: headerVisible ? 'translateY(0)' : 'translateY(-100%)',
          transition: 'transform 0.25s ease',
          boxShadow: headerVisible ? `0 2px 8px ${theme === 'dark' ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.06)'}` : 'none',
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
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0, flexShrink: 0 }}>
            <button
              onClick={() => navigate(`/book/${encodeURIComponent(decodedUrl)}`)}
              style={btnStyle()}
            >
              {t('reader.chapters')}
            </button>
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
            {isSpeaking ? (
              <>
                {isPaused ? (
                  <button onClick={resumeTTS} style={btnStyle()}>
                    {t('common.resume')}
                  </button>
                ) : (
                  <button onClick={pauseTTS} style={btnStyle()}>
                    {t('common.pause')}
                  </button>
                )}
                <button
                  onClick={stopTTS}
                  style={{
                    ...btnStyle(),
                    color: '#f44336',
                    borderColor: '#ffcdd2',
                  }}
                >
                  {t('common.stop')}
                </button>
              </>
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

        {/* Settings panel */}
        {showSettings && !isMobileUi && (
          <div
            style={{
              borderBottom: `1px solid ${tStyle.border}`,
              padding: isMobileUi ? '10px 12px' : '10px 20px',
              display: 'grid',
              gridTemplateColumns: isMobileUi ? '1fr 1fr' : 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: isMobileUi ? '10px 12px' : '12px 16px',
              alignItems: 'center',
            }}
          >
            {/* Page animation mode */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap' }}>翻页：</span>
              {[
                { key: 'scroll', label: t('reader.pageAnimScroll') },
                { key: 'slide', label: t('reader.pageAnimSlide') },
                { key: 'none', label: t('reader.pageAnimNone') },
              ].map((item) => (
                <button
                  key={item.key}
                  onClick={() => updatePageAnim(item.key)}
                  style={pageAnim === item.key ? btnStyle(true) : btnStyle()}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {/* Font size slider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap' }}>{t('reader.fontSize')}</span>
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
                style={{ verticalAlign: 'middle', width: 80 }}
              />
              <span style={{ fontSize: 13, fontWeight: 600, minWidth: 30, textAlign: 'center' }}>
                {fontSize}px
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap' }}>{t('reader.theme')}</span>
              {['light', 'dark', 'sepia'].map((tName) => (
                <button
                  key={tName}
                  onClick={() => {
                    setTheme(tName);
                    localStorage.setItem('reader_theme', tName);
                  }}
                  style={theme === tName ? btnStyle(true) : btnStyle()}
                >
                  {t(`reader.theme${tName.charAt(0).toUpperCase() + tName.slice(1)}`)}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap' }}>{t('reader.ttsSpeed')}</span>
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.1"
                value={ttsRate}
                onChange={(e) => {
                  const r = parseFloat(e.target.value);
                  setTtsRate(r);
                  localStorage.setItem('reader_tts_rate', String(r));
                }}
                style={{ verticalAlign: 'middle', width: 60 }}
              />
              <span style={{ fontSize: 13, fontWeight: 600, minWidth: 32 }}>{ttsRate}x</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap' }}>{t('reader.lineHeight')}</span>
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
                style={{ verticalAlign: 'middle', width: 60 }}
              />
              <span style={{ fontSize: 13, fontWeight: 600, minWidth: 32 }}>
                {lineHeight.toFixed(1)}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap' }}>{t('reader.paragraphSpacing')}</span>
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
                style={{ verticalAlign: 'middle', width: 60 }}
              />
              <span style={{ fontSize: 13, fontWeight: 600, minWidth: 32 }}>
                {paragraphSpacing.toFixed(1)}em
              </span>
            </div>
            {/* Font family */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap' }}>{t('reader.fontFamily')}</span>
              {[
                { key: 'system', label: t('reader.fontFamilySystem') },
                { key: 'serif', label: t('reader.fontFamilySerif') },
                { key: 'sans', label: t('reader.fontFamilySans') },
              ].map((f) => (
                <button
                  key={f.key}
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
            {/* Text align */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap' }}>{t('reader.textAlign')}</span>
              {[
                { key: 'left', label: t('reader.alignLeft') },
                { key: 'justify', label: t('reader.alignJustify') },
              ].map((a) => (
                <button
                  key={a.key}
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
            {/* Content width (desktop only) */}
            {!isMobileUi && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap' }}>{t('reader.contentWidth')}</span>
                <input
                  type="range"
                  min={480}
                  max={1200}
                  step={40}
                  value={contentWidth}
                  onChange={(e) => {
                    const w = parseInt(e.target.value, 10);
                    setContentWidth(w);
                    localStorage.setItem('reader_content_width', String(w));
                  }}
                  style={{ verticalAlign: 'middle', width: 80 }}
                />
                <span style={{ fontSize: 13, fontWeight: 600, minWidth: 40 }}>{contentWidth}px</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Progress bar */}
      {!loading && !message && showReadProgress && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            zIndex: 55,
            background: 'transparent',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${chapterProgressPercent}%`,
              background: '#1976d2',
              transition: 'width 0.3s ease',
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

      {/* Content */}
      <div
        ref={contentRef}
        className="reader-content"
        onClick={(e) => {
          if (!isMobileUi && !loading && !message) {
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
            dangerouslySetInnerHTML={{
              __html: sanitizeHtml(applyReplaceRules(content)).replace(/\n/g, '<br/>'),
            }}
          />
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
              padding: '0 calc(18px + var(--legado-safe-right)) 10px calc(18px + var(--legado-safe-left))',
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
              aria-label={useReplaceRules ? t('reader.replaceRulesOn') : t('reader.replaceRulesOff')}
              title={useReplaceRules ? t('reader.replaceRulesOn') : t('reader.replaceRulesOff')}
            >
              ≋
            </button>
            <button
              type="button"
              onClick={() => {
                const nextTheme = theme === 'dark' ? 'light' : 'dark';
                setTheme(nextTheme);
                localStorage.setItem('reader_theme', nextTheme);
              }}
              style={mobileRoundButtonStyle(theme === 'dark')}
              aria-label={theme === 'dark' ? t('reader.dayTheme') : t('reader.nightTheme')}
              title={theme === 'dark' ? t('reader.dayTheme') : t('reader.nightTheme')}
            >
              {theme === 'dark' ? '日' : '夜'}
            </button>
          </div>

          {/* Bottom sheet with rounded top corners */}
          <div
            style={{
              background: tStyle.bg,
              borderTop: `1px solid ${tStyle.border}`,
              borderRadius: '16px 16px 0 0',
              boxShadow: theme === 'dark'
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
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8 }}>
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
                    <span style={{ fontSize: 12, opacity: 0.72 }}>
                      {readerSearchResults.length
                        ? t('reader.searchMatches', { count: readerSearchResults.length })
                        : t('reader.noSearchMatches')}
                    </span>
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
                    { key: 'scroll', label: t('reader.pageAnimScroll') },
                    { key: 'none', label: t('reader.pageAnimNone') },
                  ].map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => updatePageAnim(item.key)}
                      style={pageAnim === item.key ? btnStyle(true) : btnStyle()}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <div style={mobileSettingBlockStyle}>
                  <span style={{ fontSize: 12, opacity: 0.75 }}>{t('reader.fontSize')}</span>
                  <div style={{ display: 'grid', gridTemplateColumns: '44px 1fr 44px', gap: 8, alignItems: 'center' }}>
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
                    <span style={{ fontSize: 12, opacity: 0.75 }}>{t('reader.paragraphSpacing')}</span>
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
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {['light', 'dark', 'sepia'].map((tName) => (
                    <button
                      key={tName}
                      type="button"
                      onClick={() => {
                        setTheme(tName);
                        localStorage.setItem('reader_theme', tName);
                      }}
                      style={theme === tName ? btnStyle(true) : btnStyle()}
                    >
                      {t(`reader.theme${tName.charAt(0).toUpperCase() + tName.slice(1)}`)}
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
                    onClick={() => updateStoredBool('reader_keep_screen_awake', setKeepScreenAwake, !keepScreenAwake)}
                    style={keepScreenAwake ? btnStyle(true) : btnStyle()}
                  >
                    {keepScreenAwake ? t('common.enabled') : t('common.disabled')}
                  </button>
                </div>
                <div style={mobileOptionRowStyle}>
                  <span>{t('reader.showReadProgress')}</span>
                  <button
                    type="button"
                    onClick={() => updateStoredBool('reader_show_progress', setShowReadProgress, !showReadProgress)}
                    style={showReadProgress ? btnStyle(true) : btnStyle()}
                  >
                    {showReadProgress ? t('common.enabled') : t('common.disabled')}
                  </button>
                </div>
                <div style={mobileOptionRowStyle}>
                  <span>{t('reader.textSelectable')}</span>
                  <button
                    type="button"
                    onClick={() => updateStoredBool('reader_text_selectable', setTextSelectable, !textSelectable)}
                    style={textSelectable ? btnStyle(true) : btnStyle()}
                  >
                    {textSelectable ? t('common.enabled') : t('common.disabled')}
                  </button>
                </div>
                <div style={mobileOptionRowStyle}>
                  <span>{t('reader.useReplaceRules')}</span>
                  <button
                    type="button"
                    onClick={() => updateStoredBool('reader_use_replace_rules', setUseReplaceRules, !useReplaceRules)}
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
                    {t('reader.autoPageInterval')} · {t('reader.secondsValue', { value: (autoPageInterval / 1000).toFixed(1) })}
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
                  <span style={mobilePanelTitleStyle}>{t('reader.ttsSpeed')} {ttsRate.toFixed(1)}x</span>
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
              <button
                type="button"
                onClick={() => prevChapter && goToChapter(prevChapter.index)}
                disabled={!prevChapter}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  border: 'none',
                  background: 'transparent',
                  color: prevChapter ? tStyle.text : '#888',
                  cursor: prevChapter ? 'pointer' : 'not-allowed',
                  fontSize: 20,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: prevChapter ? 0.75 : 0.3,
                  transition: 'all 0.2s',
                }}
              >
                ‹
              </button>
              <div style={{ position: 'relative', height: 28, display: 'flex', alignItems: 'center' }}>
                <div style={{ position: 'absolute', left: 0, right: 0, height: 3, borderRadius: 2, background: tStyle.border, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${chapterProgressPercent}%`, background: '#1976d2', borderRadius: 2, transition: 'width 0.2s' }} />
                </div>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, chapters.length - 1)}
                  step={1}
                  value={Math.min(idx, Math.max(0, chapters.length - 1))}
                  disabled={chapters.length <= 1}
                  onChange={(e) => goToChapter(parseInt(e.target.value, 10))}
                  aria-label={t('reader.chapterProgress', { current: idx + 1, total: chapters.length })}
                  style={{ position: 'absolute', left: 0, right: 0, width: '100%', height: '100%', opacity: 0, cursor: chapters.length > 1 ? 'pointer' : 'default', margin: 0 }}
                />
                <div style={{ position: 'absolute', width: 10, height: 10, borderRadius: '50%', background: '#1976d2', border: `2px solid ${tStyle.bg}`, pointerEvents: 'none', left: `calc(${chapterProgressPercent}% - 5px)`, transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
              </div>
              <button
                type="button"
                onClick={() => nextChapter && goToChapter(nextChapter.index)}
                disabled={!nextChapter}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  border: 'none',
                  background: 'transparent',
                  color: nextChapter ? tStyle.text : '#888',
                  cursor: nextChapter ? 'pointer' : 'not-allowed',
                  fontSize: 20,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: nextChapter ? 0.75 : 0.3,
                  transition: 'all 0.2s',
                }}
              >
                ›
              </button>
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
                onClick={() => navigate(`/book/${encodeURIComponent(decodedUrl)}`)}
                style={mobileMenuButtonStyle()}
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
          {/* Prev chapter — circular icon button */}
          <button
            onClick={() => prevChapter && goToChapter(prevChapter.index)}
            disabled={!prevChapter}
            title={t('reader.prevChapter')}
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              border: 'none',
              background: 'transparent',
              color: prevChapter ? tStyle.text : '#888',
              cursor: prevChapter ? 'pointer' : 'not-allowed',
              fontSize: 18,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              opacity: prevChapter ? 0.8 : 0.35,
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => { if (prevChapter) { e.currentTarget.style.background = tStyle.border; e.currentTarget.style.opacity = '1'; }}}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.opacity = prevChapter ? '0.8' : '0.35'; }}
          >
            ‹
          </button>

          {/* Progress slider */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <span style={{ fontSize: 11, color: '#888', fontWeight: 500, whiteSpace: 'nowrap', width: 36, textAlign: 'right' }}>
              {Math.round(chapterProgressPercent)}%
            </span>
            <div style={{ flex: 1, position: 'relative', height: 28, display: 'flex', alignItems: 'center' }}>
              {/* Track background */}
              <div style={{ position: 'absolute', left: 0, right: 0, height: 3, borderRadius: 2, background: tStyle.border, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${chapterProgressPercent}%`, background: '#1976d2', borderRadius: 2, transition: 'width 0.2s' }} />
              </div>
              {/* Thumb indicator */}
              <div style={{ position: 'absolute', width: 10, height: 10, borderRadius: '50%', background: '#1976d2', border: `2px solid ${tStyle.bg}`, pointerEvents: 'none', left: `calc(${chapterProgressPercent}% - 5px)`, transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
              {/* Invisible range input for interaction */}
              <input
                type="range"
                min={0}
                max={Math.max(0, chapters.length - 1)}
                step={1}
                value={Math.min(idx, Math.max(0, chapters.length - 1))}
                disabled={chapters.length <= 1}
                onChange={(e) => goToChapter(parseInt(e.target.value, 10))}
                aria-label={t('reader.chapterProgress', { current: idx + 1, total: chapters.length })}
                style={{ position: 'absolute', left: 0, right: 0, width: '100%', height: '100%', opacity: 0, cursor: chapters.length > 1 ? 'pointer' : 'default', margin: 0 }}
              />
            </div>
            <span style={{ fontSize: 11, color: '#888', fontWeight: 500, whiteSpace: 'nowrap', width: 50 }}>
              {idx + 1} / {chapters.length}
            </span>
          </div>

          {/* Next chapter — circular icon button */}
          <button
            onClick={() => nextChapter && goToChapter(nextChapter.index)}
            disabled={!nextChapter}
            title={t('reader.nextChapter')}
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              border: 'none',
              background: 'transparent',
              color: nextChapter ? tStyle.text : '#888',
              cursor: nextChapter ? 'pointer' : 'not-allowed',
              fontSize: 18,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              opacity: nextChapter ? 0.8 : 0.35,
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => { if (nextChapter) { e.currentTarget.style.background = tStyle.border; e.currentTarget.style.opacity = '1'; }}}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.opacity = nextChapter ? '0.8' : '0.35'; }}
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}
