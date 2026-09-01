import { useState } from 'react';
import { api } from '../api';
import { useAccount } from '../useAccount';
import { Disclosure, Empty, Field, StatusBadge } from '../components/ui';
import { formatDate } from '../format';
import { citationCount, demotionsIfRemoved } from '../domain/claims';
import {
  CLAIM_STATUSES,
  EVIDENCE_CATEGORIES,
  EVIDENCE_CATEGORY_LABELS,
  EVIDENCE_CATEGORY_QUESTIONS,
  SOURCE_SYSTEMS,
  SOURCE_TYPES,
  SOURCE_TYPE_LABELS,
  isVerifiableSource,
  type ClaimStatus,
  type EvidenceCategory,
  type EvidenceItem,
  type SourceSystem,
  type SourceType,
} from '../domain/types';

export default function EvidenceLedger() {
  const { aggregate } = useAccount();
  const [category, setCategory] = useState<EvidenceCategory | 'all'>('all');

  const visible =
    category === 'all'
      ? aggregate.evidence
      : aggregate.evidence.filter((e) => e.evidenceCategory === category);

  return (
    <>
      <div className="card">
        <div className="row between">
          <div>
            <h2>Evidence ledger</h2>
            <p className="dim">
              Everything downstream — claims, wedges, champion signals — points back at a row in
              here. Delete a row and whatever rested on it is demoted.
            </p>
          </div>
          <select
            style={{ width: 'auto' }}
            value={category}
            onChange={(e) => setCategory(e.target.value as EvidenceCategory | 'all')}
          >
            <option value="all">All criteria</option>
            {EVIDENCE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {EVIDENCE_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        {category !== 'all' ? (
          <p className="muted" style={{ marginTop: 8 }}>
            {EVIDENCE_CATEGORY_QUESTIONS[category]}
          </p>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <Empty>Nothing recorded under this criterion yet.</Empty>
      ) : (
        visible.map((item) => <EvidenceRow key={item.id} item={item} />)
      )}

      <AddEvidence />
    </>
  );
}

function EvidenceRow({ item }: { item: EvidenceItem }) {
  const { aggregate, busy, run } = useAccount();
  const cites = citationCount(item.id, aggregate.claims);
  const demotions = demotionsIfRemoved(item.id, aggregate.claims, aggregate.evidence);

  return (
    <div className="card">
      <div className="row between">
        <div className="spread">
          <div className="row">
            <span className="badge">{SOURCE_TYPE_LABELS[item.sourceType]}</span>
            {item.evidenceCategory ? (
              <span className="badge">
                {EVIDENCE_CATEGORY_LABELS[item.evidenceCategory]}
              </span>
            ) : null}
            <StatusBadge status={item.status} />
            {item.confidential ? <span className="badge stale">Confidential</span> : null}
          </div>
          <p className="verbatim" style={{ marginTop: 8 }}>
            {item.verbatim}
          </p>
          <div className="dim" style={{ marginTop: 6 }}>
            {item.sourceRef ? `${item.sourceRef} · ` : ''}as of {formatDate(item.asOf)} ·{' '}
            {cites} citation{cites === 1 ? '' : 's'}
            {item.externalUrl ? (
              <>
                {' · '}
                <a href={item.externalUrl} target="_blank" rel="noreferrer">
                  source
                </a>
              </>
            ) : null}
          </div>
          {item.implicationForDevin ? (
            <p className="muted" style={{ marginTop: 6 }}>
              <strong>For Devin:</strong> {item.implicationForDevin}
            </p>
          ) : null}
          {item.nextDiscoveryQuestion ? (
            <p className="muted">
              <strong>Ask next:</strong> {item.nextDiscoveryQuestion}
            </p>
          ) : null}
        </div>
        <div className="row">
          <select
            value={item.status ?? ''}
            disabled={busy}
            title={
              isVerifiableSource(item.sourceType)
                ? undefined
                : 'Inference can never be a fact.'
            }
            onChange={(e) =>
              void run((rev) =>
                api.patch(aggregate.account.id, 'evidence', item.id, rev, {
                  status: e.target.value === '' ? null : (e.target.value as ClaimStatus),
                })
              )
            }
          >
            <option value="">Unreviewed</option>
            {CLAIM_STATUSES.map((status) => (
              <option
                key={status}
                value={status}
                disabled={status === 'FACT' && !isVerifiableSource(item.sourceType)}
              >
                {status}
              </option>
            ))}
          </select>
          <button
            className="small danger"
            disabled={busy}
            title={
              demotions.length
                ? `${demotions.length} claim(s) will be demoted to HYPOTHESIS.`
                : undefined
            }
            onClick={() => {
              if (
                demotions.length > 0 &&
                !confirm(
                  `Removing this demotes ${demotions.length} claim(s) to HYPOTHESIS:\n\n${demotions
                    .map((claim) => `• ${claim.text}`)
                    .join('\n')}\n\nContinue?`
                )
              ) {
                return;
              }
              void run((rev) =>
                api.remove(aggregate.account.id, 'evidence', item.id, rev)
              );
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function AddEvidence() {
  const { aggregate, busy, run } = useAccount();
  const [verbatim, setVerbatim] = useState('');
  const [sourceType, setSourceType] = useState<SourceType>('conversation');
  const [sourceSystem, setSourceSystem] = useState<SourceSystem>('manual');
  const [sourceRef, setSourceRef] = useState('');
  const [externalUrl, setExternalUrl] = useState('');
  const [category, setCategory] = useState<EvidenceCategory>('devin_fit');
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [confidential, setConfidential] = useState(false);
  const [stakeholderId, setStakeholderId] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const saved = await run((rev) =>
      api.create(aggregate.account.id, 'evidence', rev, {
        verbatim,
        sourceType,
        sourceSystem,
        sourceRef: sourceRef || undefined,
        externalUrl: externalUrl || undefined,
        evidenceCategory: category,
        asOf,
        confidential,
        stakeholderId: stakeholderId || undefined,
      })
    );
    if (saved) {
      setVerbatim('');
      setSourceRef('');
      setExternalUrl('');
    }
  }

  return (
    <Disclosure summary="Record evidence">
      <form onSubmit={submit}>
        <Field
          label="What was said or written"
          hint="Quote it. A paraphrase you cannot repeat back to them is not evidence."
        >
          <textarea value={verbatim} onChange={(e) => setVerbatim(e.target.value)} />
        </Field>
        <div className="grid two">
          <Field label="Source type">
            <select
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value as SourceType)}
            >
              {SOURCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {SOURCE_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Source system">
            <select
              value={sourceSystem}
              onChange={(e) => setSourceSystem(e.target.value as SourceSystem)}
            >
              {SOURCE_SYSTEMS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Where it came from">
            <input
              value={sourceRef}
              onChange={(e) => setSourceRef(e.target.value)}
              placeholder="Call with VP Platform, 12 Feb"
            />
          </Field>
          <Field label="Link">
            <input value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} />
          </Field>
          <Field label="Criterion">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as EvidenceCategory)}
            >
              {EVIDENCE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {EVIDENCE_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="As of" hint="When it was true. Staleness is measured from this date.">
            <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          </Field>
          <Field label="Attributed to">
            <select value={stakeholderId} onChange={(e) => setStakeholderId(e.target.value)}>
              <option value="">Nobody in particular</option>
              {aggregate.stakeholders.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <label className="checkline">
          <input
            type="checkbox"
            checked={confidential}
            onChange={(e) => setConfidential(e.target.checked)}
          />
          <span>Shared in confidence — never quote this outside the account team.</span>
        </label>
        <button className="primary" style={{ marginTop: 10 }} disabled={busy || !verbatim.trim()}>
          Save evidence
        </button>
      </form>
    </Disclosure>
  );
}
