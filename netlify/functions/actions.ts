/**
 * Action CRUD.
 *
 * Actions serve both the 30-day plan (bucketed by horizon) and the Next Best
 * Action (top-ranked open action). The NBA itself is computed client-side
 * from the aggregate, not stored, so the suggestion and the plan can never
 * disagree.
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
  CHANNELS,
  HORIZONS,
  type Action,
  type ActionStatus,
  type Channel,
  type Horizon,
  type ID,
} from '../../src/domain/types';

export const config: Config = {
  path: [
    '/api/accounts/:accountId/actions',
    '/api/accounts/:accountId/actions/:actionId',
  ],
};

const STATUSES: ActionStatus[] = ['open', 'done', 'dropped'];

export default async (req: Request, context: Context): Promise<Response> => {
  const accountId = context.params.accountId;
  const actionId = context.params.actionId;

  try {
    if (!accountId) return error(400, 'Missing account id.');

    if (!actionId) {
      if (req.method === 'GET') return await listActions(accountId);
      if (req.method === 'POST') return await addAction(req, accountId);
      return error(405, `${req.method} is not supported on this route.`);
    }

    if (req.method === 'PATCH' || req.method === 'PUT') {
      return await updateAction(req, accountId, actionId);
    }
    if (req.method === 'DELETE') return await removeAction(req, accountId, actionId);
    return error(405, `${req.method} is not supported on this route.`);
  } catch (err) {
    return toResponse(err);
  }
};

function parseChannel(value: unknown): Channel {
  if (value === undefined) return 'other';
  if (typeof value !== 'string' || !CHANNELS.includes(value as Channel)) {
    throw new BadRequestError(`"channel" must be one of: ${CHANNELS.join(', ')}.`);
  }
  return value as Channel;
}

function parseHorizon(value: unknown): Horizon {
  if (typeof value !== 'string' || !HORIZONS.includes(value as Horizon)) {
    throw new BadRequestError(`"horizon" must be one of: ${HORIZONS.join(', ')}.`);
  }
  return value as Horizon;
}

function parseStatus(value: unknown): ActionStatus {
  if (value === undefined) return 'open';
  if (typeof value !== 'string' || !STATUSES.includes(value as ActionStatus)) {
    throw new BadRequestError(`"status" must be one of: ${STATUSES.join(', ')}.`);
  }
  return value as ActionStatus;
}

function parseIdArray(value: unknown, field: string): ID[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new BadRequestError(`"${field}" must be an array of strings.`);
  }
  return value as ID[];
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new BadRequestError(`"${field}" must be a string.`);
  return value.trim() || undefined;
}

async function listActions(accountId: string): Promise<Response> {
  const loaded = await readAggregate(accountId);
  if (!loaded) return error(404, 'Account not found.');
  return jsonWithRev(loaded.aggregate.actions, loaded.aggregate.rev);
}

async function addAction(req: Request, accountId: string): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(req);
  const now = new Date().toISOString();

  const action: Action = {
    id: newId(),
    stakeholderId: optionalString(body.stakeholderId, 'stakeholderId'),
    wedgeId: optionalString(body.wedgeId, 'wedgeId'),
    objective: requireString(body.objective, 'objective'),
    channel: parseChannel(body.channel),
    messageOrAction: requireString(body.messageOrAction, 'messageOrAction'),
    whyThisPersonNow: requireString(body.whyThisPersonNow, 'whyThisPersonNow'),
    desiredOutcome: requireString(body.desiredOutcome, 'desiredOutcome'),
    dependencyActionId: optionalString(body.dependencyActionId, 'dependencyActionId'),
    ifSuccess: optionalString(body.ifSuccess, 'ifSuccess'),
    ifFail: optionalString(body.ifFail, 'ifFail'),
    horizon: parseHorizon(body.horizon),
    status: 'open',
    dueAt: optionalString(body.dueAt, 'dueAt'),
    resolvesClaimIds: parseIdArray(body.resolvesClaimIds, 'resolvesClaimIds'),
    createdAt: now,
  };

  const outcome = await mutateAggregate(accountId, expectedRev(req), (aggregate) => {
    if (action.stakeholderId) {
      const exists = aggregate.stakeholders.some((s) => s.id === action.stakeholderId);
      if (!exists) throw new BadRequestError('stakeholderId does not exist on this account.');
    }
    if (action.dependencyActionId) {
      const exists = aggregate.actions.some((a) => a.id === action.dependencyActionId);
      if (!exists) throw new BadRequestError('dependencyActionId does not exist.');
    }

    aggregate.actions.push(action);
    appendEvent(
      aggregate,
      newEvent('action_added', `Action added: ${action.objective}.`, {
        entityRef: `action:${action.id}`,
      })
    );
    return action;
  });

  if (!outcome) return error(404, 'Account not found.');
  return mutationResult(outcome.aggregate, outcome.result.id, 201);
}

async function updateAction(
  req: Request,
  accountId: string,
  actionId: string
): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(req);

  const outcome = await mutateAggregate(accountId, expectedRev(req), (aggregate) => {
    const action = aggregate.actions.find((a) => a.id === actionId);
    if (!action) return null;

    const previousStatus = action.status;

    if (body.objective !== undefined) action.objective = requireString(body.objective, 'objective');
    if (body.channel !== undefined) action.channel = parseChannel(body.channel);
    if (body.messageOrAction !== undefined) {
      action.messageOrAction = requireString(body.messageOrAction, 'messageOrAction');
    }
    if (body.whyThisPersonNow !== undefined) {
      action.whyThisPersonNow = requireString(body.whyThisPersonNow, 'whyThisPersonNow');
    }
    if (body.desiredOutcome !== undefined) {
      action.desiredOutcome = requireString(body.desiredOutcome, 'desiredOutcome');
    }
    if (body.horizon !== undefined) action.horizon = parseHorizon(body.horizon);
    if (body.dueAt !== undefined) action.dueAt = optionalString(body.dueAt, 'dueAt');
    if (body.resolvesClaimIds !== undefined) {
      action.resolvesClaimIds = parseIdArray(body.resolvesClaimIds, 'resolvesClaimIds');
    }
    if (body.status !== undefined) action.status = parseStatus(body.status);
    if (body.outcomeNote !== undefined) {
      action.outcomeNote = optionalString(body.outcomeNote, 'outcomeNote');
    }

    if (action.status === 'done' && previousStatus !== 'done') {
      action.completedAt = new Date().toISOString();
      appendEvent(
        aggregate,
        newEvent('action_completed', `Action completed: ${action.objective}.`, {
          entityRef: `action:${action.id}`,
          reason: action.outcomeNote,
        })
      );
    }

    return action;
  });

  if (!outcome) return error(404, 'Account not found.');
  if (!outcome.result) return error(404, 'Action not found.');
  return mutationResult(outcome.aggregate, actionId);
}

async function removeAction(
  req: Request,
  accountId: string,
  actionId: string
): Promise<Response> {
  const outcome = await mutateAggregate(accountId, expectedRev(req), (aggregate) => {
    const action = aggregate.actions.find((a) => a.id === actionId);
    if (!action) return null;

    aggregate.actions = aggregate.actions.filter((a) => a.id !== actionId);
    appendEvent(
      aggregate,
      newEvent('action_added', `Action removed: ${action.objective}.`, {
        entityRef: `action:${actionId}`,
        reason: 'Deleted by user.',
      })
    );
    return action;
  });

  if (!outcome) return error(404, 'Account not found.');
  if (!outcome.result) return error(404, 'Action not found.');
  return mutationResult(outcome.aggregate, actionId);
}
