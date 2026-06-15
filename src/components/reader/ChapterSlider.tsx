import { useTranslation } from 'react-i18next';

interface ChapterSliderProps {
  /** Current chapter index (0-based). */
  idx: number;
  /** Total chapter count. */
  total: number;
  /** Called when user picks a new chapter. */
  onChange: (newIdx: number) => void;
  /** True to render the compact mobile variant (round 32px buttons). */
  variant: 'mobile' | 'desktop';
  /** Theme colors — slider fill is fixed at #1976d2, but the thumb border
   * matches `tStyle.bg` and the track uses `tStyle.border`. */
  trackBg: string;
  thumbBorder: string;
}

/**
 * Chapter slider used in the mobile bottom sheet and the desktop footer.
 *
 * Both variants share the same track + range + thumb DOM. The only
 * difference is the prev/next button styling and the parent layout
 * — mobile uses round 32px buttons in a flex row, desktop uses
 * absolute-positioned buttons flanking the slider in the footer bar.
 *
 * Wraps an invisible `<input type="range">` for native drag/scrub
 * support across all platforms (Tauri WebView, Edge, Chrome).
 */
export default function ChapterSlider({
  idx,
  total,
  onChange,
  variant,
  trackBg,
  thumbBorder,
}: ChapterSliderProps) {
  const { t } = useTranslation();

  const safeMax = Math.max(0, total - 1);
  const clampedIdx = Math.min(idx, safeMax);
  const percent = total > 1 ? (clampedIdx / safeMax) * 100 : 0;
  const disabled = total <= 1;

  const isMobile = variant === 'mobile';
  const btnSize = 32;
  const trackHeight = 3;
  const thumbSize = 10;
  const btnStyle: React.CSSProperties = {
    width: btnSize,
    height: btnSize,
    borderRadius: '50%',
    border: 'none',
    background: 'transparent',
    color: trackBg, // buttons are inert (no text) so this is unused
    fontSize: 20,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.75,
    transition: 'all 0.2s',
    flexShrink: 0,
  };

  return (
    <>
      <button
        type="button"
        onClick={() => onChange(Math.max(0, idx - 1))}
        disabled={idx <= 0}
        aria-label={t('reader.prevChapter')}
        style={{
          ...btnStyle,
          color: idx > 0 ? thumbBorder : '#888',
          cursor: idx > 0 ? 'pointer' : 'not-allowed',
          opacity: idx > 0 ? 0.75 : 0.3,
        }}
      >
        {isMobile ? '‹' : '‹'}
      </button>
      <div
        style={{
          position: 'relative',
          flex: 1,
          height: 28,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            height: trackHeight,
            borderRadius: 2,
            background: trackBg,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${percent}%`,
              background: '#1976d2',
              borderRadius: 2,
              transition: 'width 0.2s',
            }}
          />
        </div>
        <input
          type="range"
          min={0}
          max={safeMax}
          step={1}
          value={clampedIdx}
          disabled={disabled}
          onChange={(e) => onChange(parseInt(e.target.value, 10))}
          aria-label={t('reader.chapterProgress', {
            current: idx + 1,
            total,
          })}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            width: '100%',
            height: '100%',
            opacity: 0,
            cursor: disabled ? 'default' : 'pointer',
            margin: 0,
          }}
        />
        <div
          style={{
            position: 'absolute',
            width: thumbSize,
            height: thumbSize,
            borderRadius: '50%',
            background: '#1976d2',
            border: `2px solid ${thumbBorder}`,
            pointerEvents: 'none',
            left: `calc(${percent}% - ${thumbSize / 2}px)`,
            transition: 'left 0.2s',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          }}
        />
      </div>
      <button
        type="button"
        onClick={() => onChange(Math.min(safeMax, idx + 1))}
        disabled={idx >= safeMax}
        aria-label={t('reader.nextChapter')}
        style={{
          ...btnStyle,
          color: idx < safeMax ? thumbBorder : '#888',
          cursor: idx < safeMax ? 'pointer' : 'not-allowed',
          opacity: idx < safeMax ? 0.75 : 0.3,
        }}
      >
        ›
      </button>
    </>
  );
}
