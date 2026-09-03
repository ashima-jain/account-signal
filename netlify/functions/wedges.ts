import type { Config, Context } from '@netlify/functions';
import {
  aggregateResponse,
  errorResponse,
  expectedRevOf,
  handle,
  InvariantViolation,
  json,
  methodNotAllowed,
  NotFound,
  oneOf,
  optionalString,
  readJson,
  requireString,
  stringArray,
} from '../lib/http';
import { appendEvent, mutateAggregate, newId, readAggregate } from '../lib/store';
import {
  DEVIN_USE_CASES,
  WEDGE_STATUSES,
  type Wedge,
} from '../../src/domain/types';

export default async (request: Request, context: Context): Promise<Response> =>
  handle(request, async () => {
    const { id, wid } = context.params;

    if (request.method === 'GET') {
      const loaded = await readAggregate(id);
      if (!loaded) return errorResponse('Account not found.', 404);
      return json(loaded.aggregate.wedges);
    }

    if (request.method === 'POST') return addWedge(request, id);
    if (request.method === 'PATCH' && wid) return updateWedge(request, id, wid);
    if (request.method === 'DELETE' && wid) return removeWedge(request, id, wid);
    return methodNotAllowed(request.method);
  });

async function addWedge(request: Request, id: string): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(request);

  const wedge: Wedge = {
    id: newId(),
    useCase: requireString(body.useCase, 'useCase'),
    devinUseCase: oneOf(body.devinUseCase, DEVIN_USE_CASES, 'devinUseCase', 'other'),
    businessProblem: optionalString(body.businessProblem, 'businessProblem') ?? '',
    technicalProblem: optionalString(body.technicalProblem, 'technicalProblem') ?? '',
    whyDevin: optionalString(body.whyDevin, 'whyDevin') ?? '',
    likelyOwnerRole: optionalString(body.likelyOwnerRole, 'likelyOwnerRole') ?? '',
    sponsorRole: optionalString(body.sponsorRole, 'sponsorRole') ?? '',
    evidenceIds: stringArray(body.evidenceIds, 'evidenceIds'),
    discoveryQuestion: optionalString(body.discoveryQuestion, 'discoveryQuestion') ?? '',
    disqualifiers: stringArray(body.disqualifiers, 'disqualifiers'),
    proofPoints: [],
    status: oneOf(body.status, WEDGE_STATUSES, 'status', 'candidate'),
    createdAt: new Date().toISOString(),
  };

  const updated = await mutateAggregate(id, expectedRevOf(request), (aggregate) => {
    const unknown = wedge.evidenceIds.filter(
      (eid) => !aggregate.evidence.some((e) => e.id === eid)
    );
    if (unknown.length > 0) {
      throw new InvariantViolation(`Cited evidence does not exist: ${unknown.join(', ')}.`);
    }
    aggregate.wedges.push(wedge);
    appendEvent(aggregate, 'wedge_added', wedge.useCase, { entityRef: `wedge:${wedge.id}` });
  });

  if (!updated) return errorResponse('Account not found.', 404);
  return aggregateResponse(updated, 201);
}

async function updateWedge(request: Request, id: string, wid: string): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(request);

  const updated = await mutateAggregate(id, expectedRevOf(request), (aggregate) => {
    const wedge = aggregate.wedges.find((w) => w.id === wid);
    if (!wedge) throw new NotFound('Wedge not found.');

    const nextStatus =
      body.status !== undefined
        ? oneOf(body.status, WEDGE_STATUSES, 'status', wedge.status)
        : wedge.status;

    // Disqualification is terminal. Reviving a killed use case is how a deal
    // ends up re-litigating a question the customer already answered.
    if (wedge.status === 'disqualified' && nextStatus !== 'disqualified') {
      throw new InvariantViolation(
        'A disqualified wedge cannot be revived. Create a new one if the situation changed.'
      );
    }

    if (nextStatus === 'disqualified' && wedge.status !== 'disqualified') {
      const reason = requireString(body.disqualifiedReason, 'disqualifiedReason');
      const evidenceId = optionalString(body.disqualifyingEvidenceId, 'disqualifyingEvidenceId');
      if (evidenceId && !aggregate.evidence.some((e) => e.id === evidenceId)) {
        throw new InvariantViolation('The disqualifying evidence does not exist on this account.');
      }
      wedge.disqualifiedReason = reason;
      wedge.disqualifyingEvidenceId = evidenceId;
      wedge.status = 'disqualified';
      appendEvent(aggregate, 'wedge_disqualified', wedge.useCase, {
        entityRef: `wedge:${wedge.id}`,
        reason,
      });
      return;
    }

    if (body.useCase !== undefined) wedge.useCase = requireString(body.useCase, 'useCase');
    if (body.devinUseCase !== undefined) {
      wedge.devinUseCase = oneOf(body.devinUseCase, DEVIN_USE_CASES, 'devinUseCase', wedge.devinUseCase);
    }
    if (body.businessProblem !== undefined) {
      wedge.businessProblem = optionalString(body.businessProblem, 'businessProblem') ?? '';
    }
    if (body.technicalProblem !== undefined) {
      wedge.technicalProblem = optionalString(body.technicalProblem, 'technicalProblem') ?? '';
    }
    if (body.whyDevin !== undefined) {
      wedge.whyDevin = optionalString(body.whyDevin, 'whyDevin') ?? '';
    }
    if (body.likelyOwnerRole !== undefined) {
      wedge.likelyOwnerRole = optionalString(body.likelyOwnerRole, 'likelyOwnerRole') ?? '';
    }
    if (body.sponsorRole !== undefined) {
      wedge.sponsorRole = optionalString(body.sponsorRole, 'sponsorRole') ?? '';
    }
    if (body.discoveryQuestion !== undefined) {
      wedge.discoveryQuestion = optionalString(body.discoveryQuestion, 'discoveryQuestion') ?? '';
    }
    if (body.disqualifiers !== undefined) {
      wedge.disqualifiers = stringArray(body.disqualifiers, 'disqualifiers');
    }
    if (body.evidenceIds !== undefined) {
      const ids = stringArray(body.evidenceIds, 'evidenceIds');
      const unknown = ids.filter((eid) => !aggregate.evidence.some((e) => e.id === eid));
      if (unknown.length > 0) {
        throw new InvariantViolation(`Cited evidence does not exist: ${unknown.join(', ')}.`);
      }
      wedge.evidenceIds = ids;
    }

    // Calling a wedge validated on our own say-so is wishful thinking.
    if (nextStatus === 'validated' && wedge.evidenceIds.length === 0) {
      throw new InvariantViolation(
        'A validated wedge must cite the evidence that validated it.'
      );
    }
    wedge.status = nextStatus;

    appendEvent(aggregate, 'wedge_updated', `${wedge.useCase} — ${wedge.status}.`, {
      entityRef: `wedge:${wedge.id}`,
    });
  });

  if (!updated) return errorResponse('Account not found.', 404);
  return aggregateResponse(updated);
}

async function removeWedge(request: Request, id: string, wid: string): Promise<Response> {
  const updated = await mutateAggregate(id, expectedRevOf(request), (aggregate) => {
    const wedge = aggregate.wedges.find((w) => w.id === wid);
    if (!wedge) throw new NotFound('Wedge not found.');
    aggregate.wedges = aggregate.wedges.filter((w) => w.id !== wid);
    for (const action of aggregate.actions) {
      if (action.wedgeId === wid) action.wedgeId = undefined;
    }
    appendEvent(aggregate, 'wedge_updated', `${wedge.useCase} removed.`, {
      entityRef: `wedge:${wid}`,
    });
  });

  if (!updated) return errorResponse('Account not found.', 404);
  return aggregateResponse(updated);
}

export const config: Config = {
  path: ['/api/accounts/:id/wedges', '/api/accounts/:id/wedges/:wid'],
};
