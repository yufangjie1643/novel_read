import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import type { ApiResponse, ReplaceRule } from '../types';

export default function ReplaceRules() {
  const { t } = useTranslation();
  const [rules, setRules] = useState<ReplaceRule[]>([]);
  const [message, setMessage] = useState('');
  const [editingId, setEditingId] = useState<number | undefined>(undefined);

  const [name, setName] = useState('');
  const [pattern, setPattern] = useState('');
  const [replacement, setReplacement] = useState('');
  const [scope, setScope] = useState('');
  const [isRegex, setIsRegex] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [order, setOrder] = useState(0);

  useEffect(() => {
    loadRules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadRules() {
    try {
      const resp = await invoke<ApiResponse<ReplaceRule[]>>('get_replace_rules');
      if (resp.success && resp.data) {
        setRules(resp.data.sort((a, b) => a.order - b.order));
      }
    } catch (e) {
      setMessage(t('common.error', { message: String(e) }));
    }
  }

  function startEdit(rule: ReplaceRule) {
    setEditingId(rule.id);
    setName(rule.name || '');
    setPattern(rule.pattern || '');
    setReplacement(rule.replacement || '');
    setScope(rule.scope || '');
    setIsRegex(rule.is_regex);
    setEnabled(rule.enabled);
    setOrder(rule.order);
  }

  function resetForm() {
    setEditingId(undefined);
    setName('');
    setPattern('');
    setReplacement('');
    setScope('');
    setIsRegex(false);
    setEnabled(true);
    setOrder(0);
  }

  async function saveRule() {
    if (!pattern.trim()) {
      setMessage(t('replaceRules.patternRequired'));
      return;
    }
    const rule: ReplaceRule = {
      id: editingId,
      name: name.trim() || undefined,
      pattern: pattern.trim(),
      replacement: replacement.trim() || undefined,
      scope: scope.trim() || undefined,
      is_regex: isRegex,
      enabled,
      order,
    };
    try {
      if (editingId) {
        await invoke('update_replace_rule', { rule });
      } else {
        await invoke('add_replace_rule', { rule });
      }
      resetForm();
      await loadRules();
    } catch (e) {
      setMessage(t('common.error', { message: String(e) }));
    }
  }

  async function deleteRule(id: number) {
    if (!confirm(t('replaceRules.deleteConfirm'))) return;
    try {
      await invoke('delete_replace_rule', { id });
      await loadRules();
    } catch (e) {
      setMessage(t('common.error', { message: String(e) }));
    }
  }

  async function toggleEnabled(rule: ReplaceRule) {
    const updated = { ...rule, enabled: !rule.enabled };
    try {
      await invoke('update_replace_rule', { rule: updated });
      await loadRules();
    } catch (e) {
      setMessage(t('common.error', { message: String(e) }));
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid #e0e0e0',
    fontSize: 14,
    outline: 'none',
    fontFamily: 'inherit',
    marginBottom: 8,
    boxSizing: 'border-box',
  };

  return (
    <div>
      <h1 style={{ margin: '0 0 20px', fontSize: 24, fontWeight: 700, color: '#1a1a2e' }}>
        {t('replaceRules.title')}
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

      {/* Form */}
      <div
        style={{
          background: '#fff',
          borderRadius: 12,
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          padding: 20,
          marginBottom: 24,
        }}
      >
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: '#555',
                display: 'block',
                marginBottom: 4,
              }}
            >
              {t('replaceRules.name')}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: '#555',
                display: 'block',
                marginBottom: 4,
              }}
            >
              {t('replaceRules.pattern')} *
            </label>
            <input
              type="text"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: '#555',
                display: 'block',
                marginBottom: 4,
              }}
            >
              {t('replaceRules.replacement')}
            </label>
            <input
              type="text"
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 4 }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: '#555',
                display: 'block',
                marginBottom: 4,
              }}
            >
              {t('replaceRules.scope')}
            </label>
            <input
              type="text"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              placeholder={t('replaceRules.scopePlaceholder')}
              style={inputStyle}
            />
          </div>
          <div style={{ flex: '0 0 100px' }}>
            <label
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: '#555',
                display: 'block',
                marginBottom: 4,
              }}
            >
              {t('replaceRules.order')}
            </label>
            <input
              type="number"
              value={order}
              onChange={(e) => {
                const val = parseInt(e.target.value || '0', 10);
                setOrder(Number.isNaN(val) ? 0 : val);
              }}
              style={{ ...inputStyle, marginBottom: 0 }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, paddingTop: 20 }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={isRegex}
                onChange={(e) => setIsRegex(e.target.checked)}
              />
              {t('replaceRules.isRegex')}
            </label>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              {t('common.enabled')}
            </label>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button
            onClick={saveRule}
            style={{
              padding: '8px 18px',
              borderRadius: 8,
              border: 'none',
              background: '#1976d2',
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {editingId ? t('common.save') : t('common.add')}
          </button>
          {editingId && (
            <button
              onClick={resetForm}
              style={{
                padding: '8px 18px',
                borderRadius: 8,
                border: '1px solid #e0e0e0',
                background: '#fff',
                color: '#555',
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              {t('common.cancel')}
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div
        style={{
          background: '#fff',
          borderRadius: 12,
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          overflow: 'hidden',
        }}
      >
        {rules.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: '#888' }}>
            {t('replaceRules.noRules')}
          </div>
        ) : (
          <div>
            {rules.map((rule) => (
              <div
                key={rule.id}
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
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#333', marginBottom: 4 }}>
                    {rule.name || rule.pattern}
                    {!rule.enabled && (
                      <span
                        style={{
                          fontSize: 12,
                          color: '#999',
                          fontWeight: 500,
                          marginLeft: 8,
                          padding: '2px 8px',
                          background: '#f0f0f0',
                          borderRadius: 4,
                        }}
                      >
                        {t('common.disabled')}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, color: '#666' }}>
                    <code style={{ background: '#f5f7fa', padding: '2px 6px', borderRadius: 4 }}>
                      {rule.pattern}
                    </code>
                    {' → '}
                    <code style={{ background: '#f5f7fa', padding: '2px 6px', borderRadius: 4 }}>
                      {rule.replacement || '(empty)'}
                    </code>
                  </div>
                  {rule.scope && (
                    <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
                      {t('replaceRules.scope')}: {rule.scope}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 12 }}>
                  <button
                    onClick={() => toggleEnabled(rule)}
                    style={{
                      padding: '4px 10px',
                      fontSize: 12,
                      border: `1px solid ${rule.enabled ? '#c8e6c9' : '#e0e0e0'}`,
                      background: rule.enabled ? '#e8f5e9' : '#fafafa',
                      color: rule.enabled ? '#2e7d32' : '#888',
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontWeight: 500,
                    }}
                  >
                    {rule.enabled ? t('common.enabled') : t('common.disabled')}
                  </button>
                  <button
                    onClick={() => startEdit(rule)}
                    style={{
                      padding: '4px 10px',
                      fontSize: 12,
                      border: '1px solid #bbdefb',
                      background: '#eef4fd',
                      color: '#1976d2',
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontWeight: 500,
                    }}
                  >
                    {t('common.edit')}
                  </button>
                  <button
                    onClick={() => {
                      if (rule.id) deleteRule(rule.id);
                    }}
                    style={{
                      padding: '4px 10px',
                      fontSize: 12,
                      color: '#f44336',
                      border: '1px solid #ffcdd2',
                      background: '#fff0f0',
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontWeight: 500,
                    }}
                  >
                    {t('common.delete')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
