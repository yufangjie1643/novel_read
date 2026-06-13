import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import type { ApiResponse } from '../types';
import { useUiMode } from '../uiMode';
import { useReaderPrefs } from './settings/useReaderPrefs';
import { useWebDav } from './settings/useWebDav';
import { useBulkImport } from './settings/useBulkImport';
import SettingsReader from './settings/SettingsReader';
import { useSettingsStyles } from './settings/styles';

export default function Settings() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const { isMobileUi } = useUiMode();
  const { sectionStyle, sectionTitle, rowStyle, labelStyle } = useSettingsStyles();
  const shouldRenderSettingsDetails = !isMobileUi || location.hash.length > 0;
  const { fontSize, reset: resetReaderPrefs } = useReaderPrefs();
  const {
    davUrl, setDavUrl, davUser, setDavUser, davPass, setDavPass,
    davMessage, davLoading,
    testWebDav, backupToWebDav, restoreFromWebDav,
  } = useWebDav();
  const [serverRunning, setServerRunning] = useState(false);
  const [serverUrl, setServerUrl] = useState('');
  const [serverMessage, setServerMessage] = useState('');
  const {
    bulkImportUrl, setBulkImportUrl,
    bulkLinks, bulkSelected, setBulkSelected,
    bulkLoading, bulkImporting,
    bulkMessage,
    selectedBulkCount, supportedBulkCount,
    importTypeLabel, isSupportedImportLink, importLinkKey,
    setSelectedSupportedLinks,
    loadBulkImportLinks, toggleBulkLink, importSelectedBulkLinks,
  } = useBulkImport();

  useEffect(() => {
    if (!shouldRenderSettingsDetails) return;
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
  }, [shouldRenderSettingsDetails]);

  function toggleLang() {
    const next = i18n.language === 'zh' ? 'en' : 'zh';
    i18n.changeLanguage(next);
  }

  function resetSettings() {
    if (!confirm(t('settings.resetConfirm'))) return;
    resetReaderPrefs();
  }

  async function toggleServer() {
    if (serverRunning) {
      try {
        await invoke('stop_web_server');
        setServerRunning(false);
        setServerUrl('');
      } catch (e) {
        setServerMessage(t('common.error', { message: String(e) }));
      }
    } else {
      try {
        const resp = await invoke<ApiResponse<string>>('start_web_server', { port: 1122 });
        if (resp.success && resp.data) {
          setServerRunning(true);
          setServerUrl(resp.data);
          setServerMessage(t('bookshelf.serverStarted', { url: resp.data }));
        } else {
          const errMsg = resp.error || '';
          if (errMsg.includes('all ports in range are in use')) {
            setServerMessage(t('bookshelf.serverPortInUse'));
          } else {
            setServerMessage(t('bookshelf.serverStartFailed', { error: errMsg }));
          }
        }
      } catch (e) {
        setServerMessage(t('common.error', { message: String(e) }));
      }
    }
  }

  const btnStyle: React.CSSProperties = {
    padding: '6px 14px',
    fontSize: 14,
    border: '1px solid #ddd',
    borderRadius: 8,
    background: '#fff',
    cursor: 'pointer',
    fontWeight: 500,
    color: '#555',
  };

  const mobileMineHeader = isMobileUi ? (
    <>
      <header className="android-profile-head">
        <img src="/mobile-media/app_icon.png" alt="" />
        <div>
          <p>Legado</p>
          <h1>{t('layout.mine', { defaultValue: '我的' })}</h1>
        </div>
      </header>

      <div className="android-stats-row">
        <div>
          <strong>{i18n.language === 'zh' ? t('layout.langZh') : t('layout.langEn')}</strong>
          <span>{t('settings.currentLanguage')}</span>
        </div>
        <div>
          <strong>{fontSize}</strong>
          <span>{t('reader.fontSize')}</span>
        </div>
        <div>
          <strong>0.1.0</strong>
          <span>{t('settings.version')}</span>
        </div>
      </div>

      <div className="android-settings-panel">
        <h2>{t('settings.title')}</h2>
        <Link to="/settings#appearance">
          <img src="/mobile-media/my_center_theme_icon.svg" alt="" />
          <span>{t('settings.mobileThemeEntry')}</span>
          <small>{t('settings.mobileThemeDesc')}</small>
        </Link>
        <Link to="/settings#webdav">
          <img src="/mobile-media/my_center_cloud_icon.svg" alt="" />
          <span>{t('settings.mobileWebdavEntry')}</span>
          <small>{t('settings.mobileWebdavDesc')}</small>
        </Link>
        <Link to="/book-sources">
          <img src="/mobile-media/my_center_book_icon.svg" alt="" />
          <span>{t('layout.bookSources')}</span>
          <small>{t('settings.mobileRulesDesc')}</small>
        </Link>
        <Link to="/config-market">
          <img src="/mobile-media/folder.svg" alt="" />
          <span>{t('layout.configMarket')}</span>
          <small>{t('settings.mobileMarketDesc')}</small>
        </Link>
      </div>
    </>
  ) : null;

  if (isMobileUi && !shouldRenderSettingsDetails) {
    return <div>{mobileMineHeader}</div>;
  }

  return (
    <div>
      {mobileMineHeader}
      {!isMobileUi && (
        <h1 style={{ margin: '0 0 20px', fontSize: 24, fontWeight: 700, color: '#1a1a2e' }}>
          {t('settings.title')}
        </h1>
      )}

      {/* Language */}
      <div style={sectionStyle}>
        <div style={sectionTitle}>{t('settings.language')}</div>
        <div style={rowStyle}>
          <span style={labelStyle}>{t('settings.currentLanguage')}</span>
          <button onClick={toggleLang} style={btnStyle}>
            {i18n.language === 'zh' ? t('layout.langEn') : t('layout.langZh')}
          </button>
        </div>
      </div>

      {/* Reader Settings */}
      <SettingsReader />

      {/* Tools */}
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

      {/* Batch Legado import */}
      <div style={sectionStyle}>
        <div style={sectionTitle}>{t('settings.bulkImport')}</div>
        <div
          style={{
            display: 'flex',
            gap: 10,
            flexDirection: isMobileUi ? 'column' : 'row',
            marginBottom: 12,
          }}
        >
          <input
            type="text"
            value={bulkImportUrl}
            onChange={(e) => setBulkImportUrl(e.target.value)}
            placeholder={t('settings.bulkImportUrlPlaceholder')}
            style={{
              flex: 1,
              minWidth: 0,
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid #e0e0e0',
              fontSize: 14,
              outline: 'none',
              fontFamily: 'inherit',
            }}
          />
          <button
            onClick={loadBulkImportLinks}
            disabled={bulkLoading || !bulkImportUrl.trim()}
            style={{
              ...btnStyle,
              borderColor: '#bbdefb',
              background: bulkLoading ? '#f5f5f5' : '#eef4fd',
              color: bulkLoading ? '#999' : '#1976d2',
              cursor: bulkLoading ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {bulkLoading ? t('common.loading') : t('settings.bulkImportRead')}
          </button>
        </div>

        {bulkLinks.length > 0 && (
          <>
            <div
              style={{
                display: 'flex',
                gap: 8,
                flexWrap: 'wrap',
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
              <span style={{ fontSize: 13, color: '#666' }}>
                {t('settings.bulkImportSelection', {
                  selected: selectedBulkCount,
                  supported: supportedBulkCount,
                  total: bulkLinks.length,
                })}
              </span>
              <button
                onClick={() => setSelectedSupportedLinks(bulkLinks)}
                style={{ ...btnStyle, padding: '4px 10px', fontSize: 13 }}
              >
                {t('settings.bulkImportSelectSupported')}
              </button>
              <button
                onClick={() => setBulkSelected(new Set())}
                style={{ ...btnStyle, padding: '4px 10px', fontSize: 13 }}
              >
                {t('bookshelf.deselectAll')}
              </button>
              <button
                onClick={importSelectedBulkLinks}
                disabled={bulkImporting || selectedBulkCount === 0}
                style={{
                  ...btnStyle,
                  padding: '4px 12px',
                  fontSize: 13,
                  borderColor: '#a5d6a7',
                  background: bulkImporting || selectedBulkCount === 0 ? '#f5f5f5' : '#e8f5e9',
                  color: bulkImporting || selectedBulkCount === 0 ? '#999' : '#2e7d32',
                  cursor: bulkImporting || selectedBulkCount === 0 ? 'not-allowed' : 'pointer',
                  marginLeft: isMobileUi ? 0 : 'auto',
                }}
              >
                {bulkImporting ? t('bookSources.importing') : t('settings.bulkImportInstall')}
              </button>
            </div>

            <div
              style={{
                border: '1px solid #f0f0f0',
                borderRadius: 8,
                overflow: 'hidden',
                maxHeight: 280,
                overflowY: 'auto',
                marginBottom: 12,
              }}
            >
              {bulkLinks.map((link) => {
                const key = importLinkKey(link);
                const supported = isSupportedImportLink(link);
                const checked = bulkSelected.has(key);
                return (
                  <label
                    key={key}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '10px 12px',
                      borderBottom: '1px solid #f8f8f8',
                      background: checked ? '#eef4fd' : '#fff',
                      cursor: supported ? 'pointer' : 'not-allowed',
                      opacity: supported ? 1 : 0.58,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!supported || bulkImporting}
                      onChange={() => toggleBulkLink(link)}
                      style={{ width: 16, height: 16, flexShrink: 0 }}
                    />
                    <span
                      style={{
                        minWidth: 82,
                        fontSize: 12,
                        fontWeight: 700,
                        color: supported ? '#1976d2' : '#999',
                      }}
                    >
                      {importTypeLabel(link.link_type)}
                    </span>
                    <span
                      title={link.source_url}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 13,
                        color: '#555',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {link.label && !['一键导入', 'Import'].includes(link.label)
                        ? link.label
                        : link.source_url.split('/').pop() || link.source_url}
                    </span>
                    {!supported && (
                      <span style={{ fontSize: 12, color: '#999', whiteSpace: 'nowrap' }}>
                        {t('settings.bulkImportUnsupported')}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </>
        )}

        {bulkMessage.text && (
          <div
            style={{
              background: bulkMessage.kind === 'error' ? '#ffebee' : '#e3f2fd',
              color: bulkMessage.kind === 'error' ? '#c62828' : '#1565c0',
              padding: '8px 12px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            {bulkMessage.text}
          </div>
        )}
      </div>

      {/* Reset */}
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

      {/* WebDAV */}
      <div id="webdav" style={sectionStyle}>
        <div style={sectionTitle}>{t('settings.webdav')}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
          <input
            type="text"
            placeholder={t('settings.davUrlPlaceholder')}
            value={davUrl}
            onChange={(e) => setDavUrl(e.target.value)}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid #e0e0e0',
              fontSize: 14,
              outline: 'none',
              fontFamily: 'inherit',
            }}
          />
          <div style={{ display: 'flex', gap: 10 }}>
            <input
              type="text"
              placeholder={t('settings.davUserPlaceholder')}
              value={davUser}
              onChange={(e) => setDavUser(e.target.value)}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid #e0e0e0',
                fontSize: 14,
                outline: 'none',
                fontFamily: 'inherit',
              }}
            />
            <input
              type="password"
              placeholder={t('settings.davPassPlaceholder')}
              value={davPass}
              onChange={(e) => setDavPass(e.target.value)}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid #e0e0e0',
                fontSize: 14,
                outline: 'none',
                fontFamily: 'inherit',
              }}
            />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <button
            onClick={testWebDav}
            disabled={davLoading}
            style={{
              padding: '6px 14px',
              fontSize: 13,
              border: '1px solid #bbdefb',
              borderRadius: 8,
              background: davLoading ? '#f5f5f5' : '#eef4fd',
              color: davLoading ? '#999' : '#1976d2',
              cursor: davLoading ? 'not-allowed' : 'pointer',
              fontWeight: 500,
            }}
          >
            {t('settings.davTest')}
          </button>
          <button
            onClick={backupToWebDav}
            disabled={davLoading}
            style={{
              padding: '6px 14px',
              fontSize: 13,
              border: '1px solid #a5d6a7',
              borderRadius: 8,
              background: davLoading ? '#f5f5f5' : '#e8f5e9',
              color: davLoading ? '#999' : '#2e7d32',
              cursor: davLoading ? 'not-allowed' : 'pointer',
              fontWeight: 500,
            }}
          >
            {t('settings.davBackup')}
          </button>
          <button
            onClick={restoreFromWebDav}
            disabled={davLoading}
            style={{
              padding: '6px 14px',
              fontSize: 13,
              border: '1px solid #ffcdd2',
              borderRadius: 8,
              background: davLoading ? '#f5f5f5' : '#fff0f0',
              color: davLoading ? '#999' : '#f44336',
              cursor: davLoading ? 'not-allowed' : 'pointer',
              fontWeight: 500,
            }}
          >
            {t('settings.davRestore')}
          </button>
        </div>
        {davMessage.text && (
          <div
            style={{
              background: davMessage.kind === 'error' ? '#ffebee' : '#e3f2fd',
              color: davMessage.kind === 'error' ? '#c62828' : '#1565c0',
              padding: '8px 12px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            {davMessage.text}
          </div>
        )}
      </div>

      {/* Bookshelf Share */}
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
        {serverMessage && (
          <div
            style={{
              background: serverMessage.includes(t('common.error')) ? '#ffebee' : '#e3f2fd',
              color: serverMessage.includes(t('common.error')) ? '#c62828' : '#1565c0',
              padding: '8px 12px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 500,
              marginTop: 10,
            }}
          >
            {serverMessage}
          </div>
        )}
      </div>

      {/* About */}
      <div style={sectionStyle}>
        <div style={sectionTitle}>{t('settings.about')}</div>
        <div style={{ fontSize: 14, color: '#666', lineHeight: 1.6 }}>
          <p style={{ margin: '0 0 8px' }}>Legado Desktop</p>
          <p style={{ margin: 0, color: '#888' }}>{t('settings.aboutDesc')}</p>
        </div>
      </div>
    </div>
  );
}
