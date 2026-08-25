/**
 * Stakeholder CRUD.
 *
 * A stakeholder is a person at the account. Their champion tier is computed
 * from their signals and evidence, never stored, so the UI and the server
 * always agree.
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
  BUYER_ROLES,
  POSTURES,
  type BuyerRole,
  type Posture,
  type Rating,
  type Stakeholder,
} from '../../src/domain/types';

export const config: Config = {
  path: [
    '/api/accounts/:accountId/stakeholders',
    '/api/accounts/:accountId/stakeholders/:stakeholderId',
  ],
};

export default async (req: Request, context: Context): Promise<Response> => {
  const accountId = context.params.accountId;
  const stakeholderId = context.params.stakeholderId;

  try {
    if (!accountId) return error(400, 'Missing account id.');

    if (!stakeholderId) {
      if (req.method === 'GET') return await listStakeholders(accountId);
      if (req.method === 'POST') return await addStakeholder(req, accountId);
      return error(405, `${req.method} is not supported on this route.`);
    }

    if (req.method === 'PATCH' || req.method === 'PUT') {
      return await updateStakeholder(req, accountId, stakeholderId);
    }
    if (req.method === 'DELETE') return await removeStakeholder(req, accountId, stakeholderId);
    return error(405, `${req.method} is not supported on this route.`);
  } catch (err) {
    return toResponse(err);
  }
};

function parseMapRoles(value: unknown): BuyerRole[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new BadRequestError('"mapRoles" must be an array of strings.');
  }
  return value.filter((v) => BUYER_ROLES.includes(v as BuyerRole)) as BuyerRole[];
}

function parsePosture(value: unknown): Posture {
  if (value === undefined) return 'unknown';
  if (typeof value !== 'string' || !POSTURES.includes(value as Posture)) {
    throw new BadRequestError(`"posture" must be one of: ${POSTURES.join(', ')}.`);
  }
  return value as Posture;
}

function parseRating(value: unknown, field: string): Rating {
  if (value === undefined) return 3;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 5) {
    throw new BadRequestError(`"${field}" must be an integer 1-5.`);
  }
  return n as Rating;
}

function parseStringArray(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new BadRequestError(`"${field}" must be an array of strings.`);
  }
  return value as string[];
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new BadRequestError(`"${field}" must be a string.`);
  return value.trim() || undefined;
}

async function listStakeholders(accountId: string): Promise<Response> {
  const loaded = await readAggregate(accountId);
  if (!loaded) return error(404, 'Account not found.');
  return jsonWithRev(loaded.aggregate.stakeholders, loaded.aggregate.rev);
}

async function addStakeholder(req: Request, accountId: string): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(req);
  const now = new Date().toISOString();

  const stakeholder: Stakeholder = {
    id: newId(),
    name: requireString(body.name, 'name'),
    role: requireString(body.role, 'role'),
    businessUnit: optionalString(body.businessUnit, 'businessUnit'),
    emails: parseStringArray(body.emails, 'emails'),
    linkedinUrl: optionalString(body.linkedinUrl, 'linkedinUrl'),
    mapRoles: parseMapRoles(body.mapRoles),
    priorities: parseStringArray(body.priorities, 'priorities'),
    relevance: optionalString(body.relevance, 'relevance'),
    influence: parseRating(body.influence, 'influence'),
    relationshipStrength: parseRating(body.relationshipStrength, 'relationshipStrength'),
    posture: parsePosture(body.posture),
    accessPath: optionalString(body.accessPath, 'accessPath'),
    whatToLearn: parseStringArray(body.whatToLearn, 'whatToLearn'),
    introducedByStakeholderId: optionalString(body.introducedByStakeholderId, 'introducedByStakeholderId'),
    createdAt: now,
  };

  const outcome = await mutateAggregate(accountId, expectedRev(req), (aggregate) => {
    if (stakeholder.introducedByStakeholderId) {
      const exists = aggregate.stakeholders.some(
        (s) => s.id === stakeholder.introducedByStakeholderId
      );
      if (!exists) {
        throw new BadRequestError('introducedByStakeholderId does not exist on this account.');
      }
    }

    aggregate.stakeholders.push(stakeholder);
    appendEvent(
      aggregate,
      newEvent('stakeholder_added', `Stakeholder added: ${stakeholder.name} (${stakeholder.role}).`, {
        entityRef: `stakeholder:${stakeholder.id}`,
      })
    );
    return stakeholder;
  });

  if (!outcome) return error(404, 'Account not found.');
  return mutationResult(outcome.aggregate, outcome.result.id, 201);
}

async function updateStakeholder(
  req: Request,
  accountId: string,
  stakeholderId: string
): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(req);

  const outcome = await mutateAggregate(accountId, expectedRev(req), (aggregate) => {
    const s = aggregate.stakeholders.find((st) => st.id === stakeholderId);
    if (!s) return null;

    const previousPosture = s.posture;

    if (body.name !== undefined) s.name = requireString(body.name, 'name');
    if (body.role !== undefined) s.role = requireString(body.role, 'role');
    if (body.businessUnit !== undefined) s.businessUnit = optionalString(body.businessUnit, 'businessUnit');
    if (body.emails !== undefined) s.emails = parseStringArray(body.emails, 'emails');
    if (body.linkedinUrl !== undefined) s.linkedinUrl = optionalString(body.linkedinUrl, 'linkedinUrl');
    if (body.mapRoles !== undefined) s.mapRoles = parseMapRoles(body.mapRoles);
    if (body.priorities !== undefined) s.priorities = parseStringArray(body.priorities, 'priorities');
    if (body.relevance !== undefined) s.relevance = optionalString(body.relevance, 'relevance');
    if (body.influence !== undefined) s.influence = parseRating(body.influence, 'influence');
    if (body.relationshipStrength !== undefined) {
      s.relationshipStrength = parseRating(body.relationshipStrength, 'relationshipStrength');
    }
    if (body.posture !== undefined) s.posture = parsePosture(body.posture);
    if (body.accessPath !== undefined) s.accessPath = optionalString(body.accessPath, 'accessPath');
    if (body.whatToLearn !== undefined) s.whatToLearn = parseStringArray(body.whatToLearn, 'whatToLearn');
    if (body.lastContactAt !== undefined) {
      s.lastContactAt = optionalString(body.lastContactAt, 'lastContactAt');
    }

    if (s.posture !== previousPosture) {
      appendEvent(
        aggregate,
        newEvent(
          'posture_changed',
          `${s.name}: posture ${previousPosture} -> ${s.posture}.`,
          { entityRef: `stakeholder:${s.id}` }
        )
      );
    }

    appendEvent(
      aggregate,
      newEvent('stakeholder_updated', `Stakeholder updated: ${s.name}.`, {
        entityRef: `stakeholder:${s.id}`,
      })
    );

    return s;
  });

  if (!outcome) return error(404, 'Account not found.');
  if (!outcome.result) return error(404, 'Stakeholder not found.');
  return mutationResult(outcome.aggregate, outcome.result.id);
}

async function removeStakeholder(
  req: Request,
  accountId: string,
  stakeholderId: string
): Promise<Response> {
  const outcome = await mutateAggregate(accountId, expectedRev(req), (aggregate) => {
    const s = aggregate.stakeholders.find((st) => st.id === stakeholderId);
    if (!s) return null;

    aggregate.stakeholders = aggregate.stakeholders.filter((st) => st.id !== stakeholderId);
    // Remove signals for this stakeholder and clear references from others.
    aggregate.signals = aggregate.signals.filter((sig) => sig.stakeholderId !== stakeholderId);
    for (const other of aggregate.stakeholders) {
      if (other.introducedByStakeholderId === stakeholderId) {
        other.introducedByStakeholderId = undefined;
      }
    }
    // Clear evidence stakeholderId references.
    for (const ev of aggregate.evidence) {
      if (ev.stakeholderId === stakeholderId) ev.stakeholderId = undefined;
    }

    appendEvent(
      aggregate,
      newEvent('stakeholder_updated', `Stakeholder removed: ${s.name}.`, {
        entityRef: `stakeholder:${stakeholderId}`,
        reason: 'Deleted by user.',
      })
    );
    return s;
  });

  if (!outcome) return error(404, 'Account not found.');
  if (!outcome.result) return error(404, 'Stakeholder not found.');
  return mutationResult(outcome.aggregate, stakeholderId);
}
