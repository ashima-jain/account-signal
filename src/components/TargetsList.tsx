import type { TargetPerson, Persona } from '../types';

interface Props {
  targets: TargetPerson[];
}

const personaColor: Record<Persona, string> = {
  Planners: 'planners',
  Operations: 'operations',
  Builders: 'builders',
  'Other Folks': 'other',
};

export function TargetsList({ targets }: Props) {
  return (
    <div className="targets-list">
      {targets.map((target, index) => (
        <div key={index} className="target-card">
          <div className="target-header">
            <span className="target-name">{target.name || 'Unknown name'}</span>
            <span className={`persona-badge ${personaColor[target.persona]}`}>{target.persona}</span>
          </div>
          <div className="target-title">{target.title}</div>
          <div className="target-meta">
            <strong>Why relevant:</strong> {target.whyRelevant}
          </div>
          <div className="target-meta">
            <strong>Evidence:</strong> {target.evidence}
          </div>
        </div>
      ))}
    </div>
  );
}
