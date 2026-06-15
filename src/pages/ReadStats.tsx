import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import type { ApiResponse, ReadRecord } from '../types';

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function ReadStats() {
  const { t } = useTranslation();
  const [records, setRecords] = useState<ReadRecord[]>([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    loadRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadRecords() {
    try {
      const resp = await invoke<ApiResponse<ReadRecord[]>>('get_read_records');
      if (resp.success && resp.data) {
        setRecords(resp.data.sort((a, b) => b.last_read - a.last_read));
      }
    } catch (e) {
      setMessage(t('common.error', { message: String(e) }));
    }
  }

  async function deleteRecord(bookName: string) {
    if (!confirm(t('readStats.deleteConfirm', { name: bookName }))) return;
    try {
      await invoke('delete_read_record', { bookName });
      await loadRecords();
    } catch (e) {
      setMessage(t('common.error', { message: String(e) }));
    }
  }

  const totalTime = records.reduce((sum, r) => sum + r.read_time, 0);
  const totalBooks = records.length;

  return (
    <div>
      <h1 style={{ margin: '0 0 20px', fontSize: 24, fontWeight: 700, color: '#1a1a2e' }}>
        {t('readStats.title')}
      </h1>

      {message && (
        <div
          style={{
            background: message.includes(t('common.error')) ? '#ffebee' : '#e3f2fd',
            color: message.includes(t('common.error')) ? '#c62828' : '#1565c0',
            padding: '10px 16px',
            borderRadius: 8,
            marginBottom: 16,
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          {message}
        </div>
      )}

      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <div
          style={{
            background: '#fff',
            borderRadius: 12,
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
            padding: '20px 24px',
            minWidth: 160,
            flex: 1,
          }}
        >
          <div style={{ fontSize: 13, color: '#888', marginBottom: 6 }}>
            {t('readStats.totalBooks')}
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#1976d2' }}>{totalBooks}</div>
        </div>
        <div
          style={{
            background: '#fff',
            borderRadius: 12,
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
            padding: '20px 24px',
            minWidth: 160,
            flex: 1,
          }}
        >
          <div style={{ fontSize: 13, color: '#888', marginBottom: 6 }}>
            {t('readStats.totalTime')}
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#1976d2' }}>
            {formatDuration(totalTime)}
          </div>
        </div>
      </div>

      {/* Records list */}
      <div
        style={{
          background: '#fff',
          borderRadius: 12,
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #f0f0f0',
            fontSize: 16,
            fontWeight: 700,
            color: '#1a1a2e',
          }}
        >
          {t('readStats.readingList')}
        </div>

        {records.length === 0 ? (
          <div style={{ padding: '60px 20px', textAlign: 'center', color: '#888' }}>
            <p style={{ fontSize: 16 }}>{t('readStats.noRecords')}</p>
          </div>
        ) : (
          <div>
            {records.map((record) => (
              <div
                key={record.book_name}
                style={{
                  padding: '14px 20px',
                  borderBottom: '1px solid #f8f8f8',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f5f7fa')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 15, color: '#1a1a2e', marginBottom: 4 }}>
                    {record.book_name}
                  </div>
                  <div style={{ fontSize: 13, color: '#888' }}>
                    {t('readStats.readTime')}: {formatDuration(record.read_time)} ·{' '}
                    {t('readStats.lastRead')}: {new Date(record.last_read).toLocaleDateString()}
                  </div>
                </div>
                <button
                  onClick={() => deleteRecord(record.book_name)}
                  style={{
                    padding: '4px 10px',
                    fontSize: 12,
                    color: '#f44336',
                    border: '1px solid #ffcdd2',
                    background: '#fff0f0',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontWeight: 500,
                    marginLeft: 12,
                    flexShrink: 0,
                  }}
                >
                  {t('common.delete')}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
