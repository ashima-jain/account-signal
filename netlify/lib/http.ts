/** Shared HTTP helpers for the Netlify Functions. */

import { ConflictError } from './store';
import type { AccountAggregate, ID } from '../../src/domain/types';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadRequestError';
  }
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: { ...JSON_HEADERS, ...(init.headers ?? {}) },
  });
}

/**
 * The API's version token is the aggregate's own rev, not the blob store's
 * ETag: the store does not return an ETag on reads in every environment, and a
 * concurrency scheme that silently stops working is worse than none.
 */
export function revEtag(rev: number): string {
  return `"rev-${rev}"`;
}

export function jsonWithRev(data: unknown, rev: number, status = 200): Response {
  return json(data, { status, headers: { ETag: revEtag(rev) } });
}

/**
 * Every mutation returns the whole aggregate. The client then holds exactly one
 * piece of server state and replaces it wholesale, instead of patching
 * sub-entities and tracking revisions by hand. `entityId` identifies the row
 * the call created or touched.
 */
export function mutationResult(
  aggregate: AccountAggregate,
  entityId?: ID,
  status = 200
): Response {
  return jsonWithRev({ aggregate, entityId }, aggregate.rev, status);
}

export function error(status: number, message: string): Response {
  return json({ error: message }, { status });
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new BadRequestError('Request body is not valid JSON.');
  }
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BadRequestError(`"${field}" is required.`);
  }
  return value.trim();
}

/**
 * Reads the expected revision from If-Match. Absent means the caller accepts
 * last-write-wins; present and stale is rejected with 409.
 */
export function expectedRev(req: Request): number | undefined {
  const header = req.headers.get('if-match');
  if (!header || header === '*') return undefined;

  const match = /rev-(\d+)/.exec(header);
  if (!match) {
    throw new BadRequestError('If-Match must be an ETag of the form "rev-N".');
  }
  return Number(match[1]);
}

/** Maps domain errors onto status codes so each handler stays free of try/catch noise. */
export function toResponse(err: unknown): Response {
  if (err instanceof BadRequestError) return error(400, err.message);
  if (err instanceof ConflictError) return error(409, err.message);
  const message = err instanceof Error ? err.message : 'Unknown error';
  return error(500, message);
}
