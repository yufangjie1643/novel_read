import { useTranslation } from 'react-i18next';
import { useUiMode } from '../../uiMode';
import { useBulkImport } from './useBulkImport';
import { btnStyle, useSettingsStyles } from './styles';

export default function SettingsBulkImport() {
  const { t } = useTranslation();
  const { isMobileUi } = useUiMode();
  const { sectionStyle, sectionTitle } = useSettingsStyles();
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

  return (
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
  );
}
