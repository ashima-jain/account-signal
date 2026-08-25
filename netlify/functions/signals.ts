/**
 * Champion signal recording.
 *
 * A signal counts toward the champion tier only when it is observed AND cites
 * evidence that still exists. The server enforces the evidence requirement;
 * the tier itself is computed in champion.ts as a pure function.
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
  CHAMPION_SIGNALS,
  type ChampionSignal,
  type ChampionSignalType,
} from '../../src/domain/types';
import { championTier } from '../../src/domain/champion';

export const config: Config = {
  path: [
    '/api/accounts/:accountId/signals',
    '/api/accounts/:accountId/signals/:signalId',
  ],
};

export default async (req: Request, context: Context): Promise<Response> => {
  const accountId = context.params.accountId;
  const signalId = context.params.signalId;

  try {
    if (!accountId) return error(400, 'Missing account id.');

    if (!signalId) {
      if (req.method === 'GET') return await listSignals(accountId);
      if (req.method === 'POST') return await recordSignal(req, accountId);
      return error(405, `${req.method} is not supported on this route.`);
    }

    if (req.method === 'PATCH' || req.method === 'PUT') {
      return await updateSignal(req, accountId, signalId);
    }
    if (req.method === 'DELETE') return await removeSignal(req, accountId, signalId);
    return error(405, `${req.method} is not supported on this route.`);
  } catch (err) {
    return toResponse(err);
  }
};

function parseSignalType(value: unknown): ChampionSignalType {
  if (typeof value !== 'string' || !CHAMPION_SIGNALS.includes(value as ChampionSignalType)) {
    throw new BadRequestError(`"signalType" must be one of: ${CHAMPION_SIGNALS.join(', ')}.`);
  }
  return value as ChampionSignalType;
}

async function listSignals(accountId: string): Promise<Response> {
  const loaded = await readAggregate(accountId);
  if (!loaded) return error(404, 'Account not found.');
  return jsonWithRev(loaded.aggregate.signals, loaded.aggregate.rev);
}

async function recordSignal(req: Request, accountId: string): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(req);

  const stakeholderId = requireString(body.stakeholderId, 'stakeholderId');
  const signalType = parseSignalType(body.signalType);
  const observed = body.observed !== false;
  const evidenceId = typeof body.evidenceId === 'string' ? body.evidenceId : undefined;
  const note = typeof body.note === 'string' ? body.note.trim() || undefined : undefined;

  // An observed signal must cite evidence. This is the rule that makes
  // self-reported enthusiasm unable to inflate the champion tier.
  if (observed && !evidenceId) {
    throw new BadRequestError(
      'An observed signal must cite evidence. Record what they did or said, then link it.'
    );
  }

  const signal: ChampionSignal = {
    id: newId(),
    stakeholderId,
    signalType,
    observed,
    evidenceId: observed ? evidenceId : undefined,
    observedAt: observed ? new Date().toISOString() : undefined,
    note,
  };

  const outcome = await mutateAggregate(accountId, expectedRev(req), (aggregate) => {
    const stakeholder = aggregate.stakeholders.find((s) => s.id === stakeholderId);
    if (!stakeholder) throw new BadRequestError('stakeholderId does not exist on this account.');

    if (evidenceId) {
      const evidence = aggregate.evidence.find((e) => e.id === evidenceId);
      if (!evidence) throw new BadRequestError('evidenceId does not exist on this account.');
    }

    // Replace any existing signal of the same type for this stakeholder.
    const existing = aggregate.signals.find(
      (sig) => sig.stakeholderId === stakeholderId && sig.signalType === signalType
    );
    if (existing) {
      existing.observed = signal.observed;
      existing.evidenceId = signal.evidenceId;
      existing.observedAt = signal.observedAt;
      existing.note = signal.note;
    } else {
      aggregate.signals.push(signal);
    }

    const tierBefore = championTier(
      aggregate.signals.filter((sig) => sig.stakeholderId === stakeholderId),
      aggregate.evidence
    );

    appendEvent(
      aggregate,
      newEvent(
        'signal_recorded',
        `${stakeholder.name}: ${signalType} ${observed ? 'observed' : 'unobserved'}.`,
        { entityRef: `signal:${existing?.id ?? signal.id}` }
      )
    );

    return { signal: existing ?? signal, tier: tierBefore };
  });

  if (!outcome) return error(404, 'Account not found.');
  return mutationResult(outcome.aggregate, outcome.result.signal.id, 201);
}

async function updateSignal(
  req: Request,
  accountId: string,
  signalId: string
): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(req);

  const outcome = await mutateAggregate(accountId, expectedRev(req), (aggregate) => {
    const signal = aggregate.signals.find((sig) => sig.id === signalId);
    if (!signal) return null;

    if (body.observed !== undefined) {
      signal.observed = body.observed === true;
      if (signal.observed && !signal.evidenceId) {
        throw new BadRequestError(
          'An observed signal must cite evidence. Link evidence first.'
        );
      }
      signal.observedAt = signal.observed ? new Date().toISOString() : undefined;
    }
    if (body.evidenceId !== undefined) {
      const evidenceId = typeof body.evidenceId === 'string' ? body.evidenceId : undefined;
      if (evidenceId) {
        const evidence = aggregate.evidence.find((e) => e.id === evidenceId);
        if (!evidence) throw new BadRequestError('evidenceId does not exist on this account.');
      }
      signal.evidenceId = evidenceId;
    }
    if (body.note !== undefined) {
      signal.note = typeof body.note === 'string' ? body.note.trim() || undefined : undefined;
    }

    const stakeholder = aggregate.stakeholders.find((s) => s.id === signal.stakeholderId);
    appendEvent(
      aggregate,
      newEvent(
        'signal_recorded',
        `${stakeholder?.name ?? 'Unknown'}: ${signal.signalType} updated.`,
        { entityRef: `signal:${signalId}` }
      )
    );

    return signal;
  });

  if (!outcome) return error(404, 'Account not found.');
  if (!outcome.result) return error(404, 'Signal not found.');
  return mutationResult(outcome.aggregate, signalId);
}

async function removeSignal(
  req: Request,
  accountId: string,
  signalId: string
): Promise<Response> {
  const outcome = await mutateAggregate(accountId, expectedRev(req), (aggregate) => {
    const signal = aggregate.signals.find((sig) => sig.id === signalId);
    if (!signal) return null;

    aggregate.signals = aggregate.signals.filter((sig) => sig.id !== signalId);
    const stakeholder = aggregate.stakeholders.find((s) => s.id === signal.stakeholderId);
    appendEvent(
      aggregate,
      newEvent(
        'signal_recorded',
        `${stakeholder?.name ?? 'Unknown'}: ${signal.signalType} removed.`,
        { entityRef: `signal:${signalId}` }
      )
    );
    return signal;
  });

  if (!outcome) return error(404, 'Account not found.');
  if (!outcome.result) return error(404, 'Signal not found.');
  return mutationResult(outcome.aggregate, signalId);
}
