import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { messageOf } from '../useAccount';
import { Empty, Field } from '../components/ui';
import { formatDate } from '../format';
import {
  DEAL_STAGE_LABELS,
  EVIDENCE_CATEGORIES,
  EVIDENCE_CATEGORY_LABELS,
  EVIDENCE_CATEGORY_QUESTIONS,
  type AccountIndexEntry,
} from '../domain/types';

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
      // Research runs in a background function and takes minutes. Starting it is
      // instant; the account page polls until the findings land.
      await api.seed(created.account.id).catch(() => undefined);
      navigate(`/accounts/${created.account.id}`, { state: { seeding: true } });
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
          <h1 className="brand">Account Signal</h1>
        </div>
      </div>

      {error ? <div className="banner error">{error}</div> : null}

      <div className="card">
        <h2>Add an account</h2>
        <form onSubmit={addAccount}>
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

      <div className="grid four" style={{ marginTop: 32 }}>
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

      <div className="card" style={{ marginTop: 32 }}>
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

      <HowToRead />
    </div>
  );
}

/**
 * The tool is opinionated in ways a first-time reader cannot guess — why a
 * claim refuses to be a fact, why the ranked action is the one on screen.
 * That contract is stated once, here, on the page everyone lands on.
 */
function HowToRead() {
  return (
    <div style={{ marginTop: 56 }}>
      <div className="section">
        <h2>How to read this</h2>
      </div>
      <p className="muted">
        Type a company. Claude researches it and writes what it finds into the evidence ledger.
        Every judgment after that is the code&apos;s, computed from that evidence and shown with
        its reasoning.
      </p>

      <div className="card" style={{ marginTop: 20 }}>
        <h2>The four questions research answers</h2>
        <dl className="deflist">
          {EVIDENCE_CATEGORIES.map((category) => (
            <div key={category}>
              <dt>{EVIDENCE_CATEGORY_LABELS[category]}</dt>
              <dd className="muted">{EVIDENCE_CATEGORY_QUESTIONS[category]}</dd>
            </div>
          ))}
        </dl>
        <p className="dim" style={{ margin: '12px 0 0' }}>
          Right to Win cannot be settled from public sources. Until you have spoken to someone it
          stays a hypothesis, however confident the research sounds.
        </p>
      </div>

      <div className="card">
        <h2>What the labels mean</h2>
        <dl className="deflist">
          <div>
            <dt className="badge FACT">Fact</dt>
            <dd className="muted">
              Cites something verifiable: a link, a document, a quote from a real conversation. An
              inference can never be one.
            </dd>
          </div>
          <div>
            <dt className="badge HYPOTHESIS">Hypothesis</dt>
            <dd className="muted">
              Plausible, partly evidenced, still yours to prove. Most of a new account is this.
            </dd>
          </div>
          <div>
            <dt className="badge UNKNOWN">Unknown</dt>
            <dd className="muted">
              A named gap that cites nothing. Unknowns are the raw material of the next action.
            </dd>
          </div>
        </dl>
        <p className="dim" style={{ margin: '12px 0 0' }}>
          Delete evidence and everything resting on it is demoted, with the reason written to the
          change log.
        </p>
      </div>

      <div className="card">
        <h2>Working an account</h2>
        <dl className="deflist">
          <div>
            <dt>Thesis</dt>
            <dd className="muted">
              Why this account, in one screen: what is known, what is assumed, what is missing.
            </dd>
          </div>
          <div>
            <dt>Evidence</dt>
            <dd className="muted">
              The spine, grouped by the four criteria. Everything else cites a row here.
            </dd>
          </div>
          <div>
            <dt>Stakeholders</dt>
            <dd className="muted">
              The buyer map and an eight-signal champion test. Only cited signals move a contact up
              the ladder.
            </dd>
          </div>
          <div>
            <dt>Wedges</dt>
            <dd className="muted">
              The Devin work to land first — migrations, test backfill, CVE upgrades, bug
              burn-down. Candidate, then testing, then validated.
            </dd>
          </div>
          <div>
            <dt>Actions</dt>
            <dd className="muted">
              One ranked next best action, from evidence coverage, champion progression, wedge
              maturity, staleness and stage. Critical blocks the deal; low is an optimisation.
            </dd>
          </div>
          <div>
            <dt>Change log</dt>
            <dd className="muted">What changed, when and why, including every demotion.</dd>
          </div>
        </dl>
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
