import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { messageOf } from '../useAccount';
import { Empty, Field } from '../components/ui';
import { formatDate } from '../format';
import { DEAL_STAGE_LABELS, type AccountIndexEntry } from '../domain/types';

export default function CommandCenter() {
  const [accounts, setAccounts] = useState<AccountIndexEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [domain, setDomain] = useState('');
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      setAccounts(await api.listAccounts());
    } catch (err) {
      setError(messageOf(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function addAccount(event: React.FormEvent) {
    event.preventDefault();
    if (!companyName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const created = await api.createAccount(companyName.trim(), domain.trim() || undefined);
      // Research is slow and may outlive the request. The account exists either
      // way, so the seed is left running and the account page polls for it.
      void api.seed(created.account.id).catch(() => undefined);
      navigate(`/accounts/${created.account.id}`);
    } catch (err) {
      setError(messageOf(err));
      setCreating(false);
    }
  }

  const needsAttention = accounts?.filter((a) => a.needsAttention).length ?? 0;

  return (
    <div className="shell">
      <div className="topbar">
        <div>
          <h1 className="brand">
            Account Signal<span>evidence-first account execution for Devin</span>
          </h1>
          <p className="muted" style={{ marginTop: 6 }}>
            Research is the model&apos;s job. Judgment is the code&apos;s job. Nothing here is a
            fact until something you can point at says so.
          </p>
        </div>
      </div>

      {error ? <div className="banner error">{error}</div> : null}

      <div className="card">
        <h2>Add an account</h2>
        <p className="dim">
          Claude researches the company across engineering scale, Devin use-case fit, urgency and
          right to win, then fills the ledger with what it can cite.
        </p>
        <form onSubmit={addAccount} style={{ marginTop: 10 }}>
          <div className="grid two">
            <Field label="Company">
              <input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Shopify"
                autoFocus
              />
            </Field>
            <Field label="Domain (optional)">
              <input
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="shopify.com"
              />
            </Field>
          </div>
          <button className="primary" disabled={creating || !companyName.trim()}>
            {creating ? 'Researching…' : 'Research account'}
          </button>
        </form>
      </div>

      <div className="grid four" style={{ marginTop: 16 }}>
        <Metric label="Accounts" value={accounts?.length ?? 0} />
        <Metric
          label="Validated wedges"
          value={sum(accounts, (a) => a.validatedWedges)}
        />
        <Metric
          label="Validated champions"
          value={sum(accounts, (a) => a.validatedChampions)}
        />
        <Metric label="Need attention" value={needsAttention} />
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Portfolio</h2>
        {accounts === null ? (
          <p className="muted">Loading…</p>
        ) : accounts.length === 0 ? (
          <Empty>No accounts yet. Add one above.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Stage</th>
                <th>Evidence</th>
                <th>Facts</th>
                <th>Unknowns</th>
                <th>Champions</th>
                <th>Wedges</th>
                <th>Open actions</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id}>
                  <td>
                    <Link to={`/accounts/${account.id}`}>{account.companyName}</Link>
                    {account.needsAttention ? (
                      <div className="dim">Needs attention</div>
                    ) : null}
                  </td>
                  <td>{DEAL_STAGE_LABELS[account.dealStage]}</td>
                  <td>{account.evidenceCount}</td>
                  <td>{account.factCount}</td>
                  <td>{account.unknownCount}</td>
                  <td>{account.validatedChampions}</td>
                  <td>{account.validatedWedges}</td>
                  <td>{account.openActions}</td>
                  <td className="dim">{formatDate(account.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <div className="value">{value}</div>
      <div className="label">{label}</div>
    </div>
  );
}

function sum(
  accounts: AccountIndexEntry[] | null,
  pick: (entry: AccountIndexEntry) => number
): number {
  return (accounts ?? []).reduce((total, entry) => total + pick(entry), 0);
}
