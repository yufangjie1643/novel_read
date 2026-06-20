import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { ApiResponse, BookSource } from '../types';
import CookieSyncModal from '../components/CookieSyncModal';

export default function SourceEdit() {
  const { sourceUrl } = useParams();
  const decodedUrl = decodeURIComponent(sourceUrl || '');

  const [source, setSource] = useState<BookSource | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nameDraft, setNameDraft] = useState('');
  const [enabledDraft, setEnabledDraft] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [cookieModalOpen, setCookieModalOpen] = useState(false);

  useEffect(() => {
    if (!decodedUrl) return;
    setLoading(true);
    setError('');
    (async () => {
      const resp = await invoke<ApiResponse<BookSource | null>>('get_book_source', {
        url: decodedUrl,
      });
      if (!resp.success || !resp.data) {
        setError(resp.error ?? 'Failed to load book source.');
        setLoading(false);
        return;
      }
      setSource(resp.data);
      setNameDraft(resp.data.book_source_name ?? '');
      setEnabledDraft(resp.data.enabled);
      setLoading(false);
    })();
  }, [decodedUrl]);

  const handleSave = async () => {
    if (!source) return;
    setSaving(true);
    setError('');
    try {
      const updated: BookSource = {
        ...source,
        book_source_name: nameDraft.trim() || source.book_source_name,
        enabled: enabledDraft,
      };
      const resp = await invoke<ApiResponse<unknown>>('update_book_source', {
        source: updated,
      });
      if (!resp.success) {
        setError(resp.error ?? 'Failed to save.');
        setSaving(false);
        return;
      }
      setSource(updated);
      setSavedAt(Date.now());
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleOpenLogin = async () => {
    const url = source?.login_url;
    if (!url) return;
    try {
      await openUrl(url);
    } catch (e) {
      setError(`Failed to open login URL: ${e}`);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <p>加载中…</p>
      </div>
    );
  }

  if (error && !source) {
    return (
      <div style={{ padding: 24 }}>
        <h2>书源详情</h2>
        <p style={{ color: '#b71c1c' }}>{error}</p>
        <Link to="/sources">← 返回</Link>
      </div>
    );
  }

  if (!source) return null;

  return (
    <div style={{ padding: '16px 24px', maxWidth: 960, margin: '0 auto' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 16,
          paddingBottom: 12,
          borderBottom: '1px solid #eee',
        }}
      >
        <Link to="/sources" style={linkBtn}>← 返回</Link>
        <h2 style={{ flex: 1, margin: 0, fontSize: 18 }}>
          {source.book_source_name || '(未命名书源)'}
        </h2>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: '6px 16px',
            border: 'none',
            borderRadius: 6,
            background: '#1976d2',
            color: '#fff',
            fontSize: 13,
            cursor: 'pointer',
            fontWeight: 500,
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </div>

      {error && (
        <div
          style={{
            padding: 12,
            background: '#fdecec',
            color: '#b71c1c',
            borderRadius: 6,
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {savedAt && (
        <div
          style={{
            padding: 8,
            background: '#e8f5e9',
            color: '#2e7d32',
            borderRadius: 6,
            fontSize: 12,
            marginBottom: 16,
          }}
        >
          已保存。
        </div>
      )}

      <Section title="基本信息">
        <Field label="名称">
          <input
            type="text"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="URL">
          <div style={{ ...inputStyle, background: '#f5f5f5', color: '#555' }}>
            {source.book_source_url}
          </div>
        </Field>
        <Field label="启用">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={enabledDraft}
              onChange={(e) => setEnabledDraft(e.target.checked)}
            />
            <span style={{ fontSize: 13, color: '#555' }}>在搜索和发现中启用此书源</span>
          </label>
        </Field>
        {source.book_source_group && (
          <Field label="分组">
            <div style={{ fontSize: 13, color: '#555' }}>{source.book_source_group}</div>
          </Field>
        )}
        {source.weight !== undefined && (
          <Field label="权重">
            <div style={{ fontSize: 13, color: '#555' }}>{source.weight}</div>
          </Field>
        )}
      </Section>

      <Section title="登录">
        <Field label="登录 URL">
          {source.login_url ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div
                style={{
                  flex: 1,
                  ...inputStyle,
                  background: '#f5f5f5',
                  color: '#555',
                  fontFamily: 'monospace',
                  fontSize: 12,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {source.login_url}
              </div>
              <button type="button" onClick={handleOpenLogin} style={secondaryBtn}>
                打开登录页
              </button>
              <button
                type="button"
                onClick={() => setCookieModalOpen(true)}
                style={primaryBtn}
              >
                获取 Cookie
              </button>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: '#888' }}>
              此书源未配置登录 URL。
            </div>
          )}
        </Field>
        {source.login_ui && (
          <Field label="登录 UI">
            <pre
              style={{
                ...inputStyle,
                background: '#fafafa',
                fontFamily: 'monospace',
                fontSize: 11,
                maxHeight: 120,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
              }}
            >
              {source.login_ui}
            </pre>
          </Field>
        )}
      </Section>

      <Section title="其它字段（只读）">
        <Field label="Header">
          <pre style={readOnlyPre}>{source.header || '(空)'}</pre>
        </Field>
        {source.rule_search && (
          <Field label="搜索规则">
            <pre style={readOnlyPre}>{source.rule_search}</pre>
          </Field>
        )}
        {source.rule_toc && (
          <Field label="目录规则">
            <pre style={readOnlyPre}>{source.rule_toc}</pre>
          </Field>
        )}
        {source.rule_content && (
          <Field label="正文规则">
            <pre style={readOnlyPre}>{source.rule_content}</pre>
          </Field>
        )}
        {source.rule_explore && (
          <Field label="发现规则">
            <pre style={readOnlyPre}>{source.rule_explore}</pre>
          </Field>
        )}
        {source.js_lib && (
          <Field label="JS Lib">
            <pre style={readOnlyPre}>{source.js_lib}</pre>
          </Field>
        )}
        {source.book_source_comment && (
          <Field label="备注">
            <pre style={readOnlyPre}>{source.book_source_comment}</pre>
          </Field>
        )}
      </Section>

      {source.login_url && (
        <CookieSyncModal
          sourceUrl={source.book_source_url}
          loginUrl={source.login_url}
          open={cookieModalOpen}
          onClose={() => setCookieModalOpen(false)}
        />
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <h3
        style={{
          margin: '0 0 12px 0',
          fontSize: 13,
          fontWeight: 600,
          color: '#1976d2',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}
      >
        {title}
      </h3>
      <div
        style={{
          background: '#fff',
          border: '1px solid #eee',
          borderRadius: 8,
          padding: 16,
        }}
      >
        {children}
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          fontSize: 12,
          color: '#666',
          marginBottom: 6,
          fontWeight: 500,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  border: '1px solid #ddd',
  borderRadius: 6,
  fontSize: 13,
  boxSizing: 'border-box',
  background: '#fff',
  color: '#222',
};

const linkBtn: React.CSSProperties = {
  padding: '6px 12px',
  border: '1px solid #ddd',
  borderRadius: 6,
  background: '#fafafa',
  color: '#555',
  fontSize: 13,
  textDecoration: 'none',
};

const primaryBtn: React.CSSProperties = {
  padding: '6px 14px',
  border: 'none',
  borderRadius: 6,
  background: '#1976d2',
  color: '#fff',
  fontSize: 13,
  cursor: 'pointer',
  fontWeight: 500,
};

const secondaryBtn: React.CSSProperties = {
  padding: '6px 14px',
  border: '1px solid #ddd',
  borderRadius: 6,
  background: '#fafafa',
  color: '#555',
  fontSize: 13,
  cursor: 'pointer',
};

const readOnlyPre: React.CSSProperties = {
  margin: 0,
  padding: 10,
  background: '#fafafa',
  border: '1px solid #eee',
  borderRadius: 6,
  fontFamily: 'monospace',
  fontSize: 11,
  color: '#555',
  maxHeight: 240,
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
};