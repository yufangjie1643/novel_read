import { useTranslation } from 'react-i18next';
import { DEFAULT_NAV_PREFS, type ReaderNavPrefs, writeNavPrefs } from './navPrefs';
import styles from './NavSettingsPopover.module.css';

export type NavSettingsPopoverProps = {
  prefs: ReaderNavPrefs;
  onChange: (next: ReaderNavPrefs) => void;
  onClose: () => void;
};

export default function NavSettingsPopover({ prefs, onChange, onClose }: NavSettingsPopoverProps) {
  const { t } = useTranslation();

  const update = (patch: Partial<ReaderNavPrefs>) => {
    const next = { ...prefs, ...patch };
    writeNavPrefs(next);
    onChange(next);
  };

  const reset = () => {
    writeNavPrefs(DEFAULT_NAV_PREFS);
    onChange(DEFAULT_NAV_PREFS);
  };

  return (
    <div
      className={styles.popover}
      role="dialog"
      aria-label={t('reader.nav.stickyToolbar')}
      data-testid="nav-settings-popover"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className={styles.title}>{t('reader.nav.stickyToolbar')}</div>
      <div className={styles.row}>
        <label htmlFor="pref-sticky">{t('reader.nav.stickyToolbar')}</label>
        <input
          id="pref-sticky"
          type="checkbox"
          checked={prefs.stickyToolbar}
          onChange={(e) => update({ stickyToolbar: e.target.checked })}
        />
      </div>
      <div className={styles.row}>
        <label htmlFor="pref-auto">{t('reader.nav.autoLoadNext')}</label>
        <input
          id="pref-auto"
          type="checkbox"
          checked={prefs.autoLoadNext}
          onChange={(e) => update({ autoLoadNext: e.target.checked })}
        />
      </div>
      <div className={styles.row}>
        <label htmlFor="pref-fab">{t('reader.nav.floatingButtons')}</label>
        <input
          id="pref-fab"
          type="checkbox"
          checked={prefs.showFloatingButtons}
          onChange={(e) => update({ showFloatingButtons: e.target.checked })}
        />
      </div>
      <div className={styles.row}>
        <label htmlFor="pref-kb">{t('reader.nav.keyboardShortcuts')}</label>
        <input
          id="pref-kb"
          type="checkbox"
          checked={prefs.keyboardShortcuts}
          onChange={(e) => update({ keyboardShortcuts: e.target.checked })}
        />
      </div>
      <div className={styles.row}>
        <button type="button" onClick={reset}>{t('common.reset', { defaultValue: 'Reset' })}</button>
        <button type="button" onClick={onClose}>{t('common.close', { defaultValue: 'Close' })}</button>
      </div>
    </div>
  );
}
