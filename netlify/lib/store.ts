/**
 * Netlify Blobs persistence.
 *
 *   index         -> AccountIndexEntry[]   derived, rebuildable from accounts
 *   account/<id>  -> AccountAggregate      source of truth, one blob per account
 *
 * One blob per account makes every write atomic across all of that account's
 * entities: a claim and the evidence it cites can never be half-saved. The cost
 * is that two people editing one account race, which is what the rev check and
 * the storage ETag are for.
 */

import { getStore, type Store } from '@netlify/blobs';
import { countValidatedChampions } from '../../src/domain/champion';
import {
  EVENTS_CAP,
  inferDealStage,
  type AccountAggregate,
  type AccountIndexEntry,
  type ChangeEvent,
  type ChangeType,
  type ID,
} from '../../src/domain/types';

const STORE_NAME = 'account_signal';
const INDEX_KEY = 'index';

export class ConflictError extends Error {
  readonly status = 409;
  constructor(message = 'This account changed while you were editing it. Reload and retry.') {
    super(message);
    this.name = 'ConflictError';
  }
}

/**
 * Instantiated per call on purpose: at module scope this can run before the
 * Blobs context exists, which fails only in production.
 */
function store(): Store {
  return getStore({ name: STORE_NAME, consistency: 'strong' });
}

const accountKey = (id: ID) => `account/${id}`;

export function newId(): ID {
  return crypto.randomUUID();
}

export interface LoadedAggregate {
  aggregate: AccountAggregate;
  /** Storage ETag, distinct from the rev the client sees. */
  etag?: string;
}

export async function readAggregate(id: ID): Promise<LoadedAggregate | null> {
  const result = await store().getWithMetadata(accountKey(id), { type: 'json' });
  if (!result) return null;
  return { aggregate: result.data as AccountAggregate, etag: result.etag };
}

export async function createAggregate(aggregate: AccountAggregate): Promise<AccountAggregate> {
  const write = await store().setJSON(accountKey(aggregate.account.id), aggregate, {
    onlyIfNew: true,
  });
  if (!write.modified) throw new ConflictError('An account with this id already exists.');
  await syncIndexEntry(indexEntryFor(aggregate));
  return aggregate;
}

/**
 * Bumps the rev, stamps updatedAt and persists.
 *
 * Conditions on the storage ETag when the read gave us one — some environments
 * do not return an ETag, and conditioning on `undefined` would fail every
 * write. The rev comparison in mutateAggregate is the check we always have.
 */
export async function saveAggregate(
  aggregate: AccountAggregate,
  storageEtag: string | undefined
): Promise<AccountAggregate> {
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
  return next;
}

/**
 * Read, mutate, write. Every mutating endpoint goes through here so no handler
 * can forget the conflict check. The mutator may throw to abort the write.
 */
export async function mutateAggregate(
  id: ID,
  expectedRev: number | undefined,
  mutate: (aggregate: AccountAggregate) => void
): Promise<AccountAggregate | null> {
  const loaded = await readAggregate(id);
  if (!loaded) return null;

  if (expectedRev !== undefined && loaded.aggregate.rev !== expectedRev) {
    throw new ConflictError(
      `This account is now at revision ${loaded.aggregate.rev}, you were editing revision ${expectedRev}. Reload and retry.`
    );
  }

  mutate(loaded.aggregate);
  return saveAggregate(loaded.aggregate, loaded.etag);
}

export async function deleteAggregate(id: ID): Promise<void> {
  await store().delete(accountKey(id));
  const index = await readIndex();
  await writeIndex(index.filter((entry) => entry.id !== id));
}

// ─── Change log ──────────────────────────────────────────────────────────────

export function appendEvent(
  aggregate: AccountAggregate,
  type: ChangeType,
  summary: string,
  opts: { entityRef?: string; reason?: string } = {}
): void {
  const event: ChangeEvent = {
    id: newId(),
    at: new Date().toISOString(),
    type,
    summary,
    entityRef: opts.entityRef,
    reason: opts.reason,
  };
  aggregate.events.push(event);
  if (aggregate.events.length > EVENTS_CAP) {
    aggregate.events = aggregate.events.slice(-EVENTS_CAP);
  }
}

// ─── Index ───────────────────────────────────────────────────────────────────

export function indexEntryFor(aggregate: AccountAggregate): AccountIndexEntry {
  const { account, evidence, claims, stakeholders, signals, wedges, actions } = aggregate;
  const open = actions.filter((a) => a.status === 'open');
  const nextDue = open
    .map((a) => a.dueAt)
    .filter((d): d is string => Boolean(d))
    .sort()[0];

  const unknownCount = claims.filter((c) => c.status === 'UNKNOWN').length;
  const validatedChampions = countValidatedChampions(stakeholders, signals, evidence);

  return {
    id: account.id,
    companyName: account.companyName,
    domain: account.domain,
    updatedAt: account.updatedAt,
    evidenceCount: evidence.length,
    factCount: claims.filter((c) => c.status === 'FACT').length,
    unknownCount,
    stakeholderCount: stakeholders.length,
    validatedChampions,
    validatedWedges: wedges.filter((w) => w.status === 'validated').length,
    openActions: open.length,
    nextActionDueAt: nextDue,
    dealStage: inferDealStage(aggregate),
    seedStatus: aggregate.seedStatus,
    needsAttention:
      evidence.length === 0 ||
      claims.length === 0 ||
      open.length === 0 ||
      (validatedChampions === 0 && stakeholders.length > 0),
  };
}

export async function readIndex(): Promise<AccountIndexEntry[]> {
  const data = await store().get(INDEX_KEY, { type: 'json' });
  return (data as AccountIndexEntry[] | null) ?? [];
}

async function writeIndex(entries: AccountIndexEntry[]): Promise<void> {
  await store().setJSON(INDEX_KEY, entries);
}

async function syncIndexEntry(entry: AccountIndexEntry): Promise<void> {
  const index = await readIndex();
  const without = index.filter((e) => e.id !== entry.id);
  without.push(entry);
  without.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  await writeIndex(without);
}
