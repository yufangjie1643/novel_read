import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

export type LongPressOptions = {
  threshold?: number;
  onStart?: () => void;
  onCancel?: () => void;
};

export type LongPressBindings = {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerLeave: (e: ReactPointerEvent<HTMLElement>) => void;
  isPressed: boolean;
  handleClick: (click: () => void) => () => void;
};

export function useLongPress(
  callback: () => void,
  options: LongPressOptions = {}
): LongPressBindings {
  const { threshold = 400, onStart, onCancel } = options;
  const timerRef = useRef<number | null>(null);
  const triggeredRef = useRef(false);
  const [pressed, setPressed] = useState(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onPointerDown = useCallback(
    (_e: ReactPointerEvent<HTMLElement>) => {
      triggeredRef.current = false;
      clearTimer();
      setPressed(true);
      onStart?.();
      timerRef.current = window.setTimeout(() => {
        triggeredRef.current = true;
        callback();
        timerRef.current = null;
        setPressed(false);
      }, threshold);
    },
    [callback, clearTimer, onStart, threshold]
  );

  const cancel = useCallback(
    (_e: ReactPointerEvent<HTMLElement>) => {
      clearTimer();
      setPressed(false);
      onCancel?.();
    },
    [clearTimer, onCancel]
  );

  const handleClick = useCallback(
    (click: () => void) => () => {
      if (triggeredRef.current) {
        triggeredRef.current = false;
        return;
      }
      click();
    },
    []
  );

  return {
    onPointerDown,
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    isPressed: pressed,
    handleClick,
  };
}