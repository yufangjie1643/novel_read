import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useUiMode } from '../uiMode';
import { useReaderPrefs } from './settings/useReaderPrefs';
import SettingsReader from './settings/SettingsReader';
import SettingsBulkImport from './settings/SettingsBulkImport';
import SettingsBackup from './settings/SettingsBackup';
import SettingsOther from './settings/SettingsOther';

export default function Settings() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const { isMobileUi } = useUiMode();
  const shouldRenderSettingsDetails = !isMobileUi || location.hash.length > 0;
  const { fontSize } = useReaderPrefs();

  const mobileMineHeader = isMobileUi ? (
    <>
      <header className="android-profile-head">
        <img src="/mobile-media/app_icon.png" alt="" />
        <div>
          <p>Legado</p>
          <h1>{t('layout.mine', { defaultValue: '我的' })}</h1>
        </div>
      </header>

      <div className="android-stats-row">
        <div>
          <strong>{i18n.language === 'zh' ? t('layout.langZh') : t('layout.langEn')}</strong>
          <span>{t('settings.currentLanguage')}</span>
        </div>
        <div>
          <strong>{fontSize}</strong>
          <span>{t('reader.fontSize')}</span>
        </div>
        <div>
          <strong>0.1.0</strong>
          <span>{t('settings.version')}</span>
        </div>
      </div>

      <div className="android-settings-panel">
        <h2>{t('settings.title')}</h2>
        <Link to="/settings#appearance">
          <img src="/mobile-media/my_center_theme_icon.svg" alt="" />
          <span>{t('settings.mobileThemeEntry')}</span>
          <small>{t('settings.mobileThemeDesc')}</small>
        </Link>
        <Link to="/settings#webdav">
          <img src="/mobile-media/my_center_cloud_icon.svg" alt="" />
          <span>{t('settings.mobileWebdavEntry')}</span>
          <small>{t('settings.mobileWebdavDesc')}</small>
        </Link>
        <Link to="/book-sources">
          <img src="/mobile-media/my_center_book_icon.svg" alt="" />
          <span>{t('layout.bookSources')}</span>
          <small>{t('settings.mobileRulesDesc')}</small>
        </Link>
        <Link to="/config-market">
          <img src="/mobile-media/folder.svg" alt="" />
          <span>{t('layout.configMarket')}</span>
          <small>{t('settings.mobileMarketDesc')}</small>
        </Link>
      </div>
    </>
  ) : null;

  if (isMobileUi && !shouldRenderSettingsDetails) {
    return <div>{mobileMineHeader}</div>;
  }

  return (
    <div>
      {mobileMineHeader}
      {!isMobileUi && (
        <h1 style={{ margin: '0 0 20px', fontSize: 24, fontWeight: 700, color: '#1a1a2e' }}>
          {t('settings.title')}
        </h1>
      )}

      {/* Language, Tools, Reset, Bookshelf Share, About */}
      <SettingsOther />

      {/* Reader Settings */}
      <SettingsReader />

      {/* Batch Legado import */}
      <SettingsBulkImport />

      {/* WebDAV */}
      <SettingsBackup />
    </div>
  );
}
