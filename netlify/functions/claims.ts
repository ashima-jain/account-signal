import type { Config, Context } from '@netlify/functions';
import {
  aggregateResponse,
  errorResponse,
  expectedRevOf,
  handle,
  InvariantViolation,
  isoDate,
  json,
  methodNotAllowed,
  NotFound,
  oneOf,
  readJson,
  requireString,
  stringArray,
} from '../lib/http';
import { appendEvent, mutateAggregate, newId, readAggregate } from '../lib/store';
import { claimInvariantError } from '../../src/domain/claims';
import {
  CLAIM_CATEGORIES,
  CLAIM_STATUSES,
  type Claim,
} from '../../src/domain/types';

export default async (request: Request, context: Context): Promise<Response> =>
  handle(request, async () => {
    const { id, cid } = context.params;

    if (request.method === 'GET') {
      const loaded = await readAggregate(id);
      if (!loaded) return errorResponse('Account not found.', 404);
      return json(loaded.aggregate.claims);
    }

    if (request.method === 'POST') return addClaim(request, id);
    if (request.method === 'PATCH' && cid) return updateClaim(request, id, cid);
    if (request.method === 'DELETE' && cid) return removeClaim(request, id, cid);
    return methodNotAllowed(request.method);
  });

async function addClaim(request: Request, id: string): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(request);
  const now = new Date().toISOString();

  const claim: Claim = {
    id: newId(),
    text: requireString(body.text, 'text'),
    status: oneOf(body.status, CLAIM_STATUSES, 'status'),
    category: oneOf(body.category, CLAIM_CATEGORIES, 'category'),
    evidenceIds: stringArray(body.evidenceIds, 'evidenceIds'),
    supersedesClaimId:
      typeof body.supersedesClaimId === 'string' ? body.supersedesClaimId : undefined,
    asOf: isoDate(body.asOf, 'asOf', now),
    createdAt: now,
  };

  const updated = await mutateAggregate(id, expectedRevOf(request), (aggregate) => {
    const violation = claimInvariantError(claim, aggregate.evidence);
    if (violation) throw new InvariantViolation(violation);

    aggregate.claims.push(claim);
    appendEvent(aggregate, 'claim_added', `${claim.status}: ${claim.text}`, {
      entityRef: `claim:${claim.id}`,
    });

    if (claim.supersedesClaimId) {
      const previous = aggregate.claims.find((c) => c.id === claim.supersedesClaimId);
      if (previous) {
        appendEvent(aggregate, 'claim_updated', `Superseded "${previous.text}".`, {
          entityRef: `claim:${previous.id}`,
        });
      }
    }
  });

  if (!updated) return errorResponse('Account not found.', 404);
  return aggregateResponse(updated, 201);
}

async function updateClaim(request: Request, id: string, cid: string): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(request);

  const updated = await mutateAggregate(id, expectedRevOf(request), (aggregate) => {
    const claim = aggregate.claims.find((c) => c.id === cid);
    if (!claim) throw new NotFound('Claim not found.');

    const proposed: Claim = {
      ...claim,
      text: body.text !== undefined ? requireString(body.text, 'text') : claim.text,
      status:
        body.status !== undefined
          ? oneOf(body.status, CLAIM_STATUSES, 'status')
          : claim.status,
      category:
        body.category !== undefined
          ? oneOf(body.category, CLAIM_CATEGORIES, 'category')
          : claim.category,
      evidenceIds:
        body.evidenceIds !== undefined
          ? stringArray(body.evidenceIds, 'evidenceIds')
          : claim.evidenceIds,
      // Revalidating is the whole point of the staleness warning, so it is an
      // explicit flag rather than a side effect of any edit.
      reviewedAt:
        body.revalidate === true ? new Date().toISOString() : claim.reviewedAt,
    };

    const violation = claimInvariantError(proposed, aggregate.evidence);
    if (violation) throw new InvariantViolation(violation);

    const statusChanged = proposed.status !== claim.status;
    Object.assign(claim, proposed);

    appendEvent(
      aggregate,
      'claim_updated',
      statusChanged
        ? `"${claim.text}" is now ${claim.status}.`
        : `"${claim.text}" updated.`,
      { entityRef: `claim:${claim.id}` }
    );
  });

  if (!updated) return errorResponse('Account not found.', 404);
  return aggregateResponse(updated);
}

async function removeClaim(request: Request, id: string, cid: string): Promise<Response> {
  const updated = await mutateAggregate(id, expectedRevOf(request), (aggregate) => {
    const claim = aggregate.claims.find((c) => c.id === cid);
    if (!claim) throw new NotFound('Claim not found.');
    aggregate.claims = aggregate.claims.filter((c) => c.id !== cid);
    appendEvent(aggregate, 'claim_removed', `Removed "${claim.text}".`, {
      entityRef: `claim:${cid}`,
    });
  });

  if (!updated) return errorResponse('Account not found.', 404);
  return aggregateResponse(updated);
}

export const config: Config = {
  path: ['/api/accounts/:id/claims', '/api/accounts/:id/claims/:cid'],
};
