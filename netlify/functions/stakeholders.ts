import type { Config, Context } from '@netlify/functions';
import {
  aggregateResponse,
  BadRequest,
  errorResponse,
  expectedRevOf,
  handle,
  json,
  methodNotAllowed,
  oneOf,
  optionalString,
  readJson,
  requireString,
  stringArray,
} from '../lib/http';
import { appendEvent, mutateAggregate, readAggregate } from '../lib/store';
import { newId } from '../lib/store';
import { championTier } from '../../src/domain/champion';
import {
  BUYER_ROLES,
  POSTURES,
  SOURCE_SYSTEMS,
  type BuyerRole,
  type Rating,
  type Stakeholder,
} from '../../src/domain/types';

export default async (request: Request, context: Context): Promise<Response> =>
  handle(async () => {
    const { id, sid } = context.params;

    if (request.method === 'GET') {
      const loaded = await readAggregate(id);
      if (!loaded) return errorResponse('Account not found.', 404);
      return json(loaded.aggregate.stakeholders);
    }

    if (request.method === 'POST') return addStakeholder(request, id);
    if (request.method === 'PATCH' && sid) return updateStakeholder(request, id, sid);
    if (request.method === 'DELETE' && sid) return removeStakeholder(request, id, sid);
    return methodNotAllowed(request.method);
  });

function rating(value: unknown, field: string, fallback: Rating): Rating {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 5) {
    throw new BadRequest(`"${field}" must be an integer between 1 and 5.`);
  }
  return n as Rating;
}

function buyerRoles(value: unknown): BuyerRole[] {
  return stringArray(value, 'mapRoles').map((role) =>
    oneOf(role, BUYER_ROLES, 'mapRoles')
  );
}

async function addStakeholder(request: Request, id: string): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(request);

  const stakeholder: Stakeholder = {
    id: newId(),
    name: requireString(body.name, 'name'),
    role: requireString(body.role, 'role'),
    businessUnit: optionalString(body.businessUnit, 'businessUnit'),
    emails: stringArray(body.emails, 'emails'),
    linkedinUrl: optionalString(body.linkedinUrl, 'linkedinUrl'),
    mapRoles: buyerRoles(body.mapRoles),
    priorities: stringArray(body.priorities, 'priorities'),
    relevance: optionalString(body.relevance, 'relevance'),
    influence: rating(body.influence, 'influence', 3),
    relationshipStrength: rating(body.relationshipStrength, 'relationshipStrength', 1),
    posture: oneOf(body.posture, POSTURES, 'posture', 'unknown'),
    accessPath: optionalString(body.accessPath, 'accessPath'),
    whatToLearn: stringArray(body.whatToLearn, 'whatToLearn'),
    lastContactAt: optionalString(body.lastContactAt, 'lastContactAt'),
    lastContactSource: body.lastContactSource
      ? oneOf(body.lastContactSource, SOURCE_SYSTEMS, 'lastContactSource')
      : undefined,
    introducedByStakeholderId: optionalString(
      body.introducedByStakeholderId,
      'introducedByStakeholderId'
    ),
    createdAt: new Date().toISOString(),
  };

  const updated = await mutateAggregate(id, expectedRevOf(request), (aggregate) => {
    aggregate.stakeholders.push(stakeholder);
    appendEvent(
      aggregate,
      'stakeholder_added',
      `${stakeholder.name} — ${stakeholder.role}`,
      { entityRef: `stakeholder:${stakeholder.id}` }
    );
  });

  if (!updated) return errorResponse('Account not found.', 404);
  return aggregateResponse(updated, 201);
}

async function updateStakeholder(request: Request, id: string, sid: string): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(request);

  let missing = false;
  const updated = await mutateAggregate(id, expectedRevOf(request), (aggregate) => {
    const person = aggregate.stakeholders.find((s) => s.id === sid);
    if (!person) {
      missing = true;
      return;
    }

    const previousPosture = person.posture;
    const previousTier = championTier(sid, aggregate.signals, aggregate.evidence);

    if (body.name !== undefined) person.name = requireString(body.name, 'name');
    if (body.role !== undefined) person.role = requireString(body.role, 'role');
    if (body.businessUnit !== undefined) {
      person.businessUnit = optionalString(body.businessUnit, 'businessUnit');
    }
    if (body.emails !== undefined) person.emails = stringArray(body.emails, 'emails');
    if (body.linkedinUrl !== undefined) {
      person.linkedinUrl = optionalString(body.linkedinUrl, 'linkedinUrl');
    }
    if (body.mapRoles !== undefined) person.mapRoles = buyerRoles(body.mapRoles);
    if (body.priorities !== undefined) {
      person.priorities = stringArray(body.priorities, 'priorities');
    }
    if (body.relevance !== undefined) person.relevance = optionalString(body.relevance, 'relevance');
    if (body.influence !== undefined) {
      person.influence = rating(body.influence, 'influence', person.influence);
    }
    if (body.relationshipStrength !== undefined) {
      person.relationshipStrength = rating(
        body.relationshipStrength,
        'relationshipStrength',
        person.relationshipStrength
      );
    }
    if (body.posture !== undefined) {
      person.posture = oneOf(body.posture, POSTURES, 'posture', person.posture);
    }
    if (body.accessPath !== undefined) {
      person.accessPath = optionalString(body.accessPath, 'accessPath');
    }
    if (body.whatToLearn !== undefined) {
      person.whatToLearn = stringArray(body.whatToLearn, 'whatToLearn');
    }
    if (body.lastContactAt !== undefined) {
      person.lastContactAt = optionalString(body.lastContactAt, 'lastContactAt');
    }

    if (previousPosture !== person.posture) {
      appendEvent(
        aggregate,
        'stakeholder_updated',
        `${person.name}: posture ${previousPosture} → ${person.posture}.`,
        { entityRef: `stakeholder:${person.id}` }
      );
    } else {
      appendEvent(aggregate, 'stakeholder_updated', `${person.name} updated.`, {
        entityRef: `stakeholder:${person.id}`,
      });
    }

    const nextTier = championTier(sid, aggregate.signals, aggregate.evidence);
    if (nextTier !== previousTier) {
      appendEvent(
        aggregate,
        'champion_tier_changed',
        `${person.name}: ${previousTier} → ${nextTier}.`,
        { entityRef: `stakeholder:${person.id}` }
      );
    }
  });

  if (!updated || missing) return errorResponse('Stakeholder not found.', 404);
  return aggregateResponse(updated);
}

async function removeStakeholder(request: Request, id: string, sid: string): Promise<Response> {
  let missing = false;
  const updated = await mutateAggregate(id, expectedRevOf(request), (aggregate) => {
    const person = aggregate.stakeholders.find((s) => s.id === sid);
    if (!person) {
      missing = true;
      return;
    }
    aggregate.stakeholders = aggregate.stakeholders.filter((s) => s.id !== sid);
    aggregate.signals = aggregate.signals.filter((s) => s.stakeholderId !== sid);
    appendEvent(aggregate, 'stakeholder_removed', `${person.name} removed.`, {
      entityRef: `stakeholder:${sid}`,
    });
  });

  if (!updated || missing) return errorResponse('Stakeholder not found.', 404);
  return aggregateResponse(updated);
}

export const config: Config = {
  path: ['/api/accounts/:id/stakeholders', '/api/accounts/:id/stakeholders/:sid'],
};
