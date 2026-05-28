import { createContext, useContext } from 'react';

export type UiMode = 'desktop' | 'mobile';

export interface UiModeContextValue {
  uiMode: UiMode;
  isMobileUi: boolean;
  isUiModeForced: boolean;
  setUiMode: (mode: UiMode) => void;
}

export const UI_MODE_STORAGE_KEY = 'app_ui_mode';
export const UiModeContext = createContext<UiModeContextValue | null>(null);

export const viteEnv =
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env || {};

export function normalizeUiMode(value: string | null | undefined): UiMode {
  return value === 'mobile' ? 'mobile' : 'desktop';
}

export function getForcedUiMode(): UiMode | null {
  const force = viteEnv.VITE_APP_UI_MODE_FORCE;
  if (force === '1' || force === 'true') {
    return normalizeUiMode(viteEnv.VITE_APP_UI_MODE);
  }
  return null;
}

function isMobilePlatform() {
  return typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function getRuntimeDefaultUiMode(): UiMode {
  if (isMobilePlatform()) {
    return 'mobile';
  }

  if (typeof window !== 'undefined') {
    const narrowSide = Math.min(window.innerWidth, window.innerHeight);
    if (narrowSide <= 768 && window.matchMedia?.('(pointer: coarse)').matches) {
      return 'mobile';
    }
  }

  return 'desktop';
}

export function getInitialUiMode(): UiMode {
  const forced = getForcedUiMode();
  if (forced) return forced;
  if (isMobilePlatform()) return 'mobile';
  const saved = localStorage.getItem(UI_MODE_STORAGE_KEY);
  if (saved) return normalizeUiMode(saved);
  if (viteEnv.VITE_APP_UI_MODE) return normalizeUiMode(viteEnv.VITE_APP_UI_MODE);
  return getRuntimeDefaultUiMode();
}

export function useUiMode() {
  const value = useContext(UiModeContext);
  if (!value) {
    throw new Error('useUiMode must be used inside UiModeProvider');
  }
  return value;
}
