import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import type { ApiResponse, ManagedFileList } from '../types';
import { useUiMode } from '../uiMode';

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export default function FileManager() {
  const { t } = useTranslation();
  const { isMobileUi } = useUiMode();
  const [path, setPath] = useState('');
  const [data, setData] = useState<ManagedFileList | null>(null);
  const [filter, setFilter] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    void loadFiles(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  async function loadFiles(relativePath = '') {
    try {
      const resp = await invoke<ApiResponse<ManagedFileList>>('list_app_files', {
        relativePath: relativePath || null,
      });
      if (resp.success && resp.data) {
        setData(resp.data);
        setMessage('');
      } else {
        setMessage(t('fileManager.loadFailed', { error: resp.error || '' }));
      }
    } catch (e) {
      setMessage(t('fileManager.loadFailed', { error: String(e) }));
    }
  }

  async function createFolder() {
    const name = prompt(t('fileManager.folderNamePrompt'));
    if (!name?.trim()) return;
    const resp = await invoke<ApiResponse<null>>('create_app_folder', {
      relativePath: data?.current_path || null,
      name: name.trim(),
    });
    if (!resp.success) {
      setMessage(t('fileManager.createFailed', { error: resp.error || '' }));
      return;
    }
    await loadFiles(data?.current_path || '');
  }

  async function deleteFile(relativePath: string, name: string) {
    if (!confirm(t('fileManager.deleteConfirm', { name }))) return;
    const resp = await invoke<ApiResponse<null>>('delete_app_file', { relativePath });
    if (!resp.success) {
      setMessage(t('fileManager.deleteFailed', { error: resp.error || '' }));
      return;
    }
    await loadFiles(data?.current_path || '');
  }

  const files = useMemo(() => {
    const items = data?.files || [];
    const keyword = filter.trim().toLowerCase();
    if (!keyword) return items;
    return items.filter((item) => item.name.toLowerCase().includes(keyword));
  }, [data, filter]);

  const crumbs = (data?.current_path || '').split('/').filter(Boolean);

  return (
    <div className={isMobileUi ? 'android-rule-page' : 'rule-settings-page'}>
      {isMobileUi ? (
        <header className="android-title-bar">
          <Link to="/settings">‹</Link>
          <h1>{t('fileManager.title')}</h1>
          <button type="button" onClick={createFolder}>
            +
          </button>
        </header>
      ) : (
        <h1 className="rule-settings-title">{t('fileManager.title')}</h1>
      )}

      {message && <div className="android-message error">{message}</div>}

      <section className="file-manager-toolbar">
        <div className="file-manager-path">
          <button type="button" onClick={() => setPath('')}>
            root
          </button>
          {crumbs.map((crumb, index) => {
            const nextPath = crumbs.slice(0, index + 1).join('/');
            return (
              <button type="button" key={nextPath} onClick={() => setPath(nextPath)}>
                {crumb}
              </button>
            );
          })}
        </div>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('fileManager.searchPlaceholder')}
        />
        {!isMobileUi && (
          <button type="button" onClick={createFolder}>
            {t('fileManager.createFolder')}
          </button>
        )}
      </section>

      <section className="rule-list-panel">
        {data?.parent_path && (
          <button
            type="button"
            className="file-row"
            onClick={() => setPath(data.parent_path || '')}
          >
            <span className="file-icon">UP</span>
            <strong>..</strong>
            <small>{t('fileManager.parentFolder')}</small>
          </button>
        )}
        {files.length === 0 ? (
          <div className="android-empty-panel">
            <p>{t('fileManager.noFiles')}</p>
          </div>
        ) : (
          files.map((file) => (
            <article key={file.relative_path} className="file-row">
              <button
                type="button"
                className="file-row-main"
                onClick={() => file.is_dir && setPath(file.relative_path)}
                disabled={!file.is_dir}
              >
                <span className="file-icon">{file.is_dir ? 'DIR' : 'FILE'}</span>
                <span>
                  <strong>{file.name}</strong>
                  <small>
                    {file.is_dir
                      ? t('fileManager.folder')
                      : `${formatSize(file.size)}${
                          file.modified
                            ? ` · ${new Date(file.modified * 1000).toLocaleString()}`
                            : ''
                        }`}
                  </small>
                </span>
              </button>
              <button
                type="button"
                className="file-delete"
                onClick={() => deleteFile(file.relative_path, file.name)}
              >
                {t('common.delete')}
              </button>
            </article>
          ))
        )}
      </section>
    </div>
  );
}
