/**
 * Thin client over the account API.
 *
 * Every mutation returns the whole aggregate and an `ETag: "rev-N"`, and every
 * mutation sends the last rev back as `If-Match`. The client therefore never
 * merges partial state, and a write made against a stale view is rejected by
 * the server rather than silently overwriting someone else's edit.
 */

import type { AccountAggregate, AccountIndexEntry } from './domain/types';
import { clearPasscode, getPasscode } from './auth';

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }

  /** A stale write. The caller should reload rather than retry blindly. */
  get isConflict(): boolean {
    return this.status === 409;
  }
}

async function request<T>(
  path: string,
  init: RequestInit & { rev?: number } = {}
): Promise<T> {
  const { rev, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (rest.body) headers.set('content-type', 'application/json');
  if (rev !== undefined) headers.set('If-Match', `"rev-${rev}"`);
  const passcode = getPasscode();
  if (passcode) headers.set('Authorization', `Bearer ${passcode}`);

  const response = await fetch(path, { ...rest, headers });
  const text = await response.text();

  // A gateway timeout answers with its own HTML or plain text, so parsing is
  // never assumed to succeed.
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  // A rejected passcode is not an error the screens can do anything with: drop
  // it so the app falls back to asking for one.
  if (response.status === 401) clearPasscode();

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : `Request failed with ${response.status}.`;
    throw new ApiError(message, response.status);
  }

  if (payload === null) {
    throw new ApiError('The server returned an unreadable response.', response.status);
  }

  return payload as T;
}

const body = (value: unknown) => JSON.stringify(value);

export const api = {
  listAccounts: () => request<AccountIndexEntry[]>('/api/accounts'),

  createAccount: (companyName: string, domain?: string) =>
    request<AccountAggregate>('/api/accounts', {
      method: 'POST',
      body: body({ companyName, domain }),
    }),

  getAccount: (id: string) => request<AccountAggregate>(`/api/accounts/${id}`),

  updateAccount: (id: string, rev: number, patch: Record<string, unknown>) =>
    request<AccountAggregate>(`/api/accounts/${id}`, {
      method: 'PATCH',
      rev,
      body: body(patch),
    }),

  deleteAccount: (id: string) =>
    request<{ deleted: boolean }>(`/api/accounts/${id}`, { method: 'DELETE' }),

  /**
   * Research runs longer than a function invocation is guaranteed to live, so a
   * timeout is not a failure — the caller polls the account until the evidence
   * lands.
   */
  seed: (id: string) =>
    request<AccountAggregate>(`/api/accounts/${id}/seed`, { method: 'POST' }),

  generateThesis: (id: string, rev: number) =>
    request<AccountAggregate>(`/api/accounts/${id}/thesis/generate`, {
      method: 'POST',
      rev,
    }),

  create: (id: string, collection: string, rev: number, payload: unknown) =>
    request<AccountAggregate>(`/api/accounts/${id}/${collection}`, {
      method: 'POST',
      rev,
      body: body(payload),
    }),

  patch: (
    id: string,
    collection: string,
    entityId: string,
    rev: number,
    payload: unknown
  ) =>
    request<AccountAggregate>(`/api/accounts/${id}/${collection}/${entityId}`, {
      method: 'PATCH',
      rev,
      body: body(payload),
    }),

  remove: (id: string, collection: string, entityId: string, rev: number) =>
    request<AccountAggregate>(`/api/accounts/${id}/${collection}/${entityId}`, {
      method: 'DELETE',
      rev,
    }),
};
