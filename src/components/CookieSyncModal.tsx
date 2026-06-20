import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { ApiResponse, CookieEntry, CookieSyncHandle } from '../types';

type Phase = 'idle' | 'starting' | 'waiting_login' | 'reading' | 'review' | 'saving' | 'error';

interface Props {
  sourceUrl: string;
  loginUrl: string;
  open: boolean;
  onClose: () => void;
  /** Called after cookies are saved. The parent SourceEdit page decides
   *  whether to refresh anything. */
  onSaved?: () => void;
}

interface SyncStatusEvent {
  sync_id: string;
  status: string;
  count?: number;
  message?: string;
  port?: number;
}

export default function CookieSyncModal({ sourceUrl, loginUrl, open, onClose, onSaved }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [syncId, setSyncId] = useState('');
  const [cookies, setCookies] = useState<CookieEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [statusMessage, setStatusMessage] = useState('');

  // Listen to backend cookie_sync_status events for live progress.
  useEffect(() => {
    if (!open) return;
    let unlisten: UnlistenFn | undefined;
    listen<SyncStatusEvent>('cookie_sync_status', (event) => {
      const { status, message, count } = event.payload;
      if (status === 'started') {
        setStatusMessage('Edge opened. Sign in to the login page in the Edge window.');
        setPhase('waiting_login');
      } else if (status === 'reading') {
        setStatusMessage('Reading cookies…');
      } else if (status === 'captured') {
        setStatusMessage(`Captured ${count ?? 0} cookie(s).`);
      } else if (status === 'failed') {
        setError(message ?? 'Failed to read cookies.');
        setPhase('error');
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [open]);

  // Cleanup on close: cancel any in-flight sync to kill the spawned Edge.
  useEffect(() => {
    if (!open && syncId) {
      void invoke('cancel_cookie_sync', { syncId }).catch(() => {});
      setSyncId('');
    }
  }, [open, syncId]);

  if (!open) return null;

  const reset = () => {
    setPhase('idle');
    setError('');
    setSyncId('');
    setCookies([]);
    setSelected(new Set());
    setStatusMessage('');
  };

  const close = () => {
    if (syncId) {
      void invoke('cancel_cookie_sync', { syncId }).catch(() => {});
      setSyncId('');
    }
    reset();
    onClose();
  };

  const handleStart = async () => {
    setPhase('starting');
    setError('');
    setStatusMessage('Starting Edge…');
    try {
      const resp = await invoke<ApiResponse<CookieSyncHandle>>('start_cookie_sync', {
        sourceUrl,
        loginUrl,
      });
      if (!resp.success || !resp.data) {
        setError(resp.error ?? 'Failed to start Edge.');
        setPhase('error');
        return;
      }
      setSyncId(resp.data.sync_id);
      setPhase('waiting_login');
      setStatusMessage(`Edge opened (debug port ${resp.data.port}). Sign in then continue.`);
    } catch (e) {
      setError(String(e));
      setPhase('error');
    }
  };

  const handleRead = async () => {
    if (!syncId) return;
    setPhase('reading');
    setError('');
    try {
      const resp = await invoke<ApiResponse<CookieEntry[]>>('read_cookies_via_edge', {
        syncId,
      });
      if (!resp.success || !resp.data) {
        setError(resp.error ?? 'Failed to read cookies.');
        setPhase('error');
        return;
      }
      setCookies(resp.data);
      setSelected(new Set(resp.data.map((c) => `${c.domain}|${c.name}`)));
      setPhase('review');
    } catch (e) {
      setError(String(e));
      setPhase('error');
    }
  };

  const handleSave = async () => {
    if (!syncId) return;
    setPhase('saving');
    setError('');
    try {
      const picked = cookies.filter((c) => selected.has(`${c.domain}|${c.name}`));
      // Serialize the picked cookies as a single header string the legacy
      // set_cookie command already understands.
      const cookieHeader = picked
        .map((c) => `${c.name}=${c.value}`)
        .join('; ');
      const resp = await invoke<ApiResponse<unknown>>('set_cookie', {
        url: sourceUrl,
        cookie: cookieHeader,
      });
      if (!resp.success) {
        setError(resp.error ?? 'Failed to save cookies.');
        setPhase('error');
        return;
      }
      void invoke('cancel_cookie_sync', { syncId }).catch(() => {});
      setSyncId('');
      onSaved?.();
      close();
    } catch (e) {
      setError(String(e));
      setPhase('error');
    }
  };

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 10,
          width: 'min(640px, 92vw)',
          maxHeight: '86vh',
          overflow: 'auto',
          padding: 24,
          boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ flex: 1, margin: 0, fontSize: 18 }}>获取 Cookie</h3>
          <button
            type="button"
            onClick={close}
            aria-label="关闭"
            style={{
              padding: '4px 12px',
              border: '1px solid #ddd',
              borderRadius: 6,
              background: '#fafafa',
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>

        {error && (
          <div
            style={{
              padding: 12,
              borderRadius: 6,
              background: '#fdecec',
              color: '#b71c1c',
              fontSize: 13,
              marginBottom: 12,
            }}
          >
            {error}
          </div>
        )}

        {statusMessage && !error && (
          <div
            style={{
              padding: 12,
              borderRadius: 6,
              background: '#eef4fd',
              color: '#0d47a1',
              fontSize: 13,
              marginBottom: 12,
            }}
          >
            {statusMessage}
          </div>
        )}

        {phase === 'idle' && (
          <>
            <p style={{ fontSize: 13, lineHeight: 1.6, color: '#444' }}>
              将自动启动一个独立的 Edge 浏览器窗口（使用临时 profile，不影响你现有的
              Edge），并打开登录页：<code>{loginUrl}</code>
            </p>
            <p style={{ fontSize: 13, lineHeight: 1.6, color: '#666' }}>
              请在弹出的 Edge 窗口中完成登录，然后回到这里点「我已登录」读取 Cookie。
              完成后 Edge 会被自动关闭，临时数据会被清理。
            </p>
            <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={handleStart}
                style={primaryBtn}
              >
                启动 Edge 并打开登录页
              </button>
              <button type="button" onClick={close} style={secondaryBtn}>
                取消
              </button>
            </div>
          </>
        )}

        {(phase === 'starting' || phase === 'waiting_login') && (
          <>
            <p style={{ fontSize: 13, lineHeight: 1.6, color: '#444' }}>
              Edge 已启动，请在浏览器中完成登录。
            </p>
            <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={handleRead}
                disabled={phase === 'starting'}
                style={{ ...primaryBtn, opacity: phase === 'starting' ? 0.6 : 1 }}
              >
                我已登录，读取 Cookie
              </button>
              <button type="button" onClick={close} style={secondaryBtn}>
                取消
              </button>
            </div>
          </>
        )}

        {phase === 'reading' && (
          <p style={{ fontSize: 13, color: '#444' }}>正在读取 Cookie…</p>
        )}

        {phase === 'review' && (
          <>
            <p style={{ fontSize: 13, lineHeight: 1.6, color: '#444' }}>
              共读取到 {cookies.length} 条 Cookie。取消勾选可排除敏感项。
            </p>
            <div
              style={{
                border: '1px solid #e0e0e0',
                borderRadius: 6,
                maxHeight: 320,
                overflowY: 'auto',
                marginBottom: 12,
              }}
            >
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead style={{ position: 'sticky', top: 0, background: '#fafafa' }}>
                  <tr>
                    <th style={th}></th>
                    <th style={th}>Name</th>
                    <th style={th}>Domain</th>
                    <th style={th}>HttpOnly</th>
                    <th style={th}>Secure</th>
                  </tr>
                </thead>
                <tbody>
                  {cookies.map((c) => {
                    const key = `${c.domain}|${c.name}`;
                    return (
                      <tr key={key} style={{ borderTop: '1px solid #f0f0f0' }}>
                        <td style={td}>
                          <input
                            type="checkbox"
                            checked={selected.has(key)}
                            onChange={() => toggle(key)}
                          />
                        </td>
                        <td style={td}>{c.name}</td>
                        <td style={{ ...td, color: '#888' }}>{c.domain}</td>
                        <td style={td}>{c.httpOnly ? '✓' : ''}</td>
                        <td style={td}>{c.secure ? '✓' : ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={handleSave} style={primaryBtn}>
                保存选中的 Cookie
              </button>
              <button type="button" onClick={close} style={secondaryBtn}>
                取消
              </button>
            </div>
          </>
        )}

        {phase === 'error' && (
          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <button type="button" onClick={reset} style={primaryBtn}>
              重试
            </button>
            <button type="button" onClick={close} style={secondaryBtn}>
              关闭
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  fontWeight: 600,
  fontSize: 11,
  color: '#666',
  borderBottom: '1px solid #e0e0e0',
};

const td: React.CSSProperties = {
  padding: '6px 10px',
  verticalAlign: 'middle',
};

const primaryBtn: React.CSSProperties = {
  padding: '8px 16px',
  border: 'none',
  borderRadius: 6,
  background: '#1976d2',
  color: '#fff',
  fontSize: 13,
  cursor: 'pointer',
  fontWeight: 500,
};

const secondaryBtn: React.CSSProperties = {
  padding: '8px 16px',
  border: '1px solid #ddd',
  borderRadius: 6,
  background: '#fafafa',
  color: '#555',
  fontSize: 13,
  cursor: 'pointer',
};