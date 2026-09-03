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
} from '../lib/http';
import { appendEvent, mutateAggregate, newId, readAggregate } from '../lib/store';
import { championTier } from '../../src/domain/champion';
import {
  CHAMPION_SIGNALS,
  CHAMPION_SIGNAL_LABELS,
  type AccountAggregate,
  type ChampionSignal,
} from '../../src/domain/types';

export default async (request: Request, context: Context): Promise<Response> =>
  handle(request, async () => {
    const { id, sigid } = context.params;

    if (request.method === 'GET') {
      const loaded = await readAggregate(id);
      if (!loaded) return errorResponse('Account not found.', 404);
      return json(loaded.aggregate.signals);
    }

    if (request.method === 'POST') return recordSignal(request, id);
    if (request.method === 'PATCH' && sigid) return updateSignal(request, id, sigid);
    if (request.method === 'DELETE' && sigid) return removeSignal(request, id, sigid);
    return methodNotAllowed(request.method);
  });

/**
 * An observed signal without a citation is a feeling, and feelings do not move
 * a champion tier. Recording one is rejected rather than silently discounted.
 */
function assertCitation(
  signal: Pick<ChampionSignal, 'observed' | 'evidenceId'>,
  aggregate: AccountAggregate
): void {
  if (!signal.observed) return;
  if (!signal.evidenceId) {
    throw new InvariantViolation(
      'An observed signal must cite the evidence that shows it happened.'
    );
  }
  if (!aggregate.evidence.some((e) => e.id === signal.evidenceId)) {
    throw new InvariantViolation('The cited evidence does not exist on this account.');
  }
}

async function recordSignal(request: Request, id: string): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(request);

  const signal: ChampionSignal = {
    id: newId(),
    stakeholderId: requireString(body.stakeholderId, 'stakeholderId'),
    signalType: oneOf(body.signalType, CHAMPION_SIGNALS, 'signalType'),
    observed: body.observed !== false,
    evidenceId: optionalString(body.evidenceId, 'evidenceId'),
    observedAt: new Date().toISOString(),
    note: optionalString(body.note, 'note'),
  };

  const updated = await mutateAggregate(id, expectedRevOf(request), (aggregate) => {
    const person = aggregate.stakeholders.find((s) => s.id === signal.stakeholderId);
    if (!person) throw new NotFound('Stakeholder not found.');
    assertCitation(signal, aggregate);

    const before = championTier(person.id, aggregate.signals, aggregate.evidence);

    // One record per person per signal type: recording it again is a correction.
    aggregate.signals = aggregate.signals.filter(
      (s) => !(s.stakeholderId === signal.stakeholderId && s.signalType === signal.signalType)
    );
    aggregate.signals.push(signal);

    appendEvent(
      aggregate,
      'signal_recorded',
      `${person.name}: ${CHAMPION_SIGNAL_LABELS[signal.signalType]} ${signal.observed ? 'observed' : 'not observed'}.`,
      { entityRef: `stakeholder:${person.id}`, reason: signal.note }
    );

    const after = championTier(person.id, aggregate.signals, aggregate.evidence);
    if (after !== before) {
      appendEvent(aggregate, 'champion_tier_changed', `${person.name}: ${before} → ${after}.`, {
        entityRef: `stakeholder:${person.id}`,
      });
    }
  });

  if (!updated) return errorResponse('Account not found.', 404);
  return aggregateResponse(updated, 201);
}

async function updateSignal(request: Request, id: string, sigid: string): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(request);

  const updated = await mutateAggregate(id, expectedRevOf(request), (aggregate) => {
    const signal = aggregate.signals.find((s) => s.id === sigid);
    if (!signal) throw new NotFound('Signal not found.');

    const before = championTier(signal.stakeholderId, aggregate.signals, aggregate.evidence);

    const proposed = {
      observed: body.observed !== undefined ? body.observed === true : signal.observed,
      evidenceId:
        body.evidenceId !== undefined
          ? optionalString(body.evidenceId, 'evidenceId')
          : signal.evidenceId,
    };
    assertCitation(proposed, aggregate);

    signal.observed = proposed.observed;
    signal.evidenceId = proposed.evidenceId;
    if (body.note !== undefined) signal.note = optionalString(body.note, 'note');
    signal.observedAt = new Date().toISOString();

    const person = aggregate.stakeholders.find((s) => s.id === signal.stakeholderId);
    appendEvent(
      aggregate,
      'signal_recorded',
      `${person?.name ?? 'Stakeholder'}: ${CHAMPION_SIGNAL_LABELS[signal.signalType]} ${signal.observed ? 'observed' : 'not observed'}.`,
      { entityRef: `stakeholder:${signal.stakeholderId}` }
    );

    const after = championTier(signal.stakeholderId, aggregate.signals, aggregate.evidence);
    if (after !== before) {
      appendEvent(
        aggregate,
        'champion_tier_changed',
        `${person?.name ?? 'Stakeholder'}: ${before} → ${after}.`,
        { entityRef: `stakeholder:${signal.stakeholderId}` }
      );
    }
  });

  if (!updated) return errorResponse('Account not found.', 404);
  return aggregateResponse(updated);
}

async function removeSignal(request: Request, id: string, sigid: string): Promise<Response> {
  const updated = await mutateAggregate(id, expectedRevOf(request), (aggregate) => {
    const signal = aggregate.signals.find((s) => s.id === sigid);
    if (!signal) throw new NotFound('Signal not found.');
    aggregate.signals = aggregate.signals.filter((s) => s.id !== sigid);
    appendEvent(
      aggregate,
      'signal_removed',
      `${CHAMPION_SIGNAL_LABELS[signal.signalType]} removed.`,
      { entityRef: `stakeholder:${signal.stakeholderId}` }
    );
  });

  if (!updated) return errorResponse('Account not found.', 404);
  return aggregateResponse(updated);
}

export const config: Config = {
  path: ['/api/accounts/:id/signals', '/api/accounts/:id/signals/:sigid'],
};
