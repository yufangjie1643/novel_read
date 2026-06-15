import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './ContextMenu.module.css';

export type ContextMenuKind = 'text' | 'page';

export type ContextMenuState = {
  x: number;
  y: number;
  kind: ContextMenuKind;
  selectedText?: string;
};

type Action = {
  id: string;
  labelKey: string;
  icon?: string;
  disabled?: boolean;
  onSelect: () => void;
};

const MENU_WIDTH = 200;
const MENU_HEIGHT_ESTIMATE = 280;

function adjustPosition(x: number, y: number): { x: number; y: number } {
  const ww = window.innerWidth;
  const wh = window.innerHeight;
  return {
    x: x + MENU_WIDTH > ww ? ww - MENU_WIDTH - 8 : x,
    y: y + MENU_HEIGHT_ESTIMATE > wh ? wh - MENU_HEIGHT_ESTIMATE - 8 : y,
  };
}

export type ContextMenuProps = {
  state: ContextMenuState | null;
  onClose: () => void;
  buildActions: (kind: ContextMenuKind, selectedText: string) => Action[];
};

export default function ContextMenu({ state, onClose, buildActions }: ContextMenuProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [focusIndex, setFocusIndex] = useState(0);

  useEffect(() => {
    if (!state) {
      setFocusIndex(0);
      return;
    }
    const handler = (e: MouseEvent | WheelEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      const actions = buildActions(state.kind, state.selectedText ?? '');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusIndex((i) => Math.min(actions.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusIndex((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const a = actions[focusIndex];
        if (a && !a.disabled) {
          a.onSelect();
          onClose();
        }
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('wheel', handler, { passive: true });
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('wheel', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [state, focusIndex, onClose, buildActions]);

  if (!state) return null;
  const { x, y } = adjustPosition(state.x, state.y);
  const actions = buildActions(state.kind, state.selectedText ?? '');

  return (
    <div
      ref={ref}
      className={styles.menu}
      role="menu"
      style={{ left: x, top: y }}
      data-testid="reader-context-menu"
    >
      {actions.map((a, i) => (
        <div
          key={a.id}
          role="menuitem"
          aria-selected={i === focusIndex}
          aria-disabled={a.disabled}
          tabIndex={-1}
          className={styles.item}
          onMouseEnter={() => setFocusIndex(i)}
          onClick={() => {
            if (a.disabled) return;
            a.onSelect();
            onClose();
          }}
        >
          {a.icon && <span className={styles.icon}>{a.icon}</span>}
          <span>{t(a.labelKey)}</span>
        </div>
      ))}
    </div>
  );
}
