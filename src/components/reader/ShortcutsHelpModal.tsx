import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './ShortcutsHelpModal.module.css';

const SHORTCUT_KEYS = [
  'prevNext',
  'pageUpDown',
  'firstLast',
  'scrollDown',
  'scrollUp',
  'find',
  'findNext',
  'bookmark',
  'bookmarkList',
  'close',
  'fullscreen',
  'toggleToolbar',
  'help',
] as const;

export type ShortcutsHelpModalProps = {
  open: boolean;
  onClose: () => void;
};

export default function ShortcutsHelpModal({ open, onClose }: ShortcutsHelpModalProps) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label={t('reader.shortcuts.title')}
      data-testid="shortcuts-help-modal"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.dialog}>
        <div className={styles.title}>{t('reader.shortcuts.title')}</div>
        <ul className={styles.list}>
          {SHORTCUT_KEYS.map((k) => (
            <li key={k}>
              <span className={styles.kbd}>{t(`reader.shortcuts.${k}`)}</span>
            </li>
          ))}
        </ul>
        <div className={styles.close}>
          <button type="button" onClick={onClose}>
            {t('common.close', { defaultValue: 'Close' })}
          </button>
        </div>
      </div>
    </div>
  );
}
