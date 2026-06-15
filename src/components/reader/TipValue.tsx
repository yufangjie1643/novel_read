import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/// The 12 tip kinds we render in the header/footer slots. Numbers must
/// stay stable — they're persisted to localStorage as integers and
/// must match the fork's `ReadTipConfig.kt` enum.
export type TipKind =
  | 0   // none
  | 1   // chapterTitle
  | 2   // time
  | 3   // battery
  | 4   // page
  | 5   // totalProgress
  | 6   // pageAndTotal
  | 7   // bookName
  | 8   // timeBattery
  | 9   // timeBatteryPercentage
  | 10  // batteryPercentage
  | 11; // totalProgress1

const TIP_KIND_KEYS: TipKind[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

const TIP_KIND_I18N: Record<TipKind, string> = {
  0: 'none',
  1: 'chapterTitle',
  2: 'time',
  3: 'battery',
  4: 'page',
  5: 'totalProgress',
  6: 'pageAndTotal',
  7: 'bookName',
  8: 'timeBattery',
  9: 'timeBatteryPercentage',
  10: 'batteryPercentage',
  11: 'totalProgress1',
};

export function tipKindLabel(kind: TipKind, t: (key: string) => string): string {
  return t(`reader.tipKind.${TIP_KIND_I18N[kind]}`);
}

/// Parse a localStorage value into a TipKind. Falls back to the
/// supplied default on missing/invalid.
export function readTipKind(key: string, fallback: TipKind): TipKind {
  const raw = parseInt(localStorage.getItem(key) ?? '', 10);
  if (TIP_KIND_KEYS.includes(raw as TipKind)) return raw as TipKind;
  return fallback;
}

interface TipValueProps {
  kind: TipKind;
  /// Optional pre-resolved values to display — when the host already
  /// has them (chapterTitle, bookName, scrollPct, etc.) it can avoid
  /// re-deriving them in TipValue.
  chapterTitle?: string;
  bookName?: string;
  /// 0-100 scroll percentage — used by `page` and `pageAndTotal`.
  scrollPct?: number;
  /// 0-100 chapter progress — used by `totalProgress` and
  /// `totalProgress1` (the second variant could later be book-level).
  chapterProgressPct?: number;
  /// Theme colors for readability on bgAlpha'd surfaces.
  color: string;
}

/**
 * Render a single tip slot. Picks the right renderer based on `kind`
 * and returns null for `none`. Live-time values (time, battery) are
 * read from `useEffect` hooks; the host only needs to provide the
 * pre-resolved data.
 */
export default function TipValue({
  kind,
  chapterTitle,
  bookName,
  scrollPct,
  chapterProgressPct,
  color,
}: TipValueProps) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => new Date());
  const [battery, setBattery] = useState<{ level: number; charging: boolean } | null>(null);

  // Tick the clock every 30s — enough to refresh "HH:mm" without
  // burning the battery on a per-second re-render.
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // Battery API is optional — fall back to a static icon if missing.
  useEffect(() => {
    type BatteryInfo = {
      level: number;
      charging: boolean;
      addEventListener: (type: string, cb: () => void) => void;
      removeEventListener: (type: string, cb: () => void) => void;
    };
    type NavWithBattery = Navigator & {
      getBattery?: () => Promise<BatteryInfo>;
    };
    const nav = navigator as NavWithBattery;
    if (!nav.getBattery) return;
    let mounted = true;
    let batteryObj: BatteryInfo | null = null;
    const refresh = () => {
      if (batteryObj && mounted) {
        setBattery({ level: batteryObj.level, charging: batteryObj.charging });
      }
    };
    nav.getBattery().then((b) => {
      if (!mounted) return;
      batteryObj = b;
      refresh();
      b.addEventListener('levelchange', refresh);
      b.addEventListener('chargingchange', refresh);
    });
    return () => {
      mounted = false;
      if (batteryObj) {
        batteryObj.removeEventListener('levelchange', refresh);
        batteryObj.removeEventListener('chargingchange', refresh);
      }
    };
  }, []);

  if (kind === 0) return null;
  const fmtTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const fmtPct = (n: number) => `${Math.round(n)}%`;
  const batteryIcon = '🔋';

  let content: string;
  switch (kind) {
    case 1:
      content = chapterTitle ?? '';
      break;
    case 2:
      content = fmtTime;
      break;
    case 3:
      content = batteryIcon;
      break;
    case 4:
      content = typeof scrollPct === 'number' ? fmtPct(scrollPct) : '—';
      break;
    case 5:
      content = typeof chapterProgressPct === 'number' ? fmtPct(chapterProgressPct) : '—';
      break;
    case 6:
      content =
        typeof scrollPct === 'number'
          ? `${fmtPct(scrollPct)} / 100%`
          : '— / —';
      break;
    case 7:
      content = bookName ?? '';
      break;
    case 8:
      content = battery ? `${fmtTime} ${batteryIcon}` : fmtTime;
      break;
    case 9:
      content = battery ? `${fmtTime} ${fmtPct(battery.level * 100)}` : fmtTime;
      break;
    case 10:
      content = battery ? `${batteryIcon} ${fmtPct(battery.level * 100)}` : batteryIcon;
      break;
    case 11:
      // Same value as totalProgress for v1 — the fork distinguishes
      // by display style (progress bar vs text). We can layer that
      // on later if needed.
      content = typeof chapterProgressPct === 'number' ? fmtPct(chapterProgressPct) : '—';
      break;
    default:
      content = '';
  }

  return (
    <span
      title={tipKindLabel(kind, t)}
      style={{
        color,
        fontSize: 12,
        fontWeight: 500,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        maxWidth: 200,
      }}
    >
      {content}
    </span>
  );
}
