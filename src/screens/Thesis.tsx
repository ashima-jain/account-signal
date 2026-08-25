import { useMemo, useState } from 'react';
import { api } from '../api';
import {
  CLAIM_CATEGORIES,
  CLAIM_CATEGORY_LABELS,
  type Claim,
  type ClaimCategory,
  type ClaimStatus,
  type ID,
} from '../domain/types';
import {
  CLAIM_STALE_AFTER_DAYS,
  canSupportFact,
  citedEvidence,
  claimIsStale,
} from '../domain/claims';
import { useAccount } from './AccountLayout';
import { EmptyState } from '../components/Feedback';
import { Chip, SourceChip, StatusChip } from '../components/Chips';
import { ageLabel, formatDate } from '../lib/format';

const STATUSES: ClaimStatus[] = ['FACT', 'HYPOTHESIS', 'UNKNOWN'];

export default function Thesis() {
  const { aggregate, apply, setError } = useAccount();
  const [text, setText] = useState('');
  const [status, setStatus] = useState<ClaimStatus>('HYPOTHESIS');
  const [category, setCategory] = useState<ClaimCategory>('why_now');
  const [selected, setSelected] = useState<ID[]>([]);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<ID | null>(null);

  const counts = useMemo(
    () => ({
      FACT: aggregate.claims.filter((c) => c.status === 'FACT').length,
      HYPOTHESIS: aggregate.claims.filter((c) => c.status === 'HYPOTHESIS').length,
      UNKNOWN: aggregate.claims.filter((c) => c.status === 'UNKNOWN').length,
    }),
    [aggregate.claims]
  );

  // Mirrors the server rule so the form explains the constraint before a
  // submission is rejected.
  const citableSelected = selected
    .map((id) => aggregate.evidence.find((e) => e.id === id))
    .filter((e) => e !== undefined && canSupportFact(e));
  const factBlocked = status === 'FACT' && citableSelected.length === 0;
  const unknownBlocked = status === 'UNKNOWN' && selected.length > 0;

  function toggleEvidence(id: ID) {
    setSelected((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    );
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!text.trim() || factBlocked || unknownBlocked) return;

    setBusy(true);
    setError(null);
    try {
      apply(
        await api.addClaim(aggregate.account.id, aggregate.rev, {
          text: text.trim(),
          status,
          category,
          evidenceIds: selected,
        })
      );
      setText('');
      setSelected([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the claim.');
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(claim: Claim, next: ClaimStatus) {
    const reason = window.prompt(
      `Why is "${claim.text}" moving from ${claim.status} to ${next}?`,
      ''
    );
    if (reason === null) return;

    setError(null);
    try {
      apply(
        await api.updateClaim(aggregate.account.id, claim.id, aggregate.rev, {
          status: next,
          reason: reason.trim() || undefined,
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the status.');
    }
  }

  async function revalidate(claim: Claim) {
    setError(null);
    try {
      apply(
        await api.updateClaim(aggregate.account.id, claim.id, aggregate.rev, { revalidate: true })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not confirm the claim.');
    }
  }

  async function remove(claim: Claim) {
    if (!window.confirm(`Remove "${claim.text}"?`)) return;
    setError(null);
    try {
      apply(await api.deleteClaim(aggregate.account.id, claim.id, aggregate.rev));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the claim.');
    }
  }

  return (
    <div className="panel-stack">
      <div className="card">
        <div className="card-head">
          <h2>Account thesis</h2>
          <div className="chip-row">
            <Chip label={`${counts.FACT} facts`} tone="good" />
            <Chip label={`${counts.HYPOTHESIS} hypotheses`} />
            <Chip label={`${counts.UNKNOWN} unknowns`} tone="warn" />
          </div>
        </div>

        {aggregate.claims.length === 0 ? (
          <EmptyState title="No claims yet.">
            <p>
              On a new account nearly everything is unknown. Write down what you actually know as
              a FACT with a citation, what you suspect as a HYPOTHESIS, and name the UNKNOWNs
              explicitly. The unknowns are what the next action should go and resolve.
            </p>
          </EmptyState>
        ) : (
          CLAIM_CATEGORIES.filter((cat) => aggregate.claims.some((c) => c.category === cat)).map(
            (cat) => (
              <div key={cat} className="claim-group">
                <h3>{CLAIM_CATEGORY_LABELS[cat]}</h3>
                <ul className="claim-list">
                  {aggregate.claims
                    .filter((claim) => claim.category === cat)
                    .map((claim) => {
                      const cited = citedEvidence(claim, aggregate.evidence);
                      const stale = claimIsStale(claim);
                      return (
                        <li key={claim.id}>
                          <div className="claim-row">
                            <StatusChip status={claim.status} />
                            <span className="claim-text">{claim.text}</span>
                            {stale && claim.status !== 'UNKNOWN' && (
                              <Chip
                                label={`Unreviewed for ${CLAIM_STALE_AFTER_DAYS}+ days`}
                                tone="warn"
                              />
                            )}
                          </div>

                          <div className="claim-actions">
                            {cited.length > 0 && (
                              <button
                                type="button"
                                className="link-button"
                                onClick={() => setExpanded(expanded === claim.id ? null : claim.id)}
                              >
                                {cited.length} citation{cited.length === 1 ? '' : 's'}
                              </button>
                            )}
                            {STATUSES.filter((s) => s !== claim.status).map((s) => (
                              <button
                                key={s}
                                type="button"
                                className="link-button"
                                onClick={() => changeStatus(claim, s)}
                              >
                                Mark {s}
                              </button>
                            ))}
                            {stale && (
                              <button
                                type="button"
                                className="link-button"
                                onClick={() => revalidate(claim)}
                              >
                                Still true
                              </button>
                            )}
                            <button
                              type="button"
                              className="link-button danger-quiet"
                              onClick={() => remove(claim)}
                            >
                              Remove
                            </button>
                          </div>

                          {expanded === claim.id && (
                            <ul className="citation-list">
                              {cited.map((item) => (
                                <li key={item.id}>
                                  <SourceChip sourceType={item.sourceType} />
                                  <blockquote>{item.verbatim}</blockquote>
                                  <span className="subtle">
                                    {item.sourceRef ? `${item.sourceRef} · ` : ''}
                                    {formatDate(item.asOf)} ({ageLabel(item.asOf)})
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                </ul>
              </div>
            )
          )
        )}
      </div>

      <form className="card form-grid" onSubmit={add}>
        <h2>Add a claim</h2>

        <label className="span-2">
          <span>Claim</span>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="They are consolidating developer tooling spend this year"
            required
          />
        </label>

        <label>
          <span>Category</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as ClaimCategory)}
          >
            {CLAIM_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {CLAIM_CATEGORY_LABELS[cat]}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as ClaimStatus)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        {aggregate.evidence.length > 0 && (
          <fieldset className="span-2">
            <legend>Citations</legend>
            <ul className="citation-picker">
              {aggregate.evidence.map((item) => (
                <li key={item.id}>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={selected.includes(item.id)}
                      onChange={() => toggleEvidence(item.id)}
                    />
                    <span>
                      <SourceChip sourceType={item.sourceType} />{' '}
                      {item.verbatim.length > 120
                        ? `${item.verbatim.slice(0, 120)}…`
                        : item.verbatim}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        )}

        {factBlocked && (
          <p className="hint span-2">
            A FACT needs at least one citation that is not an inference. Cite a source above, or
            record this as a HYPOTHESIS.
          </p>
        )}
        {unknownBlocked && (
          <p className="hint span-2">
            An UNKNOWN cannot cite evidence. If you have evidence for it, it is at least a
            HYPOTHESIS.
          </p>
        )}

        <div className="form-actions span-2">
          <button type="submit" disabled={busy || !text.trim() || factBlocked || unknownBlocked}>
            {busy ? 'Saving…' : 'Add claim'}
          </button>
        </div>
      </form>
    </div>
  );
}
