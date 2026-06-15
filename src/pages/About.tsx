import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useUiMode } from '../uiMode';

export default function About() {
  const { t } = useTranslation();
  const { isMobileUi } = useUiMode();

  return (
    <div className={isMobileUi ? 'android-rule-page' : 'rule-settings-page'}>
      {isMobileUi ? (
        <header className="android-title-bar">
          <Link to="/settings">‹</Link>
          <h1>{t('settings.about')}</h1>
          <span />
        </header>
      ) : (
        <h1 className="rule-settings-title">{t('settings.about')}</h1>
      )}

      <section className="about-page-card">
        <img src="/mobile-media/app_icon.png" alt="" />
        <h2>Legado Desktop</h2>
        <p>{t('settings.aboutDesc')}</p>
        <dl>
          <div>
            <dt>{t('settings.version')}</dt>
            <dd>0.1.0</dd>
          </div>
          <div>
            <dt>{t('about.stack')}</dt>
            <dd>Tauri + React + Rust</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
