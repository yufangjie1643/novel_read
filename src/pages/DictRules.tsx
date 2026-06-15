import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import type { ApiResponse, DictRule } from '../types';
import { useUiMode } from '../uiMode';

export default function DictRules() {
  const { t } = useTranslation();
  const { isMobileUi } = useUiMode();
  const [rules, setRules] = useState<DictRule[]>([]);
  const [message, setMessage] = useState('');
  const [editingId, setEditingId] = useState<number | undefined>();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [showRule, setShowRule] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [sortNumber, setSortNumber] = useState(0);

  useEffect(() => {
    loadRules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadRules() {
    try {
      const resp = await invoke<ApiResponse<DictRule[]>>('get_dict_rules');
      if (resp.success && resp.data) {
        setRules(resp.data.sort((a, b) => a.sort_number - b.sort_number));
      } else {
        setMessage(t('dictRules.loadFailed', { error: resp.error || '' }));
      }
    } catch (e) {
      setMessage(t('common.error', { message: String(e) }));
    }
  }

  function resetForm() {
    setEditingId(undefined);
    setName('');
    setUrl('');
    setShowRule('');
    setEnabled(true);
    setSortNumber(rules.length);
  }

  function startEdit(rule: DictRule) {
    setEditingId(rule.id);
    setName(rule.name || '');
    setUrl(rule.url || '');
    setShowRule(rule.show_rule || '');
    setEnabled(rule.enabled);
    setSortNumber(rule.sort_number);
  }

  async function saveRule() {
    if (!name.trim() || !url.trim()) {
      setMessage(t('dictRules.required'));
      return;
    }
    const payload: DictRule = {
      id: editingId,
      name: name.trim(),
      url: url.trim(),
      show_rule: showRule.trim() || undefined,
      enabled,
      sort_number: sortNumber,
    };
    try {
      const resp = await invoke<ApiResponse<number | null>>(
        editingId ? 'update_dict_rule' : 'add_dict_rule',
        { rule: payload }
      );
      if (!resp.success) {
        setMessage(t('dictRules.saveFailed', { error: resp.error || '' }));
        return;
      }
      resetForm();
      setMessage(t('dictRules.saveSuccess'));
      await loadRules();
    } catch (e) {
      setMessage(t('dictRules.saveFailed', { error: String(e) }));
    }
  }

  async function toggleEnabled(rule: DictRule) {
    try {
      const resp = await invoke<ApiResponse<null>>('update_dict_rule', {
        rule: { ...rule, enabled: !rule.enabled },
      });
      if (!resp.success) {
        setMessage(t('dictRules.saveFailed', { error: resp.error || '' }));
        return;
      }
      await loadRules();
    } catch (e) {
      setMessage(t('dictRules.saveFailed', { error: String(e) }));
    }
  }

  async function deleteRule(id?: number) {
    if (id == null || !confirm(t('dictRules.deleteConfirm'))) return;
    try {
      const resp = await invoke<ApiResponse<null>>('delete_dict_rule', { id });
      if (!resp.success) {
        setMessage(t('dictRules.deleteFailed', { error: resp.error || '' }));
        return;
      }
      await loadRules();
    } catch (e) {
      setMessage(t('dictRules.deleteFailed', { error: String(e) }));
    }
  }

  return (
    <div className={isMobileUi ? 'android-rule-page' : 'rule-settings-page'}>
      {isMobileUi ? (
        <header className="android-title-bar">
          <Link to="/settings">‹</Link>
          <h1>{t('dictRules.title')}</h1>
          <button type="button" onClick={resetForm}>
            +
          </button>
        </header>
      ) : (
        <h1 className="rule-settings-title">{t('dictRules.title')}</h1>
      )}

      {message && (
        <div
          className={
            message.includes('失败') || message.toLowerCase().includes('failed')
              ? 'android-message error'
              : 'android-message'
          }
        >
          {message}
        </div>
      )}

      <section className="rule-editor-panel">
        <label>
          <span>{t('dictRules.name')}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('dictRules.namePlaceholder')}
          />
        </label>
        <label>
          <span>{t('dictRules.urlRule')}</span>
          <textarea
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t('dictRules.urlRulePlaceholder')}
            rows={4}
          />
        </label>
        <label>
          <span>{t('dictRules.showRule')}</span>
          <textarea
            value={showRule}
            onChange={(e) => setShowRule(e.target.value)}
            placeholder={t('dictRules.showRulePlaceholder')}
            rows={3}
          />
        </label>
        <div className="rule-editor-inline">
          <label>
            <span>{t('dictRules.sortNumber')}</span>
            <input
              type="number"
              value={sortNumber}
              onChange={(e) => setSortNumber(Number.parseInt(e.target.value || '0', 10) || 0)}
            />
          </label>
          <button
            type="button"
            className={`rule-toggle ${enabled ? 'on' : ''}`}
            onClick={() => setEnabled((value) => !value)}
          >
            {enabled ? t('common.enabled') : t('common.disabled')}
          </button>
        </div>
        <div className="rule-editor-actions">
          <button type="button" className="primary" onClick={saveRule}>
            {editingId ? t('common.save') : t('common.add')}
          </button>
          {editingId && (
            <button type="button" onClick={resetForm}>
              {t('common.cancel')}
            </button>
          )}
        </div>
      </section>

      <section className="rule-list-panel">
        {rules.length === 0 ? (
          <div className="android-empty-panel">
            <p>{t('dictRules.noRules')}</p>
          </div>
        ) : (
          rules.map((rule) => (
            <article key={rule.id ?? rule.name} className="rule-list-row">
              <div>
                <strong>{rule.name || t('dictRules.unnamed')}</strong>
                <code>{rule.url}</code>
                {rule.show_rule && <small>{rule.show_rule}</small>}
                {!rule.enabled && <small>{t('common.disabled')}</small>}
              </div>
              <div className="rule-row-actions">
                <button type="button" onClick={() => toggleEnabled(rule)}>
                  {rule.enabled ? t('common.enabled') : t('common.disabled')}
                </button>
                <button type="button" onClick={() => startEdit(rule)}>
                  {t('common.edit')}
                </button>
                <button type="button" className="danger" onClick={() => deleteRule(rule.id)}>
                  {t('common.delete')}
                </button>
              </div>
            </article>
          ))
        )}
      </section>
    </div>
  );
}
