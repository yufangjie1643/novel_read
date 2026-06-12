import type { SourceStatus } from '../../types';

export default function SourceStatusStrip({
  statuses,
}: {
  statuses: SourceStatus[];
  onRetry: (url: string) => void;
}) {
  return <div data-testid="source-status-strip">{statuses.length} sources</div>;
}
