import { useCallback, useEffect, useRef, useState } from 'react';
import { readNavPrefs, writeNavPrefs, type ReaderNavPrefs } from '../components/reader/navPrefs';

export type UseReaderNavOptions = {
  contentRef: React.RefObject<HTMLElement>;
  hasPrevChapter: boolean;
  hasNextChapter: boolean;
  onPrevChapter: () => void;
  onNextChapter: () => void;
  onFirstChapter: () => void;
  onLastChapter: () => void;
  onOpenSearch: () => void;
  onAddBookmark: () => void;
  onOpenBookmarkList: () => void;
  onToggleToolbar: () => void;
  onShowShortcuts: () => void;
  onFullscreen: () => void;
  onClose: () => void;
};

const SCROLL_FRACTION = 0.85;
const WHEEL_THRESHOLD_PX = 50;
const WHEEL_COOLDOWN_MS = 500;

export function useReaderNav(opts: UseReaderNavOptions) {
  const [prefs, setPrefs] = useState<ReaderNavPrefs>(() => readNavPrefs());
  const [toolbarVisible, setToolbarVisible] = useState(true);
  const lastWheelTimeRef = useRef(0);
  const scrollAccumRef = useRef(0);
  const accumulator = useRef(0);
  // Scaffolding for future iterations — kept per spec.
  void WHEEL_THRESHOLD_PX;
  void scrollAccumRef;
  void accumulator;

  const updatePrefs = useCallback((next: ReaderNavPrefs) => {
    setPrefs(next);
    writeNavPrefs(next);
  }, []);

  useEffect(() => {
    if (!prefs.keyboardShortcuts) return;

    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          opts.onPrevChapter();
          break;
        case 'ArrowRight':
          e.preventDefault();
          opts.onNextChapter();
          break;
        case 'PageUp':
          e.preventDefault();
          opts.onPrevChapter();
          break;
        case 'PageDown':
          e.preventDefault();
          opts.onNextChapter();
          break;
        case 'Home':
          e.preventDefault();
          opts.onFirstChapter();
          break;
        case 'End':
          e.preventDefault();
          opts.onLastChapter();
          break;
        case ' ':
          e.preventDefault();
          if (e.shiftKey) {
            window.scrollBy({ top: -window.innerHeight * SCROLL_FRACTION, behavior: 'smooth' });
          } else {
            window.scrollBy({ top: window.innerHeight * SCROLL_FRACTION, behavior: 'smooth' });
          }
          break;
        case 'F3':
          e.preventDefault();
          opts.onOpenSearch();
          break;
        case 'F11':
          e.preventDefault();
          opts.onFullscreen();
          break;
        case '?':
          e.preventDefault();
          opts.onShowShortcuts();
          break;
        case 'Escape':
          opts.onClose();
          break;
        case 'b':
        case 'B':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            opts.onToggleToolbar();
          }
          break;
        case 'd':
        case 'D':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            if (e.shiftKey) {
              opts.onOpenBookmarkList();
            } else {
              opts.onAddBookmark();
            }
          }
          break;
        case 'f':
        case 'F':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            opts.onOpenSearch();
          }
          break;
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [prefs.keyboardShortcuts, opts]);

  // 工具栏显隐：滚 100px 切换
  useEffect(() => {
    if (!prefs.stickyToolbar) {
      setToolbarVisible(true);
      return;
    }
    let lastY = window.scrollY;
    let timer: number | null = null;
    const onScroll = () => {
      const y = window.scrollY;
      const delta = y - lastY;
      if (Math.abs(delta) > 100) {
        setToolbarVisible(delta < 0);
        lastY = y;
      }
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => setToolbarVisible(true), 3000);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (timer) window.clearTimeout(timer);
    };
  }, [prefs.stickyToolbar]);

  // 滚到底/顶 + 反向滚 → 翻章
  useEffect(() => {
    if (!prefs.keyboardShortcuts) return;
    const onWheel = (e: WheelEvent) => {
      const now = Date.now();
      if (now - lastWheelTimeRef.current < WHEEL_COOLDOWN_MS) return;
      const docEl = document.documentElement;
      const atTop = window.scrollY <= 30;
      const atBottom = window.scrollY + window.innerHeight >= docEl.scrollHeight - 30;
      if (atTop && e.deltaY < 0) {
        if (opts.hasPrevChapter) {
          e.preventDefault();
          lastWheelTimeRef.current = now;
          opts.onPrevChapter();
        }
      } else if (atBottom && e.deltaY > 0) {
        if (opts.hasNextChapter) {
          e.preventDefault();
          lastWheelTimeRef.current = now;
          opts.onNextChapter();
        }
      }
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, [prefs.keyboardShortcuts, opts.hasPrevChapter, opts.hasNextChapter, opts.onPrevChapter, opts.onNextChapter]);

  // 鼠标移到顶部 16px → 显示工具栏
  useEffect(() => {
    if (!prefs.stickyToolbar) return;
    const onMove = (e: MouseEvent) => {
      if (e.clientY <= 16) setToolbarVisible(true);
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMove);
  }, [prefs.stickyToolbar]);

  return {
    prefs,
    setPrefs: updatePrefs,
    toolbarVisible,
    setToolbarVisible,
  };
}
