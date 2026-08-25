import { useState } from 'react';
import { api } from '../api';
import {
  WEDGE_STATUSES,
  WEDGE_STATUS_LABELS,
  type ID,
  type Wedge,
  type WedgeStatus,
} from '../domain/types';
import { useAccount } from './AccountLayout';
import { EmptyState } from '../components/Feedback';
import { Chip } from '../components/Chips';
import { ageLabel } from '../lib/format';

export default function Wedges() {
  const { aggregate, apply, setError } = useAccount();
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [disqualifying, setDisqualifying] = useState<ID | null>(null);
  const [disqualifyReason, setDisqualifyReason] = useState('');
  const [disqualifyEvidenceId, setDisqualifyEvidenceId] = useState('');

  // Form state.
  const [useCase, setUseCase] = useState('');
  const [businessProblem, setBusinessProblem] = useState('');
  const [technicalProblem, setTechnicalProblem] = useState('');
  const [whyFactory, setWhyFactory] = useState('');
  const [likelyOwnerRole, setLikelyOwnerRole] = useState('');
  const [sponsorRole, setSponsorRole] = useState('');
  const [discoveryQuestion, setDiscoveryQuestion] = useState('');
  const [selectedEvidence, setSelectedEvidence] = useState<ID[]>([]);
  const [disqualifiers, setDisqualifiers] = useState<string[]>([]);

  const wedges = aggregate.wedges;
  const activeWedges = wedges.filter((w) => w.status !== 'disqualified');
  const disqualifiedWedges = wedges.filter((w) => w.status === 'disqualified');

  function resetForm() {
    setUseCase('');
    setBusinessProblem('');
    setTechnicalProblem('');
    setWhyFactory('');
    setLikelyOwnerRole('');
    setSponsorRole('');
    setDiscoveryQuestion('');
    setSelectedEvidence([]);
    setDisqualifiers([]);
    setShowForm(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      apply(
        await api.addWedge(aggregate.account.id, aggregate.rev, {
          useCase,
          businessProblem,
          technicalProblem,
          whyFactory,
          likelyOwnerRole: likelyOwnerRole || undefined,
          sponsorRole: sponsorRole || undefined,
          discoveryQuestion: discoveryQuestion || undefined,
          evidenceIds: selectedEvidence,
          disqualifiers,
        })
      );
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the wedge.');
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(wedge: Wedge, status: WedgeStatus) {
    if (status === 'disqualified') {
      setDisqualifying(wedge.id);
      setDisqualifyReason('');
      setDisqualifyEvidenceId('');
      return;
    }
    setError(null);
    try {
      apply(
        await api.updateWedge(aggregate.account.id, wedge.id, aggregate.rev, { status })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the wedge.');
    }
  }

  async function confirmDisqualify() {
    if (!disqualifying) return;
    if (!disqualifyReason.trim()) {
      setError('A reason is required to disqualify a wedge.');
      return;
    }
    setError(null);
    try {
      apply(
        await api.updateWedge(aggregate.account.id, disqualifying, aggregate.rev, {
          status: 'disqualified',
          disqualifiedReason: disqualifyReason,
          disqualifyingEvidenceId: disqualifyEvidenceId || undefined,
        })
      );
      setDisqualifying(null);
      setDisqualifyReason('');
      setDisqualifyEvidenceId('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disqualify the wedge.');
    }
  }

  async function remove(wedge: Wedge) {
    if (!window.confirm(`Remove "${wedge.useCase}"?`)) return;
    setError(null);
    try {
      apply(await api.deleteWedge(aggregate.account.id, wedge.id, aggregate.rev));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the wedge.');
    }
  }

  function toggleEvidence(id: ID) {
    setSelectedEvidence((prev) =>
      prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id]
    );
  }

  const statusTone: Record<WedgeStatus, 'good' | 'info' | 'warn' | 'bad'> = {
    candidate: 'info',
    testing: 'warn',
    validated: 'good',
    disqualified: 'bad',
  };

  function WedgeStatusChip({ status }: { status: WedgeStatus }) {
    return <Chip label={WEDGE_STATUS_LABELS[status]} tone={statusTone[status]} />;
  }

  return (
    <div className="panel-stack">
      <div className="card">
        <div className="card-head">
          <h2>Wedges</h2>
          <div className="chip-row">
            <Chip label={`${activeWedges.length} active`} tone="info" />
            <Chip label={`${disqualifiedWedges.length} disqualified`} tone="bad" />
          </div>
        </div>

        <p className="hint">
          A wedge is a specific use case where Factory solves a real problem. Move wedges through
          candidate → testing → validated. Disqualify with a reason — the record stays so you
          remember why you walked away.
        </p>

        {!showForm && (
          <button
            type="button"
            className="link-button"
            onClick={() => setShowForm(true)}
            style={{ marginTop: '0.5rem' }}
          >
            + Add wedge
          </button>
        )}

        {showForm && (
          <form onSubmit={submit} className="inline-form" style={{ marginTop: '0.75rem' }}>
            <label>
              Use case <span className="req">*</span>
              <input
                value={useCase}
                onChange={(e) => setUseCase(e.target.value)}
                placeholder="e.g. AI-assisted code review for Tesco's Bengaluru tech hub"
                required
              />
            </label>
            <label>
              Business problem <span className="req">*</span>
              <textarea
                value={businessProblem}
                onChange={(e) => setBusinessProblem(e.target.value)}
                placeholder="What business pain does this address?"
                rows={2}
                required
              />
            </label>
            <label>
              Technical problem <span className="req">*</span>
              <textarea
                value={technicalProblem}
                onChange={(e) => setTechnicalProblem(e.target.value)}
                placeholder="What technical challenge does this solve?"
                rows={2}
                required
              />
            </label>
            <label>
              Why Factory <span className="req">*</span>
              <textarea
                value={whyFactory}
                onChange={(e) => setWhyFactory(e.target.value)}
                placeholder="Why is Factory the right solution for this?"
                rows={2}
                required
              />
            </label>
            <div className="form-row">
              <label>
                Likely owner role
                <input
                  value={likelyOwnerRole}
                  onChange={(e) => setLikelyOwnerRole(e.target.value)}
                  placeholder="e.g. Head of Engineering"
                />
              </label>
              <label>
                Sponsor role
                <input
                  value={sponsorRole}
                  onChange={(e) => setSponsorRole(e.target.value)}
                  placeholder="e.g. CTO"
                />
              </label>
            </div>
            <label>
              Discovery question
              <input
                value={discoveryQuestion}
                onChange={(e) => setDiscoveryQuestion(e.target.value)}
                placeholder="What question would you ask to validate this wedge?"
              />
            </label>

            {aggregate.evidence.length > 0 && (
              <fieldset>
                <legend>Supporting evidence</legend>
                <div className="checkbox-grid">
                  {aggregate.evidence.map((ev) => (
                    <label key={ev.id} className="checkbox-item">
                      <input
                        type="checkbox"
                        checked={selectedEvidence.includes(ev.id)}
                        onChange={() => toggleEvidence(ev.id)}
                      />
                      <span className="checkbox-label">
                        {ev.verbatim.slice(0, 80)}
                        {ev.verbatim.length > 80 ? '…' : ''}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            <div className="form-actions">
              <button type="submit" className="primary" disabled={busy}>
                {busy ? 'Saving…' : 'Add wedge'}
              </button>
              <button type="button" className="link-button" onClick={resetForm}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      {wedges.length === 0 && !showForm && (
        <EmptyState title="No wedges yet. Add one to start tracking use cases." />
      )}

      {activeWedges.length > 0 && (
        <div className="card">
          <h3>Active wedges</h3>
          {activeWedges.map((w) => (
            <div key={w.id} className="wedge-card">
              <div className="wedge-head">
                <WedgeStatusChip status={w.status} />
                <span className="wedge-title">{w.useCase}</span>
                <span className="hint">{ageLabel(w.createdAt)}</span>
              </div>

              <div className="wedge-body">
                <p><strong>Business problem:</strong> {w.businessProblem}</p>
                <p><strong>Technical problem:</strong> {w.technicalProblem}</p>
                <p><strong>Why Factory:</strong> {w.whyFactory}</p>
                {w.likelyOwnerRole && <p><strong>Owner:</strong> {w.likelyOwnerRole}</p>}
                {w.sponsorRole && <p><strong>Sponsor:</strong> {w.sponsorRole}</p>}
                {w.discoveryQuestion && (
                  <p><strong>Discovery question:</strong> {w.discoveryQuestion}</p>
                )}
                {w.evidenceIds.length > 0 && (
                  <p><strong>Evidence:</strong> {w.evidenceIds.length} item(s)</p>
                )}
                {w.disqualifiers.length > 0 && (
                  <p><strong>Disqualifiers to watch:</strong> {w.disqualifiers.join(', ')}</p>
                )}
              </div>

              <div className="wedge-actions">
                {WEDGE_STATUSES.filter((s) => s !== 'disqualified' && s !== w.status).map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="link-button"
                    onClick={() => changeStatus(w, s)}
                  >
                    → {WEDGE_STATUS_LABELS[s]}
                  </button>
                ))}
                {w.status !== 'disqualified' && (
                  <button
                    type="button"
                    className="link-button danger"
                    onClick={() => changeStatus(w, 'disqualified')}
                  >
                    Disqualify
                  </button>
                )}
                <button
                  type="button"
                  className="link-button danger"
                  onClick={() => remove(w)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {disqualifiedWedges.length > 0 && (
        <div className="card">
          <h3>Disqualified</h3>
          {disqualifiedWedges.map((w) => (
            <div key={w.id} className="wedge-card disqualified">
              <div className="wedge-head">
                <WedgeStatusChip status="disqualified" />
                <span className="wedge-title">{w.useCase}</span>
              </div>
              <div className="wedge-body">
                {w.disqualifiedReason && (
                  <p className="disqualify-reason">
                    <strong>Reason:</strong> {w.disqualifiedReason}
                  </p>
                )}
                {w.disqualifyingEvidenceId && (
                  <p className="hint">
                    Evidence: {aggregate.evidence.find((e) => e.id === w.disqualifyingEvidenceId)?.verbatim.slice(0, 80) ?? 'removed'}
                  </p>
                )}
              </div>
              <div className="wedge-actions">
                <button
                  type="button"
                  className="link-button danger"
                  onClick={() => remove(w)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {disqualifying && (
        <div className="modal-overlay" onClick={() => setDisqualifying(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>Disqualify wedge</h3>
            <p className="hint">A disqualified wedge stays on record so you remember why you walked away.</p>
            <label>
              Reason <span className="req">*</span>
              <textarea
                value={disqualifyReason}
                onChange={(e) => setDisqualifyReason(e.target.value)}
                placeholder="Why is this wedge not viable?"
                rows={3}
                autoFocus
              />
            </label>
            {aggregate.evidence.length > 0 && (
              <label>
                Disqualifying evidence
                <select
                  value={disqualifyEvidenceId}
                  onChange={(e) => setDisqualifyEvidenceId(e.target.value)}
                >
                  <option value="">— none —</option>
                  {aggregate.evidence.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.verbatim.slice(0, 80)}
                      {ev.verbatim.length > 80 ? '…' : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="form-actions">
              <button type="button" className="primary" onClick={confirmDisqualify}>
                Disqualify
              </button>
              <button type="button" className="link-button" onClick={() => setDisqualifying(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
