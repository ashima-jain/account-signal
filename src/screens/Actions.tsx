import { useMemo, useState } from 'react';
import { api, type ActionInput } from '../api';
import {
  CHANNELS,
  CHANNEL_LABELS,
  HORIZONS,
  HORIZON_LABELS,
  type Action,
  type Channel,
  type Horizon,
  type ID,
} from '../domain/types';
import { nextBestActions, type NbaCandidate } from '../domain/nba';
import { useAccount } from './AccountLayout';
import { EmptyState } from '../components/Feedback';
import { Chip } from '../components/Chips';
import { formatDate } from '../lib/format';

const EMPTY_FORM: ActionInput = {
  objective: '',
  channel: 'call',
  messageOrAction: '',
  whyThisPersonNow: '',
  desiredOutcome: '',
  horizon: 'this_week',
  resolvesClaimIds: [],
};

export default function Actions() {
  const { aggregate, apply, setError } = useAccount();
  const [form, setForm] = useState<ActionInput>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  const candidates = useMemo(() => nextBestActions(aggregate), [aggregate]);
  const top = candidates[0] ?? null;

  const byHorizon = useMemo(() => {
    const groups: Record<Horizon, Action[]> = {
      this_week: [],
      next_2_weeks: [],
      next_30_days: [],
    };
    for (const action of aggregate.actions) {
      if (action.status === 'open') groups[action.horizon].push(action);
    }
    for (const h of HORIZONS) {
      groups[h].sort((a, b) => {
        const ad = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
        const bd = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
        return ad - bd;
      });
    }
    return groups;
  }, [aggregate.actions]);

  async function commitCandidate(candidate: NbaCandidate) {
    setBusy(true);
    setError(null);
    try {
      apply(
        await api.addAction(aggregate.account.id, aggregate.rev, {
          objective: candidate.objective,
          channel: candidate.channel,
          messageOrAction: '',
          whyThisPersonNow: candidate.whyNow,
          desiredOutcome: candidate.desiredOutcome,
          horizon: candidate.horizon,
          stakeholderId: candidate.stakeholderId,
          resolvesClaimIds: candidate.claimId ? [candidate.claimId] : [],
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not commit the action.');
    } finally {
      setBusy(false);
    }
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!form.objective.trim()) return;

    setBusy(true);
    setError(null);
    try {
      apply(
        await api.addAction(aggregate.account.id, aggregate.rev, {
          ...form,
          objective: form.objective.trim(),
          messageOrAction: form.messageOrAction.trim(),
          whyThisPersonNow: form.whyThisPersonNow.trim(),
          desiredOutcome: form.desiredOutcome.trim(),
        })
      );
      setForm(EMPTY_FORM);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the action.');
    } finally {
      setBusy(false);
    }
  }

  async function complete(action: Action) {
    setError(null);
    try {
      apply(
        await api.updateAction(aggregate.account.id, action.id, aggregate.rev, {
          status: 'done',
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not complete the action.');
    }
  }

  async function drop(action: Action) {
    setError(null);
    try {
      apply(
        await api.updateAction(aggregate.account.id, action.id, aggregate.rev, {
          status: 'dropped',
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not drop the action.');
    }
  }

  async function remove(action: Action) {
    if (!window.confirm(`Remove "${action.objective}"?`)) return;
    setError(null);
    try {
      apply(await api.deleteAction(aggregate.account.id, action.id, aggregate.rev));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the action.');
    }
  }

  const stakeholderName = (id?: ID) =>
    id ? aggregate.stakeholders.find((s) => s.id === id)?.name ?? 'Unknown' : null;

  return (
    <div className="panel-stack">
      {top && (
        <div className="card nba-card">
          <div className="nba-head">
            <h2>Next Best Action</h2>
            <Chip label={`Score ${top.score}`} tone="good" />
          </div>
          <p className="nba-objective">{top.objective}</p>
          <p className="subtle">{top.whyNow}</p>
          <p className="subtle">
            <strong>Desired outcome:</strong> {top.desiredOutcome}
          </p>
          <div className="nba-actions">
            <button type="button" disabled={busy} onClick={() => commitCandidate(top)}>
              {busy ? 'Committing…' : 'Commit as action'}
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <h2>30-day plan</h2>

        {aggregate.actions.filter((a) => a.status === 'open').length === 0 && !top ? (
          <EmptyState title="Nothing to do.">
            <p>
              The account has no open actions and no candidates. Either it is fully covered, or you
              need to record more evidence and stakeholders for the system to find the next gap.
            </p>
          </EmptyState>
        ) : (
          HORIZONS.map((horizon) => {
            const actions = byHorizon[horizon];
            if (actions.length === 0) return null;
            return (
              <div key={horizon} className="horizon-group">
                <h3>{HORIZON_LABELS[horizon]}</h3>
                <ul className="action-list">
                  {actions.map((action) => {
                    const person = stakeholderName(action.stakeholderId);
                    const overdue =
                      action.dueAt && new Date(action.dueAt).getTime() < Date.now();
                    return (
                      <li key={action.id} className={overdue ? 'action-overdue' : ''}>
                        <div className="action-head">
                          <strong>{action.objective}</strong>
                          {overdue && <Chip label="Overdue" tone="warn" />}
                        </div>
                        <p className="subtle">
                          {CHANNEL_LABELS[action.channel]}
                          {person ? ` · ${person}` : ''}
                          {action.dueAt ? ` · due ${formatDate(action.dueAt)}` : ''}
                        </p>
                        {action.messageOrAction && (
                          <p className="action-message">{action.messageOrAction}</p>
                        )}
                        {action.whyThisPersonNow && (
                          <p className="subtle">Why now: {action.whyThisPersonNow}</p>
                        )}
                        {action.desiredOutcome && (
                          <p className="subtle">
                            <strong>Outcome:</strong> {action.desiredOutcome}
                          </p>
                        )}
                        <div className="action-buttons">
                          <button type="button" className="link-button" onClick={() => complete(action)}>
                            Mark done
                          </button>
                          <button type="button" className="link-button" onClick={() => drop(action)}>
                            Drop
                          </button>
                          <button type="button" className="link-button danger-quiet" onClick={() => remove(action)}>
                            Remove
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })
        )}
      </div>

      <form className="card form-grid" onSubmit={add}>
        <h2>Add an action</h2>
        <p className="subtle">
          Every action has a desired outcome. If you cannot state what success looks like, the
          action is not specific enough to be useful.
        </p>

        <label className="span-2">
          <span>Objective</span>
          <input
            value={form.objective}
            onChange={(e) => setForm({ ...form, objective: e.target.value })}
            placeholder="Get Priya to introduce the head of procurement"
            required
          />
        </label>

        <label className="span-2">
          <span>What you will do or say</span>
          <textarea
            value={form.messageOrAction}
            onChange={(e) => setForm({ ...form, messageOrAction: e.target.value })}
            rows={2}
            placeholder="Ask Priya for a warm intro to Ravi, framing it around the build-time metric she cares about."
          />
        </label>

        <label className="span-2">
          <span>Why this person, why now</span>
          <textarea
            value={form.whyThisPersonNow}
            onChange={(e) => setForm({ ...form, whyThisPersonNow: e.target.value })}
            rows={2}
            placeholder="Priya is a coach and has already shared that procurement is the bottleneck."
          />
        </label>

        <label className="span-2">
          <span>Desired outcome</span>
          <input
            value={form.desiredOutcome}
            onChange={(e) => setForm({ ...form, desiredOutcome: e.target.value })}
            placeholder="A meeting with Ravi scheduled within two weeks."
          />
        </label>

        <label>
          <span>Channel</span>
          <select
            value={form.channel}
            onChange={(e) => setForm({ ...form, channel: e.target.value as Channel })}
          >
            {CHANNELS.map((ch) => (
              <option key={ch} value={ch}>
                {CHANNEL_LABELS[ch]}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Horizon</span>
          <select
            value={form.horizon}
            onChange={(e) => setForm({ ...form, horizon: e.target.value as Horizon })}
          >
            {HORIZONS.map((h) => (
              <option key={h} value={h}>
                {HORIZON_LABELS[h]}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Due date</span>
          <input
            type="date"
            value={form.dueAt ? form.dueAt.slice(0, 10) : ''}
            onChange={(e) =>
              setForm({ ...form, dueAt: e.target.value ? new Date(e.target.value).toISOString() : undefined })
            }
          />
        </label>

        <div className="form-actions span-2">
          <button type="submit" disabled={busy || !form.objective.trim()}>
            {busy ? 'Saving…' : 'Add action'}
          </button>
        </div>
      </form>
    </div>
  );
}
