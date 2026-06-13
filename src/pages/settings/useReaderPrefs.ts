import { useState, useCallback, useEffect } from 'react';

const DEFAULTS = {
  fontSize: 18,
  theme: 'light',
  ttsRate: 1,
  lineHeight: 1.8,
  paragraphSpacing: 0.5,
  searchConcurrency: 5,
};

const KEY_MAP = {
  fontSize: 'reader_font_size',
  theme: 'reader_theme',
  ttsRate: 'reader_tts_rate',
  lineHeight: 'reader_line_height',
  paragraphSpacing: 'reader_paragraph_spacing',
  searchConcurrency: 'search_concurrency',
} as const;

export function useReaderPrefs() {
  const [fontSize, setFontSize] = useState(DEFAULTS.fontSize);
  const [theme, setTheme] = useState(DEFAULTS.theme);
  const [ttsRate, setTtsRate] = useState(DEFAULTS.ttsRate);
  const [lineHeight, setLineHeight] = useState(DEFAULTS.lineHeight);
  const [paragraphSpacing, setParagraphSpacing] = useState(DEFAULTS.paragraphSpacing);
  const [searchConcurrency, setSearchConcurrency] = useState(DEFAULTS.searchConcurrency);

  useEffect(() => {
    setFontSize(Number(localStorage.getItem(KEY_MAP.fontSize)) || DEFAULTS.fontSize);
    setTheme(localStorage.getItem(KEY_MAP.theme) || DEFAULTS.theme);
    setTtsRate(Number(localStorage.getItem(KEY_MAP.ttsRate)) || DEFAULTS.ttsRate);
    setLineHeight(Number(localStorage.getItem(KEY_MAP.lineHeight)) || DEFAULTS.lineHeight);
    setParagraphSpacing(
      Number(localStorage.getItem(KEY_MAP.paragraphSpacing)) || DEFAULTS.paragraphSpacing,
    );
    setSearchConcurrency(
      Number(localStorage.getItem(KEY_MAP.searchConcurrency)) || DEFAULTS.searchConcurrency,
    );
  }, []);

  const updateFontSize = useCallback((delta: number) => {
    setFontSize((prev) => {
      const next = Math.max(12, Math.min(36, prev + delta));
      localStorage.setItem(KEY_MAP.fontSize, String(next));
      return next;
    });
  }, []);

  const updateTheme = useCallback((name: string) => {
    setTheme(name);
    localStorage.setItem(KEY_MAP.theme, name);
  }, []);

  const updateTtsRate = useCallback((v: number) => {
    setTtsRate(v);
    localStorage.setItem(KEY_MAP.ttsRate, String(v));
  }, []);

  const updateLineHeight = useCallback((v: number) => {
    setLineHeight(v);
    localStorage.setItem(KEY_MAP.lineHeight, String(v));
  }, []);

  const updateParagraphSpacing = useCallback((v: number) => {
    setParagraphSpacing(v);
    localStorage.setItem(KEY_MAP.paragraphSpacing, String(v));
  }, []);

  const updateSearchConcurrency = useCallback((v: number) => {
    setSearchConcurrency(v);
    localStorage.setItem(KEY_MAP.searchConcurrency, String(v));
  }, []);

  const reset = useCallback(() => {
    Object.values(KEY_MAP).forEach((k) => localStorage.removeItem(k));
    setFontSize(DEFAULTS.fontSize);
    setTheme(DEFAULTS.theme);
    setTtsRate(DEFAULTS.ttsRate);
    setLineHeight(DEFAULTS.lineHeight);
    setParagraphSpacing(DEFAULTS.paragraphSpacing);
    setSearchConcurrency(DEFAULTS.searchConcurrency);
  }, []);

  return {
    fontSize, theme, ttsRate, lineHeight, paragraphSpacing, searchConcurrency,
    updateFontSize, updateTheme, updateTtsRate, updateLineHeight,
    updateParagraphSpacing, updateSearchConcurrency, reset,
  };
}
