import type { ConfidenceEvidence } from '../types';

interface Props {
  item: ConfidenceEvidence;
}

export function ConfidenceBadge({ item }: Props) {
  return (
    <span className={`badge ${item.type}`}>
      {item.type === 'fact' ? 'Fact' : 'Assumption'}
    </span>
  );
}
