import { useState } from 'react';
import { api } from '../api';
import { useAccount } from '../useAccount';
import { Citations, Disclosure, Empty, EvidencePicker, Field } from '../components/ui';
import {
  DEVIN_USE_CASES,
  DEVIN_USE_CASE_LABELS,
  WEDGE_STATUSES,
  WEDGE_STATUS_LABELS,
  type DevinUseCase,
  type Wedge,
  type WedgeStatus,
} from '../domain/types';

export default function Wedges() {
  const { aggregate } = useAccount();

  return (
    <>
      <div className="card">
        <h2>Use-case wedges</h2>
        <p className="dim">
          The first bounded piece of work a Devin deployment would own. A wedge is validated only
          when evidence says the work exists, not when it sounds plausible.
        </p>
      </div>

      {aggregate.wedges.length === 0 ? (
        <Empty>No wedges yet.</Empty>
      ) : (
        aggregate.wedges.map((wedge) => <WedgeCard key={wedge.id} wedge={wedge} />)
      )}

      <AddWedge />
    </>
  );
}

function WedgeCard({ wedge }: { wedge: Wedge }) {
  const { aggregate, busy, run } = useAccount();
  const [editing, setEditing] = useState(false);
  const [evidenceIds, setEvidenceIds] = useState<string[]>(wedge.evidenceIds);

  const patch = (payload: Record<string, unknown>) =>
    run((rev) => api.patch(aggregate.account.id, 'wedges', wedge.id, rev, payload));

  return (
    <div className="card">
      <div className="row between">
        <div className="spread">
          <div className="row">
            <h3>{wedge.useCase}</h3>
            <span className="badge">{DEVIN_USE_CASE_LABELS[wedge.devinUseCase]}</span>
            <span className="badge">{WEDGE_STATUS_LABELS[wedge.status]}</span>
          </div>
          {wedge.businessProblem ? (
            <p style={{ marginTop: 6 }}>
              <strong>Business problem:</strong> {wedge.businessProblem}
            </p>
          ) : null}
          {wedge.technicalProblem ? (
            <p>
              <strong>Technical problem:</strong> {wedge.technicalProblem}
            </p>
          ) : null}
          {wedge.whyDevin ? (
            <p>
              <strong>Why Devin:</strong> {wedge.whyDevin}
            </p>
          ) : null}
          <div className="dim">
            {wedge.likelyOwnerRole ? `Owner: ${wedge.likelyOwnerRole}. ` : ''}
            {wedge.sponsorRole ? `Sponsor: ${wedge.sponsorRole}.` : ''}
          </div>
          {wedge.discoveryQuestion ? (
            <p className="muted" style={{ marginTop: 6 }}>
              <strong>Ask:</strong> {wedge.discoveryQuestion}
            </p>
          ) : null}
          {wedge.disqualifiers.length > 0 ? (
            <p className="dim">Kill it if: {wedge.disqualifiers.join('; ')}</p>
          ) : null}
          {wedge.disqualifiedReason ? (
            <p className="dim">Disqualified: {wedge.disqualifiedReason}</p>
          ) : null}
          <Citations ids={wedge.evidenceIds} evidence={aggregate.evidence} />
        </div>
        <div className="row">
          <select
            value={wedge.status}
            disabled={busy || wedge.status === 'disqualified'}
            title="Validating a wedge requires at least one citation."
            onChange={(e) => {
              const status = e.target.value as WedgeStatus;
              if (status === 'disqualified') {
                const reason = prompt('What did you hear that kills this wedge?');
                if (!reason) return;
                void patch({ status, disqualifiedReason: reason });
                return;
              }
              void patch({ status });
            }}
          >
            {WEDGE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {WEDGE_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
          <button className="small" onClick={() => setEditing(!editing)}>
            {editing ? 'Close' : 'Citations'}
          </button>
          <button
            className="small danger"
            disabled={busy}
            onClick={() =>
              void run((rev) => api.remove(aggregate.account.id, 'wedges', wedge.id, rev))
            }
          >
            Delete
          </button>
        </div>
      </div>

      {editing ? (
        <div style={{ marginTop: 12 }}>
          <Field label="Evidence this wedge rests on">
            <EvidencePicker
              evidence={aggregate.evidence}
              selected={evidenceIds}
              onChange={setEvidenceIds}
            />
          </Field>
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              const saved = await patch({ evidenceIds });
              if (saved) setEditing(false);
            }}
          >
            Save citations
          </button>
        </div>
      ) : null}
    </div>
  );
}

function AddWedge() {
  const { aggregate, busy, run } = useAccount();
  const [useCase, setUseCase] = useState('');
  const [devinUseCase, setDevinUseCase] = useState<DevinUseCase>('migration');
  const [businessProblem, setBusinessProblem] = useState('');
  const [technicalProblem, setTechnicalProblem] = useState('');
  const [whyDevin, setWhyDevin] = useState('');
  const [discoveryQuestion, setDiscoveryQuestion] = useState('');
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const saved = await run((rev) =>
      api.create(aggregate.account.id, 'wedges', rev, {
        useCase,
        devinUseCase,
        businessProblem,
        technicalProblem,
        whyDevin,
        discoveryQuestion,
        evidenceIds,
      })
    );
    if (saved) {
      setUseCase('');
      setBusinessProblem('');
      setTechnicalProblem('');
      setWhyDevin('');
      setDiscoveryQuestion('');
      setEvidenceIds([]);
    }
  }

  return (
    <Disclosure summary="Add a wedge">
      <form onSubmit={submit}>
        <div className="grid two">
          <Field label="Wedge">
            <input
              value={useCase}
              onChange={(e) => setUseCase(e.target.value)}
              placeholder="Retire Java 8 across the payments estate"
            />
          </Field>
          <Field label="Devin use case">
            <select
              value={devinUseCase}
              onChange={(e) => setDevinUseCase(e.target.value as DevinUseCase)}
            >
              {DEVIN_USE_CASES.map((useCaseOption) => (
                <option key={useCaseOption} value={useCaseOption}>
                  {DEVIN_USE_CASE_LABELS[useCaseOption]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Business problem">
          <textarea
            value={businessProblem}
            onChange={(e) => setBusinessProblem(e.target.value)}
          />
        </Field>
        <Field label="Technical problem">
          <textarea
            value={technicalProblem}
            onChange={(e) => setTechnicalProblem(e.target.value)}
          />
        </Field>
        <Field
          label="Why Devin"
          hint="Why an autonomous engineer beats hiring, offshoring, or an in-IDE assistant here."
        >
          <textarea value={whyDevin} onChange={(e) => setWhyDevin(e.target.value)} />
        </Field>
        <Field label="Discovery question">
          <input
            value={discoveryQuestion}
            onChange={(e) => setDiscoveryQuestion(e.target.value)}
          />
        </Field>
        <Field label="Evidence">
          <EvidencePicker
            evidence={aggregate.evidence}
            selected={evidenceIds}
            onChange={setEvidenceIds}
          />
        </Field>
        <button className="primary" disabled={busy || !useCase.trim()}>
          Save wedge
        </button>
      </form>
    </Disclosure>
  );
}
