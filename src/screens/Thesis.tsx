import { useState } from 'react';
import { api } from '../api';
import { useAccount } from '../useAccount';
import { Citations, Disclosure, Empty, Field, StatusBadge } from '../components/ui';
import { formatDate } from '../format';
import { EvidencePicker } from '../components/ui';
import { isStale } from '../domain/claims';
import {
  CLAIM_CATEGORIES,
  CLAIM_CATEGORY_LABELS,
  CLAIM_STATUSES,
  RATING_CLAIM_CATEGORIES,
  type Claim,
  type ClaimCategory,
  type ClaimStatus,
} from '../domain/types';

export default function Thesis() {
  const { aggregate, busy, run } = useAccount();
  const { claims, evidence } = aggregate;

  const ratings = RATING_CLAIM_CATEGORIES.map((category) => ({
    category,
    claim: claims.find((c) => c.category === category),
  }));
  // Ratings first, then everything else, so the four criteria read as a block.
  const ordered = [...claims].sort(
    (a, b) => rank(a.category) - rank(b.category)
  );
  const unknowns = claims.filter((c) => c.status === 'UNKNOWN');

  return (
    <>
      <div className="card">
        <div className="row between">
          <h2>Why this account matters</h2>
          <button
            className="primary"
            disabled={busy || evidence.length === 0}
            title={
              evidence.length === 0
                ? 'Add or research evidence first — the thesis is written from the ledger.'
                : 'Rewrite the thesis and claims from the current ledger.'
            }
            onClick={() =>
              void run((rev) => api.generateThesis(aggregate.account.id, rev))
            }
          >
            {claims.length ? 'Regenerate thesis' : 'Generate thesis'}
          </button>
        </div>
        {aggregate.whyItMatters ? (
          <p style={{ marginTop: 8 }}>{aggregate.whyItMatters}</p>
        ) : (
          <p className="muted" style={{ marginTop: 8 }}>
            No thesis yet. It is written from the evidence ledger, so anything it says can be
            traced back to a source.
          </p>
        )}
      </div>

      <div className="card">
        <h2>Qualification</h2>
        <p className="dim">
          Four criteria. A rating is only as strong as the evidence under it, and Right to Win
          cannot be a fact until someone inside the account tells you something.
        </p>
        <div className="grid two" style={{ marginTop: 10 }}>
          {ratings.map(({ category, claim }) => (
            <div className="card tight" key={category}>
              <div className="row between">
                <h3>{CLAIM_CATEGORY_LABELS[category]}</h3>
                <StatusBadge status={claim?.status} />
              </div>
              {claim ? (
                <>
                  <p style={{ marginTop: 6 }}>{claim.text}</p>
                  <Citations ids={claim.evidenceIds} evidence={evidence} />
                </>
              ) : (
                <p className="muted" style={{ marginTop: 6 }}>
                  Not assessed.
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      {unknowns.length > 0 ? (
        <div className="card">
          <h2>Open unknowns</h2>
          <p className="dim">
            These are the things that have to be true. Each one is a discovery question, not a
            gap in the write-up.
          </p>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
            {unknowns.map((claim) => (
              <li key={claim.id}>{claim.text}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="card">
        <h2>All claims</h2>
        {claims.length === 0 ? (
          <Empty>No claims yet.</Empty>
        ) : (
          <div className="grid" style={{ marginTop: 10 }}>
            {ordered.map((claim) => (
              <ClaimRow key={claim.id} claim={claim} />
            ))}
          </div>
        )}
      </div>

      <AddClaim />
    </>
  );
}

function rank(category: ClaimCategory): number {
  const index = RATING_CLAIM_CATEGORIES.indexOf(category);
  return index === -1 ? RATING_CLAIM_CATEGORIES.length : index;
}

function ClaimRow({ claim }: { claim: Claim }) {
  const { aggregate, busy, run } = useAccount();
  const stale = isStale(claim, aggregate.evidence);

  const patch = (payload: Record<string, unknown>) =>
    void run((rev) => api.patch(aggregate.account.id, 'claims', claim.id, rev, payload));

  return (
    <div className="card tight">
      <div className="row between">
        <div className="spread">
          <div className="row">
            <span className="badge">{CLAIM_CATEGORY_LABELS[claim.category]}</span>
            <StatusBadge status={claim.status} />
            {stale ? <span className="badge stale">Stale</span> : null}
          </div>
          <p style={{ marginTop: 6 }}>{claim.text}</p>
          <Citations ids={claim.evidenceIds} evidence={aggregate.evidence} />
          <div className="dim" style={{ marginTop: 4 }}>
            As of {formatDate(claim.asOf)}
            {claim.reviewedAt ? ` · reviewed ${formatDate(claim.reviewedAt)}` : ''}
          </div>
        </div>
        <div className="row">
          <select
            value={claim.status}
            disabled={busy}
            onChange={(e) => patch({ status: e.target.value as ClaimStatus })}
          >
            {CLAIM_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          {stale ? (
            <button className="small" disabled={busy} onClick={() => patch({ revalidate: true })}>
              Still true
            </button>
          ) : null}
          <button
            className="small danger"
            disabled={busy}
            onClick={() =>
              void run((rev) => api.remove(aggregate.account.id, 'claims', claim.id, rev))
            }
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function AddClaim() {
  const { aggregate, busy, run } = useAccount();
  const [text, setText] = useState('');
  const [category, setCategory] = useState<ClaimCategory>('devin_fit');
  const [status, setStatus] = useState<ClaimStatus>('HYPOTHESIS');
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const saved = await run((rev) =>
      api.create(aggregate.account.id, 'claims', rev, {
        text,
        category,
        status,
        evidenceIds: status === 'UNKNOWN' ? [] : evidenceIds,
      })
    );
    if (saved) {
      setText('');
      setEvidenceIds([]);
    }
  }

  return (
    <Disclosure summary="Add a claim">
      <form onSubmit={submit}>
        <Field label="Claim">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Platform team owns a 400-repo Java 8 estate with an internal EOL deadline of Q3."
          />
        </Field>
        <div className="grid two">
          <Field label="Category">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ClaimCategory)}
            >
              {CLAIM_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CLAIM_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Status"
            hint="A fact needs a citation from a verifiable source. An unknown cannot cite anything."
          >
            <select value={status} onChange={(e) => setStatus(e.target.value as ClaimStatus)}>
              {CLAIM_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {status !== 'UNKNOWN' ? (
          <Field label="Evidence">
            <EvidencePicker
              evidence={aggregate.evidence}
              selected={evidenceIds}
              onChange={setEvidenceIds}
            />
          </Field>
        ) : null}
        <button className="primary" disabled={busy || !text.trim()}>
          Save claim
        </button>
      </form>
    </Disclosure>
  );
}
