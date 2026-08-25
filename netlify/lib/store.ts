/**
 * Netlify Blobs persistence.
 *
 * Layout:
 *   index            -> AccountIndexEntry[]        (derived, rebuildable)
 *   account/<id>     -> AccountAggregate           (source of truth)
 *
 * One blob per account keeps a write atomic across all of an account's
 * entities, and avoids the per-record request fan-out the v1 code had.
 * Concurrency is enforced with ETag compare-and-swap rather than a version
 * field, so a stale write is rejected by the storage layer itself.
 */

import { getStore, type Store } from '@netlify/blobs';
import {
  EVENTS_CAP,
  type AccountAggregate,
  type AccountIndexEntry,
  type ChangeEvent,
  type ChangeType,
  type ID,
} from '../../src/domain/types';
import { championTier } from '../../src/domain/champion';

const STORE_NAME = 'signal_v2';
const INDEX_KEY = 'index';
const ACCOUNT_PREFIX = 'account/';

/** Raised when a conditional write loses. Surfaces to the client as HTTP 409. */
export class ConflictError extends Error {
  constructor(message = 'This account was modified by another tab. Reload and retry.') {
    super(message);
    this.name = 'ConflictError';
  }
}

function store(): Store {
  // Instantiated per request on purpose. Calling getStore() at module scope can
  // execute before the Blobs context is populated, which fails in production.
  return getStore({ name: STORE_NAME, consistency: 'strong' });
}

function accountKey(id: ID): string {
  return `${ACCOUNT_PREFIX}${id}`;
}

export function newId(): ID {
  return crypto.randomUUID();
}

// ─── Aggregate read / write ──────────────────────────────────────────────────

export interface LoadedAggregate {
  aggregate: AccountAggregate;
  /** Pass back to saveAggregate to guarantee no lost update. */
  etag?: string;
}

export async function readAggregate(id: ID): Promise<LoadedAggregate | null> {
  const result = await store().getWithMetadata(accountKey(id), { type: 'json' });
  if (!result) return null;
  return { aggregate: result.data as AccountAggregate, etag: result.etag };
}

export async function createAggregate(
  aggregate: AccountAggregate
): Promise<LoadedAggregate> {
  const write = await store().setJSON(accountKey(aggregate.account.id), aggregate, {
    onlyIfNew: true,
  });
  if (!write.modified) {
    throw new ConflictError('An account with this id already exists.');
  }
  await syncIndexEntry(indexEntryFor(aggregate));
  return { aggregate, etag: write.etag };
}

/**
 * Bumps rev, stamps updatedAt, and persists.
 *
 * Uses the storage ETag for a true compare-and-swap when one is available, but
 * does not require it: reads do not return an ETag in every environment, and
 * conditioning on a missing value would fail every update. The authoritative
 * conflict check is the rev comparison in mutateAggregate.
 */
export async function saveAggregate(
  aggregate: AccountAggregate,
  storageEtag: string | undefined
): Promise<LoadedAggregate> {
  const next: AccountAggregate = {
    ...aggregate,
    rev: aggregate.rev + 1,
    account: { ...aggregate.account, updatedAt: new Date().toISOString() },
  };

  const write = await store().setJSON(
    accountKey(next.account.id),
    next,
    storageEtag ? { onlyIfMatch: storageEtag } : {}
  );
  if (!write.modified) throw new ConflictError();

  await syncIndexEntry(indexEntryFor(next));
  return { aggregate: next, etag: write.etag };
}

/**
 * Read, mutate, write. Every sub-entity endpoint goes through here so no
 * handler can forget the conflict check. Returns null if the account does not
 * exist; the mutator may throw to abort the write.
 */
export async function mutateAggregate<T>(
  id: ID,
  expectedRev: number | undefined,
  mutator: (aggregate: AccountAggregate) => T
): Promise<{ aggregate: AccountAggregate; etag?: string; result: T } | null> {
  const loaded = await readAggregate(id);
  if (!loaded) return null;

  if (expectedRev !== undefined && loaded.aggregate.rev !== expectedRev) {
    throw new ConflictError(
      `This account has changed since you loaded it (now at revision ${loaded.aggregate.rev}, you had ${expectedRev}). Reload and retry.`
    );
  }

  const result = mutator(loaded.aggregate);
  const saved = await saveAggregate(loaded.aggregate, loaded.etag);
  return { aggregate: saved.aggregate, etag: saved.etag, result };
}

export async function deleteAggregate(id: ID): Promise<void> {
  await store().delete(accountKey(id));
  await removeIndexEntry(id);
}

// ─── Change log ──────────────────────────────────────────────────────────────

export function newEvent(
  type: ChangeType,
  summary: string,
  opts: { entityRef?: string; reason?: string } = {}
): ChangeEvent {
  return {
    id: newId(),
    at: new Date().toISOString(),
    type,
    summary,
    entityRef: opts.entityRef,
    reason: opts.reason,
  };
}

/**
 * Appends to the account's history, newest last, capped so the aggregate blob
 * cannot grow without bound. Mutates in place.
 */
export function appendEvent(aggregate: AccountAggregate, event: ChangeEvent): void {
  aggregate.events.push(event);
  if (aggregate.events.length > EVENTS_CAP) {
    aggregate.events = aggregate.events.slice(-EVENTS_CAP);
  }
}

// ─── Index ───────────────────────────────────────────────────────────────────

const STALE_ACCOUNT_DAYS = 14;

export function indexEntryFor(aggregate: AccountAggregate): AccountIndexEntry {
  const { account, claims, evidence, stakeholders, signals, actions } = aggregate;

  const openActions = actions.filter((a) => a.status === 'open');
  const dueDates = openActions
    .map((a) => a.dueAt)
    .filter((d): d is string => Boolean(d))
    .sort();
  const nextActionDueAt = dueDates[0];

  const validatedChampions = stakeholders.filter(
    (s) =>
      championTier(
        signals.filter((sig) => sig.stakeholderId === s.id),
        evidence
      ) === 'Validated Champion'
  ).length;

  const now = Date.now();
  const overdue = dueDates.some((d) => new Date(d).getTime() < now);
  const stale =
    now - new Date(account.updatedAt).getTime() >
    STALE_ACCOUNT_DAYS * 24 * 60 * 60 * 1000;
  const noEconomicBuyer = !stakeholders.some((s) => s.mapRoles.includes('economic_buyer'));

  return {
    id: account.id,
    companyName: account.companyName,
    updatedAt: account.updatedAt,
    evidenceCount: evidence.length,
    factCount: claims.filter((c) => c.status === 'FACT').length,
    unknownCount: claims.filter((c) => c.status === 'UNKNOWN').length,
    stakeholderCount: stakeholders.length,
    validatedChampions,
    openActions: openActions.length,
    nextActionDueAt,
    // Anything that should pull the seller's attention on a Monday.
    needsAttention: overdue || stale || evidence.length === 0 || noEconomicBuyer,
  };
}

export async function listIndex(): Promise<AccountIndexEntry[]> {
  const raw = await store().get(INDEX_KEY, { type: 'json' });
  const entries = (raw as AccountIndexEntry[] | null) ?? (await rebuildIndex());
  return [...entries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * The index is a cache of derived data. It is written without CAS because a
 * lost update only costs a stale portfolio row, and it can always be rebuilt
 * from the account blobs.
 */
async function syncIndexEntry(entry: AccountIndexEntry): Promise<void> {
  const raw = await store().get(INDEX_KEY, { type: 'json' });
  const entries = (raw as AccountIndexEntry[] | null) ?? [];
  const next = entries.filter((e) => e.id !== entry.id);
  next.push(entry);
  await store().setJSON(INDEX_KEY, next);
}

async function removeIndexEntry(id: ID): Promise<void> {
  const raw = await store().get(INDEX_KEY, { type: 'json' });
  const entries = (raw as AccountIndexEntry[] | null) ?? [];
  await store().setJSON(
    INDEX_KEY,
    entries.filter((e) => e.id !== id)
  );
}

export async function rebuildIndex(): Promise<AccountIndexEntry[]> {
  const { blobs } = await store().list({ prefix: ACCOUNT_PREFIX });
  const entries: AccountIndexEntry[] = [];
  for (const blob of blobs) {
    const raw = await store().get(blob.key, { type: 'json' });
    if (raw) entries.push(indexEntryFor(raw as AccountAggregate));
  }
  await store().setJSON(INDEX_KEY, entries);
  return entries;
}
