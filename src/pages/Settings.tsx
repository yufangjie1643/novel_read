import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import type { ApiResponse } from '../types';
import { useUiMode } from '../uiMode';
import { useReaderPrefs } from './settings/useReaderPrefs';
import SettingsReader from './settings/SettingsReader';
import SettingsBulkImport from './settings/SettingsBulkImport';
import SettingsBackup from './settings/SettingsBackup';
import { btnStyle, useSettingsStyles } from './settings/styles';

export default function Settings() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const { isMobileUi } = useUiMode();
  const { sectionStyle, sectionTitle, rowStyle, labelStyle } = useSettingsStyles();
  const shouldRenderSettingsDetails = !isMobileUi || location.hash.length > 0;
  const { fontSize, reset: resetReaderPrefs } = useReaderPrefs();
  const [serverRunning, setServerRunning] = useState(false);
  const [serverUrl, setServerUrl] = useState('');
  const [serverMessage, setServerMessage] = useState('');

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
      <SettingsBulkImport />

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
      <SettingsBackup />

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
