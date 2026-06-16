import { createContext, useContext } from 'react';

export type ReaderTheme = 'day' | 'night' | 'eink';
export type PageAnim = 'cover' | 'slide' | 'simulation' | 'scroll' | 'none';
export type TipKind = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

export type ReaderSettings = {
  fontSize: number;
  setFontSize: (n: number) => void;
  fontFamily: string;
  setFontFamily: (f: string) => void;
  lineHeight: number;
  setLineHeight: (n: number) => void;
  paragraphSpacing: number;
  setParagraphSpacing: (n: number) => void;
  theme: ReaderTheme;
  setTheme: (t: ReaderTheme) => void;
  pageAnim: PageAnim;
  updatePageAnim: (p: PageAnim) => void;
  ttsRate: number;
  setTtsRate: (n: number) => void;
  bgAlpha: number;
  setBgAlpha: (n: number) => void;
  tipHeaderLeft: TipKind;
  setTipHeaderLeft: (k: TipKind) => void;
  tipHeaderRight: TipKind;
  setTipHeaderRight: (k: TipKind) => void;
  tipFooterLeft: TipKind;
  setTipFooterLeft: (k: TipKind) => void;
  tipFooterRight: TipKind;
  setTipFooterRight: (k: TipKind) => void;
  baseBg: string;
  border: string;
  text: string;
  bookName: string | undefined;
  bookUrl: string;
  chapterIndex: number;
  onClose: () => void;
};

export const ReaderSettingsContext = createContext<ReaderSettings | null>(null);

export function useReaderSettings(): ReaderSettings {
  const ctx = useContext(ReaderSettingsContext);
  if (!ctx) {
    throw new Error('useReaderSettings must be used within ReaderSettingsContext.Provider');
  }
  return ctx;
}
