import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  getForcedUiMode,
  getInitialUiMode,
  normalizeUiMode,
  UI_MODE_STORAGE_KEY,
  UiModeContext,
} from './uiMode';
import type { UiMode, UiModeContextValue } from './uiMode';

export default function UiModeProvider({ children }: { children: ReactNode }) {
  const forcedMode = getForcedUiMode();
  const [uiMode, setUiModeState] = useState<UiMode>(() => forcedMode || getInitialUiMode());

  useEffect(() => {
    if (forcedMode) {
      setUiModeState(forcedMode);
    }
  }, [forcedMode]);

  useEffect(() => {
    document.documentElement.dataset.uiMode = uiMode;
  }, [uiMode]);

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (!forcedMode && event.key === UI_MODE_STORAGE_KEY) {
        setUiModeState(normalizeUiMode(event.newValue));
      }
    }
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [forcedMode]);

  const value = useMemo<UiModeContextValue>(
    () => ({
      uiMode,
      isMobileUi: uiMode === 'mobile',
      isUiModeForced: forcedMode !== null,
      setUiMode: (mode) => {
        localStorage.setItem(UI_MODE_STORAGE_KEY, mode);
        if (!forcedMode) {
          setUiModeState(mode);
        }
      },
    }),
    [forcedMode, uiMode]
  );

  return <UiModeContext.Provider value={value}>{children}</UiModeContext.Provider>;
}
