import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

export type PromptDialogProps = {
  isOpen: boolean;
  title?: string;
  message?: string;
  initialValue?: string;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
  onSubmit: (value: string) => void;
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
  margin: '0 0 12px',
  fontSize: 14,
  color: '#555',
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  fontSize: 14,
  border: '1px solid #e0e0e0',
  borderRadius: 8,
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
  marginBottom: 20,
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

export function PromptDialog({
  isOpen,
  title,
  message,
  initialValue = '',
  placeholder,
  confirmText,
  cancelText,
  onSubmit,
  onCancel,
}: PromptDialogProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setValue(initialValue);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen, initialValue]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const trimmed = value.trim();
  const canSubmit = trimmed.length > 0;

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
        {message && <p style={messageStyle}>{message}</p>}
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSubmit) {
              e.preventDefault();
              onSubmit(trimmed);
            }
          }}
          style={inputStyle}
        />
        <div style={actionsStyle}>
          <button type="button" onClick={onCancel} style={cancelBtnStyle}>
            {cancelText ?? t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => canSubmit && onSubmit(trimmed)}
            disabled={!canSubmit}
            style={{
              ...confirmBtnBaseStyle,
              background: '#1976d2',
              opacity: canSubmit ? 1 : 0.5,
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