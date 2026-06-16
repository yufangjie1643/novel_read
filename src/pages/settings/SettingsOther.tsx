import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { useReaderPrefs } from './useReaderPrefs';
import { useServerControl } from './useServerControl';
import { useSearchSettings, type SearchSettings } from './useSearchSettings';
import { btnStyle, useSettingsStyles } from './styles';

type SettingsOtherProps = {
  mode?: 'server' | 'other';
};

export default function SettingsOther({ mode }: SettingsOtherProps = {}) {
  const { t, i18n } = useTranslation();
  const { reset: resetReaderPrefs } = useReaderPrefs();
  const { sectionStyle, sectionTitle, rowStyle, labelStyle } = useSettingsStyles();
  const { serverRunning, serverUrl, serverMessage, toggling, toggleServer } = useServerControl();

  // Cloud progress sync state
  const [syncUrl, setSyncUrl] = useState(localStorage.getItem("webdav_url") || "");
  const [syncUser, setSyncUser] = useState(localStorage.getItem("webdav_user") || "");
  const [syncPass, setSyncPass] = useState(localStorage.getItem("webdav_pass") || "");
  const [syncResult, setSyncResult] = useState("");
  const [syncing, setSyncing] = useState(false);

  async function runCloudSync() {
    if (syncing) return;
    setSyncing(true);
    setSyncResult("");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const res = await invoke("get_books") as { data?: Array<{ book_url: string }> };
      const urls = (res.data || []).map((b) => b.book_url);
      let uploaded = 0, downloaded = 0, skipped = 0, failed = 0;
      for (const u of urls) {
        try {
          const r = await invoke("sync_book_progress", {
            bookUrl: u,
            direction: "auto",
            webdavUrl: syncUrl,
            webdavUser: syncUser || null,
            webdavPass: syncPass || null,
          });
          if (((r as { status?: string }).status) === "uploaded") uploaded++;
          else if (((r as { status?: string }).status) === "downloaded") downloaded++;
          else if (((r as { status?: string }).status) === "skipped") skipped++;
          else failed++;
        } catch { failed++; }
      }
      const summary = "up:" + uploaded + " down:" + downloaded + " skip:" + skipped + " fail:" + failed + " of " + urls.length;
      setSyncResult(t("settings.syncResult", { result: summary }));
    } catch (e) {
      setSyncResult(String(e));
    } finally {
      setSyncing(false);
    }
  }

  function toggleLang() {
    const next = i18n.language.startsWith('zh') ? 'en' : 'zh';
    i18n.changeLanguage(next);
  }

  function resetSettings() {
    if (!confirm(t('settings.resetConfirm'))) return;
    resetReaderPrefs();
  }

  return (
    <>
      {(!mode || mode === 'other') && (
        <div style={sectionStyle}>
          <div style={sectionTitle}>{t('settings.syncTitle')}</div>
          <div style={rowStyle}>
            <span style={labelStyle}>{t('settings.syncUrl')}</span>
            <input
              value={syncUrl}
              onChange={(e) => { setSyncUrl(e.target.value); localStorage.setItem("webdav_url", e.target.value); }}
              placeholder="https://dav.example.com/remote.php/webdav/"
              style={{ flex: 1, minWidth: 200, padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6 }}
            />
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>{t('settings.syncUser')}</span>
            <input
              value={syncUser}
              onChange={(e) => { setSyncUser(e.target.value); localStorage.setItem("webdav_user", e.target.value); }}
              style={{ flex: 1, minWidth: 200, padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6 }}
            />
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>{t('settings.syncPass')}</span>
            <input
              type="password"
              value={syncPass}
              onChange={(e) => { setSyncPass(e.target.value); localStorage.setItem("webdav_pass", e.target.value); }}
              style={{ flex: 1, minWidth: 200, padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6 }}
            />
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>{t('settings.syncNow')}</span>
            <button
              type="button"
              onClick={runCloudSync}
              disabled={syncing || !syncUrl}
              style={btnStyle}
            >
              {syncing ? "..." : t('settings.syncNow')}
            </button>
          </div>
          {syncResult && (
            <div style={{ ...rowStyle, fontSize: 13, opacity: 0.85 }}>
              <span style={labelStyle}></span>
              <span>{syncResult}</span>
            </div>
          )}
        </div>
      )}

      {(!mode || mode === 'other') && (
        <div style={sectionStyle}>
          <div style={sectionTitle}>{t('settings.language')}</div>
          <div style={rowStyle}>
            <span style={labelStyle}>{t('settings.currentLanguage')}</span>
            <button onClick={toggleLang} style={btnStyle}>
              {i18n.language.startsWith('zh') ? t('layout.langEn') : t('layout.langZh')}
            </button>
          </div>
        </div>
      )}

      {(!mode || mode === 'other') && (
        <div style={sectionStyle}>
          <div style={sectionTitle}>{t('settings.tools')}</div>
          <div style={rowStyle}>
            <span style={labelStyle}>{t('settings.debugTool')}</span>
            <Link
              to="/debug"
              style={{
                padding: '6px 16px',
                fontSize: 14,
                border: '1px solid #bbdefb',
                borderRadius: 8,
                background: '#eef4fd',
                color: '#1976d2',
                textDecoration: 'none',
                fontWeight: 500,
              }}
            >
              {t('layout.debug')} →
            </Link>
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>{t('settings.bookSourceTool')}</span>
            <Link
              to="/book-sources"
              style={{
                padding: '6px 16px',
                fontSize: 14,
                border: '1px solid #bbdefb',
                borderRadius: 8,
                background: '#eef4fd',
                color: '#1976d2',
                textDecoration: 'none',
                fontWeight: 500,
              }}
            >
              {t('layout.bookSources')} →
            </Link>
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>{t('settings.configMarketTool')}</span>
            <Link
              to="/config-market"
              style={{
                padding: '6px 16px',
                fontSize: 14,
                border: '1px solid #bbdefb',
                borderRadius: 8,
                background: '#eef4fd',
                color: '#1976d2',
                textDecoration: 'none',
                fontWeight: 500,
              }}
            >
              {t('layout.configMarket')} →
            </Link>
          </div>
        </div>
      )}

      {(!mode || mode === 'other') && (
        <div style={sectionStyle}>
          <div style={sectionTitle}>{t('settings.searchResource')}</div>
          <SearchResourceSection />
        </div>
      )}

      {(!mode || mode === 'other') && (
        <div style={sectionStyle}>
          <div style={sectionTitle}>{t('settings.reset')}</div>
          <div style={rowStyle}>
            <span style={labelStyle}>{t('settings.resetDesc')}</span>
            <button
              onClick={resetSettings}
              style={{
                padding: '6px 16px',
                fontSize: 14,
                border: '1px solid #ffcdd2',
                borderRadius: 8,
                background: '#fff0f0',
                color: '#f44336',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              {t('settings.resetBtn')}
            </button>
          </div>
        </div>
      )}

      {(!mode || mode === 'server') && (
        <div style={sectionStyle}>
          <div style={sectionTitle}>{t('settings.bookshelfShare')}</div>
          <div style={rowStyle}>
            <span style={labelStyle}>
              {serverRunning
                ? t('bookshelf.serverRunning', { url: serverUrl })
                : t('settings.serverStopped')}
            </span>
            <button
              onClick={toggleServer}
              disabled={toggling}
              style={{
                padding: '6px 14px',
                fontSize: 13,
                border: '1px solid',
                borderRadius: 8,
                borderColor: serverRunning ? '#ffcdd2' : '#bbdefb',
                background: serverRunning ? '#fff0f0' : '#eef4fd',
                color: serverRunning ? '#f44336' : '#1976d2',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              {serverRunning ? t('bookshelf.stopServer') : t('bookshelf.startServer')}
            </button>
          </div>
          {serverMessage.text && (
            <div
              style={{
                background: serverMessage.kind === 'error' ? '#ffebee' : '#e3f2fd',
                color: serverMessage.kind === 'error' ? '#c62828' : '#1565c0',
                padding: '8px 12px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 500,
                marginTop: 10,
              }}
            >
              {serverMessage.text}
            </div>
          )}
        </div>
      )}

      {(!mode || mode === 'other') && (
        <div style={sectionStyle}>
          <div style={sectionTitle}>{t('settings.about')}</div>
          <div style={{ fontSize: 14, color: '#666', lineHeight: 1.6 }}>
            <p style={{ margin: '0 0 8px' }}>Legado Desktop</p>
            <p style={{ margin: 0, color: '#888' }}>{t('settings.aboutDesc')}</p>
          </div>
        </div>
      )}
    </>
  );
}

const inputNarrowStyle: React.CSSProperties = {
  width: 90,
  padding: '6px 10px',
  fontSize: 13,
  border: '1px solid #ddd',
  borderRadius: 6,
};

function SearchResourceSection() {
  const { t } = useTranslation();
  const { settings, save, error, saving } = useSearchSettings();
  const { rowStyle, labelStyle } = useSettingsStyles();
  const [draft, setDraft] = useState<SearchSettings>(settings);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const handleSave = () => {
    void save(draft);
  };

  const handleReset = () => {
    setDraft({
      max_concurrency: 8,
      memory_soft_limit_mb: 400,
      per_source_timeout_ms: 2000,
      reclaim_batch: 2,
    });
  };

  return (
    <>
      <div style={rowStyle}>
        <span style={labelStyle}>{t('settings.maxConcurrency')}</span>
        <input
          type="number"
          min={1}
          max={64}
          value={draft.max_concurrency}
          onChange={(e) =>
            setDraft({ ...draft, max_concurrency: Number(e.target.value) })
          }
          style={inputNarrowStyle}
        />
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>{t('settings.memorySoftLimit')}</span>
        <input
          type="number"
          min={50}
          max={4096}
          value={draft.memory_soft_limit_mb}
          onChange={(e) =>
            setDraft({ ...draft, memory_soft_limit_mb: Number(e.target.value) })
          }
          style={inputNarrowStyle}
        />
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>{t('settings.perSourceTimeout')}</span>
        <input
          type="number"
          min={500}
          max={60000}
          value={draft.per_source_timeout_ms}
          onChange={(e) =>
            setDraft({ ...draft, per_source_timeout_ms: Number(e.target.value) })
          }
          style={inputNarrowStyle}
        />
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>{t('settings.reclaimBatch')}</span>
        <input
          type="number"
          min={1}
          max={16}
          value={draft.reclaim_batch}
          onChange={(e) =>
            setDraft({ ...draft, reclaim_batch: Number(e.target.value) })
          }
          style={inputNarrowStyle}
        />
      </div>
      <div style={rowStyle}>
        <span style={labelStyle} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '6px 14px',
              fontSize: 13,
              border: '1px solid #bbdefb',
              borderRadius: 8,
              background: '#eef4fd',
              color: '#1976d2',
              cursor: saving ? 'not-allowed' : 'pointer',
              fontWeight: 500,
            }}
          >
            {t('common.save')}
          </button>
          <button
            onClick={handleReset}
            style={{
              padding: '6px 14px',
              fontSize: 13,
              border: '1px solid #ddd',
              borderRadius: 8,
              background: '#fff',
              color: '#555',
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            {t('common.reset')}
          </button>
        </div>
      </div>
      {error && (
        <div
          style={{
            background: '#ffebee',
            color: '#c62828',
            padding: '8px 12px',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 500,
            marginTop: 10,
          }}
        >
          {error}
        </div>
      )}
    </>
  );
}
