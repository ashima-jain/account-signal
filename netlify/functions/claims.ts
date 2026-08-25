/**
 * Claims: the account thesis, one assertion at a time.
 *
 * The FACT invariant is checked here on every write. Nothing reaches storage
 * labelled FACT without a citation that resolves, whether it was typed by the
 * seller or produced by the generator.
 */

import type { Config, Context } from '@netlify/functions';
import { appendEvent, mutateAggregate, newEvent, newId, readAggregate } from '../lib/store';
import {
  BadRequestError,
  error,
  expectedRev,
  jsonWithRev,
  mutationResult,
  readJson,
  requireString,
  toResponse,
} from '../lib/http';
import {
  CLAIM_CATEGORIES,
  type Claim,
  type ClaimCategory,
  type ClaimStatus,
  type ID,
} from '../../src/domain/types';
import { claimInvariantError } from '../../src/domain/claims';

export const config: Config = {
  path: ['/api/accounts/:accountId/claims', '/api/accounts/:accountId/claims/:claimId'],
};

const CLAIM_STATUSES: ClaimStatus[] = ['FACT', 'HYPOTHESIS', 'UNKNOWN'];

export default async (req: Request, context: Context): Promise<Response> => {
  const accountId = context.params.accountId;
  const claimId = context.params.claimId;

  try {
    if (!accountId) return error(400, 'Missing account id.');

    if (!claimId) {
      if (req.method === 'GET') return await listClaims(accountId);
      if (req.method === 'POST') return await addClaim(req, accountId);
      return error(405, `${req.method} is not supported on this route.`);
    }

    if (req.method === 'PATCH' || req.method === 'PUT') {
      return await updateClaim(req, accountId, claimId);
    }
    if (req.method === 'DELETE') return await removeClaim(req, accountId, claimId);
    return error(405, `${req.method} is not supported on this route.`);
  } catch (err) {
    return toResponse(err);
  }
};

function parseStatus(value: unknown): ClaimStatus {
  if (typeof value !== 'string' || !CLAIM_STATUSES.includes(value as ClaimStatus)) {
    throw new BadRequestError(`"status" must be one of: ${CLAIM_STATUSES.join(', ')}.`);
  }
  return value as ClaimStatus;
}

function parseCategory(value: unknown): ClaimCategory {
  if (typeof value !== 'string' || !CLAIM_CATEGORIES.includes(value as ClaimCategory)) {
    throw new BadRequestError(`"category" must be one of: ${CLAIM_CATEGORIES.join(', ')}.`);
  }
  return value as ClaimCategory;
}

function parseEvidenceIds(value: unknown): ID[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new BadRequestError('"evidenceIds" must be an array of strings.');
  }
  return value as ID[];
}

async function listClaims(accountId: string): Promise<Response> {
  const loaded = await readAggregate(accountId);
  if (!loaded) return error(404, 'Account not found.');
  return jsonWithRev(loaded.aggregate.claims, loaded.aggregate.rev);
}

async function addClaim(req: Request, accountId: string): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(req);
  const now = new Date().toISOString();

  const claim: Claim = {
    id: newId(),
    text: requireString(body.text, 'text'),
    status: parseStatus(body.status),
    category: parseCategory(body.category),
    evidenceIds: parseEvidenceIds(body.evidenceIds),
    supersedesClaimId:
      typeof body.supersedesClaimId === 'string' ? body.supersedesClaimId : undefined,
    asOf: now,
    createdAt: now,
  };

  const outcome = await mutateAggregate(accountId, expectedRev(req), (aggregate) => {
    const invalid = claimInvariantError(claim, aggregate.evidence);
    if (invalid) throw new BadRequestError(invalid);

    if (claim.supersedesClaimId) {
      const previous = aggregate.claims.find((c) => c.id === claim.supersedesClaimId);
      if (!previous) throw new BadRequestError('supersedesClaimId does not exist.');
      appendEvent(
        aggregate,
        newEvent('claim_superseded', `"${previous.text}" was replaced by "${claim.text}".`, {
          entityRef: `claim:${previous.id}`,
          reason: typeof body.reason === 'string' ? body.reason : undefined,
        })
      );
    }

    aggregate.claims.push(claim);
    appendEvent(
      aggregate,
      newEvent('claim_added', `${claim.status} added: "${claim.text}".`, {
        entityRef: `claim:${claim.id}`,
      })
    );
    return claim;
  });

  if (!outcome) return error(404, 'Account not found.');
  return mutationResult(outcome.aggregate, outcome.result.id, 201);
}

async function updateClaim(
  req: Request,
  accountId: string,
  claimId: string
): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(req);

  const outcome = await mutateAggregate(accountId, expectedRev(req), (aggregate) => {
    const claim = aggregate.claims.find((c) => c.id === claimId);
    if (!claim) return null;

    const previousStatus = claim.status;

    if (body.text !== undefined) claim.text = requireString(body.text, 'text');
    if (body.category !== undefined) claim.category = parseCategory(body.category);
    if (body.evidenceIds !== undefined) claim.evidenceIds = parseEvidenceIds(body.evidenceIds);
    if (body.status !== undefined) claim.status = parseStatus(body.status);
    // Confirming a claim is still true resets its staleness clock without
    // changing what it says.
    if (body.revalidate === true) claim.reviewedAt = new Date().toISOString();

    const invalid = claimInvariantError(claim, aggregate.evidence);
    if (invalid) throw new BadRequestError(invalid);

    if (claim.status !== previousStatus) {
      appendEvent(
        aggregate,
        newEvent(
          'claim_status_changed',
          `"${claim.text}" moved from ${previousStatus} to ${claim.status}.`,
          {
            entityRef: `claim:${claim.id}`,
            reason: typeof body.reason === 'string' ? body.reason : undefined,
          }
        )
      );
    }

    return claim;
  });

  if (!outcome) return error(404, 'Account not found.');
  if (!outcome.result) return error(404, 'Claim not found.');
  return mutationResult(outcome.aggregate, outcome.result.id);
}

async function removeClaim(
  req: Request,
  accountId: string,
  claimId: string
): Promise<Response> {
  const outcome = await mutateAggregate(accountId, expectedRev(req), (aggregate) => {
    const claim = aggregate.claims.find((c) => c.id === claimId);
    if (!claim) return null;

    aggregate.claims = aggregate.claims.filter((c) => c.id !== claimId);
    // Actions justify themselves by the unknowns they resolve; drop stale refs.
    for (const action of aggregate.actions) {
      action.resolvesClaimIds = action.resolvesClaimIds.filter((id) => id !== claimId);
    }

    appendEvent(
      aggregate,
      newEvent('claim_status_changed', `Claim removed: "${claim.text}".`, {
        entityRef: `claim:${claimId}`,
        reason: 'Deleted by user.',
      })
    );
    return claim;
  });

  if (!outcome) return error(404, 'Account not found.');
  if (!outcome.result) return error(404, 'Claim not found.');
  return mutationResult(outcome.aggregate, claimId);
}
