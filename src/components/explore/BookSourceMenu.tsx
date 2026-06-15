import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

export type BookSourceAction = 'edit' | 'top' | 'login' | 'searchThis' | 'refresh' | 'delete';

const MENU_WIDTH = 180;

export function BookSourceMenu({
  group,
  anchorEl,
  onClose,
  onAction,
}: {
  group: { hasLoginUrl: boolean };
  anchorEl: HTMLElement | null;
  onClose: () => void;
  onAction: (action: BookSourceAction) => void;
}) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!anchorEl) return;
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [anchorEl, onClose]);

  if (!anchorEl) return null;

  const rect = anchorEl.getBoundingClientRect();
  const top = Math.min(rect.bottom + 4, window.innerHeight - 200);
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - MENU_WIDTH - 8));

  const items: { key: BookSourceAction; label: string; show: boolean }[] = [
    { key: 'edit', label: t('explore.menu.edit'), show: true },
    { key: 'top', label: t('explore.menu.top'), show: true },
    { key: 'login', label: t('explore.menu.login'), show: group.hasLoginUrl },
    { key: 'searchThis', label: t('explore.menu.searchThis'), show: true },
    { key: 'refresh', label: t('explore.menu.refresh'), show: true },
    { key: 'delete', label: t('explore.menu.delete'), show: true },
  ];

  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      style={{
        position: 'fixed',
        top,
        left,
        zIndex: 1000,
        background: '#fff',
        border: '1px solid #e0e0e0',
        borderRadius: 8,
        boxShadow: '0 6px 20px rgba(0,0,0,0.12)',
        padding: 4,
        minWidth: 180,
      }}
    >
      {items
        .filter((item) => item.show)
        .map((item) => (
          <button
            key={item.key}
            role="menuitem"
            type="button"
            onClick={() => {
              onAction(item.key);
              onClose();
            }}
            style={{
              display: 'block',
              width: '100%',
              padding: '8px 14px',
              border: 'none',
              background: 'transparent',
              textAlign: 'left',
              fontSize: 14,
              color: item.key === 'delete' ? '#f44336' : '#333',
              cursor: 'pointer',
              borderRadius: 6,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = item.key === 'delete' ? '#fff0f0' : '#f5f7fa';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            {item.label}
          </button>
        ))}
    </div>,
    document.body
  );
}
