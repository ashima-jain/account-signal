import type { ClaimStatus, SourceType } from '../domain/types';
import { SOURCE_TYPE_LABELS } from '../domain/types';

/**
 * The status chip is the most important pixel in the product: it is how the
 * seller tells at a glance what is known from what is guessed.
 */
export function StatusChip({ status }: { status: ClaimStatus }) {
  return <span className={`chip chip-${status.toLowerCase()}`}>{status}</span>;
}

export function SourceChip({ sourceType }: { sourceType: SourceType }) {
  const isInference = sourceType === 'inference';
  return (
    <span className={`chip chip-source${isInference ? ' chip-inference' : ''}`}>
      {SOURCE_TYPE_LABELS[sourceType]}
    </span>
  );
}

export function Chip({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'warn' | 'good';
}) {
  return <span className={`chip chip-${tone}`}>{label}</span>;
}
