import { useTranslation } from 'react-i18next';
import { useReaderSettings, type PageAnim, type TipKind } from './ReaderSettingsContext';

const THEME_CYCLE = ['day', 'night', 'eink'] as const;
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

const TIP_OPTIONS = TIP_KIND_KEYS.map((k) => ({
  value: k,
  labelKey: `reader.tipKind.${TIP_KIND_I18N[k]}`,
}));

const btnStyle = (active?: boolean): React.CSSProperties => ({
  padding: '6px 14px',
  borderRadius: 8,
  border: '1px solid var(--reader-menu-border, #e8e8f0)',
  background: active ? '#1976d2' : 'var(--reader-menu-button, #f5f7fa)',
  color: active ? '#fff' : 'var(--reader-menu-text, #1a1a2e)',
  fontSize: 13,
  cursor: 'pointer',
  fontWeight: 500,
  transition: 'all 0.2s',
  whiteSpace: 'nowrap',
  maxWidth: '100%',
});

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  whiteSpace: 'nowrap',
};

/**
 * Renders the full reader settings UI. Reads/writes state from
 * `ReaderSettingsContext`. Used by:
 *   - the inline panel inside the Reader (in the fixed header)
 *   - the standalone `/reader/.../settings` page
 */
export default function SettingsPanel() {
  const { t } = useTranslation();
  const s = useReaderSettings();

  return (
    <div
      style={{
        background: s.baseBg,
        padding: '14px 20px 18px',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '12px 16px',
        alignItems: 'center',
      }}
    >
      {/* Page animation mode */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={labelStyle}>翻页：</span>
        {([
          { key: 'cover', label: t('reader.pageAnimCover') },
          { key: 'slide', label: t('reader.pageAnimSlide') },
          { key: 'simulation', label: t('reader.pageAnimSimulation') },
          { key: 'scroll', label: t('reader.pageAnimScroll') },
          { key: 'none', label: t('reader.pageAnimNone') },
        ] as { key: PageAnim; label: string }[]).map((item) => (
          <button
            key={item.key}
            onClick={() => s.updatePageAnim(item.key)}
            style={s.pageAnim === item.key ? btnStyle(true) : btnStyle()}
          >
            {item.label}
          </button>
        ))}
      </div>
      {/* Font size slider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={labelStyle}>{t('reader.fontSize')}</span>
        <input
          type="range"
          min={12}
          max={32}
          step={1}
          value={s.fontSize}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            s.setFontSize(v);
            localStorage.setItem('reader_font_size', String(v));
          }}
          style={{ verticalAlign: 'middle', width: 80, minWidth: 60 }}
        />
        <span style={{ fontSize: 13, fontWeight: 600, minWidth: 30, textAlign: 'center' }}>
          {s.fontSize}px
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={labelStyle}>{t('reader.theme')}</span>
        {THEME_CYCLE.map((tName) => (
          <button
            key={tName}
            onClick={() => {
              s.setTheme(tName);
              localStorage.setItem('reader_theme', tName);
            }}
            style={s.theme === tName ? btnStyle(true) : btnStyle()}
          >
            {t(`reader.themeCycle.${tName}`)}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={labelStyle}>{t('reader.ttsSpeed')}</span>
        <input
          type="range"
          min="0.5"
          max="2"
          step="0.1"
          value={s.ttsRate}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            s.setTtsRate(v);
            localStorage.setItem('reader_tts_rate', String(v));
          }}
          style={{ verticalAlign: 'middle', width: 60, minWidth: 50 }}
        />
        <span style={{ fontSize: 13, fontWeight: 600, minWidth: 32 }}>{s.ttsRate}x</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={labelStyle}>{t('reader.lineHeight')}</span>
        <input
          type="range"
          min={1.2}
          max={2.5}
          step={0.1}
          value={s.lineHeight}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            s.setLineHeight(v);
            localStorage.setItem('reader_line_height', String(v));
          }}
          style={{ verticalAlign: 'middle', width: 60, minWidth: 50 }}
        />
        <span style={{ fontSize: 13, fontWeight: 600, minWidth: 32 }}>
          {s.lineHeight.toFixed(1)}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={labelStyle}>{t('reader.paragraphSpacing')}</span>
        <input
          type="range"
          min={0}
          max={2}
          step={0.1}
          value={s.paragraphSpacing}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            s.setParagraphSpacing(v);
            localStorage.setItem('reader_paragraph_spacing', String(v));
          }}
          style={{ verticalAlign: 'middle', width: 60, minWidth: 50 }}
        />
        <span style={{ fontSize: 13, fontWeight: 600, minWidth: 32 }}>
          {s.paragraphSpacing.toFixed(1)}em
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={labelStyle}>{t('reader.fontFamily')}</span>
        {([
          { key: 'system', label: t('reader.fontFamilySystem') },
          { key: 'serif', label: t('reader.fontFamilySerif') },
          { key: 'sans', label: t('reader.fontFamilySans') },
        ]).map((f) => (
          <button
            key={f.key}
            onClick={() => {
              s.setFontFamily(f.key);
              localStorage.setItem('reader_font_family', f.key);
            }}
            style={s.fontFamily === f.key ? btnStyle(true) : btnStyle()}
          >
            {f.label}
          </button>
        ))}
      </div>
      {/* Header / Footer tip slots */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', gridColumn: '1 / -1' }}>
        <span style={labelStyle}>{t('reader.tipHeaderLeft')}</span>
        <select
          value={s.tipHeaderLeft}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10) as TipKind;
            s.setTipHeaderLeft(v);
            localStorage.setItem('reader_tip_header_left', String(v));
          }}
          style={{ padding: '4px 8px', borderRadius: 4, border: `1px solid ${s.border}` }}
        >
          {TIP_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {t(o.labelKey)}
            </option>
          ))}
        </select>
        <select
          value={s.tipHeaderRight}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10) as TipKind;
            s.setTipHeaderRight(v);
            localStorage.setItem('reader_tip_header_right', String(v));
          }}
          style={{ padding: '4px 8px', borderRadius: 4, border: `1px solid ${s.border}` }}
        >
          {TIP_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {t(o.labelKey)}
            </option>
          ))}
        </select>
        <span style={labelStyle}>{t('reader.tipFooterLeft')}</span>
        <select
          value={s.tipFooterLeft}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10) as TipKind;
            s.setTipFooterLeft(v);
            localStorage.setItem('reader_tip_footer_left', String(v));
          }}
          style={{ padding: '4px 8px', borderRadius: 4, border: `1px solid ${s.border}` }}
        >
          {TIP_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {t(o.labelKey)}
            </option>
          ))}
        </select>
        <select
          value={s.tipFooterRight}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10) as TipKind;
            s.setTipFooterRight(v);
            localStorage.setItem('reader_tip_footer_right', String(v));
          }}
          style={{ padding: '4px 8px', borderRadius: 4, border: `1px solid ${s.border}` }}
        >
          {TIP_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {t(o.labelKey)}
            </option>
          ))}
        </select>
      </div>
      {/* Background opacity */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={labelStyle}>{t('reader.bgAlpha')}</span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={s.bgAlpha}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            s.setBgAlpha(v);
            localStorage.setItem('reader_bg_alpha', String(v));
          }}
          style={{ verticalAlign: 'middle', width: 100, minWidth: 80 }}
        />
        <span style={{ fontSize: 13, fontWeight: 600, minWidth: 32 }}>{s.bgAlpha}</span>
      </div>
    </div>
  );
}
