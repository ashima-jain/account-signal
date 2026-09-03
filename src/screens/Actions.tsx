import { useState } from 'react';
import { api } from '../api';
import { useAccount } from '../useAccount';
import { Disclosure, Empty, Field } from '../components/ui';
import { formatDate } from '../format';
import { nextBestActions } from '../domain/nba';
import {
  CHANNELS,
  CHANNEL_LABELS,
  HORIZONS,
  HORIZON_LABELS,
  type Action,
  type Channel,
  type Horizon,
} from '../domain/types';

export default function Actions() {
  const { aggregate } = useAccount();
  const nba = nextBestActions(aggregate);
  const open = aggregate.actions.filter((a) => a.status === 'open');
  const closed = aggregate.actions.filter((a) => a.status !== 'open');

  return (
    <>
      <div className="card">
        <h2>Next best actions</h2>
        <p className="dim">
          Ranked by rules, not by a model. Each one names the gap it closes and what the account
          currently does or does not have.
        </p>
        {nba.length === 0 ? (
          <p className="muted" style={{ marginTop: 8 }}>
            Nothing outstanding.
          </p>
        ) : (
          <div className="grid" style={{ marginTop: 10 }}>
            {nba.slice(0, 5).map((candidate) => (
              <div className="card tight" key={candidate.key}>
                <div className="row">
                  <span className={`badge ${candidate.tier}`}>{candidate.tier}</span>
                  <strong>{candidate.title}</strong>
                </div>
                <p className="muted" style={{ marginTop: 4 }}>
                  {candidate.why}
                </p>
                <p style={{ marginBottom: 0 }}>{candidate.suggestedAction}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Plan ({open.length} open)</h2>
        {open.length === 0 ? (
          <Empty>Nothing booked. An account with no next step is an account going stale.</Empty>
        ) : (
          open.map((action) => <ActionRow key={action.id} action={action} />)
        )}
      </div>

      {closed.length > 0 ? (
        <div className="card">
          <h2>Closed</h2>
          {closed.map((action) => (
            <ActionRow key={action.id} action={action} />
          ))}
        </div>
      ) : null}

      <AddAction />
    </>
  );
}

function ActionRow({ action }: { action: Action }) {
  const { aggregate, busy, run } = useAccount();
  const person = aggregate.stakeholders.find((s) => s.id === action.stakeholderId);
  const overdue =
    action.status === 'open' && action.dueAt !== undefined && new Date(action.dueAt) < new Date();

  const patch = (payload: Record<string, unknown>) =>
    void run((rev) => api.patch(aggregate.account.id, 'actions', action.id, rev, payload));

  return (
    <div className="card tight">
      <div className="row between">
        <div className="spread">
          <div className="row">
            <strong>{action.objective}</strong>
            <span className="badge">{CHANNEL_LABELS[action.channel]}</span>
            <span className="badge">{HORIZON_LABELS[action.horizon]}</span>
            {overdue ? <span className="badge stale">Overdue</span> : null}
          </div>
          {person ? <div className="dim">{person.name} — {person.role}</div> : null}
          {action.messageOrAction ? <p style={{ marginTop: 6 }}>{action.messageOrAction}</p> : null}
          {action.desiredOutcome ? (
            <p className="muted">Outcome sought: {action.desiredOutcome}</p>
          ) : null}
          <div className="dim">
            Due {formatDate(action.dueAt)}
            {action.outcomeNote ? ` · ${action.outcomeNote}` : ''}
          </div>
        </div>
        <div className="row">
          {action.status === 'open' ? (
            <>
              <button
                className="small"
                disabled={busy}
                onClick={() => {
                  const note = prompt('What happened?') ?? undefined;
                  patch({ status: 'done', outcomeNote: note });
                }}
              >
                Done
              </button>
              <button className="small" disabled={busy} onClick={() => patch({ status: 'dropped' })}>
                Drop
              </button>
            </>
          ) : (
            <span className="badge">{action.status}</span>
          )}
          <button
            className="small danger"
            disabled={busy}
            onClick={() =>
              void run((rev) => api.remove(aggregate.account.id, 'actions', action.id, rev))
            }
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function AddAction() {
  const { aggregate, busy, run } = useAccount();
  const [objective, setObjective] = useState('');
  const [channel, setChannel] = useState<Channel>('email');
  const [horizon, setHorizon] = useState<Horizon>('this_week');
  const [stakeholderId, setStakeholderId] = useState('');
  const [wedgeId, setWedgeId] = useState('');
  const [messageOrAction, setMessageOrAction] = useState('');
  const [whyThisPersonNow, setWhyThisPersonNow] = useState('');
  const [desiredOutcome, setDesiredOutcome] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [resolvesClaimIds, setResolvesClaimIds] = useState<string[]>([]);

  const unknowns = aggregate.claims.filter((c) => c.status === 'UNKNOWN');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const saved = await run((rev) =>
      api.create(aggregate.account.id, 'actions', rev, {
        objective,
        channel,
        horizon,
        stakeholderId: stakeholderId || undefined,
        wedgeId: wedgeId || undefined,
        messageOrAction,
        whyThisPersonNow,
        desiredOutcome,
        dueAt: dueAt || undefined,
        resolvesClaimIds,
      })
    );
    if (saved) {
      setObjective('');
      setMessageOrAction('');
      setWhyThisPersonNow('');
      setDesiredOutcome('');
      setResolvesClaimIds([]);
    }
  }

  return (
    <Disclosure summary="Plan an action">
      <form onSubmit={submit}>
        <Field label="Objective">
          <input
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            placeholder="Get the platform lead to name the first repo for a pilot"
          />
        </Field>
        <div className="grid two">
          <Field label="Person">
            <select value={stakeholderId} onChange={(e) => setStakeholderId(e.target.value)}>
              <option value="">Nobody yet</option>
              {aggregate.stakeholders.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name} — {person.role}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Wedge">
            <select value={wedgeId} onChange={(e) => setWedgeId(e.target.value)}>
              <option value="">No wedge</option>
              {aggregate.wedges.map((wedge) => (
                <option key={wedge.id} value={wedge.id}>
                  {wedge.useCase}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Channel">
            <select value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {CHANNEL_LABELS[c]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Horizon">
            <select value={horizon} onChange={(e) => setHorizon(e.target.value as Horizon)}>
              {HORIZONS.map((h) => (
                <option key={h} value={h}>
                  {HORIZON_LABELS[h]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Due">
            <input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          </Field>
          <Field label="Why this person now">
            <input
              value={whyThisPersonNow}
              onChange={(e) => setWhyThisPersonNow(e.target.value)}
            />
          </Field>
        </div>
        <Field label="What you will say or do">
          <textarea
            value={messageOrAction}
            onChange={(e) => setMessageOrAction(e.target.value)}
          />
        </Field>
        <Field label="Desired outcome">
          <input value={desiredOutcome} onChange={(e) => setDesiredOutcome(e.target.value)} />
        </Field>
        {unknowns.length > 0 ? (
          <Field label="Unknowns this closes">
            <div className="signals">
              {unknowns.map((claim) => (
                <label className="signal" key={claim.id}>
                  <input
                    type="checkbox"
                    checked={resolvesClaimIds.includes(claim.id)}
                    onChange={() =>
                      setResolvesClaimIds(
                        resolvesClaimIds.includes(claim.id)
                          ? resolvesClaimIds.filter((id) => id !== claim.id)
                          : [...resolvesClaimIds, claim.id]
                      )
                    }
                  />
                  <span>{claim.text}</span>
                </label>
              ))}
            </div>
          </Field>
        ) : null}
        <button className="primary" disabled={busy || !objective.trim()}>
          Save action
        </button>
      </form>
    </Disclosure>
  );
}
