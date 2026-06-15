import { useTranslation } from 'react-i18next';
import { useReaderPrefs } from './useReaderPrefs';
import { btnStyle, useSettingsStyles } from './styles';

export default function SettingsReader() {
  const { t } = useTranslation();
  const { sectionStyle, sectionTitle, rowStyle, labelStyle } = useSettingsStyles();
  const {
    fontSize,
    theme,
    ttsRate,
    lineHeight,
    paragraphSpacing,
    searchConcurrency,
    updateFontSize,
    updateTheme,
    updateTtsRate,
    updateLineHeight,
    updateParagraphSpacing,
    updateSearchConcurrency,
  } = useReaderPrefs();

  return (
    <>
      <div id="appearance" style={sectionStyle}>
        <div style={sectionTitle}>{t('settings.reader')}</div>

        <div style={rowStyle}>
          <span style={labelStyle}>{t('reader.fontSize')}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => updateFontSize(-1)} style={{ ...btnStyle, padding: '4px 12px' }}>
              −
            </button>
            <span style={{ fontSize: 14, fontWeight: 600, minWidth: 28, textAlign: 'center' }}>
              {fontSize}
            </span>
            <button onClick={() => updateFontSize(1)} style={{ ...btnStyle, padding: '4px 12px' }}>
              +
            </button>
          </div>
        </div>

        <div style={rowStyle}>
          <span style={labelStyle}>{t('reader.theme')}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['light', 'dark', 'sepia'] as const).map((tName) => (
              <button
                key={tName}
                onClick={() => updateTheme(tName)}
                style={{
                  padding: '6px 14px',
                  fontSize: 13,
                  borderRadius: 8,
                  border: '1px solid',
                  borderColor: theme === tName ? '#1976d2' : '#e0e0e0',
                  background: theme === tName ? '#eef4fd' : '#fff',
                  color: theme === tName ? '#1976d2' : '#555',
                  cursor: 'pointer',
                  fontWeight: theme === tName ? 600 : 500,
                }}
              >
                {t(`reader.theme${tName.charAt(0).toUpperCase() + tName.slice(1)}`)}
              </button>
            ))}
          </div>
        </div>

        <div style={rowStyle}>
          <span style={labelStyle}>{t('reader.ttsSpeed')}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.1}
              value={ttsRate}
              onChange={(e) => updateTtsRate(parseFloat(e.target.value))}
              style={{ width: 120 }}
            />
            <span style={{ fontSize: 14, fontWeight: 600, minWidth: 36 }}>
              {ttsRate.toFixed(1)}x
            </span>
          </div>
        </div>

        <div style={rowStyle}>
          <span style={labelStyle}>{t('reader.lineHeight')}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="range"
              min={1.2}
              max={2.5}
              step={0.1}
              value={lineHeight}
              onChange={(e) => updateLineHeight(parseFloat(e.target.value))}
              style={{ width: 120 }}
            />
            <span style={{ fontSize: 14, fontWeight: 600, minWidth: 36 }}>
              {lineHeight.toFixed(1)}
            </span>
          </div>
        </div>

        <div style={rowStyle}>
          <span style={labelStyle}>{t('reader.paragraphSpacing')}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={paragraphSpacing}
              onChange={(e) => updateParagraphSpacing(parseFloat(e.target.value))}
              style={{ width: 120 }}
            />
            <span style={{ fontSize: 14, fontWeight: 600, minWidth: 36 }}>
              {paragraphSpacing.toFixed(1)}em
            </span>
          </div>
        </div>
      </div>

      <div style={sectionStyle}>
        <div style={sectionTitle}>{t('settings.search')}</div>
        <div style={rowStyle}>
          <span style={labelStyle}>{t('settings.searchConcurrency')}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="range"
              min={1}
              max={20}
              step={1}
              value={searchConcurrency}
              onChange={(e) => updateSearchConcurrency(parseInt(e.target.value, 10))}
              style={{ width: 120 }}
            />
            <span style={{ fontSize: 14, fontWeight: 600, minWidth: 28, textAlign: 'center' }}>
              {searchConcurrency}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
