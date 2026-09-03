/**
 * Client-side account state.
 *
 * There is exactly one copy of the account in the browser: the aggregate the
 * server last returned. Mutations replace it wholesale, so a screen can never
 * be showing a claim whose evidence the server has already deleted.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api, ApiError } from './api';
import type { AccountAggregate } from './domain/types';

export interface AccountStore {
  aggregate: AccountAggregate | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  clearError: () => void;
  reload: () => Promise<void>;
  /** Starts research. Never fails loudly: the server records how it ended. */
  seed: () => Promise<void>;
  /** Runs a mutation with the current rev and installs the returned aggregate. */
  run: (
    mutation: (rev: number) => Promise<AccountAggregate>
  ) => Promise<AccountAggregate | null>;
}

export function useAccountData(id: string | undefined): AccountStore {
  const [aggregate, setAggregate] = useState<AccountAggregate | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revRef = useRef(0);

  const install = useCallback((next: AccountAggregate) => {
    revRef.current = next.rev;
    setAggregate(next);
  }, []);

  const reload = useCallback(async () => {
    if (!id) return;
    try {
      install(await api.getAccount(id));
      setError(null);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setLoading(false);
    }
  }, [id, install]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  // A seed that outlived its function invocation finishes server-side; polling
  // is how the UI finds out.
  useEffect(() => {
    if (aggregate?.seedStatus !== 'running') return;
    const timer = setInterval(() => void reload(), 4000);
    return () => clearInterval(timer);
  }, [aggregate?.seedStatus, reload]);

  const seed = useCallback(async () => {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      install(await api.seed(id));
    } catch (err) {
      // Research outliving its invocation looks like a transport failure here,
      // but the server has already recorded 'running' and will record how it
      // ended. Reload and let the seed status speak.
      if (err instanceof ApiError && err.status < 500) setError(messageOf(err));
      await reload();
    } finally {
      setBusy(false);
    }
  }, [id, install, reload]);

  const run = useCallback(
    async (mutation: (rev: number) => Promise<AccountAggregate>) => {
      setBusy(true);
      setError(null);
      try {
        const next = await mutation(revRef.current);
        install(next);
        return next;
      } catch (err) {
        setError(messageOf(err));
        if (err instanceof ApiError && err.isConflict) await reload();
        return null;
      } finally {
        setBusy(false);
      }
    },
    [install, reload]
  );

  return {
    aggregate,
    loading,
    busy,
    error,
    clearError: () => setError(null),
    reload,
    seed,
    run,
  };
}

export function useAccount(): AccountStore & { aggregate: AccountAggregate } {
  return useOutletContext<AccountStore & { aggregate: AccountAggregate }>();
}

export function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}
