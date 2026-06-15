import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import type { ApiResponse, HttpServerAuthView } from '../../types';

export function useServerControl() {
  const { t } = useTranslation();
  const [serverRunning, setServerRunning] = useState(false);
  const [serverUrl, setServerUrl] = useState('');
  const [serverMessage, setServerMessage] = useState<{
    text: string;
    kind: 'idle' | 'error' | 'info';
  }>({
    text: '',
    kind: 'idle',
  });
  const [toggling, setToggling] = useState(false);

  const [authView, setAuthView] = useState<HttpServerAuthView | null>(null);
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authSaving, setAuthSaving] = useState(false);

  useEffect(() => {
    async function checkServerStatus() {
      try {
        const resp = await invoke<ApiResponse<boolean>>('get_web_server_status');
        if (resp.success && resp.data) {
          setServerRunning(resp.data);
        }
      } catch (e) {
        console.error('Failed to check server status:', e);
      }
    }
    checkServerStatus();
  }, []);

  const refreshAuth = useCallback(async () => {
    try {
      const resp = await invoke<ApiResponse<HttpServerAuthView | null>>(
        'get_http_server_auth',
      );
      if (resp.success) {
        setAuthView(resp.data ?? null);
        if (resp.data) setAuthUsername(resp.data.username);
      }
    } catch (e) {
      console.error('Failed to load http server auth:', e);
    }
  }, []);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  const saveAuth = useCallback(async () => {
    if (authSaving) return;
    if (!authUsername.trim() || !authPassword) return;
    setAuthSaving(true);
    try {
      const resp = await invoke<ApiResponse<null>>('set_http_server_credentials', {
        username: authUsername.trim(),
        password: authPassword,
      });
      if (resp.success) {
        setAuthPassword('');
        await refreshAuth();
        setServerMessage({
          text: t('bookshelf.serverAuthSaved', { defaultValue: 'HTTP 服务凭证已保存' }),
          kind: 'info',
        });
      } else {
        setServerMessage({
          text: resp.error || t('common.error', { message: 'unknown' }),
          kind: 'error',
        });
      }
    } finally {
      setAuthSaving(false);
    }
  }, [authUsername, authPassword, authSaving, refreshAuth, t]);

  const clearAuth = useCallback(async () => {
    if (!confirm(t('bookshelf.serverAuthClearConfirm', { defaultValue: '确定要清除 HTTP 服务凭证吗？' }))) {
      return;
    }
    try {
      await invoke('clear_http_server_credentials');
      setAuthPassword('');
      await refreshAuth();
    } catch (e) {
      setServerMessage({ text: t('common.error', { message: String(e) }), kind: 'error' });
    }
  }, [refreshAuth, t]);

  const toggleServer = useCallback(async () => {
    if (toggling) return;
    setToggling(true);
    try {
      if (serverRunning) {
        try {
          await invoke('stop_web_server');
          setServerRunning(false);
          setServerUrl('');
        } catch (e) {
          setServerMessage({ text: t('common.error', { message: String(e) }), kind: 'error' });
        }
      } else {
        try {
          const resp = await invoke<ApiResponse<string>>('start_web_server', { port: 1122 });
          if (resp.success && resp.data) {
            setServerRunning(true);
            setServerUrl(resp.data);
            setServerMessage({
              text: t('bookshelf.serverStarted', { url: resp.data }),
              kind: 'info',
            });
          } else {
            const errMsg = resp.error || '';
            if (errMsg.includes('all ports in range are in use')) {
              setServerMessage({ text: t('bookshelf.serverPortInUse'), kind: 'error' });
            } else if (errMsg.includes('凭证') || errMsg.includes('credential')) {
              setServerMessage({ text: errMsg, kind: 'error' });
            } else {
              setServerMessage({
                text: t('bookshelf.serverStartFailed', { error: errMsg }),
                kind: 'error',
              });
            }
          }
        } catch (e) {
          setServerMessage({ text: t('common.error', { message: String(e) }), kind: 'error' });
        }
      }
    } finally {
      setToggling(false);
    }
  }, [serverRunning, toggling, t]);

  return {
    serverRunning,
    serverUrl,
    serverMessage,
    toggling,
    toggleServer,
    authView,
    authUsername,
    authPassword,
    authSaving,
    setAuthUsername,
    setAuthPassword,
    saveAuth,
    clearAuth,
  };
}
