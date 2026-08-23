import type { ResearchOutput } from '../types';
import { TargetsList } from './TargetsList';
import { OutboundKit } from './OutboundKit';
import { ConfidenceBadge } from './ConfidenceBadge';

interface Props {
  output: ResearchOutput;
}

export function ResearchPanel({ output }: Props) {
  return (
    <div className="research-panel">
      <section className="panel-section">
        <h2>Known facts</h2>
        <ul className="fact-list">
          {output.knownFacts.map((fact, index) => (
            <li key={index}>{fact}</li>
          ))}
        </ul>
      </section>

      <section className="panel-section">
        <h2>Three falsifiable hypotheses</h2>
        <div className="hypothesis-list">
          {output.hypotheses.map((h, index) => (
            <div key={index} className={`hypothesis-card confidence-${h.confidence}`}>
              <div className="hypothesis-header">
                <span className="hypothesis-number">{index + 1}</span>
                <span className={`confidence-pill ${h.confidence}`}>{h.confidence} confidence</span>
              </div>
              <p className="hypothesis-text">{h.text}</p>
              <div className="hypothesis-meta">
                <strong>Test on the call:</strong> {h.falsifiableTest}
              </div>
              <div className="hypothesis-meta">
                <strong>Evidence:</strong> {h.evidence}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel-section">
        <h2>10 potential targets</h2>
        <TargetsList targets={output.targets} />
      </section>

      <section className="panel-section">
        <h2>Likely priorities by persona</h2>
        <div className="priorities-grid">
          {Object.entries(output.priorities).map(([persona, priorities]) => (
            <div key={persona} className="priority-card">
              <h4>{persona}</h4>
              <ul>
                {priorities.map((p, index) => (
                  <li key={index}>{p}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="panel-section">
        <h2>Outbound kit</h2>
        <OutboundKit output={output} />
      </section>

      <section className="panel-section">
        <h2>Confidence / evidence</h2>
        <div className="confidence-list">
          {output.confidenceEvidence.map((item, index) => (
            <div key={index} className="confidence-row">
              <ConfidenceBadge item={item} />
              <span className="confidence-statement">{item.statement}</span>
              {item.source && <span className="confidence-source">Source: {item.source}</span>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
