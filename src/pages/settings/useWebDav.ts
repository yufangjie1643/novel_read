import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import type { ApiResponse } from '../../types';

export function useWebDav() {
  const { t } = useTranslation();
  const [davUrl, setDavUrl] = useState('');
  const [davUser, setDavUser] = useState('');
  const [davPass, setDavPass] = useState('');
  const [davMessage, setDavMessage] = useState('');
  const [davLoading, setDavLoading] = useState(false);

  useEffect(() => {
    setDavUrl(localStorage.getItem('webdav_url') || '');
    setDavUser(localStorage.getItem('webdav_user') || '');
  }, []);

  const testWebDav = useCallback(async () => {
    if (!davUrl.trim()) {
      setDavMessage(t('settings.davUrlRequired'));
      return;
    }
    setDavLoading(true);
    setDavMessage(t('settings.davTesting'));
    try {
      const resp = await invoke<ApiResponse<null>>('test_webdav_connection', {
        url: davUrl.trim(),
        username: davUser.trim() || null,
        password: davPass.trim() || null,
      });
      if (resp.success) {
        setDavMessage(t('settings.davTestSuccess'));
        localStorage.setItem('webdav_url', davUrl.trim());
        localStorage.setItem('webdav_user', davUser.trim());
      } else {
        setDavMessage(t('settings.davTestFailed', { error: resp.error || '' }));
      }
    } catch (e) {
      setDavMessage(t('common.error', { message: String(e) }));
    }
    setDavLoading(false);
  }, [davUrl, davUser, davPass, t]);

  const backupToWebDav = useCallback(async () => {
    if (!davUrl.trim()) {
      setDavMessage(t('settings.davUrlRequired'));
      return;
    }
    setDavLoading(true);
    setDavMessage(t('settings.davBackingUp'));
    try {
      const resp = await invoke<ApiResponse<string>>('backup_to_webdav', {
        url: davUrl.trim(),
        username: davUser.trim() || null,
        password: davPass.trim() || null,
      });
      if (resp.success) {
        setDavMessage(t('settings.davBackupSuccess', { name: resp.data || '' }));
      } else {
        setDavMessage(t('settings.davBackupFailed', { error: resp.error || '' }));
      }
    } catch (e) {
      setDavMessage(t('common.error', { message: String(e) }));
    }
    setDavLoading(false);
  }, [davUrl, davUser, davPass, t]);

  const restoreFromWebDav = useCallback(async () => {
    if (!davUrl.trim()) {
      setDavMessage(t('settings.davUrlRequired'));
      return;
    }
    if (!confirm(t('settings.davRestoreConfirm'))) return;
    setDavLoading(true);
    setDavMessage(t('settings.davRestoring'));
    try {
      const resp = await invoke<ApiResponse<string>>('restore_from_webdav', {
        url: davUrl.trim(),
        username: davUser.trim() || null,
        password: davPass.trim() || null,
      });
      if (resp.success) {
        setDavMessage(t('settings.davRestoreSuccess'));
      } else {
        setDavMessage(t('settings.davRestoreFailed', { error: resp.error || '' }));
      }
    } catch (e) {
      setDavMessage(t('common.error', { message: String(e) }));
    }
    setDavLoading(false);
  }, [davUrl, davUser, davPass, t]);

  return {
    davUrl, setDavUrl,
    davUser, setDavUser,
    davPass, setDavPass,
    davMessage,
    davLoading,
    testWebDav, backupToWebDav, restoreFromWebDav,
  };
}
