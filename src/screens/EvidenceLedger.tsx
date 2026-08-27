import { useMemo, useState } from 'react';
import { api, type EvidenceInput } from '../api';
import {
  SOURCE_TYPES,
  SOURCE_TYPE_LABELS,
  EVIDENCE_CATEGORIES,
  EVIDENCE_CATEGORY_LABELS,
  type Claim,
  type EvidenceItem,
  type SourceType,
} from '../domain/types';
import { supportedStatus } from '../domain/claims';
import { useAccount } from './AccountLayout';
import { EmptyState } from '../components/Feedback';
import { Chip, SourceChip } from '../components/Chips';
import { ageLabel, formatDate, toDateInput } from '../lib/format';

/**
 * Which FACTs would stop being facts if this evidence were removed. Computed
 * with the same function the server uses, so the warning cannot disagree with
 * what actually happens.
 */
function demotionImpact(evidenceId: string, claims: Claim[], evidence: EvidenceItem[]): Claim[] {
  const remaining = evidence.filter((e) => e.id !== evidenceId);
  return claims.filter((claim) => {
    if (claim.status !== 'FACT' || !claim.evidenceIds.includes(evidenceId)) return false;
    const trimmed: Claim = {
      ...claim,
      evidenceIds: claim.evidenceIds.filter((id) => id !== evidenceId),
    };
    return supportedStatus(trimmed, remaining) !== 'FACT';
  });
}

function renderEvidenceItem(
  item: EvidenceItem,
  cited: number,
  remove: (item: EvidenceItem) => void,
) {
  return (
    <li key={item.id}>
      <div className="evidence-meta">
        <SourceChip sourceType={item.sourceType} />
        {item.signalType && <Chip label={item.signalType} tone="info" />}
        {item.confidential && <Chip label="Confidential" tone="warn" />}
        {cited === 0 ? (
          <Chip label="Not cited" tone="neutral" />
        ) : (
          <Chip label={`Cited by ${cited}`} tone="good" />
        )}
        <span className="subtle">
          {item.sourceRef ? `${item.sourceRef} · ` : ''}
          true as of {formatDate(item.asOf)} ({ageLabel(item.asOf)})
        </span>
      </div>

      <blockquote>{item.verbatim}</blockquote>

      {item.whyItMatters && (
        <p className="evidence-analysis"><strong>Why it matters:</strong> {item.whyItMatters}</p>
      )}
      {item.implicationForFactory && (
        <p className="evidence-analysis"><strong>For Factory:</strong> {item.implicationForFactory}</p>
      )}
      {item.nextDiscoveryQuestion && (
        <p className="evidence-analysis"><strong>Next question:</strong> {item.nextDiscoveryQuestion}</p>
      )}

      <div className="evidence-foot">
        {item.externalUrl && (
          <a href={item.externalUrl} target="_blank" rel="noreferrer">
            Open source
          </a>
        )}
        <span className="subtle">via {item.sourceSystem}</span>
        <button type="button" className="danger-quiet" onClick={() => remove(item)}>
          Remove
        </button>
      </div>
    </li>
  );
}

const EMPTY_FORM = {
  sourceType: 'conversation' as SourceType,
  sourceRef: '',
  verbatim: '',
  asOf: toDateInput(new Date().toISOString()),
  externalUrl: '',
  confidential: false,
};

export default function EvidenceLedger() {
  const { aggregate, apply, setError } = useAccount();
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<SourceType | 'all'>('all');

  const sorted = useMemo(
    () => [...aggregate.evidence].sort((a, b) => b.asOf.localeCompare(a.asOf)),
    [aggregate.evidence]
  );

  const visible = filter === 'all' ? sorted : sorted.filter((e) => e.sourceType === filter);

  const citationCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const claim of aggregate.claims) {
      for (const id of claim.evidenceIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [aggregate.claims]);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!form.verbatim.trim()) return;

    const input: EvidenceInput = {
      sourceType: form.sourceType,
      verbatim: form.verbatim.trim(),
      sourceRef: form.sourceRef.trim() || undefined,
      externalUrl: form.externalUrl.trim() || undefined,
      asOf: form.asOf ? new Date(form.asOf).toISOString() : undefined,
      confidential: form.confidential,
    };

    setBusy(true);
    setError(null);
    try {
      apply(await api.addEvidence(aggregate.account.id, aggregate.rev, input));
      setForm(EMPTY_FORM);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the evidence.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: EvidenceItem) {
    const affected = demotionImpact(item.id, aggregate.claims, aggregate.evidence);
    const warning =
      affected.length > 0
        ? `\n\nThis will stop ${affected.length} fact${affected.length === 1 ? '' : 's'} being a fact:\n` +
          affected.map((c) => `  • ${c.text}`).join('\n')
        : '';

    if (!window.confirm(`Remove this evidence?${warning}`)) return;

    setError(null);
    try {
      apply(await api.deleteEvidence(aggregate.account.id, item.id, aggregate.rev));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the evidence.');
    }
  }

  return (
    <div className="panel-stack">
      <form className="card form-grid" onSubmit={add}>
        <h2>Record evidence</h2>
        <p className="subtle">
          Paste what was actually said or written. Every fact in this account has to point back
          to one of these, so record the words, not your summary of them.
        </p>

        <label>
          <span>Source type</span>
          <select
            value={form.sourceType}
            onChange={(e) => setForm({ ...form, sourceType: e.target.value as SourceType })}
          >
            {SOURCE_TYPES.map((type) => (
              <option key={type} value={type}>
                {SOURCE_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Source reference</span>
          <input
            value={form.sourceRef}
            onChange={(e) => setForm({ ...form, sourceRef: e.target.value })}
            placeholder="Q3 FY26 earnings call"
          />
        </label>

        <label className="span-2">
          <span>What was said</span>
          <textarea
            value={form.verbatim}
            onChange={(e) => setForm({ ...form, verbatim: e.target.value })}
            rows={4}
            placeholder="We are consolidating developer tooling spend this year."
            required
          />
        </label>

        <label>
          <span>True as of</span>
          <input
            type="date"
            value={form.asOf}
            onChange={(e) => setForm({ ...form, asOf: e.target.value })}
          />
        </label>

        <label>
          <span>Link</span>
          <input
            value={form.externalUrl}
            onChange={(e) => setForm({ ...form, externalUrl: e.target.value })}
            placeholder="https://"
          />
        </label>

        <label className="checkbox span-2">
          <input
            type="checkbox"
            checked={form.confidential}
            onChange={(e) => setForm({ ...form, confidential: e.target.checked })}
          />
          <span>Shared in confidence. Never quote this in outreach.</span>
        </label>

        <div className="form-actions span-2">
          <button type="submit" disabled={busy || !form.verbatim.trim()}>
            {busy ? 'Saving…' : 'Add evidence'}
          </button>
        </div>
      </form>

      <div className="card">
        <div className="card-head">
          <h2>Ledger ({aggregate.evidence.length})</h2>
          <label className="inline-label">
            <span>Filter</span>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as SourceType | 'all')}
            >
              <option value="all">All sources</option>
              {SOURCE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {SOURCE_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </label>
        </div>

        {visible.length === 0 ? (
          <EmptyState title="Nothing recorded yet.">
            <p>
              Until there is evidence here, this account has no facts, only guesses. That is an
              honest starting point, not a failure.
            </p>
          </EmptyState>
        ) : (
          <>
            {EVIDENCE_CATEGORIES.map((cat) => {
              const catItems = visible.filter((item) => item.evidenceCategory === cat);
              if (catItems.length === 0) return null;
              return (
                <div key={cat} className="evidence-category-group">
                  <h3 className="evidence-category-title">{EVIDENCE_CATEGORY_LABELS[cat]}</h3>
                  <ul className="evidence-list">
                    {catItems.map((item) => renderEvidenceItem(item, citationCounts.get(item.id) ?? 0, remove))}
                  </ul>
                </div>
              );
            })}
            {/* Evidence without a category (manually added) */}
            {(() => {
              const uncategorized = visible.filter((item) => !item.evidenceCategory);
              if (uncategorized.length === 0) return null;
              return (
                <ul className="evidence-list">
                  {uncategorized.map((item) => renderEvidenceItem(item, citationCounts.get(item.id) ?? 0, remove))}
                </ul>
              );
            })()}
          </>
        )}
      </div>
    </div>
  );
}
