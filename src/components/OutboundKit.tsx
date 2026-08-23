import { useState } from 'react';
import type { ResearchOutput } from '../types';

interface Props {
  output: ResearchOutput;
}

export function OutboundKit({ output }: Props) {
  const [emailBody, setEmailBody] = useState(output.email.body);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="outbound-kit">
      <section className="kit-section">
        <h3>Outbound email</h3>
        <div className="field">
          <label>Subject</label>
          <input type="text" value={output.email.subject} readOnly className="readonly-input" />
        </div>
        <div className="field">
          <label>Body (editable)</label>
          <textarea value={emailBody} onChange={e => setEmailBody(e.target.value)} rows={8} />
        </div>
        <button className="secondary" onClick={() => copyToClipboard(`Subject: ${output.email.subject}\n\n${emailBody}`)}>
          Copy full email
        </button>
      </section>

      <section className="kit-section">
        <h3>30-second cold-call opener</h3>
        <p className="script">{output.coldCallOpener}</p>
        <button className="secondary" onClick={() => copyToClipboard(output.coldCallOpener)}>
          Copy opener
        </button>
      </section>

      <section className="kit-section">
        <h3>Discovery questions</h3>
        <ol className="question-list">
          {output.discoveryQuestions.map((q, index) => (
            <li key={index}>
              <div className="question">{q.question}</div>
              <div className="question-why">{q.whyItWorks}</div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
