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

/**
 * `seedRequested` covers the gap between asking for research and the server
 * recording that it started: the page opened by account creation polls from
 * its first render rather than waiting for a status that is not there yet.
 */
export function useAccountData(id: string | undefined, seedRequested = false): AccountStore {
  const [aggregate, setAggregate] = useState<AccountAggregate | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revRef = useRef(0);
  const [awaitingSeed, setAwaitingSeed] = useState(seedRequested);

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

  // Research runs in a background function, so the result never comes back on
  // the request that started it. Polling is how the UI finds out. It also polls
  // while a just-requested run has yet to show up as 'running'.
  const seedStatus = aggregate?.seedStatus;
  useEffect(() => {
    if (seedStatus !== 'running' && !awaitingSeed) return;
    if (awaitingSeed && (seedStatus === 'complete' || seedStatus === 'failed')) {
      setAwaitingSeed(false);
      return;
    }
    const timer = setInterval(() => void reload(), 4000);
    return () => clearInterval(timer);
  }, [seedStatus, awaitingSeed, reload]);

  const seed = useCallback(async () => {
    if (!id) return;
    setBusy(true);
    setError(null);
    setAwaitingSeed(true);
    try {
      await api.seed(id);
    } catch (err) {
      // The run may still have been accepted; only a rejection the seller can
      // act on is worth showing.
      if (err instanceof ApiError && err.status < 500) setError(messageOf(err));
    } finally {
      setBusy(false);
      await reload();
    }
  }, [id, reload]);

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
