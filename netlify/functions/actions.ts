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
  optionalString,
  readJson,
  requireString,
  stringArray,
} from '../lib/http';
import { appendEvent, mutateAggregate, newId, readAggregate } from '../lib/store';
import { nextBestActions } from '../../src/domain/nba';
import {
  CHANNELS,
  HORIZONS,
  type Action,
  type ActionStatus,
} from '../../src/domain/types';

const ACTION_STATUSES: ActionStatus[] = ['open', 'done', 'dropped'];

export default async (request: Request, context: Context): Promise<Response> =>
  handle(request, async () => {
    const { id, aid } = context.params;

    if (request.method === 'GET') {
      const loaded = await readAggregate(id);
      if (!loaded) return errorResponse('Account not found.', 404);
      // The ranked gaps ride along so the client never recomputes them from a
      // partial view of the account.
      return json({
        actions: loaded.aggregate.actions,
        nba: nextBestActions(loaded.aggregate),
      });
    }

    if (request.method === 'POST') return addAction(request, id);
    if (request.method === 'PATCH' && aid) return updateAction(request, id, aid);
    if (request.method === 'DELETE' && aid) return removeAction(request, id, aid);
    return methodNotAllowed(request.method);
  });

async function addAction(request: Request, id: string): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(request);

  const action: Action = {
    id: newId(),
    stakeholderId: optionalString(body.stakeholderId, 'stakeholderId'),
    wedgeId: optionalString(body.wedgeId, 'wedgeId'),
    objective: requireString(body.objective, 'objective'),
    channel: oneOf(body.channel, CHANNELS, 'channel', 'email'),
    messageOrAction: optionalString(body.messageOrAction, 'messageOrAction') ?? '',
    whyThisPersonNow: optionalString(body.whyThisPersonNow, 'whyThisPersonNow') ?? '',
    desiredOutcome: optionalString(body.desiredOutcome, 'desiredOutcome') ?? '',
    horizon: oneOf(body.horizon, HORIZONS, 'horizon', 'this_week'),
    status: 'open',
    dueAt: body.dueAt ? isoDate(body.dueAt, 'dueAt') : undefined,
    resolvesClaimIds: stringArray(body.resolvesClaimIds, 'resolvesClaimIds'),
    createdAt: new Date().toISOString(),
  };

  const updated = await mutateAggregate(id, expectedRevOf(request), (aggregate) => {
    const unknown = action.resolvesClaimIds.filter(
      (cid) => !aggregate.claims.some((c) => c.id === cid)
    );
    if (unknown.length > 0) {
      throw new InvariantViolation(`Unknown claim ids: ${unknown.join(', ')}.`);
    }
    aggregate.actions.push(action);
    appendEvent(aggregate, 'action_added', action.objective, {
      entityRef: `action:${action.id}`,
    });
  });

  if (!updated) return errorResponse('Account not found.', 404);
  return aggregateResponse(updated, 201);
}

async function updateAction(request: Request, id: string, aid: string): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(request);

  const updated = await mutateAggregate(id, expectedRevOf(request), (aggregate) => {
    const action = aggregate.actions.find((a) => a.id === aid);
    if (!action) throw new NotFound('Action not found.');

    const previousStatus = action.status;

    if (body.objective !== undefined) action.objective = requireString(body.objective, 'objective');
    if (body.channel !== undefined) {
      action.channel = oneOf(body.channel, CHANNELS, 'channel', action.channel);
    }
    if (body.messageOrAction !== undefined) {
      action.messageOrAction = optionalString(body.messageOrAction, 'messageOrAction') ?? '';
    }
    if (body.whyThisPersonNow !== undefined) {
      action.whyThisPersonNow = optionalString(body.whyThisPersonNow, 'whyThisPersonNow') ?? '';
    }
    if (body.desiredOutcome !== undefined) {
      action.desiredOutcome = optionalString(body.desiredOutcome, 'desiredOutcome') ?? '';
    }
    if (body.horizon !== undefined) {
      action.horizon = oneOf(body.horizon, HORIZONS, 'horizon', action.horizon);
    }
    if (body.dueAt !== undefined) {
      action.dueAt = body.dueAt ? isoDate(body.dueAt, 'dueAt') : undefined;
    }
    if (body.stakeholderId !== undefined) {
      action.stakeholderId = optionalString(body.stakeholderId, 'stakeholderId');
    }
    if (body.wedgeId !== undefined) {
      action.wedgeId = optionalString(body.wedgeId, 'wedgeId');
    }
    if (body.resolvesClaimIds !== undefined) {
      action.resolvesClaimIds = stringArray(body.resolvesClaimIds, 'resolvesClaimIds');
    }
    if (body.outcomeNote !== undefined) {
      action.outcomeNote = optionalString(body.outcomeNote, 'outcomeNote');
    }
    if (body.status !== undefined) {
      action.status = oneOf(body.status, ACTION_STATUSES, 'status', action.status);
      action.completedAt = action.status === 'open' ? undefined : new Date().toISOString();
    }

    appendEvent(
      aggregate,
      'action_updated',
      previousStatus !== action.status
        ? `${action.objective} — ${action.status}.`
        : `${action.objective} updated.`,
      { entityRef: `action:${action.id}`, reason: action.outcomeNote }
    );
  });

  if (!updated) return errorResponse('Account not found.', 404);
  return aggregateResponse(updated);
}

async function removeAction(request: Request, id: string, aid: string): Promise<Response> {
  const updated = await mutateAggregate(id, expectedRevOf(request), (aggregate) => {
    const action = aggregate.actions.find((a) => a.id === aid);
    if (!action) throw new NotFound('Action not found.');
    aggregate.actions = aggregate.actions.filter((a) => a.id !== aid);
    appendEvent(aggregate, 'action_removed', `${action.objective} removed.`, {
      entityRef: `action:${aid}`,
    });
  });

  if (!updated) return errorResponse('Account not found.', 404);
  return aggregateResponse(updated);
}

export const config: Config = {
  path: ['/api/accounts/:id/actions', '/api/accounts/:id/actions/:aid'],
};
