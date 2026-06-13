import type { CSSProperties } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function SettingsSidebar() {
  const { t } = useTranslation();

  const linkStyle: CSSProperties = {
    display: 'block',
    padding: '10px 16px',
    color: '#555',
    textDecoration: 'none',
    fontSize: 14,
    borderLeft: '3px solid transparent',
  };
  const activeStyle: CSSProperties = {
    fontWeight: 600,
    color: '#1a1a2e',
    borderLeft: '3px solid #2e7d32',
    background: '#f8f8f8',
  };

  return (
    <nav
      style={{
        width: 200,
        flexShrink: 0,
        borderRight: '1px solid #e0e0e0',
        paddingTop: 8,
      }}
    >
      <NavLink
        to="/settings/reader"
        style={({ isActive }) => ({ ...linkStyle, ...(isActive ? activeStyle : {}) })}
      >
        {t('settings.catTheme')}
      </NavLink>
      <NavLink
        to="/settings/backup"
        style={({ isActive }) => ({ ...linkStyle, ...(isActive ? activeStyle : {}) })}
      >
        {t('settings.catBackup')}
      </NavLink>
      <NavLink
        to="/settings/bulk-import"
        style={({ isActive }) => ({ ...linkStyle, ...(isActive ? activeStyle : {}) })}
      >
        {t('settings.catBulkImport')}
      </NavLink>
      <NavLink
        to="/settings/server"
        style={({ isActive }) => ({ ...linkStyle, ...(isActive ? activeStyle : {}) })}
      >
        {t('settings.catServer')}
      </NavLink>
      <NavLink
        to="/settings/other"
        style={({ isActive }) => ({ ...linkStyle, ...(isActive ? activeStyle : {}) })}
      >
        {t('settings.catOther')}
      </NavLink>
    </nav>
  );
}