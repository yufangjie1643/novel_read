import { useTranslation } from 'react-i18next';


const THEME_CYCLE = ['day', 'night', 'eink'] as const;
type Theme = (typeof THEME_CYCLE)[number];
type PageAnim = 'cover' | 'slide' | 'simulation' | 'scroll' | 'none';
type TipKind = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

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

export type SettingsPanelProps = {
  open: boolean;
  isMobileUi: boolean;
  baseBg: string;
  border: string;
  text: string;
  fontSize: number;
  setFontSize: (n: number) => void;
  fontFamily: string;
  setFontFamily: (f: string) => void;
  lineHeight: number;
  setLineHeight: (n: number) => void;
  paragraphSpacing: number;
  setParagraphSpacing: (n: number) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
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
  onClose: () => void;
};

const btnStyle = (active?: boolean, isMobileUi?: boolean): React.CSSProperties => ({
  padding: isMobileUi ? '7px 10px' : '6px 14px',
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

export default function SettingsPanel(props: SettingsPanelProps) {
  const { t } = useTranslation();
  if (!props.open) return null;
  if (props.isMobileUi) return null;

  return (
    <div
      style={{
        background: props.baseBg,
        borderBottom: `1px solid ${props.border}`,
        padding: '10px 20px',
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
            onClick={() => props.updatePageAnim(item.key)}
            style={props.pageAnim === item.key ? btnStyle(true) : btnStyle()}
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
          value={props.fontSize}
          onChange={(e) => {
            const s = parseInt(e.target.value, 10);
            props.setFontSize(s);
            localStorage.setItem('reader_font_size', String(s));
          }}
          style={{ verticalAlign: 'middle', width: 80, minWidth: 60 }}
        />
        <span style={{ fontSize: 13, fontWeight: 600, minWidth: 30, textAlign: 'center' }}>
          {props.fontSize}px
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={labelStyle}>{t('reader.theme')}</span>
        {THEME_CYCLE.map((tName) => (
          <button
            key={tName}
            onClick={() => {
              props.setTheme(tName);
              localStorage.setItem('reader_theme', tName);
            }}
            style={props.theme === tName ? btnStyle(true) : btnStyle()}
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
          value={props.ttsRate}
          onChange={(e) => {
            const r = parseFloat(e.target.value);
            props.setTtsRate(r);
            localStorage.setItem('reader_tts_rate', String(r));
          }}
          style={{ verticalAlign: 'middle', width: 60, minWidth: 50 }}
        />
        <span style={{ fontSize: 13, fontWeight: 600, minWidth: 32 }}>{props.ttsRate}x</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={labelStyle}>{t('reader.lineHeight')}</span>
        <input
          type="range"
          min={1.2}
          max={2.5}
          step={0.1}
          value={props.lineHeight}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            props.setLineHeight(v);
            localStorage.setItem('reader_line_height', String(v));
          }}
          style={{ verticalAlign: 'middle', width: 60, minWidth: 50 }}
        />
        <span style={{ fontSize: 13, fontWeight: 600, minWidth: 32 }}>
          {props.lineHeight.toFixed(1)}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={labelStyle}>{t('reader.paragraphSpacing')}</span>
        <input
          type="range"
          min={0}
          max={2}
          step={0.1}
          value={props.paragraphSpacing}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            props.setParagraphSpacing(v);
            localStorage.setItem('reader_paragraph_spacing', String(v));
          }}
          style={{ verticalAlign: 'middle', width: 60, minWidth: 50 }}
        />
        <span style={{ fontSize: 13, fontWeight: 600, minWidth: 32 }}>
          {props.paragraphSpacing.toFixed(1)}em
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
              props.setFontFamily(f.key);
              localStorage.setItem('reader_font_family', f.key);
            }}
            style={props.fontFamily === f.key ? btnStyle(true) : btnStyle()}
          >
            {f.label}
          </button>
        ))}
      </div>
      {/* Header / Footer tip slots */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', gridColumn: '1 / -1' }}>
        <span style={labelStyle}>{t('reader.tipHeaderLeft')}</span>
        <select
          value={props.tipHeaderLeft}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10) as TipKind;
            props.setTipHeaderLeft(v);
            localStorage.setItem('reader_tip_header_left', String(v));
          }}
          style={{ padding: '4px 8px', borderRadius: 4, border: `1px solid ${props.border}` }}
        >
          {TIP_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {t(o.labelKey)}
            </option>
          ))}
        </select>
        <select
          value={props.tipHeaderRight}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10) as TipKind;
            props.setTipHeaderRight(v);
            localStorage.setItem('reader_tip_header_right', String(v));
          }}
          style={{ padding: '4px 8px', borderRadius: 4, border: `1px solid ${props.border}` }}
        >
          {TIP_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {t(o.labelKey)}
            </option>
          ))}
        </select>
        <span style={labelStyle}>{t('reader.tipFooterLeft')}</span>
        <select
          value={props.tipFooterLeft}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10) as TipKind;
            props.setTipFooterLeft(v);
            localStorage.setItem('reader_tip_footer_left', String(v));
          }}
          style={{ padding: '4px 8px', borderRadius: 4, border: `1px solid ${props.border}` }}
        >
          {TIP_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {t(o.labelKey)}
            </option>
          ))}
        </select>
        <select
          value={props.tipFooterRight}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10) as TipKind;
            props.setTipFooterRight(v);
            localStorage.setItem('reader_tip_footer_right', String(v));
          }}
          style={{ padding: '4px 8px', borderRadius: 4, border: `1px solid ${props.border}` }}
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
          value={props.bgAlpha}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            props.setBgAlpha(v);
            localStorage.setItem('reader_bg_alpha', String(v));
          }}
          style={{ verticalAlign: 'middle', width: 100, minWidth: 80 }}
        />
        <span style={{ fontSize: 13, fontWeight: 600, minWidth: 32 }}>{props.bgAlpha}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <button type="button" onClick={props.onClose} style={btnStyle()}>
          {t('common.close', { defaultValue: 'Close' })}
        </button>
      </div>
    </div>
  );
}
