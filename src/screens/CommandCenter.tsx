import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { AccountIndexEntry } from '../domain/types';
import { ErrorBanner, EmptyState, Spinner } from '../components/Feedback';
import { Chip } from '../components/Chips';
import { ageLabel } from '../lib/format';

export default function CommandCenter() {
  const [accounts, setAccounts] = useState<AccountIndexEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setAccounts(await api.listAccounts());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load accounts.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    const name = companyName.trim();
    if (!name) return;

    setBusy(true);
    setError(null);
    try {
      await api.createAccount({ companyName: name });
      setCompanyName('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the account.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="screen">
      <div className="screen-head">
        <h1>Accounts</h1>
        <form className="inline-form" onSubmit={create}>
          <input
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="Company name"
            aria-label="Company name"
          />
          <button type="submit" disabled={busy || !companyName.trim()}>
            {busy ? 'Adding…' : 'Add account'}
          </button>
        </form>
      </div>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {accounts === null ? (
        <Spinner label="Loading accounts" />
      ) : accounts.length === 0 ? (
        <EmptyState title="No accounts yet.">
          <p>
            Add a company above. The first thing to do inside an account is record evidence:
            everything else in the system has to cite it.
          </p>
        </EmptyState>
      ) : (
        <ul className="account-list">
          {accounts.map((account) => (
            <li key={account.id} className={account.needsAttention ? 'needs-attention' : ''}>
              <Link to={`/accounts/${account.id}`} className="account-card">
                <div className="account-card-head">
                  <h2>{account.companyName}</h2>
                  {account.needsAttention && <Chip label="Needs attention" tone="warn" />}
                </div>
                <dl className="metrics">
                  <div>
                    <dt>Evidence</dt>
                    <dd>{account.evidenceCount}</dd>
                  </div>
                  <div>
                    <dt>Facts</dt>
                    <dd>{account.factCount}</dd>
                  </div>
                  <div>
                    <dt>Unknowns</dt>
                    <dd>{account.unknownCount}</dd>
                  </div>
                  <div>
                    <dt>People</dt>
                    <dd>{account.stakeholderCount}</dd>
                  </div>
                  <div>
                    <dt>Open actions</dt>
                    <dd>{account.openActions}</dd>
                  </div>
                </dl>
                <p className="account-card-foot">Updated {ageLabel(account.updatedAt)}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
