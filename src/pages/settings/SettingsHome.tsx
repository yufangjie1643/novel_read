import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

interface Props {
  fontSize: number;
}

export default function SettingsHome({ fontSize }: Props) {
  const { t, i18n } = useTranslation();

  return (
    <div>
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

      <div className="android-settings-panel">
        <h2>{t('settings.settingsNav')}</h2>
        <Link to="/settings/reader">
          <span>{t('settings.catTheme')}</span>
        </Link>
        <Link to="/settings/backup">
          <span>{t('settings.catBackup')}</span>
        </Link>
        <Link to="/settings/bulk-import">
          <span>{t('settings.catBulkImport')}</span>
        </Link>
        <Link to="/settings/other">
          <span>{t('settings.catOther')}</span>
        </Link>
      </div>
    </div>
  );
}