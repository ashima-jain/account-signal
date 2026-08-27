import { useMemo, useState } from 'react';
import { api } from '../api';
import {
  EVIDENCE_CATEGORIES,
  EVIDENCE_CATEGORY_LABELS,
  type ClaimStatus,
  type EvidenceItem,
  type EvidenceCategory,
  type ID,
} from '../domain/types';
import { useAccount } from './AccountLayout';
import { EmptyState } from '../components/Feedback';
import { Chip, SourceChip } from '../components/Chips';
import { ageLabel, formatDate } from '../lib/format';

const STATUS_LABELS: Record<ClaimStatus, string> = {
  FACT: 'Fact',
  HYPOTHESIS: 'Hypothesis',
  UNKNOWN: 'Unknown',
};

export default function Thesis() {
  const { aggregate, apply, setError } = useAccount();
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ID | null>(null);

  const evidenceByCategory = useMemo(() => {
    const map = new Map<EvidenceCategory | 'uncategorized', EvidenceItem[]>();
    for (const cat of [...EVIDENCE_CATEGORIES, 'uncategorized' as const]) {
      map.set(cat, []);
    }
    for (const item of aggregate.evidence) {
      const key = item.evidenceCategory ?? ('uncategorized' as const);
      map.get(key)?.push(item);
    }
    return map;
  }, [aggregate.evidence]);

  // Find the rating claim for a category (e.g., "Engineering Scale: High").
  const ratingForCategory = useMemo(() => {
    const map = new Map<EvidenceCategory, string>();
    for (const claim of aggregate.claims) {
      if (EVIDENCE_CATEGORIES.includes(claim.category as EvidenceCategory)) {
        map.set(claim.category as EvidenceCategory, claim.text);
      }
    }
    return map;
  }, [aggregate.claims]);

  async function generate() {
    if (aggregate.evidence.length === 0) {
      setError('Record evidence first — a thesis without evidence is a guess.');
      return;
    }
    const confirmed = window.confirm(
      'This will replace all existing claims with AI-generated ones and update evidence statuses. The server enforces the FACT invariant — nothing becomes a FACT without a real citation. Continue?'
    );
    if (!confirmed) return;

    setGenerating(true);
    setGenResult(null);
    setError(null);
    try {
      const response = await api.generateThesis(aggregate.account.id, aggregate.rev);
      if (response.insufficientEvidence) {
        setGenResult(response.reason ?? 'The evidence is insufficient to support a thesis.');
      } else if (response.aggregate) {
        apply(response);
        setGenResult(`Thesis generated: ${response.aggregate.claims.length} claims.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate the thesis.');
    } finally {
      setGenerating(false);
    }
  }

  async function markStatus(item: EvidenceItem, status: ClaimStatus) {
    setError(null);
    try {
      apply(
        await api.updateEvidence(aggregate.account.id, item.id, aggregate.rev, { status })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update evidence status.');
    }
  }

  async function removeEvidence(item: EvidenceItem) {
    if (!window.confirm(`Remove this evidence item?`)) return;
    setError(null);
    try {
      apply(await api.deleteEvidence(aggregate.account.id, item.id, aggregate.rev));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove evidence.');
    }
  }

  function renderEvidenceItem(item: EvidenceItem) {
    const status = item.status;
    const isExpanded = expanded === item.id;

    return (
      <li key={item.id} className="thesis-evidence-item">
        <div className="thesis-evidence-head">
          <span className={`thesis-status-dot ${status?.toLowerCase() ?? 'unmarked'}`}>
            {status ? STATUS_LABELS[status] : 'Unmarked'}
          </span>
          <SourceChip sourceType={item.sourceType} />
          {item.sourceRef && <span className="subtle">{item.sourceRef}</span>}
          <span className="subtle">
            {formatDate(item.asOf)} ({ageLabel(item.asOf)})
          </span>
        </div>

        <blockquote>{item.verbatim}</blockquote>

        {isExpanded && (item.whyItMatters || item.implicationForFactory || item.nextDiscoveryQuestion) && (
          <div className="thesis-evidence-analysis">
            {item.whyItMatters && (
              <p className="evidence-analysis">
                <strong>Why it matters:</strong> {item.whyItMatters}
              </p>
            )}
            {item.implicationForFactory && (
              <p className="evidence-analysis">
                <strong>For Factory:</strong> {item.implicationForFactory}
              </p>
            )}
            {item.nextDiscoveryQuestion && (
              <p className="evidence-analysis">
                <strong>Next question:</strong> {item.nextDiscoveryQuestion}
              </p>
            )}
          </div>
        )}

        <div className="thesis-evidence-actions">
          {item.whyItMatters && (
            <button
              type="button"
              className="link-button"
              onClick={() => setExpanded(isExpanded ? null : item.id)}
            >
              {isExpanded ? 'Hide details' : 'Details'}
            </button>
          )}
          {status !== 'FACT' && (
            <button
              type="button"
              className="link-button"
              onClick={() => markStatus(item, 'FACT')}
            >
              Mark as Fact
            </button>
          )}
          {status !== 'HYPOTHESIS' && (
            <button
              type="button"
              className="link-button"
              onClick={() => markStatus(item, 'HYPOTHESIS')}
            >
              Mark as Hypothesis
            </button>
          )}
          <button
            type="button"
            className="link-button danger-quiet"
            onClick={() => removeEvidence(item)}
          >
            Remove
          </button>
        </div>
      </li>
    );
  }

  const hasEvidence = aggregate.evidence.length > 0;

  return (
    <div className="panel-stack">
      {/* Why this account matters */}
      <div className="card thesis-narrative-card">
        <div className="card-head">
          <h2>Why this account matters</h2>
          <button
            type="button"
            className="link-button"
            disabled={generating || !hasEvidence}
            onClick={generate}
          >
            {generating ? 'Generating…' : 'Generate thesis'}
          </button>
        </div>

        {aggregate.whyItMatters ? (
          <p className="thesis-narrative">{aggregate.whyItMatters}</p>
        ) : (
          <p className="hint">
            {hasEvidence
              ? 'Generate a thesis to produce the narrative, or mark evidence below as Fact or Hypothesis.'
              : 'Record evidence first, then generate a thesis to see why this account matters.'}
          </p>
        )}

        {genResult && (
          <p className="hint" style={{ marginTop: '0.5rem' }}>{genResult}</p>
        )}
      </div>

      {/* 4 categories with evidence */}
      {hasEvidence ? (
        <div className="card">
          <h2>Evidence by category ({aggregate.evidence.length})</h2>

          {EVIDENCE_CATEGORIES.map((cat) => {
            const items = evidenceByCategory.get(cat) ?? [];
            if (items.length === 0) return null;
            const rating = ratingForCategory.get(cat);
            return (
              <div key={cat} className="thesis-category-group">
                <div className="thesis-category-head">
                  <h3>{EVIDENCE_CATEGORY_LABELS[cat]}</h3>
                  {rating && <Chip label={rating} tone="info" />}
                </div>
                <ul className="evidence-list">
                  {items.map((item) => renderEvidenceItem(item))}
                </ul>
              </div>
            );
          })}

          {/* Uncategorized evidence (old accounts) */}
          {(() => {
            const items = evidenceByCategory.get('uncategorized' as const) ?? [];
            if (items.length === 0) return null;
            return (
              <div className="thesis-category-group">
                <div className="thesis-category-head">
                  <h3>Uncategorized</h3>
                </div>
                <ul className="evidence-list">
                  {items.map((item) => renderEvidenceItem(item))}
                </ul>
              </div>
            );
          })()}
        </div>
      ) : (
        <div className="card">
          <EmptyState title="No evidence yet.">
            <p>
              Record evidence to start building the account thesis. Each piece of evidence
              can be marked as a Fact or Hypothesis once recorded.
            </p>
          </EmptyState>
        </div>
      )}
    </div>
  );
}
