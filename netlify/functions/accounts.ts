import type { Config, Context } from '@netlify/functions';
import {
  aggregateResponse,
  errorResponse,
  expectedRevOf,
  handle,
  json,
  methodNotAllowed,
  optionalString,
  readJson,
  requireString,
} from '../lib/http';
import {
  createAggregate,
  deleteAggregate,
  appendEvent,
  mutateAggregate,
  newId,
  readAggregate,
  readIndex,
} from '../lib/store';
import { emptyAggregate, type Account } from '../../src/domain/types';

export default async (request: Request, context: Context): Promise<Response> =>
  handle(request, async () => {
    const id = context.params.id;

    if (!id) {
      if (request.method === 'GET') return json(await readIndex());
      if (request.method === 'POST') return createAccount(request);
      return methodNotAllowed(request.method);
    }

    switch (request.method) {
      case 'GET': {
        const loaded = await readAggregate(id);
        if (!loaded) return errorResponse('Account not found.', 404);
        return aggregateResponse(loaded.aggregate);
      }
      case 'PATCH': {
        const body = await readJson<{ companyName?: string; domain?: string }>(request);
        const updated = await mutateAggregate(id, expectedRevOf(request), (aggregate) => {
          if (body.companyName !== undefined) {
            aggregate.account.companyName = requireString(body.companyName, 'companyName');
          }
          if (body.domain !== undefined) {
            aggregate.account.domain = optionalString(body.domain, 'domain');
          }
          appendEvent(aggregate, 'account_updated', `Account details updated.`);
        });
        if (!updated) return errorResponse('Account not found.', 404);
        return aggregateResponse(updated);
      }
      case 'DELETE': {
        await deleteAggregate(id);
        return new Response(null, { status: 204 });
      }
      default:
        return methodNotAllowed(request.method);
    }
  });

async function createAccount(request: Request): Promise<Response> {
  const body = await readJson<{ companyName?: string; domain?: string }>(request);
  const now = new Date().toISOString();
  const account: Account = {
    id: newId(),
    companyName: requireString(body.companyName, 'companyName'),
    domain: optionalString(body.domain, 'domain'),
    createdAt: now,
    updatedAt: now,
  };

  const aggregate = emptyAggregate(account);
  appendEvent(aggregate, 'account_created', `${account.companyName} added to the portfolio.`);
  await createAggregate(aggregate);
  return aggregateResponse(aggregate, 201);
}

export const config: Config = {
  path: ['/api/accounts', '/api/accounts/:id'],
};
