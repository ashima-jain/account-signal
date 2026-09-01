import { useState } from 'react';
import { api } from '../api';
import { useAccount } from '../useAccount';
import { Disclosure, Empty, Field } from '../components/ui';
import { formatDate } from '../format';
import { assessChampion, isChampionTrack } from '../domain/champion';
import {
  BUYER_ROLES,
  BUYER_ROLE_HINTS,
  BUYER_ROLE_LABELS,
  CHAMPION_SIGNALS,
  CHAMPION_SIGNAL_LABELS,
  CHAMPION_SIGNAL_TESTS,
  POSTURES,
  POSTURE_LABELS,
  RATINGS,
  type BuyerRole,
  type ChampionSignalType,
  type Posture,
  type Rating,
  type Stakeholder,
} from '../domain/types';

export default function Stakeholders() {
  const { aggregate } = useAccount();
  const missing = BUYER_ROLES.filter(
    (role) => !aggregate.stakeholders.some((s) => s.mapRoles.includes(role))
  );

  return (
    <>
      <div className="card">
        <h2>Buyer map</h2>
        <p className="dim">
          A champion is not someone who likes you. It is someone who does eight specific things,
          each of which you can point at evidence for.
        </p>
        {missing.length > 0 ? (
          <p className="muted" style={{ marginTop: 8 }}>
            Unmapped roles: {missing.map((role) => BUYER_ROLE_LABELS[role]).join(', ')}.
          </p>
        ) : null}
      </div>

      {aggregate.stakeholders.length === 0 ? (
        <Empty>No stakeholders yet.</Empty>
      ) : (
        aggregate.stakeholders.map((person) => (
          <StakeholderCard key={person.id} person={person} />
        ))
      )}

      <AddStakeholder />
    </>
  );
}

function StakeholderCard({ person }: { person: Stakeholder }) {
  const { aggregate, busy, run } = useAccount();
  const assessment = assessChampion(person.id, aggregate.signals, aggregate.evidence);
  const [open, setOpen] = useState(false);
  const showSignals = isChampionTrack(person, aggregate.signals);

  const patch = (payload: Record<string, unknown>) =>
    void run((rev) =>
      api.patch(aggregate.account.id, 'stakeholders', person.id, rev, payload)
    );

  const toggleRole = (role: BuyerRole) =>
    patch({
      mapRoles: person.mapRoles.includes(role)
        ? person.mapRoles.filter((r) => r !== role)
        : [...person.mapRoles, role],
    });

  return (
    <div className="card">
      <div className="row between">
        <div className="spread">
          <div className="row">
            <h3>{person.name}</h3>
            <span className="muted">{person.role}</span>
            {person.businessUnit ? <span className="dim">{person.businessUnit}</span> : null}
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <span className="badge">{assessment.tier}</span>
            {person.mapRoles.map((role) => (
              <span className="badge" key={role} title={BUYER_ROLE_HINTS[role]}>
                {BUYER_ROLE_LABELS[role]}
              </span>
            ))}
          </div>
          <p className="muted" style={{ marginTop: 6 }}>
            {assessment.rationale}
          </p>
          {person.relevance ? <p className="dim">{person.relevance}</p> : null}
          <div className="dim">
            Influence {person.influence}/5 · relationship {person.relationshipStrength}/5 · last
            contact {formatDate(person.lastContactAt)}
          </div>
        </div>
        <div className="row">
          <select
            value={person.posture}
            disabled={busy}
            onChange={(e) => patch({ posture: e.target.value as Posture })}
          >
            {POSTURES.map((posture) => (
              <option key={posture} value={posture}>
                {POSTURE_LABELS[posture]}
              </option>
            ))}
          </select>
          <button className="small" onClick={() => setOpen(!open)}>
            {open ? 'Close' : 'Edit'}
          </button>
          <button
            className="small danger"
            disabled={busy}
            onClick={() =>
              void run((rev) =>
                api.remove(aggregate.account.id, 'stakeholders', person.id, rev)
              )
            }
          >
            Delete
          </button>
        </div>
      </div>

      {open ? (
        <div style={{ marginTop: 12 }} className="grid two">
          <Field label="Buyer roles">
            <div className="signals">
              {BUYER_ROLES.map((role) => (
                <label className="signal" key={role}>
                  <input
                    type="checkbox"
                    checked={person.mapRoles.includes(role)}
                    disabled={busy}
                    onChange={() => toggleRole(role)}
                  />
                  <span>
                    {BUYER_ROLE_LABELS[role]}
                    <br />
                    <span className="dim">{BUYER_ROLE_HINTS[role]}</span>
                  </span>
                </label>
              ))}
            </div>
          </Field>
          <div>
            <Field label="Influence">
              <select
                value={person.influence}
                disabled={busy}
                onChange={(e) => patch({ influence: Number(e.target.value) as Rating })}
              >
                {RATINGS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Relationship strength">
              <select
                value={person.relationshipStrength}
                disabled={busy}
                onChange={(e) =>
                  patch({ relationshipStrength: Number(e.target.value) as Rating })
                }
              >
                {RATINGS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </Field>
            {person.whatToLearn.length > 0 ? (
              <Field label="What to learn">
                <ul className="dim" style={{ margin: 0, paddingLeft: 18 }}>
                  {person.whatToLearn.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </Field>
            ) : null}
          </div>
        </div>
      ) : null}

      {showSignals ? <ChampionTest person={person} /> : null}
    </div>
  );
}

function ChampionTest({ person }: { person: Stakeholder }) {
  const { aggregate, busy, run } = useAccount();
  const assessment = assessChampion(person.id, aggregate.signals, aggregate.evidence);

  const signalFor = (type: ChampionSignalType) =>
    aggregate.signals.find((s) => s.stakeholderId === person.id && s.signalType === type);

  return (
    <div style={{ marginTop: 12 }}>
      <div className="row between">
        <h3>Champion test</h3>
        <span className="dim">{assessment.count}/8 evidenced</span>
      </div>
      <div className="signals" style={{ marginTop: 8 }}>
        {CHAMPION_SIGNALS.map((type) => {
          const signal = signalFor(type);
          const counted = assessment.evidencedSignals.includes(type);
          const claimedOnly = assessment.unevidencedSignals.includes(type);
          return (
            <div className={`signal${counted ? ' on' : ''}`} key={type}>
              <div className="spread">
                <div>
                  <strong>{CHAMPION_SIGNAL_LABELS[type]}</strong>
                  {claimedOnly ? (
                    <span className="badge UNKNOWN" style={{ marginLeft: 8 }}>
                      No citation
                    </span>
                  ) : null}
                </div>
                <div className="dim">{CHAMPION_SIGNAL_TESTS[type]}</div>
              </div>
              <select
                style={{ width: 220 }}
                disabled={busy}
                value={signal?.evidenceId ?? ''}
                title="A signal only counts when it points at evidence."
                onChange={(e) => {
                  const evidenceId = e.target.value;
                  if (!evidenceId) {
                    if (signal) {
                      void run((rev) =>
                        api.remove(aggregate.account.id, 'signals', signal.id, rev)
                      );
                    }
                    return;
                  }
                  void run((rev) =>
                    api.create(aggregate.account.id, 'signals', rev, {
                      stakeholderId: person.id,
                      signalType: type,
                      observed: true,
                      evidenceId,
                    })
                  );
                }}
              >
                <option value="">Not observed</option>
                {aggregate.evidence.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.verbatim.slice(0, 60)}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
      {assessment.nextTest ? (
        <p className="muted" style={{ marginTop: 8 }}>
          <strong>Cheapest next test ({assessment.nextTest.unlocks}):</strong>{' '}
          {assessment.nextTest.test}
        </p>
      ) : null}
    </div>
  );
}

function AddStakeholder() {
  const { aggregate, busy, run } = useAccount();
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [mapRoles, setMapRoles] = useState<BuyerRole[]>([]);
  const [relevance, setRelevance] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const saved = await run((rev) =>
      api.create(aggregate.account.id, 'stakeholders', rev, {
        name,
        role,
        mapRoles,
        relevance: relevance || undefined,
      })
    );
    if (saved) {
      setName('');
      setRole('');
      setMapRoles([]);
      setRelevance('');
    }
  }

  return (
    <Disclosure summary="Add a stakeholder">
      <form onSubmit={submit}>
        <div className="grid two">
          <Field label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Title">
            <input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="VP Platform Engineering"
            />
          </Field>
        </div>
        <Field label="Why they matter">
          <input value={relevance} onChange={(e) => setRelevance(e.target.value)} />
        </Field>
        <Field label="Buyer roles">
          <div className="signals">
            {BUYER_ROLES.map((buyerRole) => (
              <label className="signal" key={buyerRole}>
                <input
                  type="checkbox"
                  checked={mapRoles.includes(buyerRole)}
                  onChange={() =>
                    setMapRoles(
                      mapRoles.includes(buyerRole)
                        ? mapRoles.filter((r) => r !== buyerRole)
                        : [...mapRoles, buyerRole]
                    )
                  }
                />
                <span>{BUYER_ROLE_LABELS[buyerRole]}</span>
              </label>
            ))}
          </div>
        </Field>
        <button className="primary" disabled={busy || !name.trim() || !role.trim()}>
          Save stakeholder
        </button>
      </form>
    </Disclosure>
  );
}
