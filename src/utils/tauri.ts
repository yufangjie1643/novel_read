// Detects whether the app is running inside Tauri (vs a plain browser).
// Use this to skip IPC calls that would fail in browser mode.
export function isTauri(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !==
      'undefined'
  );
}
