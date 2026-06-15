import { invoke } from '@tauri-apps/api/core';
import type { ApiResponse, Bookmark } from '../../types';

export type AddBookmarkInput = Omit<Bookmark, 'id'> & { id?: never };

export async function addBookmark(bookmark: AddBookmarkInput): Promise<number> {
  const resp = await invoke<ApiResponse<number>>('add_bookmark', { bookmark });
  if (!resp.success || resp.data === undefined || resp.data === null) {
    throw new Error(resp.error ?? 'add_bookmark failed');
  }
  return resp.data;
}

export async function getBookmarks(bookUrl: string): Promise<Bookmark[]> {
  const resp = await invoke<ApiResponse<Bookmark[]>>('get_bookmarks', { bookUrl });
  if (!resp.success || !resp.data) return [];
  return resp.data;
}

export async function deleteBookmark(id: number): Promise<void> {
  const resp = await invoke<ApiResponse<unknown>>('delete_bookmark', { id });
  if (!resp.success) {
    throw new Error(resp.error ?? 'delete_bookmark failed');
  }
}
