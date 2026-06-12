import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FailureKind } from '../../types';

interface Failure {
  sourceUrl: string;
  sourceName: string;
  error: string;
  kind: FailureKind;
}

export default function FailureFooter({
  failures,
  onRetryAll,
}: {
  failures: Failure[];
  onRetryAll: () => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  if (failures.length === 0) return null;

  return (
    <div
      data-testid="failure-footer"
      style={{
        background: '#fff3e0',
        border: '1px solid #ffe0b2',
        borderRadius: 10,
        padding: 12,
        marginBottom: 16,
        marginTop: 16,
      }}
    >
      <div
        onClick={() => setExpanded((x) => !x)}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
          fontSize: 14,
          fontWeight: 600,
          color: '#e65100',
        }}
      >
        <span>
          ⚠ {t('home.failureFooterTitle', { count: failures.length, defaultValue: `${failures.length} source(s) failed` })} {expanded ? '▾' : '▸'}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRetryAll();
          }}
          style={{
            padding: '4px 12px',
            borderRadius: 6,
            border: '1px solid #ffb74d',
            background: '#fff',
            color: '#e65100',
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          {t('home.retryAll', 'Retry all')}
        </button>
      </div>
      {expanded && (
        <ul style={{ margin: '12px 0 0', padding: 0, listStyle: 'none' }}>
          {failures.map((f) => (
            <li
              key={f.sourceUrl}
              style={{
                padding: '6px 0',
                fontSize: 13,
                color: '#bf360c',
                borderTop: '1px solid #ffe0b2',
              }}
            >
              <strong>{f.sourceName}</strong>: {f.error}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
