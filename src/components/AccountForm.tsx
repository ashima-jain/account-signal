import { useState } from 'react';
import type { Account, ResearchRequest } from '../types';

interface Props {
  account?: Account;
  onSubmit: (request: ResearchRequest) => void;
  loading: boolean;
  onSave: (account: Partial<Account>) => void;
}

export function AccountForm({ account, onSubmit, loading, onSave }: Props) {
  const [companyName, setCompanyName] = useState(account?.companyName || '');
  const [targetName, setTargetName] = useState(account?.targetName || '');
  const [targetTitle, setTargetTitle] = useState(account?.targetTitle || '');
  const [researchNotes, setResearchNotes] = useState(account?.researchNotes || '');
  const [people, setPeople] = useState<{ name: string; title: string }[]>(
    account?.people.length ? account.people : [{ name: '', title: '' }]
  );

  const addPerson = () => setPeople([...people, { name: '', title: '' }]);
  const removePerson = (index: number) => setPeople(people.filter((_, i) => i !== index));
  const updatePerson = (index: number, field: 'name' | 'title', value: string) => {
    const next = [...people];
    next[index][field] = value;
    setPeople(next);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      companyName: companyName.trim(),
      targetName: targetName.trim() || undefined,
      targetTitle: targetTitle.trim() || undefined,
      researchNotes: researchNotes.trim(),
      people: people.filter(p => p.name.trim() || p.title.trim()),
    });
  };

  const handleSave = () => {
    onSave({
      companyName: companyName.trim(),
      targetName: targetName.trim() || undefined,
      targetTitle: targetTitle.trim() || undefined,
      researchNotes: researchNotes.trim(),
      people: people.filter(p => p.name.trim() || p.title.trim()),
    });
  };

  return (
    <form className="account-form" onSubmit={handleSubmit}>
      <div className="field">
        <label htmlFor="companyName">Company name *</label>
        <input
          id="companyName"
          type="text"
          value={companyName}
          onChange={e => setCompanyName(e.target.value)}
          placeholder="e.g. Acme Corp"
          required
        />
      </div>

      <div className="row">
        <div className="field">
          <label htmlFor="targetName">Target person's name</label>
          <input
            id="targetName"
            type="text"
            value={targetName}
            onChange={e => setTargetName(e.target.value)}
            placeholder="Optional"
          />
        </div>
        <div className="field">
          <label htmlFor="targetTitle">Target person's title</label>
          <input
            id="targetTitle"
            type="text"
            value={targetTitle}
            onChange={e => setTargetTitle(e.target.value)}
            placeholder="Optional"
          />
        </div>
      </div>

      <div className="field">
        <label>People at the account (from LinkedIn Navigator)</label>
        {people.map((person, index) => (
          <div key={index} className="person-row">
            <input
              type="text"
              placeholder="Name"
              value={person.name}
              onChange={e => updatePerson(index, 'name', e.target.value)}
            />
            <input
              type="text"
              placeholder="Title"
              value={person.title}
              onChange={e => updatePerson(index, 'title', e.target.value)}
            />
            {people.length > 1 && (
              <button type="button" className="danger" onClick={() => removePerson(index)}>
                Remove
              </button>
            )}
          </div>
        ))}
        <button type="button" className="secondary" onClick={addPerson}>
          + Add person
        </button>
      </div>

      <div className="field">
        <label htmlFor="researchNotes">Research notes</label>
        <textarea
          id="researchNotes"
          value={researchNotes}
          onChange={e => setResearchNotes(e.target.value)}
          rows={6}
          placeholder="Paste LinkedIn company page notes, recent news, tech stack, hiring signals, etc."
        />
      </div>

      <div className="form-actions">
        <button type="submit" className="primary" disabled={loading || !companyName.trim()}>
          {loading ? 'Generating...' : 'Generate account signal'}
        </button>
        <button type="button" className="secondary" onClick={handleSave} disabled={!companyName.trim()}>
          Save account
        </button>
      </div>
    </form>
  );
}
