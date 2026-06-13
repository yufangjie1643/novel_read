import { useTranslation } from 'react-i18next';
import { useWebDav } from './useWebDav';
import { useSettingsStyles } from './styles';

export default function SettingsBackup() {
  const { t } = useTranslation();
  const { sectionStyle, sectionTitle } = useSettingsStyles();
  const {
    davUrl, setDavUrl, davUser, setDavUser, davPass, setDavPass,
    davMessage, davLoading,
    testWebDav, backupToWebDav, restoreFromWebDav,
  } = useWebDav();

  return (
    <div id="webdav" style={sectionStyle}>
      <div style={sectionTitle}>{t('settings.webdav')}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
        <input
          type="text"
          placeholder={t('settings.davUrlPlaceholder')}
          value={davUrl}
          onChange={(e) => setDavUrl(e.target.value)}
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid #e0e0e0',
            fontSize: 14,
            outline: 'none',
            fontFamily: 'inherit',
          }}
        />
        <div style={{ display: 'flex', gap: 10 }}>
          <input
            type="text"
            placeholder={t('settings.davUserPlaceholder')}
            value={davUser}
            onChange={(e) => setDavUser(e.target.value)}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid #e0e0e0',
              fontSize: 14,
              outline: 'none',
              fontFamily: 'inherit',
            }}
          />
          <input
            type="password"
            placeholder={t('settings.davPassPlaceholder')}
            value={davPass}
            onChange={(e) => setDavPass(e.target.value)}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid #e0e0e0',
              fontSize: 14,
              outline: 'none',
              fontFamily: 'inherit',
            }}
          />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <button
          onClick={testWebDav}
          disabled={davLoading}
          style={{
            padding: '6px 14px',
            fontSize: 13,
            border: '1px solid #bbdefb',
            borderRadius: 8,
            background: davLoading ? '#f5f5f5' : '#eef4fd',
            color: davLoading ? '#999' : '#1976d2',
            cursor: davLoading ? 'not-allowed' : 'pointer',
            fontWeight: 500,
          }}
        >
          {t('settings.davTest')}
        </button>
        <button
          onClick={backupToWebDav}
          disabled={davLoading}
          style={{
            padding: '6px 14px',
            fontSize: 13,
            border: '1px solid #a5d6a7',
            borderRadius: 8,
            background: davLoading ? '#f5f5f5' : '#e8f5e9',
            color: davLoading ? '#999' : '#2e7d32',
            cursor: davLoading ? 'not-allowed' : 'pointer',
            fontWeight: 500,
          }}
        >
          {t('settings.davBackup')}
        </button>
        <button
          onClick={restoreFromWebDav}
          disabled={davLoading}
          style={{
            padding: '6px 14px',
            fontSize: 13,
            border: '1px solid #ffcdd2',
            borderRadius: 8,
            background: davLoading ? '#f5f5f5' : '#fff0f0',
            color: davLoading ? '#999' : '#f44336',
            cursor: davLoading ? 'not-allowed' : 'pointer',
            fontWeight: 500,
          }}
        >
          {t('settings.davRestore')}
        </button>
      </div>
      {davMessage.text && (
        <div
          style={{
            background: davMessage.kind === 'error' ? '#ffebee' : '#e3f2fd',
            color: davMessage.kind === 'error' ? '#c62828' : '#1565c0',
            padding: '8px 12px',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          {davMessage.text}
        </div>
      )}
    </div>
  );
}
