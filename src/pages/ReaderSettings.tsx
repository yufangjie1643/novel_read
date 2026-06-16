import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import SettingsPanel from '../components/reader/SettingsPanel';
import { useReaderSettings } from '../components/reader/ReaderSettingsContext';

export default function ReaderSettings() {
  const { bookUrl, chapterIndex } = useParams();
  const { t } = useTranslation();
  const s = useReaderSettings();
  const decodedUrl = decodeURIComponent(bookUrl || '');
  const idx = Math.max(0, parseInt(chapterIndex || '0', 10) || 0);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: s.baseBg,
        color: s.text,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Top bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 20px',
          borderBottom: `1px solid ${s.border}`,
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <Link
          to={`/reader/${encodeURIComponent(decodedUrl)}/${idx}`}
          title={t('common.back')}
          aria-label={t('common.back')}
          style={{
            padding: '6px 12px',
            minWidth: 36,
            fontSize: 16,
            textDecoration: 'none',
            textAlign: 'center',
            border: `1px solid ${s.border}`,
            borderRadius: 8,
            background: s.baseBg,
            color: s.text,
          }}
        >
          ←
        </Link>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 16,
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {t('common.settings')}
          </div>
          {s.bookName && (
            <div
              style={{
                fontSize: 12,
                opacity: 0.65,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {s.bookName}
            </div>
          )}
        </div>
      </div>

      <SettingsPanel />
    </div>
  );
}
