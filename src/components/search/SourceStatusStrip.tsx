import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SourceStatus as Status } from '../../types';
import { useUiMode } from '../../uiMode';

const STATUS_STYLES: Record<Status['state'], { bg: string; color: string; pulse?: boolean }> = {
  pending: { bg: '#e0e0e0', color: '#666' },
  running: { bg: '#1976d2', color: '#fff', pulse: true },
  ok: { bg: '#4caf50', color: '#fff' },
  failed: { bg: '#f44336', color: '#fff' },
};

const MAX_VISIBLE_PILLS = 20;

export default function SourceStatusStrip({ statuses }: { statuses: Status[] }) {
  const { t } = useTranslation();
  const { isMobileUi } = useUiMode();
  const [expanded, setExpanded] = useState(false);

  const counts = useMemo(() => {
    let pending = 0;
    let running = 0;
    let ok = 0;
    let failed = 0;
    for (const s of statuses) {
      if (s.state === 'pending') pending++;
      else if (s.state === 'running') running++;
      else if (s.state === 'ok') ok++;
      else if (s.state === 'failed') failed++;
    }
    return { pending, running, ok, failed, total: statuses.length };
  }, [statuses]);

  // When collapsed, show the in-flight + done sources (most relevant to
  // the user's eye). Pending ones are hidden because there can be
  // thousands and they're all grey.
  const visible = useMemo(() => {
    if (expanded) return statuses;
    const interesting = statuses.filter((s) => s.state !== 'pending');
    if (interesting.length > MAX_VISIBLE_PILLS) {
      return [
        ...interesting.slice(0, MAX_VISIBLE_PILLS),
        ...statuses.filter((s) => s.state === 'pending').slice(0, 5),
      ];
    }
    // Not many interesting — fill remainder with up to 5 pending
    if (interesting.length < MAX_VISIBLE_PILLS) {
      const pendingSlots = MAX_VISIBLE_PILLS - interesting.length;
      return [
        ...interesting,
        ...statuses.filter((s) => s.state === 'pending').slice(0, pendingSlots),
      ];
    }
    return interesting;
  }, [statuses, expanded]);

  const remaining = statuses.length - visible.length;
  const summary = `${counts.running} ${t('home.sourceRunning', 'Searching')} · ${counts.ok} ${t('home.sourceOk', 'Done')} · ${counts.failed} ${t('home.sourceHttpError', 'HTTP error')}`;

  return (
    <div
      data-testid="source-status-strip"
      style={{
        marginBottom: 16,
        padding: 12,
        background: '#fafbfc',
        borderRadius: 10,
      }}
    >
      <div
        onClick={() => setExpanded((x) => !x)}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
          userSelect: 'none',
          fontSize: 13,
          color: '#555',
        }}
        title={t('home.clickToExpandSources', 'Click to expand source list')}
      >
        <span>
          📡 {summary} <span style={{ color: '#999' }}>/ {counts.total}</span>
        </span>
        <span style={{ color: '#999', fontSize: 12 }}>
          {expanded ? '▴' : `▾ +${remaining} ${t('home.more', 'more')}`}
        </span>
      </div>
      {expanded && (
        <div
          style={{
            display: 'flex',
            flexDirection: isMobileUi ? 'column' : 'row',
            flexWrap: 'wrap',
            gap: 8,
            marginTop: 10,
          }}
        >
          {visible.map((s) => {
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
                style={{
                  padding: '4px 10px',
                  borderRadius: 16,
                  background: style.bg,
                  color: style.color,
                  fontSize: 12,
                  fontWeight: 500,
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
        </div>
      )}
      <style>{`@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.6; } }`}</style>
    </div>
  );
}
