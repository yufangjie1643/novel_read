import { useTranslation } from 'react-i18next';
import type { BookSourceGroup as Group, ExploreKind } from '../../types';
import { useLongPress } from '../../hooks/useLongPress';
import { ExploreKindChip } from './ExploreKindChip';

export type KindsState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; kinds: ExploreKind[] }
  | { kind: 'error'; message: string };

export function BookSourceGroup({
  group,
  kindsState,
  isExpanded,
  onToggle,
  onChipClick,
  onErrorClick,
  onMenuOpen,
  onRetryKinds,
}: {
  group: Group;
  kindsState: KindsState;
  isExpanded: boolean;
  onToggle: () => void;
  onChipClick: (kind: ExploreKind) => void;
  onErrorClick: (kind: ExploreKind) => void;
  onMenuOpen: () => void;
  onRetryKinds: () => void;
}) {
  const { t } = useTranslation();
  const longPress = useLongPress(onMenuOpen, { threshold: 500 });

  const handleRowClick = longPress.handleClick(onToggle);
  const showSpinner = isExpanded && kindsState.kind === 'loading';

  return (
    <div style={{ padding: '4px 0' }}>
      <div
        role="button"
        tabIndex={0}
        onClick={handleRowClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
        onPointerDown={longPress.onPointerDown}
        onPointerUp={longPress.onPointerUp}
        onPointerCancel={longPress.onPointerCancel}
        onPointerLeave={longPress.onPointerLeave}
        data-source-row={group.sourceUrl}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '8px 16px',
          background: isExpanded ? '#eef4fd' : '#fff',
          borderRadius: 8,
          cursor: 'pointer',
          userSelect: 'none',
          gap: 10,
        }}
      >
        <span
          aria-label={isExpanded ? t('explore.collapse') : t('explore.expand')}
          style={{
            fontSize: 12,
            color: '#888',
            width: 16,
            display: 'inline-block',
            textAlign: 'center',
          }}
        >
          {isExpanded ? '▾' : '▸'}
        </span>
        <span style={{ flex: 1, fontSize: 15, fontWeight: 600, color: '#1a1a2e' }}>
          {group.sourceName}
        </span>
        {group.sourceGroup && (
          <span
            style={{
              fontSize: 11,
              color: '#888',
              background: '#f5f7fa',
              padding: '2px 8px',
              borderRadius: 4,
            }}
          >
            {group.sourceGroup}
          </span>
        )}
        {showSpinner && (
          <span
            role="status"
            aria-live="polite"
            aria-label={t('common.loading')}
            style={{
              width: 16,
              height: 16,
              border: '2px solid #e0e0e0',
              borderTopColor: '#1976d2',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }}
          />
        )}
      </div>
      {isExpanded && (
        <div
          style={{
            padding: '8px 16px 12px 32px',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          {kindsState.kind === 'loading' && (
            <span style={{ color: '#888', fontSize: 13 }}>
              {t('common.loading')}
            </span>
          )}
          {kindsState.kind === 'error' && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#c62828', fontSize: 13 }}>
              {t('explore.kindsFailed')}
              <button
                onClick={onRetryKinds}
                style={{
                  padding: '2px 10px',
                  borderRadius: 6,
                  border: '1px solid #ffcdd2',
                  background: '#fff',
                  color: '#c62828',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {t('explore.kindsRetry')}
              </button>
            </span>
          )}
          {kindsState.kind === 'ok' && kindsState.kinds.length === 0 && (
            <span style={{ color: '#888', fontSize: 13 }}>{t('explore.emptyKinds')}</span>
          )}
          {kindsState.kind === 'ok' &&
            kindsState.kinds.map((kind, idx) => (
              <ExploreKindChip
                key={`${kind.title}-${idx}`}
                kind={kind}
                onClick={() => onChipClick(kind)}
                onErrorClick={onErrorClick}
              />
            ))}
        </div>
      )}
    </div>
  );
}
