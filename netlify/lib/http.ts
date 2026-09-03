/**
 * Request/response plumbing shared by every function.
 *
 * The wire contract is deliberately narrow: mutations return the whole
 * aggregate with an `ETag: "rev-N"`, and the next mutation must send that value
 * back as `If-Match`. Clients never merge partial updates, so they cannot drift.
 */

import type { AccountAggregate } from '../../src/domain/types';
import { requireAccess } from './auth';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

export function errorResponse(message: string, status: number, extra: Record<string, unknown> = {}): Response {
  return json({ error: message, ...extra }, status);
}

export function revEtag(rev: number): string {
  return `"rev-${rev}"`;
}

/** Returns the aggregate plus the ETag the client must echo on its next write. */
export function aggregateResponse(aggregate: AccountAggregate, status = 200): Response {
  return json(aggregate, status, { ETag: revEtag(aggregate.rev) });
}

/** Parses `If-Match: "rev-7"`. Absent or malformed means "no expectation". */
export function expectedRevOf(request: Request): number | undefined {
  const header = request.headers.get('if-match');
  if (!header) return undefined;
  const match = /rev-(\d+)/.exec(header);
  if (!match) return undefined;
  return Number(match[1]);
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new BadRequest('Request body must be valid JSON.');
  }
}

export class BadRequest extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'BadRequest';
  }
}

export class NotFound extends Error {
  readonly status = 404;
  constructor(message = 'Not found.') {
    super(message);
    this.name = 'NotFound';
  }
}

/** Rejected by an invariant rather than by validation: worth its own status. */
export class InvariantViolation extends Error {
  readonly status = 422;
  constructor(message: string) {
    super(message);
    this.name = 'InvariantViolation';
  }
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BadRequest(`"${field}" is required.`);
  }
  return value.trim();
}

export function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new BadRequest(`"${field}" must be a string.`);
  return value.trim();
}

/**
 * Stored links are rendered as anchors, so only schemes a browser can safely
 * follow are accepted: `javascript:` in an href is script execution.
 */
export function optionalHttpUrl(value: unknown, field: string): string | undefined {
  const raw = optionalString(value, field);
  if (raw === undefined) return undefined;
  const url = sanitizeHttpUrl(raw);
  if (!url) throw new BadRequest(`"${field}" must be an http(s) URL.`);
  return url;
}

/** Same rule for links the model hands us: drop them rather than reject the batch. */
export function sanitizeHttpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

export function stringArray(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new BadRequest(`"${field}" must be an array of strings.`);
  }
  return value as string[];
}

export function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
  fallback?: T
): T {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    throw new BadRequest(`"${field}" is required.`);
  }
  if (!allowed.includes(value as T)) {
    throw new BadRequest(`"${field}" must be one of: ${allowed.join(', ')}.`);
  }
  return value as T;
}

export function isoDate(value: unknown, field: string, fallback?: string): string {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    throw new BadRequest(`"${field}" is required.`);
  }
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new BadRequest(`"${field}" must be an ISO date.`);
  }
  return new Date(value).toISOString();
}

/**
 * Authorises the request, then wraps the handler so every thrown domain error
 * becomes the right status code and nothing leaks a stack trace to the client.
 */
export async function handle(request: Request, fn: () => Promise<Response>): Promise<Response> {
  try {
    requireAccess(request);
    return await fn();
  } catch (error) {
    const status = (error as { status?: number }).status;
    const message = error instanceof Error ? error.message : 'Unexpected error.';
    if (typeof status === 'number') return errorResponse(message, status);
    if (error instanceof Error && error.name === 'ConflictError') {
      return errorResponse(message, 409);
    }
    console.error('Unhandled error', error);
    return errorResponse(message, 500);
  }
}

export function methodNotAllowed(method: string): Response {
  return errorResponse(`${method} is not supported on this route.`, 405);
}
