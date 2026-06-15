export type ReaderNavPrefs = {
  stickyToolbar: boolean;
  autoLoadNext: boolean;
  showFloatingButtons: boolean;
  keyboardShortcuts: boolean;
};

export const DEFAULT_NAV_PREFS: ReaderNavPrefs = {
  stickyToolbar: true,
  autoLoadNext: true,
  showFloatingButtons: true,
  keyboardShortcuts: true,
};

const STORAGE_KEY = 'reader_nav_prefs';

export function readNavPrefs(): ReaderNavPrefs {
  if (typeof localStorage === 'undefined') return DEFAULT_NAV_PREFS;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_NAV_PREFS;
  try {
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_NAV_PREFS, ...parsed };
  } catch {
    return DEFAULT_NAV_PREFS;
  }
}

export function writeNavPrefs(prefs: ReaderNavPrefs): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}
