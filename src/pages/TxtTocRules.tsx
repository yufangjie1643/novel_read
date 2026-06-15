import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import type { ApiResponse, TxtTocRule } from '../types';
import { useUiMode } from '../uiMode';

export default function TxtTocRules() {
  const { t } = useTranslation();
  const { isMobileUi } = useUiMode();
  const [rules, setRules] = useState<TxtTocRule[]>([]);
  const [message, setMessage] = useState('');
  const [editingId, setEditingId] = useState<number | undefined>();
  const [name, setName] = useState('');
  const [rule, setRule] = useState('');
  const [example, setExample] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [order, setOrder] = useState(0);

  useEffect(() => {
    loadRules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadRules() {
    try {
      const resp = await invoke<ApiResponse<TxtTocRule[]>>('get_txt_toc_rules');
      if (resp.success && resp.data) {
        setRules(resp.data.sort((a, b) => a.order - b.order));
      } else {
        setMessage(t('txtTocRules.loadFailed', { error: resp.error || '' }));
      }
    } catch (e) {
      setMessage(t('common.error', { message: String(e) }));
    }
  }

  function resetForm() {
    setEditingId(undefined);
    setName('');
    setRule('');
    setExample('');
    setEnabled(true);
    setOrder(rules.length);
  }

  function startEdit(item: TxtTocRule) {
    setEditingId(item.id);
    setName(item.name || '');
    setRule(item.rule || '');
    setExample(item.example || '');
    setEnabled(item.enabled);
    setOrder(item.order);
  }

  async function saveRule() {
    const ruleText = rule.trim();
    if (!name.trim() || !ruleText) {
      setMessage(t('txtTocRules.required'));
      return;
    }
    try {
      new RegExp(ruleText);
    } catch (e) {
      setMessage(t('txtTocRules.invalidRegex', { error: String(e) }));
      return;
    }

    const payload: TxtTocRule = {
      id: editingId,
      name: name.trim(),
      rule: ruleText,
      example: example.trim() || undefined,
      enabled,
      order,
    };

    try {
      const resp = await invoke<ApiResponse<number | null>>(
        editingId ? 'update_txt_toc_rule' : 'add_txt_toc_rule',
        { rule: payload }
      );
      if (!resp.success) {
        setMessage(t('txtTocRules.saveFailed', { error: resp.error || '' }));
        return;
      }
      resetForm();
      setMessage(t('txtTocRules.saveSuccess'));
      await loadRules();
    } catch (e) {
      setMessage(t('txtTocRules.saveFailed', { error: String(e) }));
    }
  }

  async function toggleEnabled(item: TxtTocRule) {
    try {
      const resp = await invoke<ApiResponse<null>>('update_txt_toc_rule', {
        rule: { ...item, enabled: !item.enabled },
      });
      if (!resp.success) {
        setMessage(t('txtTocRules.saveFailed', { error: resp.error || '' }));
        return;
      }
      await loadRules();
    } catch (e) {
      setMessage(t('txtTocRules.saveFailed', { error: String(e) }));
    }
  }

  async function deleteRule(id?: number) {
    if (id == null || !confirm(t('txtTocRules.deleteConfirm'))) return;
    try {
      const resp = await invoke<ApiResponse<null>>('delete_txt_toc_rule', { id });
      if (!resp.success) {
        setMessage(t('txtTocRules.deleteFailed', { error: resp.error || '' }));
        return;
      }
      await loadRules();
    } catch (e) {
      setMessage(t('txtTocRules.deleteFailed', { error: String(e) }));
    }
  }

  return (
    <div className={isMobileUi ? 'android-rule-page' : 'rule-settings-page'}>
      {isMobileUi ? (
        <header className="android-title-bar">
          <Link to="/settings">‹</Link>
          <h1>{t('txtTocRules.title')}</h1>
          <button type="button" onClick={resetForm}>
            +
          </button>
        </header>
      ) : (
        <h1 className="rule-settings-title">{t('txtTocRules.title')}</h1>
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
          <span>{t('txtTocRules.name')}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('txtTocRules.namePlaceholder')}
          />
        </label>
        <label>
          <span>{t('txtTocRules.rule')}</span>
          <textarea
            value={rule}
            onChange={(e) => setRule(e.target.value)}
            placeholder={t('txtTocRules.rulePlaceholder')}
            rows={4}
          />
        </label>
        <label>
          <span>{t('txtTocRules.example')}</span>
          <textarea
            value={example}
            onChange={(e) => setExample(e.target.value)}
            placeholder={t('txtTocRules.examplePlaceholder')}
            rows={3}
          />
        </label>
        <div className="rule-editor-inline">
          <label>
            <span>{t('txtTocRules.order')}</span>
            <input
              type="number"
              value={order}
              onChange={(e) => setOrder(Number.parseInt(e.target.value || '0', 10) || 0)}
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
            <p>{t('txtTocRules.noRules')}</p>
          </div>
        ) : (
          rules.map((item) => (
            <article key={item.id ?? `${item.name}-${item.order}`} className="rule-list-row">
              <div>
                <strong>{item.name || t('txtTocRules.unnamed')}</strong>
                <code>{item.rule}</code>
                {item.example && <small>{item.example}</small>}
                {!item.enabled && <small>{t('common.disabled')}</small>}
              </div>
              <div className="rule-row-actions">
                <button type="button" onClick={() => toggleEnabled(item)}>
                  {item.enabled ? t('common.enabled') : t('common.disabled')}
                </button>
                <button type="button" onClick={() => startEdit(item)}>
                  {t('common.edit')}
                </button>
                <button type="button" className="danger" onClick={() => deleteRule(item.id)}>
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
