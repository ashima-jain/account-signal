import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { api, type MutationResponse } from '../api';
import type { AccountAggregate } from '../domain/types';
import { ErrorBanner, Spinner } from '../components/Feedback';

export interface AccountContext {
  aggregate: AccountAggregate;
  /** Replace local state with the server's post-write aggregate. */
  apply: (response: MutationResponse) => void;
  reload: () => Promise<void>;
  setError: (message: string | null) => void;
}

export function useAccount(): AccountContext {
  return useOutletContext<AccountContext>();
}

const TABS = [
  { to: '.', label: 'Thesis', end: true },
  { to: 'evidence', label: 'Evidence' },
  { to: 'stakeholders', label: 'Stakeholders' },
  { to: 'actions', label: 'Actions' },
  { to: 'changelog', label: 'Change log' },
];

export default function AccountLayout() {
  const { accountId } = useParams<{ accountId: string }>();
  const navigate = useNavigate();
  const [aggregate, setAggregate] = useState<AccountAggregate | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!accountId) return;
    try {
      setAggregate(await api.getAccount(accountId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the account.');
    }
  }, [accountId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const apply = useCallback((response: MutationResponse) => {
    setAggregate(response.aggregate);
  }, []);

  async function remove() {
    if (!accountId || !aggregate) return;
    const confirmed = window.confirm(
      `Delete ${aggregate.account.companyName} and everything recorded against it? This cannot be undone.`
    );
    if (!confirmed) return;

    try {
      await api.deleteAccount(accountId);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the account.');
    }
  }

  if (!aggregate) {
    return (
      <section className="screen">
        <ErrorBanner error={error} onDismiss={() => setError(null)} />
        {!error && <Spinner label="Loading account" />}
      </section>
    );
  }

  const context: AccountContext = { aggregate, apply, reload, setError };

  return (
    <section className="screen">
      <div className="screen-head">
        <div>
          <h1>{aggregate.account.companyName}</h1>
          <p className="subtle">
            {aggregate.evidence.length} pieces of evidence · revision {aggregate.rev}
          </p>
        </div>
        <button type="button" className="danger-quiet" onClick={remove}>
          Delete account
        </button>
      </div>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <nav className="tabs">
        {TABS.map((tab) => (
          <NavLink key={tab.label} to={tab.to} end={tab.end} className="tab">
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <Outlet context={context} />
    </section>
  );
}
