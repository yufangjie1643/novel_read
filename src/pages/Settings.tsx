import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useUiMode } from '../uiMode';
import { useReaderPrefs } from './settings/useReaderPrefs';
import SettingsReader from './settings/SettingsReader';
import SettingsBackup from './settings/SettingsBackup';
import SettingsBulkImport from './settings/SettingsBulkImport';
import SettingsOther from './settings/SettingsOther';
import SettingsHome from './settings/SettingsHome';
import SettingsSidebar from './settings/SettingsSidebar';

const HASH_REDIRECTS: Record<string, string> = {
  appearance: 'reader',
  webdav: 'backup',
};

export default function Settings() {
  const { t } = useTranslation();
  const { isMobileUi } = useUiMode();
  const location = useLocation();
  const { fontSize } = useReaderPrefs();

  const hash = location.hash.replace(/^#/, '');
  if (hash && HASH_REDIRECTS[hash]) {
    return <Navigate to={HASH_REDIRECTS[hash]} replace />;
  }

  if (isMobileUi) {
    return (
      <Routes>
        <Route path="" element={<SettingsHome fontSize={fontSize} />} />
        <Route path="reader" element={<SettingsReader />} />
        <Route path="backup" element={<SettingsBackup />} />
        <Route path="bulk-import" element={<SettingsBulkImport />} />
        <Route path="other" element={<SettingsOther />} />
        <Route path="*" element={<Navigate to="" replace />} />
      </Routes>
    );
  }

  return (
    <div>
      <h1 style={{ margin: '0 0 20px', fontSize: 24, fontWeight: 700, color: '#1a1a2e' }}>
        {t('settings.title')}
      </h1>
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
        <SettingsSidebar />
        <main style={{ flex: 1, minWidth: 0 }}>
          <Routes>
            <Route path="" element={<Navigate to="reader" replace />} />
            <Route path="reader" element={<SettingsReader />} />
            <Route path="backup" element={<SettingsBackup />} />
            <Route path="bulk-import" element={<SettingsBulkImport />} />
            <Route path="server" element={<SettingsOther mode="server" />} />
            <Route path="other" element={<SettingsOther mode="other" />} />
            <Route path="*" element={<Navigate to="reader" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}