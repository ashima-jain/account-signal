import { useMemo, useState } from 'react';
import { api, type StakeholderInput } from '../api';
import {
  BUYER_ROLES,
  BUYER_ROLE_LABELS,
  CHAMPION_SIGNALS,
  CHAMPION_SIGNAL_LABELS,
  POSTURES,
  POSTURE_LABELS,
  RATING_LABELS,
  type BuyerRole,
  type ChampionSignal,
  type ChampionSignalType,
  type ID,
  type Posture,
  type Stakeholder as StakeholderType,
} from '../domain/types';
import {
  championTier,
  nextChampionTest,
  postureConflict,
  evidencedSignalTypes,
} from '../domain/champion';
import { useAccount } from './AccountLayout';
import { EmptyState } from '../components/Feedback';
import { Chip } from '../components/Chips';

const EMPTY_FORM: StakeholderInput = {
  name: '',
  role: '',
  mapRoles: [],
  influence: 3,
  relationshipStrength: 3,
  posture: 'unknown',
  priorities: [],
  whatToLearn: [],
};

export default function Stakeholders() {
  const { aggregate, apply, setError } = useAccount();
  const [form, setForm] = useState<StakeholderInput>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<ID | null>(null);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name.trim() || !form.role.trim()) return;

    setBusy(true);
    setError(null);
    try {
      apply(
        await api.addStakeholder(aggregate.account.id, aggregate.rev, {
          ...form,
          name: form.name.trim(),
          role: form.role.trim(),
        })
      );
      setForm(EMPTY_FORM);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the stakeholder.');
    } finally {
      setBusy(false);
    }
  }

  async function changePosture(s: StakeholderType, next: Posture) {
    setError(null);
    try {
      apply(
        await api.updateStakeholder(aggregate.account.id, s.id, aggregate.rev, {
          posture: next,
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the posture.');
    }
  }

  async function remove(s: StakeholderType) {
    if (!window.confirm(`Remove ${s.name}?`)) return;
    setError(null);
    try {
      apply(await api.deleteStakeholder(aggregate.account.id, s.id, aggregate.rev));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the stakeholder.');
    }
  }

  function toggleRole(role: BuyerRole) {
    setForm((f) => ({
      ...f,
      mapRoles: f.mapRoles?.includes(role)
        ? f.mapRoles.filter((r) => r !== role)
        : [...(f.mapRoles ?? []), role],
    }));
  }

  return (
    <div className="panel-stack">
      <form className="card form-grid" onSubmit={add}>
        <h2>Add a stakeholder</h2>
        <p className="subtle">
          A stakeholder is anyone at the account who can influence the decision. Mark the roles they
          play — most people occupy several.
        </p>

        <label>
          <span>Name</span>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Priya Sharma"
            required
          />
        </label>

        <label>
          <span>Role / title</span>
          <input
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
            placeholder="VP Engineering"
            required
          />
        </label>

        <fieldset className="span-2">
          <legend>Buyer roles</legend>
          <div className="role-grid">
            {BUYER_ROLES.map((role) => (
              <label key={role} className="checkbox">
                <input
                  type="checkbox"
                  checked={form.mapRoles?.includes(role) ?? false}
                  onChange={() => toggleRole(role)}
                />
                <span>{BUYER_ROLE_LABELS[role]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label>
          <span>Influence</span>
          <select
            value={form.influence}
            onChange={(e) => setForm({ ...form, influence: Number(e.target.value) })}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} — {RATING_LABELS[n as 1 | 2 | 3 | 4 | 5]}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Relationship strength</span>
          <select
            value={form.relationshipStrength}
            onChange={(e) => setForm({ ...form, relationshipStrength: Number(e.target.value) })}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} — {RATING_LABELS[n as 1 | 2 | 3 | 4 | 5]}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Posture (your read)</span>
          <select
            value={form.posture}
            onChange={(e) => setForm({ ...form, posture: e.target.value as Posture })}
          >
            {POSTURES.map((p) => (
              <option key={p} value={p}>
                {POSTURE_LABELS[p]}
              </option>
            ))}
          </select>
        </label>

        <div className="form-actions span-2">
          <button type="submit" disabled={busy || !form.name.trim() || !form.role.trim()}>
            {busy ? 'Saving…' : 'Add stakeholder'}
          </button>
        </div>
      </form>

      <div className="card">
        <h2>Stakeholders ({aggregate.stakeholders.length})</h2>

        {aggregate.stakeholders.length === 0 ? (
          <EmptyState title="No stakeholders yet.">
            <p>
              Add the people you are talking to. The champion test below will tell you which of them
              is actually spending political capital on your behalf — and which just seems friendly.
            </p>
          </EmptyState>
        ) : (
          <ul className="stakeholder-list">
            {aggregate.stakeholders.map((s) => (
              <li key={s.id}>
                <StakeholderCard
                  stakeholder={s}
                  signals={aggregate.signals.filter((sig) => sig.stakeholderId === s.id)}
                  evidence={aggregate.evidence}
                  expanded={expanded === s.id}
                  onToggle={() => setExpanded(expanded === s.id ? null : s.id)}
                  onPostureChange={(p) => changePosture(s, p)}
                  onRemove={() => remove(s)}
                  accountId={aggregate.account.id}
                  rev={aggregate.rev}
                  apply={apply}
                  setError={setError}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── Stakeholder card with champion test ─────────────────────────────────────

interface CardProps {
  stakeholder: StakeholderType;
  signals: ChampionSignal[];
  evidence: { id: ID; sourceType: string; verbatim: string; sourceRef?: string }[];
  expanded: boolean;
  onToggle: () => void;
  onPostureChange: (posture: Posture) => void;
  onRemove: () => void;
  accountId: ID;
  rev: number;
  apply: (response: { aggregate: import('../../src/domain/types').AccountAggregate }) => void;
  setError: (message: string | null) => void;
}

function StakeholderCard({
  stakeholder: s,
  signals,
  evidence,
  expanded,
  onToggle,
  onPostureChange,
  onRemove,
  accountId,
  rev,
  apply,
  setError,
}: CardProps) {
  const tier = useMemo(() => championTier(signals, evidence as never), [signals, evidence]);
  const nextTest = useMemo(() => nextChampionTest(signals, evidence as never), [signals, evidence]);
  const conflict = useMemo(() => postureConflict(s.posture, tier), [s.posture, tier]);
  const seen = useMemo(
    () => evidencedSignalTypes(signals, evidence as never),
    [signals, evidence]
  );
  const isChampionTrack =
    s.mapRoles.includes('champion') ||
    signals.length > 0;

  async function recordSignal(signalType: ChampionSignalType, evidenceId: ID) {
    setError(null);
    try {
      apply(await api.recordSignal(accountId, rev, { stakeholderId: s.id, signalType, observed: true, evidenceId }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the signal.');
    }
  }

  async function unrecordSignal(signalType: ChampionSignalType) {
    setError(null);
    try {
      apply(await api.recordSignal(accountId, rev, { stakeholderId: s.id, signalType, observed: false }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the signal.');
    }
  }

  return (
    <div className="stakeholder-card-inner">
      <div className="stakeholder-head">
        <div>
          <h3>{s.name}</h3>
          <p className="subtle">
            {s.role}
            {s.businessUnit ? ` · ${s.businessUnit}` : ''}
          </p>
        </div>
        <div className="chip-row">
          <Chip label={tier} tone={tier === 'Validated Champion' ? 'good' : 'neutral'} />
          <Chip label={`Posture: ${POSTURE_LABELS[s.posture]}`} />
        </div>
      </div>

      {s.mapRoles.length > 0 && (
        <div className="chip-row">
          {s.mapRoles.map((role) => (
            <Chip key={role} label={BUYER_ROLE_LABELS[role]} />
          ))}
        </div>
      )}

      {conflict && <p className="hint">{conflict}</p>}

      <div className="stakeholder-actions">
        {isChampionTrack && (
          <button type="button" className="link-button" onClick={onToggle}>
            {expanded ? 'Hide' : 'Show'} champion test
          </button>
        )}
        <select
          className="posture-select"
          value={s.posture}
          onChange={(e) => onPostureChange(e.target.value as Posture)}
        >
          {POSTURES.map((p) => (
            <option key={p} value={p}>
              Posture: {POSTURE_LABELS[p]}
            </option>
          ))}
        </select>
        <button type="button" className="link-button danger-quiet" onClick={onRemove}>
          Remove
        </button>
      </div>

      {expanded && isChampionTrack && (
        <div className="champion-test">
          <p className="subtle">
            {seen.size} of 8 signals evidenced. A signal counts only when observed with linked
            evidence — not when you believe it.
          </p>

          {nextTest && (
            <div className="next-test">
              <strong>Next test:</strong> {CHAMPION_SIGNAL_LABELS[nextTest.signalType]}
              <p className="subtle">{nextTest.why}</p>
            </div>
          )}

          <ul className="signal-list">
            {CHAMPION_SIGNALS.map((type) => {
              const signal = signals.find((sig) => sig.signalType === type);
              const isObserved = seen.has(type);
              return (
                <li key={type} className={isObserved ? 'signal-evidenced' : ''}>
                  <div className="signal-head">
                    <span>{CHAMPION_SIGNAL_LABELS[type]}</span>
                    {isObserved ? (
                      <Chip label="Evidenced" tone="good" />
                    ) : signal?.observed ? (
                      <Chip label="Observed, no evidence" tone="warn" />
                    ) : (
                      <Chip label="Not tested" />
                    )}
                  </div>

                  {isObserved && signal?.evidenceId && (
                    <p className="subtle signal-citation">
                      {evidence.find((e) => e.id === signal.evidenceId)?.verbatim.slice(0, 120)}
                    </p>
                  )}

                  {!isObserved && evidence.length > 0 && (
                    <div className="signal-record">
                      <select
                        className="signal-evidence-select"
                        defaultValue=""
                        onChange={(e) => {
                          if (e.target.value) {
                            void recordSignal(type, e.target.value);
                            e.target.value = '';
                          }
                        }}
                      >
                        <option value="">Record with evidence…</option>
                        {evidence.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.sourceType}: {e.verbatim.slice(0, 80)}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {isObserved && (
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => unrecordSignal(type)}
                    >
                      Unmark
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          {evidence.length === 0 && (
            <p className="hint">
              No evidence to cite. Record what this person did or said in the Evidence tab first.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
