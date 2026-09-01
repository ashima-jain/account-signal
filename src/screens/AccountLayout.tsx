import { Link, NavLink, Outlet, useParams } from 'react-router-dom';
import { useAccountData } from '../useAccount';
import { nextBestAction } from '../domain/nba';
import { stageLabel } from '../domain/nba';
import { api } from '../api';

const TABS = [
  { to: '.', label: 'Thesis', end: true },
  { to: 'evidence', label: 'Evidence' },
  { to: 'stakeholders', label: 'Stakeholders' },
  { to: 'wedges', label: 'Wedges' },
  { to: 'actions', label: 'Actions' },
  { to: 'log', label: 'Change log' },
];

export default function AccountLayout() {
  const { id } = useParams();
  const store = useAccountData(id);
  const { aggregate, loading, error, busy, run, clearError } = store;

  if (loading && !aggregate) {
    return (
      <div className="shell">
        <p className="muted">Loading account…</p>
      </div>
    );
  }

  if (!aggregate) {
    return (
      <div className="shell">
        <div className="banner error">{error ?? 'Account not found.'}</div>
        <Link to="/">Back to the command center</Link>
      </div>
    );
  }

  const nba = nextBestAction(aggregate);
  const seeding = aggregate.seedStatus === 'running';

  return (
    <div className="shell">
      <div className="topbar">
        <div>
          <div className="dim">
            <Link to="/">Command center</Link>
          </div>
          <h1>{aggregate.account.companyName}</h1>
          <div className="dim">
            {stageLabel(aggregate)} · rev {aggregate.rev}
            {aggregate.account.domain ? ` · ${aggregate.account.domain}` : ''}
          </div>
        </div>
        <div className="row">
          {busy ? <span className="dim">Saving…</span> : null}
          <button
            disabled={busy || aggregate.evidence.length > 0}
            title={
              aggregate.evidence.length > 0
                ? 'Seeding only runs on an empty account.'
                : 'Research this company with Claude.'
            }
            onClick={() => void run(() => api.seed(aggregate.account.id))}
          >
            Research
          </button>
        </div>
      </div>

      {error ? (
        <div className="banner error">
          <div className="row between">
            <div>{error}</div>
            <button className="ghost small" onClick={clearError}>
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {seeding ? (
        <div className="banner warn">
          Research is still running. This page refreshes itself as findings land.
        </div>
      ) : null}

      {nba ? (
        <div className="banner">
          <div className="row between">
            <div>
              <div className="row">
                <span className={`badge ${nba.tier}`}>{nba.tier}</span>
                <strong>Next best action: {nba.title}</strong>
              </div>
              <div className="muted" style={{ marginTop: 4 }}>
                {nba.why}
              </div>
              <div style={{ marginTop: 4 }}>{nba.suggestedAction}</div>
            </div>
          </div>
        </div>
      ) : null}

      <nav className="tabs">
        {TABS.map((tab) => (
          <NavLink
            key={tab.label}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) => (isActive ? 'active' : '')}
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <Outlet context={store} />
    </div>
  );
}
