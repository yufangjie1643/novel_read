import { useTranslation } from 'react-i18next';
import { TipKind, readTipKind, tipKindLabel } from './TipValue';
import { useCallback } from 'react';

const TIP_KIND_KEYS: TipKind[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

/// localStorage key names for the 6 slots. Middle slots are
/// persisted but currently unused on web (we have no 5th position);
/// they exist so a future visual addition needs no migration.
const SLOT_KEYS = {
  hl: 'reader_tip_header_left',
  hm: 'reader_tip_header_middle',
  hr: 'reader_tip_header_right',
  fl: 'reader_tip_footer_left',
  fm: 'reader_tip_footer_middle',
  fr: 'reader_tip_footer_right',
} as const;

type SlotKey = (typeof SLOT_KEYS)[keyof typeof SLOT_KEYS];

/// Save a new kind to a slot, applying the fork's `clearRepeat`
/// rule: any other slot that already holds the same kind is reset
/// to `none` (0) so the user doesn't see the same value duplicated
/// in two slots at once.
function setTipSlot(slot: SlotKey, value: TipKind) {
  if (value !== 0) {
    for (const k of Object.values(SLOT_KEYS) as SlotKey[]) {
      if (k === slot) continue;
      const cur = readTipKind(k, 0);
      if (cur === value) {
        localStorage.setItem(k, '0');
      }
    }
  }
  localStorage.setItem(slot, String(value));
  // Nudge listeners — the host reads via the same localStorage keys,
  // so the cheapest way to update the rendered chrome is a synthetic
  // 'storage' event. (LocalStorage writes in the same window don't
  // fire 'storage' on their own.)
  window.dispatchEvent(new StorageEvent('storage', { key: slot }));
}

interface TipSettingsSectionProps {
  /// Live values for the 4 visible slots (header left/right,
  /// footer left/right). The middle slots are hidden in web chrome
  /// but still configurable through the picker.
  headerLeft: TipKind;
  headerRight: TipKind;
  footerLeft: TipKind;
  footerRight: TipKind;
  /// Generic row label + dropdown style, to match the surrounding
  /// settings panel.
  labelStyle: React.CSSProperties;
  selectStyle: React.CSSProperties;
}

/**
 * 4-row picker for the 4 visible tip slots. The middle slots are
 * hidden on web (no 5th position to put them in) but the
 * `clearRepeat` rule still applies across all 6 persisted keys.
 */
export default function TipSettingsSection({
  headerLeft,
  headerRight,
  footerLeft,
  footerRight,
  labelStyle,
  selectStyle,
}: TipSettingsSectionProps) {
  const { t } = useTranslation();
  const renderRow = useCallback(
    (
      labelKey: string,
      slot: SlotKey,
      value: TipKind
    ) => (
      <div
        key={slot}
        style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
      >
        <span style={labelStyle}>{t(labelKey)}</span>
        <select
          value={String(value)}
          onChange={(e) => setTipSlot(slot, parseInt(e.target.value, 10) as TipKind)}
          style={selectStyle}
        >
          {TIP_KIND_KEYS.map((k) => (
            <option key={k} value={String(k)}>
              {tipKindLabel(k, t)}
            </option>
          ))}
        </select>
      </div>
    ),
    [t, labelStyle, selectStyle]
  );

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {renderRow('reader.tipHeaderLeft', SLOT_KEYS.hl, headerLeft)}
      {renderRow('reader.tipHeaderRight', SLOT_KEYS.hr, headerRight)}
      {renderRow('reader.tipFooterLeft', SLOT_KEYS.fl, footerLeft)}
      {renderRow('reader.tipFooterRight', SLOT_KEYS.fr, footerRight)}
    </div>
  );
}
