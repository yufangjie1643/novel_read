import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

export type ConfirmDialogProps = {
  isOpen: boolean;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};

const dialogStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  padding: 20,
  minWidth: 280,
  maxWidth: '90vw',
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.24)',
};

const titleStyle: React.CSSProperties = {
  margin: '0 0 12px',
  fontSize: 16,
  fontWeight: 700,
  color: '#1a1a2e',
};

const messageStyle: React.CSSProperties = {
  margin: '0 0 20px',
  fontSize: 14,
  color: '#555',
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
};

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
};

const cancelBtnStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 14,
  border: '1px solid #ddd',
  borderRadius: 8,
  background: '#fff',
  cursor: 'pointer',
  color: '#555',
  fontWeight: 500,
};

const confirmBtnBaseStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 14,
  border: 'none',
  borderRadius: 8,
  color: '#fff',
  cursor: 'pointer',
  fontWeight: 500,
};

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText,
  cancelText,
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKey);
    confirmRef.current?.focus();
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      style={backdropStyle}
    >
      <div style={dialogStyle}>
        {title && <h2 style={titleStyle}>{title}</h2>}
        <p style={messageStyle}>{message}</p>
        <div style={actionsStyle}>
          <button type="button" onClick={onCancel} style={cancelBtnStyle}>
            {cancelText ?? t('common.cancel')}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            style={{
              ...confirmBtnBaseStyle,
              background: danger ? '#f44336' : '#1976d2',
            }}
          >
            {confirmText ?? t('common.confirm')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
