import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import type { ApiResponse } from '../../types';

const KEY_MAP = {
  url: 'webdav_url',
  user: 'webdav_user',
} as const;

export function useWebDav() {
  const { t } = useTranslation();
  const [davUrl, setDavUrl] = useState('');
  const [davUser, setDavUser] = useState('');
  const [davPass, setDavPass] = useState('');
  const [davMessage, setDavMessage] = useState<{ text: string; kind: 'idle' | 'error' | 'info' }>({
    text: '',
    kind: 'idle',
  });
  const [davLoading, setDavLoading] = useState(false);

  useEffect(() => {
    setDavUrl(localStorage.getItem(KEY_MAP.url) || '');
    setDavUser(localStorage.getItem(KEY_MAP.user) || '');
  }, []);

  const testWebDav = useCallback(async () => {
    if (davLoading) return;
    if (!davUrl.trim()) {
      setDavMessage({ text: t('settings.davUrlRequired'), kind: 'error' });
      return;
    }
    setDavLoading(true);
    setDavMessage({ text: t('settings.davTesting'), kind: 'info' });
    try {
      const resp = await invoke<ApiResponse<null>>('test_webdav_connection', {
        url: davUrl.trim(),
        username: davUser.trim() || null,
        password: davPass.trim() || null,
      });
      if (resp.success) {
        setDavMessage({ text: t('settings.davTestSuccess'), kind: 'info' });
        localStorage.setItem(KEY_MAP.url, davUrl.trim());
        localStorage.setItem(KEY_MAP.user, davUser.trim());
      } else {
        setDavMessage({
          text: t('settings.davTestFailed', { error: resp.error || '' }),
          kind: 'error',
        });
      }
    } catch (e) {
      setDavMessage({ text: t('common.error', { message: String(e) }), kind: 'error' });
    } finally {
      setDavLoading(false);
    }
  }, [davUrl, davUser, davPass, davLoading, t]);

  const backupToWebDav = useCallback(async () => {
    if (davLoading) return;
    if (!davUrl.trim()) {
      setDavMessage({ text: t('settings.davUrlRequired'), kind: 'error' });
      return;
    }
    setDavLoading(true);
    setDavMessage({ text: t('settings.davBackingUp'), kind: 'info' });
    try {
      const resp = await invoke<ApiResponse<string>>('backup_to_webdav', {
        url: davUrl.trim(),
        username: davUser.trim() || null,
        password: davPass.trim() || null,
      });
      if (resp.success) {
        setDavMessage({
          text: t('settings.davBackupSuccess', { name: resp.data || '' }),
          kind: 'info',
        });
      } else {
        setDavMessage({
          text: t('settings.davBackupFailed', { error: resp.error || '' }),
          kind: 'error',
        });
      }
    } catch (e) {
      setDavMessage({ text: t('common.error', { message: String(e) }), kind: 'error' });
    } finally {
      setDavLoading(false);
    }
  }, [davUrl, davUser, davPass, davLoading, t]);

  const restoreFromWebDav = useCallback(async () => {
    if (davLoading) return;
    if (!davUrl.trim()) {
      setDavMessage({ text: t('settings.davUrlRequired'), kind: 'error' });
      return;
    }
    if (!confirm(t('settings.davRestoreConfirm'))) return;
    setDavLoading(true);
    setDavMessage({ text: t('settings.davRestoring'), kind: 'info' });
    try {
      const resp = await invoke<ApiResponse<string>>('restore_from_webdav', {
        url: davUrl.trim(),
        username: davUser.trim() || null,
        password: davPass.trim() || null,
      });
      if (resp.success) {
        setDavMessage({ text: t('settings.davRestoreSuccess'), kind: 'info' });
      } else {
        setDavMessage({
          text: t('settings.davRestoreFailed', { error: resp.error || '' }),
          kind: 'error',
        });
      }
    } catch (e) {
      setDavMessage({ text: t('common.error', { message: String(e) }), kind: 'error' });
    } finally {
      setDavLoading(false);
    }
  }, [davUrl, davUser, davPass, davLoading, t]);

  return {
    davUrl,
    setDavUrl,
    davUser,
    setDavUser,
    davPass,
    setDavPass,
    davMessage,
    davLoading,
    testWebDav,
    backupToWebDav,
    restoreFromWebDav,
  };
}
