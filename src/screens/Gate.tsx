import { useEffect, useState, type ReactNode } from 'react';
import { getPasscode, onPasscodeChange, setPasscode } from '../auth';
import { Field } from '../components/ui';

/**
 * The server is the authority on whether this deploy is private: a deploy with
 * no ACCESS_PASSCODE set answers unauthenticated requests, so the gate asks for
 * a passcode only once the API has actually refused one. It asks again as soon
 * as the server rejects what it has.
 */
export default function Gate({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState(() => Boolean(getPasscode()));
  const [open, setOpen] = useState<boolean | null>(null);
  const [entry, setEntry] = useState('');

  useEffect(() => onPasscodeChange(() => setUnlocked(Boolean(getPasscode()))), []);

  useEffect(() => {
    if (unlocked) return;
    let live = true;
    void fetch('/api/accounts')
      .then((response) => {
        if (live) setOpen(response.status !== 401);
      })
      .catch(() => {
        if (live) setOpen(false);
      });
    return () => {
      live = false;
    };
  }, [unlocked]);

  if (unlocked || open) return <>{children}</>;
  if (open === null) return null;

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
