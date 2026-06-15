import { invoke } from '@tauri-apps/api/core';
import type { ApiResponse, BookProgressSync, SyncBookProgressResult } from '../../types';

export type SyncDirection = 'upload' | 'download' | 'auto';

export interface WebDavConfig {
  url: string;
  user?: string;
  pass?: string;
}

/**
 * Read WebDAV config from localStorage. The settings UI (useWebDav hook)
 * owns the same key names so the same config is reused.
 */
export function readWebDavConfig(): WebDavConfig {
  const url = localStorage.getItem('webdav_url') || '';
  const user = localStorage.getItem('webdav_user') || '';
  // The password is held only in component state (not persisted) for
  // security; useWebDav passes it through as a parameter when needed.
  // For sync, we rely on the user having entered it in the settings
  // panel recently. The settings screen stores it in component state
  // (not localStorage). We expose a hook-friendly getter here too.
  return {
    url,
    user: user || undefined,
  };
}

export async function syncBookProgress(
  bookUrl: string,
  direction: SyncDirection = 'auto',
  webdav: WebDavConfig = readWebDavConfig(),
): Promise<SyncBookProgressResult> {
  const resp = await invoke<ApiResponse<SyncBookProgressResult>>('sync_book_progress', {
    bookUrl,
    direction,
    webdavUrl: webdav.url,
    webdavUser: webdav.user ?? null,
    webdavPass: webdav.pass ?? null,
  });
  if (!resp.success || !resp.data) {
    throw new Error(resp.error ?? 'sync_book_progress failed');
  }
  return resp.data;
}

export async function getBookSyncStatus(
  bookUrl: string,
): Promise<BookProgressSync | null> {
  const resp = await invoke<ApiResponse<BookProgressSync | null>>(
    'get_book_sync_status',
    { bookUrl },
  );
  if (!resp.success) return null;
  return resp.data ?? null;
}
