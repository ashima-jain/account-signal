/**
 * Account CRUD.
 *
 * Routes are declared with `config.path` rather than parsed out of the URL. The
 * v1 code matched the rewritten `/.netlify/functions/...` path, which only
 * exists under `netlify dev`; in production the function sees the original
 * `/api/...` URL, so every id-based route silently fell through to 405.
 * `context.params` removes the guesswork.
 */

import type { Config, Context } from '@netlify/functions';
import {
  createAggregate,
  deleteAggregate,
  listIndex,
  newEvent,
  newId,
  appendEvent,
  readAggregate,
  saveAggregate,
} from '../lib/store';
import {
  error,
  ifMatch,
  json,
  jsonWithEtag,
  readJson,
  requireString,
  toResponse,
} from '../lib/http';
import { emptyAggregate, type Account } from '../../src/domain/types';

export const config: Config = {
  path: ['/api/accounts', '/api/accounts/:id'],
};

export default async (req: Request, context: Context): Promise<Response> => {
  const id = context.params.id;

  try {
    if (!id) {
      if (req.method === 'GET') return await listAccounts();
      if (req.method === 'POST') return await createAccount(req);
      return error(405, `${req.method} is not supported on /api/accounts.`);
    }

    if (req.method === 'GET') return await getAccount(id);
    if (req.method === 'PATCH' || req.method === 'PUT') return await updateAccount(req, id);
    if (req.method === 'DELETE') return await removeAccount(id);
    return error(405, `${req.method} is not supported on /api/accounts/:id.`);
  } catch (err) {
    return toResponse(err);
  }
};

async function listAccounts(): Promise<Response> {
  return json(await listIndex());
}

async function createAccount(req: Request): Promise<Response> {
  const body = await readJson<{ companyName?: unknown; domain?: unknown }>(req);
  const companyName = requireString(body.companyName, 'companyName');
  const now = new Date().toISOString();

  const account: Account = {
    id: newId(),
    companyName,
    domain: typeof body.domain === 'string' ? body.domain.trim() || undefined : undefined,
    createdAt: now,
    updatedAt: now,
  };

  const aggregate = emptyAggregate(account);
  appendEvent(
    aggregate,
    newEvent('account_created', `Account created for ${companyName}.`, {
      entityRef: `account:${account.id}`,
    })
  );

  const saved = await createAggregate(aggregate);
  return jsonWithEtag(saved.aggregate, saved.etag, 201);
}

async function getAccount(id: string): Promise<Response> {
  const loaded = await readAggregate(id);
  if (!loaded) return error(404, 'Account not found.');
  return jsonWithEtag(loaded.aggregate, loaded.etag);
}

async function updateAccount(req: Request, id: string): Promise<Response> {
  const loaded = await readAggregate(id);
  if (!loaded) return error(404, 'Account not found.');

  const body = await readJson<{ companyName?: unknown; domain?: unknown }>(req);
  const aggregate = loaded.aggregate;
  const changes: string[] = [];

  if (body.companyName !== undefined) {
    const companyName = requireString(body.companyName, 'companyName');
    if (companyName !== aggregate.account.companyName) {
      changes.push(`name "${aggregate.account.companyName}" -> "${companyName}"`);
      aggregate.account.companyName = companyName;
    }
  }

  if (body.domain !== undefined) {
    const domain =
      typeof body.domain === 'string' && body.domain.trim() ? body.domain.trim() : undefined;
    if (domain !== aggregate.account.domain) {
      changes.push(`domain -> ${domain ?? 'none'}`);
      aggregate.account.domain = domain;
    }
  }

  if (changes.length > 0) {
    appendEvent(
      aggregate,
      newEvent('account_updated', `Account details changed: ${changes.join(', ')}.`, {
        entityRef: `account:${id}`,
      })
    );
  }

  const saved = await saveAggregate(aggregate, ifMatch(req) ?? loaded.etag);
  return jsonWithEtag(saved.aggregate, saved.etag);
}

async function removeAccount(id: string): Promise<Response> {
  const loaded = await readAggregate(id);
  if (!loaded) return error(404, 'Account not found.');
  await deleteAggregate(id);
  return json({ success: true });
}
