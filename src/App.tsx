import { useEffect, useState, useCallback } from 'react';
import { AccountForm } from './components/AccountForm';
import { ResearchPanel } from './components/ResearchPanel';
import { SavedAccounts } from './components/SavedAccounts';
import { generateResearch, listAccounts, createAccount, updateAccount, deleteAccount } from './api';
import type { Account, ResearchOutput, ResearchRequest } from './types';
import './App.css';

function App() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [output, setOutput] = useState<ResearchOutput | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    try {
      const data = await listAccounts();
      setAccounts(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load accounts');
    }
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const handleGenerate = async (request: ResearchRequest) => {
    setLoading(true);
    setError(null);
    setOutput(null);
    try {
      // Ensure the account exists before generating research so outputs are saved.
      let account = selectedAccount;
      if (!account) {
        const created = await createAccount({
          companyName: request.companyName,
          targetName: request.targetName,
          targetTitle: request.targetTitle,
          researchNotes: request.researchNotes,
          people: request.people,
        });
        if (!created) throw new Error('Failed to create account');
        account = created;
        setSelectedAccount(created);
        setAccounts(prev => [created, ...prev]);
      }

      const research = await generateResearch(request);
      setOutput(research);

      const updated = await updateAccount(account.id, { ...request, research });
      setSelectedAccount(updated);
      setAccounts(prev => [updated, ...prev.filter(a => a.id !== updated.id)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Research generation failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (partial: Partial<Account>) => {
    setError(null);
    try {
      if (selectedAccount) {
        const updated = await updateAccount(selectedAccount.id, partial);
        setSelectedAccount(updated);
        setAccounts(prev => [updated, ...prev.filter(a => a.id !== updated.id)]);
      } else {
        const created = await createAccount(partial as Omit<Account, 'id' | 'createdAt' | 'updatedAt'>);
        setSelectedAccount(created);
        setAccounts(prev => [created, ...prev]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save account');
    }
  };

  const handleNew = () => {
    setSelectedAccount(null);
    setOutput(null);
    setError(null);
  };

  const handleSelect = (account: Account) => {
    setSelectedAccount(account);
    setOutput(account.research || null);
    setError(null);
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteAccount(id);
      setAccounts(prev => prev.filter(a => a.id !== id));
      if (selectedAccount?.id === id) {
        setSelectedAccount(null);
        setOutput(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete account');
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Account Signal</h1>
        <p>Turn account research into better outbound.</p>
      </header>

      <div className="app-body">
        <aside className="app-sidebar">
          <SavedAccounts
            accounts={accounts}
            selectedId={selectedAccount?.id}
            onSelect={handleSelect}
            onNew={handleNew}
            onDelete={handleDelete}
          />
        </aside>

        <main className="app-main">
          {error && <div className="error-banner">{error}</div>}

          <section className="form-section">
            <h2>{selectedAccount ? `Edit ${selectedAccount.companyName}` : 'New account'}</h2>
            <AccountForm
              key={selectedAccount?.id || 'new'}
              account={selectedAccount || undefined}
              onSubmit={handleGenerate}
              loading={loading}
              onSave={handleSave}
            />
          </section>

          {loading && (
            <div className="loading-state">
              <div className="spinner" />
              <p>Generating account signal...</p>
            </div>
          )}

          {!loading && output && (
            <section className="output-section">
              <h2>Research output</h2>
              <ResearchPanel output={output} />
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
