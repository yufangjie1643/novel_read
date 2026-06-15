import type { ExploreKind } from '../../types';

export function ExploreKindChip({
  kind,
  onClick,
  onErrorClick,
}: {
  kind: ExploreKind;
  onClick: () => void;
  onErrorClick: (kind: ExploreKind) => void;
}) {
  const isError = kind.title.startsWith('ERROR:');
  const disabled = !isError && (!kind.url || kind.url.trim() === '');

  if (isError) {
    return (
      <button
        type="button"
        onClick={() => onErrorClick(kind)}
        style={{
          padding: '4px 12px',
          borderRadius: 999,
          border: '1px solid #ffcdd2',
          background: '#fff0f0',
          color: '#f44336',
          fontSize: 13,
          fontWeight: 500,
          cursor: 'pointer',
          maxWidth: 240,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={kind.title}
      >
        {kind.title}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '4px 12px',
        borderRadius: 999,
        border: '1px solid #e0e0e0',
        background: disabled ? '#f5f5f5' : '#f5f7fa',
        color: disabled ? '#bbb' : '#555',
        fontSize: 13,
        fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        maxWidth: 240,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        transition: 'background 0.15s, border-color 0.15s, color 0.15s',
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = '#1976d2';
        e.currentTarget.style.borderColor = '#1976d2';
        e.currentTarget.style.color = '#fff';
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = '#f5f7fa';
        e.currentTarget.style.borderColor = '#e0e0e0';
        e.currentTarget.style.color = '#555';
      }}
    >
      {kind.title}
    </button>
  );
}
