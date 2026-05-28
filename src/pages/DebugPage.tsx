import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import type { ApiResponse, BookSource } from '../types';

interface DebugResult {
  request_url: string;
  raw_response: string;
  parsed_result: string;
}

export default function DebugPage() {
  const { t } = useTranslation();
  const [sources, setSources] = useState<BookSource[]>([]);
  const [selectedSourceUrl, setSelectedSourceUrl] = useState('');
  const [step, setStep] = useState('search');
  const [key, setKey] = useState('');
  const [bookUrl, setBookUrl] = useState('');
  const [chapterUrl, setChapterUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DebugResult | null>(null);
  const [error, setError] = useState('');

  async function loadSources() {
    try {
      const resp = await invoke<ApiResponse<BookSource[]>>('get_book_sources');
      if (resp.success && resp.data) {
        setSources(resp.data);
        if (resp.data.length > 0 && !selectedSourceUrl) {
          setSelectedSourceUrl(resp.data[0].book_source_url);
        }
      }
    } catch (e) {
      console.error('Failed to load sources:', e);
    }
  }

  async function runDebug() {
    const source = sources.find((s) => s.book_source_url === selectedSourceUrl);
    if (!source) {
      setError(t('debug.selectSource'));
      return;
    }

    setLoading(true);
    setError('');
    setResult(null);

    try {
      const resp = await invoke<ApiResponse<DebugResult>>('debug_book_source', {
        source,
        step,
        key: key || null,
        bookUrl: bookUrl || null,
        chapterUrl: chapterUrl || null,
      });
      if (resp.success && resp.data) {
        setResult(resp.data);
      } else {
        setError(t('debug.debugFailed', { error: resp.error || '' }));
      }
    } catch (e) {
      setError(t('common.error', { message: String(e) }));
    }
    setLoading(false);
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 14px',
    borderRadius: 8,
    border: '1px solid #e0e0e0',
    fontSize: 14,
    outline: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    cursor: 'pointer',
    background: '#fff',
  };

  return (
    <div>
      <h1 style={{ margin: '0 0 20px', fontSize: 24, fontWeight: 700, color: '#1a1a2e' }}>
        {t('debug.title')}
      </h1>

      <div
        style={{
          background: '#fff',
          borderRadius: 12,
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          padding: 24,
          marginBottom: 24,
        }}
      >
        <div style={{ marginBottom: 16 }}>
          <button
            onClick={loadSources}
            disabled={loading}
            style={{
              padding: '8px 18px',
              borderRadius: 8,
              border: '1px solid #bbdefb',
              background: '#eef4fd',
              color: '#1976d2',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {t('debug.loadSources')}
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label
              style={{
                display: 'block',
                fontSize: 14,
                fontWeight: 600,
                marginBottom: 6,
                color: '#333',
              }}
            >
              {t('debug.source')}
            </label>
            <select
              value={selectedSourceUrl}
              onChange={(e) => setSelectedSourceUrl(e.target.value)}
              style={selectStyle}
            >
              <option value="">{t('debug.selectSource')}</option>
              {sources.map((s) => (
                <option key={s.book_source_url} value={s.book_source_url}>
                  {s.book_source_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              style={{
                display: 'block',
                fontSize: 14,
                fontWeight: 600,
                marginBottom: 6,
                color: '#333',
              }}
            >
              {t('debug.step')}
            </label>
            <select
              value={step}
              onChange={(e) => setStep(e.target.value)}
              style={{ ...selectStyle, width: 'auto', minWidth: 180 }}
            >
              <option value="search">{t('debug.stepSearch')}</option>
              <option value="book_info">{t('debug.stepBookInfo')}</option>
              <option value="chapter_list">{t('debug.stepChapterList')}</option>
              <option value="content">{t('debug.stepContent')}</option>
            </select>
          </div>

          {step === 'search' && (
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: 14,
                  fontWeight: 600,
                  marginBottom: 6,
                  color: '#333',
                }}
              >
                {t('debug.searchKey')}
              </label>
              <input
                type="text"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={t('debug.searchKeyPlaceholder')}
                style={inputStyle}
              />
            </div>
          )}

          {(step === 'book_info' || step === 'chapter_list') && (
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: 14,
                  fontWeight: 600,
                  marginBottom: 6,
                  color: '#333',
                }}
              >
                {t('debug.bookUrl')}
              </label>
              <input
                type="text"
                value={bookUrl}
                onChange={(e) => setBookUrl(e.target.value)}
                placeholder={t('debug.bookUrlPlaceholder')}
                style={inputStyle}
              />
            </div>
          )}

          {step === 'content' && (
            <>
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: 14,
                    fontWeight: 600,
                    marginBottom: 6,
                    color: '#333',
                  }}
                >
                  {t('debug.bookUrl')}
                </label>
                <input
                  type="text"
                  value={bookUrl}
                  onChange={(e) => setBookUrl(e.target.value)}
                  placeholder={t('debug.bookUrlPlaceholder')}
                  style={inputStyle}
                />
              </div>
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: 14,
                    fontWeight: 600,
                    marginBottom: 6,
                    color: '#333',
                  }}
                >
                  {t('debug.chapterUrl')}
                </label>
                <input
                  type="text"
                  value={chapterUrl}
                  onChange={(e) => setChapterUrl(e.target.value)}
                  placeholder={t('debug.chapterUrlPlaceholder')}
                  style={inputStyle}
                />
              </div>
            </>
          )}

          <button
            onClick={runDebug}
            disabled={loading}
            style={{
              padding: '10px 20px',
              borderRadius: 8,
              border: 'none',
              background: '#1976d2',
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
              alignSelf: 'flex-start',
            }}
          >
            {loading ? t('debug.running') : t('debug.runDebug')}
          </button>
        </div>
      </div>

      {error && (
        <div
          style={{
            background: '#ffebee',
            color: '#c62828',
            padding: '12px 16px',
            borderRadius: 8,
            marginBottom: 16,
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          {error}
        </div>
      )}

      {result && (
        <div
          style={{
            background: '#fff',
            borderRadius: 12,
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
            padding: 24,
          }}
        >
          <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700, color: '#1a1a2e' }}>
            {t('debug.requestUrl')}
          </h3>
          <pre
            style={{
              background: '#f8f9fa',
              padding: 14,
              borderRadius: 8,
              overflow: 'auto',
              fontSize: 13,
              border: '1px solid #f0f0f0',
            }}
          >
            {result.request_url}
          </pre>

          <h3 style={{ margin: '20px 0 12px', fontSize: 16, fontWeight: 700, color: '#1a1a2e' }}>
            {t('debug.rawResponse')}
          </h3>
          <pre
            style={{
              background: '#f8f9fa',
              padding: 14,
              borderRadius: 8,
              overflow: 'auto',
              fontSize: 12,
              maxHeight: 400,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              border: '1px solid #f0f0f0',
            }}
          >
            {result.raw_response}
          </pre>

          <h3 style={{ margin: '20px 0 12px', fontSize: 16, fontWeight: 700, color: '#1a1a2e' }}>
            {t('debug.parsedResult')}
          </h3>
          <pre
            style={{
              background: '#f8f9fa',
              padding: 14,
              borderRadius: 8,
              overflow: 'auto',
              fontSize: 13,
              maxHeight: 400,
              whiteSpace: 'pre-wrap',
              border: '1px solid #f0f0f0',
            }}
          >
            {result.parsed_result}
          </pre>
        </div>
      )}
    </div>
  );
}
