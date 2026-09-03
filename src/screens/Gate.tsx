import { useEffect, useState, type ReactNode } from 'react';
import { getPasscode, onPasscodeChange, setPasscode } from '../auth';
import { Field } from '../components/ui';

/**
 * Account intelligence is not public, so nothing renders until the workspace
 * passcode is present. The server is the authority: this only decides whether
 * to ask, and it asks again as soon as the server rejects what it has.
 */
export default function Gate({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState(() => Boolean(getPasscode()));
  const [entry, setEntry] = useState('');

  useEffect(() => onPasscodeChange(() => setUnlocked(Boolean(getPasscode()))), []);

  if (unlocked) return <>{children}</>;

  return (
    <div className="shell">
      <div className="topbar">
        <div>
          <h1 className="brand">
            Account Signal<span>evidence-first account execution for Devin</span>
          </h1>
        </div>
      </div>
      <div className="card">
        <h2>Workspace passcode</h2>
        <p className="dim">
          Account intelligence is private to your team, so the API answers nobody without it.
        </p>
        <form
          style={{ marginTop: 10 }}
          onSubmit={(event) => {
            event.preventDefault();
            if (entry.trim()) setPasscode(entry.trim());
          }}
        >
          <Field label="Passcode">
            <input
              type="password"
              value={entry}
              autoFocus
              onChange={(event) => setEntry(event.target.value)}
            />
          </Field>
          <div className="row" style={{ marginTop: 10 }}>
            <button type="submit" disabled={!entry.trim()}>
              Unlock
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
