import { useTranslation } from 'react-i18next';
import type { SourceStatus as Status, SourceKey } from '../../types';
import { useUiMode } from '../../uiMode';

const STATUS_STYLES: Record<Status['state'], { bg: string; color: string; pulse?: boolean }> = {
  pending: { bg: '#e0e0e0', color: '#666' },
  running: { bg: '#1976d2', color: '#fff', pulse: true },
  ok: { bg: '#4caf50', color: '#fff' },
  failed: { bg: '#f44336', color: '#fff' },
};

export default function SourceStatusStrip({
  statuses,
  onRetry,
}: {
  statuses: Status[];
  onRetry: (url: SourceKey) => void;
}) {
  const { t } = useTranslation();
  const { isMobileUi } = useUiMode();

  return (
    <div
      data-testid="source-status-strip"
      style={{
        display: 'flex',
        flexDirection: isMobileUi ? 'column' : 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 16,
        padding: 12,
        background: '#fafbfc',
        borderRadius: 10,
      }}
    >
      {statuses.map((s) => {
        const style = STATUS_STYLES[s.state];
        const label =
          s.state === 'pending'
            ? t('home.sourcePending', 'Waiting')
            : s.state === 'running'
            ? t('home.sourceRunning', 'Searching')
            : s.state === 'ok'
            ? t('home.sourceOk', 'Done')
            : s.kind === 'Timeout'
            ? t('home.sourceTimeout', 'Timeout')
            : s.kind === 'Parse'
            ? t('home.sourceParseError', 'Parse error')
            : t('home.sourceHttpError', 'HTTP error');
        const titleText = s.state === 'failed' ? s.error : s.sourceName;
        return (
          <span
            key={s.sourceUrl}
            onClick={() => s.state === 'failed' && onRetry(s.sourceUrl)}
            style={{
              padding: '4px 10px',
              borderRadius: 16,
              background: style.bg,
              color: style.color,
              fontSize: 12,
              fontWeight: 500,
              cursor: s.state === 'failed' ? 'pointer' : 'default',
              animation: style.pulse ? 'pulse 1.5s ease-in-out infinite' : 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
            title={titleText}
          >
            {s.sourceName}: {label}
          </span>
        );
      })}
      <style>{`@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.6; } }`}</style>
    </div>
  );
}
