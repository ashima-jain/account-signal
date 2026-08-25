/** Shared HTTP helpers for the Netlify Functions. */

import { ConflictError } from './store';

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

export function jsonWithEtag(data: unknown, etag: string | undefined, status = 200): Response {
  return json(data, { status, headers: etag ? { ETag: etag } : {} });
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
 * Writes carry the ETag from the preceding GET in If-Match. Missing it is
 * allowed for compatibility but forfeits lost-update protection.
 */
export function ifMatch(req: Request): string | undefined {
  return req.headers.get('if-match') ?? undefined;
}

/** Maps domain errors onto status codes so each handler stays free of try/catch noise. */
export function toResponse(err: unknown): Response {
  if (err instanceof BadRequestError) return error(400, err.message);
  if (err instanceof ConflictError) return error(409, err.message);
  const message = err instanceof Error ? err.message : 'Unknown error';
  return error(500, message);
}
