import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function SourceImport() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function add() {
    if (!name.trim() || !url.trim()) return;
    setBusy(true);
    setMsg(t('home.checkUpdates', 'Checking…'));
    try {
      const resp = await invoke<{ success: boolean; data?: unknown[]; error?: string }>(
        'import_source_from_url',
        { url }
      );
      if (resp.success && resp.data) {
        for (const source of resp.data) {
          await invoke('add_book_source', { source });
        }
        setMsg(t('common.success', 'Success'));
        navigate('/sources');
      } else {
        setMsg(resp.error ?? t('common.error', 'Error'));
      }
    } catch (e) {
      setMsg(String(e));
    }
    setBusy(false);
  }

  return (
    <div style={{ padding: 24, maxWidth: 600 }}>
      <h2>{t('home.sourceSubscriptions', 'Subscriptions')}</h2>
      <input
        placeholder={t('home.subNamePlaceholder', 'Name')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={{
          width: '100%',
          padding: 10,
          marginBottom: 12,
          border: '1px solid #e0e0e0',
          borderRadius: 8,
        }}
      />
      <input
        placeholder={t('home.subUrlPlaceholder', 'Subscription URL')}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        style={{
          width: '100%',
          padding: 10,
          marginBottom: 12,
          border: '1px solid #e0e0e0',
          borderRadius: 8,
        }}
      />
      <button
        onClick={add}
        disabled={busy}
        style={{
          padding: '10px 20px',
          borderRadius: 8,
          border: 'none',
          background: '#1976d2',
          color: '#fff',
          fontSize: 14,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        {busy ? t('common.loading', 'Loading…') : t('common.add', 'Add')}
      </button>
      {msg && <p style={{ marginTop: 12, color: '#666', fontSize: 13 }}>{msg}</p>}
    </div>
  );
}
