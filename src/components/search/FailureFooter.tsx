import type { FailureKind } from '../../types';

export default function FailureFooter({
  failures,
  onRetryAll,
}: {
  failures: Array<{ sourceUrl: string; sourceName: string; error: string; kind: FailureKind }>;
  onRetryAll: () => void;
}) {
  return (
    <div data-testid="failure-footer" onClick={onRetryAll}>
      {failures.length} failures
    </div>
  );
}
