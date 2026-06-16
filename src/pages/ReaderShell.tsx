import { useState, useEffect, useMemo } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import type { ApiResponse, Book } from '../types';
import {
  ReaderSettingsContext,
  type ReaderTheme,
  type PageAnim,
  type TipKind,
} from '../components/reader/ReaderSettingsContext';
import { readTipKind } from '../components/reader/TipValue';

const themeStyles: Record<ReaderTheme, { bg: string; text: string; border: string; button: string }> = {
  day: { bg: '#fff', text: '#1a1a2e', border: '#e8e8f0', button: '#f5f7fa' },
  night: { bg: '#1a1a2e', text: '#e0e0e0', border: '#333', button: '#2a2a3e' },
  eink: { bg: '#f4ecd8', text: '#5b4636', border: '#d4c5a9', button: '#e8dec0' },
};

/**
 * Shared state container for /reader/* routes (Reader, ChapterCatalog,
 * ReaderSettings). Owns all reader settings state, loads the current
 * book once, and exposes both via ReaderSettingsContext so child routes
 * can read/write settings without prop-drilling.
 */
export default function ReaderShell() {
  const { bookUrl, chapterIndex } = useParams();
  const decodedUrl = decodeURIComponent(bookUrl || '');
  const idx = Math.max(0, parseInt(chapterIndex || '0', 10) || 0);

  const [book, setBook] = useState<Book | null>(null);

  // Settings state
  const [fontSize, setFontSize] = useState(() => {
    const v = parseInt(localStorage.getItem('reader_font_size') || '18', 10);
    return Number.isFinite(v) ? Math.max(12, Math.min(32, v)) : 18;
  });
  const [fontFamily, setFontFamily] = useState(
    () => localStorage.getItem('reader_font_family') || 'system',
  );
  const [lineHeight, setLineHeight] = useState(() => {
    const v = parseFloat(localStorage.getItem('reader_line_height') || '1.8');
    return Number.isFinite(v) ? v : 1.8;
  });
  const [paragraphSpacing, setParagraphSpacing] = useState(() => {
    const v = parseFloat(localStorage.getItem('reader_paragraph_spacing') || '0.5');
    return Number.isFinite(v) ? v : 0.5;
  });
  const [theme, setTheme] = useState<ReaderTheme>(() => {
    const stored = localStorage.getItem('reader_theme');
    if (stored === 'day' || stored === 'night' || stored === 'eink') return stored;
    return 'day';
  });
  const [pageAnim, setPageAnim] = useState<PageAnim>(() => {
    const raw = localStorage.getItem('reader_page_anim');
    if (
      raw === 'cover' ||
      raw === 'slide' ||
      raw === 'simulation' ||
      raw === 'scroll' ||
      raw === 'none'
    )
      return raw;
    return 'simulation';
  });
  const updatePageAnim = (p: PageAnim) => {
    setPageAnim(p);
    localStorage.setItem('reader_page_anim', p);
  };
  const [ttsRate, setTtsRate] = useState(() => {
    const v = parseFloat(localStorage.getItem('reader_tts_rate') || '1');
    return Number.isFinite(v) ? v : 1;
  });
  const [bgAlpha, setBgAlpha] = useState(() => {
    const v = parseInt(localStorage.getItem('reader_bg_alpha') || '100', 10);
    return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 100;
  });
  const [tipHeaderLeft, setTipHeaderLeft] = useState<TipKind>(
    () => readTipKind('reader_tip_header_left', 1) as TipKind,
  );
  const [tipHeaderRight, setTipHeaderRight] = useState<TipKind>(
    () => readTipKind('reader_tip_header_right', 7) as TipKind,
  );
  const [tipFooterLeft, setTipFooterLeft] = useState<TipKind>(
    () => readTipKind('reader_tip_footer_left', 5) as TipKind,
  );
  const [tipFooterRight, setTipFooterRight] = useState<TipKind>(
    () => readTipKind('reader_tip_footer_right', 7) as TipKind,
  );

  // Load the book once for the book-name display in headers
  useEffect(() => {
    if (!decodedUrl) return;
    let cancelled = false;
    (async () => {
      const resp = await invoke<ApiResponse<Book>>('get_book', { bookUrl: decodedUrl });
      if (!cancelled && resp.success && resp.data) {
        setBook(resp.data);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [decodedUrl]);

  const baseStyle = themeStyles[theme];
  const baseBg = baseStyle.bg;
  const borderColor = baseStyle.border;
  const textColor = baseStyle.text;

  const ctxValue = useMemo(
    () => ({
      fontSize,
      setFontSize,
      fontFamily,
      setFontFamily,
      lineHeight,
      setLineHeight,
      paragraphSpacing,
      setParagraphSpacing,
      theme,
      setTheme,
      pageAnim,
      updatePageAnim,
      ttsRate,
      setTtsRate,
      bgAlpha,
      setBgAlpha,
      tipHeaderLeft,
      setTipHeaderLeft,
      tipHeaderRight,
      setTipHeaderRight,
      tipFooterLeft,
      setTipFooterLeft,
      tipFooterRight,
      setTipFooterRight,
      baseBg,
      border: borderColor,
      text: textColor,
      bookName: book?.name,
      bookUrl: decodedUrl,
      chapterIndex: idx,
      onClose: () => {},
    }),
    [
      fontSize, fontFamily, lineHeight, paragraphSpacing, theme, pageAnim,
      ttsRate, bgAlpha,
      tipHeaderLeft, tipHeaderRight, tipFooterLeft, tipFooterRight,
      baseBg, borderColor, textColor, book, decodedUrl, idx,
    ],
  );

  return (
    <ReaderSettingsContext.Provider value={ctxValue}>
      <Outlet />
    </ReaderSettingsContext.Provider>
  );
}
