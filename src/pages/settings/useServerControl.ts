import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import type { ApiResponse } from '../../types';

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
  };
}
