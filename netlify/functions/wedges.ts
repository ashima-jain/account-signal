/**
 * Wedge CRUD.
 *
 * A wedge is a specific use case where Factory's capabilities solve a
 * business + technical problem at the account. Wedges move through a
 * lifecycle: candidate → testing → validated (or disqualified).
 *
 * Disqualification requires a reason and optionally cites evidence. Once
 * disqualified, a wedge stays disqualified — it is not deleted, so the
 * record of why we walked away is preserved.
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
  WEDGE_STATUSES,
  type ID,
  type Wedge,
  type WedgeStatus,
} from '../../src/domain/types';

export const config: Config = {
  path: [
    '/api/accounts/:accountId/wedges',
    '/api/accounts/:accountId/wedges/:wedgeId',
  ],
};

export default async (req: Request, context: Context): Promise<Response> => {
  const accountId = context.params.accountId;
  const wedgeId = context.params.wedgeId;

  try {
    if (!accountId) return error(400, 'Missing account id.');

    if (!wedgeId) {
      if (req.method === 'GET') return await listWedges(accountId);
      if (req.method === 'POST') return await addWedge(req, accountId);
      return error(405, `${req.method} is not supported on this route.`);
    }

    if (req.method === 'PATCH' || req.method === 'PUT') {
      return await updateWedge(req, accountId, wedgeId);
    }
    if (req.method === 'DELETE') return await removeWedge(req, accountId, wedgeId);
    return error(405, `${req.method} is not supported on this route.`);
  } catch (err) {
    return toResponse(err);
  }
};

function parseStatus(value: unknown): WedgeStatus {
  if (value === undefined) return 'candidate';
  if (typeof value !== 'string' || !WEDGE_STATUSES.includes(value as WedgeStatus)) {
    throw new BadRequestError(`"status" must be one of: ${WEDGE_STATUSES.join(', ')}.`);
  }
  return value as WedgeStatus;
}

function parseStringArray(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new BadRequestError(`"${field}" must be an array of strings.`);
  }
  return value as string[];
}

function parseIdArray(value: unknown, field: string): ID[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new BadRequestError(`"${field}" must be an array of IDs.`);
  }
  return value as ID[];
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new BadRequestError(`"${field}" must be a string.`);
  return value.trim() || undefined;
}

async function listWedges(accountId: string): Promise<Response> {
  const loaded = await readAggregate(accountId);
  if (!loaded) return error(404, 'Account not found.');
  return jsonWithRev(loaded.aggregate.wedges, loaded.aggregate.rev);
}

async function addWedge(req: Request, accountId: string): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(req);
  const now = new Date().toISOString();

  const wedge: Wedge = {
    id: newId(),
    useCase: requireString(body.useCase, 'useCase'),
    businessProblem: requireString(body.businessProblem, 'businessProblem'),
    technicalProblem: requireString(body.technicalProblem, 'technicalProblem'),
    whyFactory: requireString(body.whyFactory, 'whyFactory'),
    likelyOwnerRole: optionalString(body.likelyOwnerRole, 'likelyOwnerRole') ?? '',
    sponsorRole: optionalString(body.sponsorRole, 'sponsorRole') ?? '',
    evidenceIds: parseIdArray(body.evidenceIds, 'evidenceIds'),
    discoveryQuestion: optionalString(body.discoveryQuestion, 'discoveryQuestion') ?? '',
    disqualifiers: parseStringArray(body.disqualifiers, 'disqualifiers'),
    proofPoints: [],
    status: 'candidate',
    createdAt: now,
  };

  const outcome = await mutateAggregate(accountId, expectedRev(req), (aggregate) => {
    // Validate evidence IDs exist.
    const evidenceIds = new Set(aggregate.evidence.map((e) => e.id));
    for (const eid of wedge.evidenceIds) {
      if (!evidenceIds.has(eid)) {
        throw new BadRequestError(`Evidence ${eid} does not exist on this account.`);
      }
    }

    aggregate.wedges.push(wedge);
    appendEvent(
      aggregate,
      newEvent('wedge_added', `Wedge added: ${wedge.useCase}.`, {
        entityRef: `wedge:${wedge.id}`,
      })
    );
    return wedge;
  });

  if (!outcome) return error(404, 'Account not found.');
  return mutationResult(outcome.aggregate, outcome.result.id, 201);
}

async function updateWedge(req: Request, accountId: string, wedgeId: string): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(req);

  const outcome = await mutateAggregate(accountId, expectedRev(req), (aggregate) => {
    const w = aggregate.wedges.find((wg) => wg.id === wedgeId);
    if (!w) return null;

    const previousStatus = w.status;

    if (body.useCase !== undefined) w.useCase = requireString(body.useCase, 'useCase');
    if (body.businessProblem !== undefined) w.businessProblem = requireString(body.businessProblem, 'businessProblem');
    if (body.technicalProblem !== undefined) w.technicalProblem = requireString(body.technicalProblem, 'technicalProblem');
    if (body.whyFactory !== undefined) w.whyFactory = requireString(body.whyFactory, 'whyFactory');
    if (body.likelyOwnerRole !== undefined) w.likelyOwnerRole = optionalString(body.likelyOwnerRole, 'likelyOwnerRole') ?? '';
    if (body.sponsorRole !== undefined) w.sponsorRole = optionalString(body.sponsorRole, 'sponsorRole') ?? '';
    if (body.evidenceIds !== undefined) {
      const evidenceIds = new Set(aggregate.evidence.map((e) => e.id));
      for (const eid of parseIdArray(body.evidenceIds, 'evidenceIds')) {
        if (!evidenceIds.has(eid)) {
          throw new BadRequestError(`Evidence ${eid} does not exist on this account.`);
        }
      }
      w.evidenceIds = parseIdArray(body.evidenceIds, 'evidenceIds');
    }
    if (body.discoveryQuestion !== undefined) {
      w.discoveryQuestion = optionalString(body.discoveryQuestion, 'discoveryQuestion') ?? '';
    }
    if (body.disqualifiers !== undefined) w.disqualifiers = parseStringArray(body.disqualifiers, 'disqualifiers');

    // Status transitions.
    if (body.status !== undefined) {
      const newStatus = parseStatus(body.status);

      // Disqualification requires a reason.
      if (newStatus === 'disqualified' && previousStatus !== 'disqualified') {
        const reason = optionalString(body.disqualifiedReason, 'disqualifiedReason');
        if (!reason) {
          throw new BadRequestError('Disqualifying a wedge requires a "disqualifiedReason".');
        }
        w.disqualifiedReason = reason;
        w.disqualifyingEvidenceId = optionalString(body.disqualifyingEvidenceId, 'disqualifyingEvidenceId');
      }

      // Cannot re-qualify a disqualified wedge.
      if (previousStatus === 'disqualified' && newStatus !== 'disqualified') {
        throw new BadRequestError('A disqualified wedge cannot be re-qualified. Create a new wedge instead.');
      }

      w.status = newStatus;

      if (newStatus === 'disqualified' && previousStatus !== 'disqualified') {
        appendEvent(
          aggregate,
          newEvent(
            'wedge_disqualified',
            `Wedge disqualified: ${w.useCase} — ${w.disqualifiedReason}.`,
            { entityRef: `wedge:${w.id}` }
          )
        );
      }
    }

    // Update disqualifiedReason independently.
    if (body.disqualifiedReason !== undefined && w.status === 'disqualified') {
      w.disqualifiedReason = optionalString(body.disqualifiedReason, 'disqualifiedReason');
    }

    appendEvent(
      aggregate,
      newEvent('wedge_added', `Wedge updated: ${w.useCase}.`, {
        entityRef: `wedge:${w.id}`,
      })
    );

    return w;
  });

  if (!outcome) return error(404, 'Account not found.');
  if (!outcome.result) return error(404, 'Wedge not found.');
  return mutationResult(outcome.aggregate, outcome.result.id);
}

async function removeWedge(req: Request, accountId: string, wedgeId: string): Promise<Response> {
  const outcome = await mutateAggregate(accountId, expectedRev(req), (aggregate) => {
    const w = aggregate.wedges.find((wg) => wg.id === wedgeId);
    if (!w) return null;

    aggregate.wedges = aggregate.wedges.filter((wg) => wg.id !== wedgeId);

    // Clear wedge references from actions.
    for (const action of aggregate.actions) {
      if (action.wedgeId === wedgeId) {
        action.wedgeId = undefined;
      }
    }

    appendEvent(
      aggregate,
      newEvent('wedge_added', `Wedge removed: ${w.useCase}.`, {
        entityRef: `wedge:${wedgeId}`,
        reason: 'Deleted by user.',
      })
    );
    return w;
  });

  if (!outcome) return error(404, 'Account not found.');
  if (!outcome.result) return error(404, 'Wedge not found.');
  return mutationResult(outcome.aggregate, wedgeId);
}
