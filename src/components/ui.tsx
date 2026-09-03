import { useState, type ReactNode } from 'react';
import { truncate } from '../format';
import {
  SOURCE_TYPE_LABELS,
  type ClaimStatus,
  type EvidenceItem,
  type ID,
} from '../domain/types';

export function StatusBadge({ status }: { status?: ClaimStatus }) {
  if (!status) return <span className="badge">Unreviewed</span>;
  return <span className={`badge ${status}`}>{status}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <fieldset>
      <label>{label}</label>
      {children}
      {hint ? <div className="dim">{hint}</div> : null}
    </fieldset>
  );
}

/** A form that stays out of the way until it is wanted. */
export function Disclosure({
  summary,
  children,
  open: initiallyOpen = false,
}: {
  summary: string;
  children: ReactNode;
  open?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <div className="card">
      <div className="row between">
        <h2>{summary}</h2>
        <button className="ghost small" onClick={() => setOpen(!open)}>
          {open ? 'Cancel' : 'Add'}
        </button>
      </div>
      {open ? <div style={{ marginTop: 12 }}>{children}</div> : null}
    </div>
  );
}

/**
 * Citation picker. Claims and wedges are only as good as what they point at, so
 * the quote itself is shown rather than an id.
 */
export function EvidencePicker({
  evidence,
  selected,
  onChange,
}: {
  evidence: EvidenceItem[];
  selected: ID[];
  onChange: (ids: ID[]) => void;
}) {
  if (evidence.length === 0) {
    return <div className="dim">No evidence in the ledger yet.</div>;
  }

  const toggle = (id: ID) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <div className="signals">
      {evidence.map((item) => (
        <label key={item.id} className="signal">
          <input
            type="checkbox"
            checked={selected.includes(item.id)}
            onChange={() => toggle(item.id)}
          />
          <span>
            <span className="dim">
              {SOURCE_TYPE_LABELS[item.sourceType]}
              {item.sourceRef ? ` — ${item.sourceRef}` : ''} · {item.asOf.slice(0, 10)}
            </span>
            <br />
            {truncate(item.verbatim, 160)}
          </span>
        </label>
      ))}
    </div>
  );
}

/** Renders citations as the quotes they are, not as opaque ids. */
export function Citations({
  ids,
  evidence,
}: {
  ids: ID[];
  evidence: EvidenceItem[];
}) {
  if (ids.length === 0) return <span className="dim">No citations.</span>;
  return (
    <ul className="dim" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
      {ids.map((id) => {
        const item = evidence.find((e) => e.id === id);
        if (!item) return <li key={id}>Missing evidence ({id.slice(0, 8)}).</li>;
        return (
          <li key={id}>
            {truncate(item.verbatim, 120)}{' '}
            {item.externalUrl ? (
              <a href={item.externalUrl} target="_blank" rel="noreferrer">
                source
              </a>
            ) : (
              <span>({SOURCE_TYPE_LABELS[item.sourceType]})</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
