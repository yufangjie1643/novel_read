import type { CSSProperties } from 'react';
import { useUiMode } from '../../uiMode';

export function useSettingsStyles() {
  const { isMobileUi } = useUiMode();
  const sectionStyle: CSSProperties = {
    background: '#fff',
    borderRadius: 8,
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
    padding: isMobileUi ? 16 : 24,
    marginBottom: 20,
  };
  const sectionTitle: CSSProperties = {
    fontSize: 16,
    fontWeight: 700,
    color: '#1a1a2e',
    margin: '0 0 16px',
  };
  const rowStyle: CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: isMobileUi ? 'stretch' : 'center',
    flexDirection: isMobileUi ? 'column' : 'row',
    gap: isMobileUi ? 8 : 12,
    padding: '12px 0',
    borderBottom: '1px solid #f8f8f8',
  };
  const labelStyle: CSSProperties = {
    fontSize: 14,
    color: '#555',
  };
  return { sectionStyle, sectionTitle, rowStyle, labelStyle };
}
