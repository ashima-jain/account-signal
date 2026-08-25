/**
 * Evidence ingestion.
 *
 * Every other entity cites evidence, so this endpoint is the only way facts
 * enter the system. POST is idempotent on (sourceSystem, externalId) so a
 * future Granola/Gmail/CRM sync can re-send the same record without creating
 * duplicates.
 */

import type { Config, Context } from '@netlify/functions';
import {
  appendEvent,
  mutateAggregate,
  newEvent,
  newId,
  readAggregate,
} from '../lib/store';
import {
  BadRequestError,
  error,
  expectedRev,
  json,
  jsonWithRev,
  readJson,
  requireString,
  toResponse,
} from '../lib/http';
import {
  SOURCE_SYSTEMS,
  SOURCE_TYPES,
  type EvidenceItem,
  type SourceSystem,
  type SourceType,
} from '../../src/domain/types';
import { reconcileClaims } from '../../src/domain/claims';

export const config: Config = {
  path: [
    '/api/accounts/:accountId/evidence',
    '/api/accounts/:accountId/evidence/:evidenceId',
  ],
};

export default async (req: Request, context: Context): Promise<Response> => {
  const accountId = context.params.accountId;
  const evidenceId = context.params.evidenceId;

  try {
    if (!accountId) return error(400, 'Missing account id.');

    if (!evidenceId) {
      if (req.method === 'GET') return await listEvidence(accountId);
      if (req.method === 'POST') return await addEvidence(req, accountId);
      return error(405, `${req.method} is not supported on this route.`);
    }

    if (req.method === 'PATCH' || req.method === 'PUT') {
      return await updateEvidence(req, accountId, evidenceId);
    }
    if (req.method === 'DELETE') return await removeEvidence(req, accountId, evidenceId);
    return error(405, `${req.method} is not supported on this route.`);
  } catch (err) {
    return toResponse(err);
  }
};

function parseSourceType(value: unknown): SourceType {
  if (typeof value !== 'string' || !SOURCE_TYPES.includes(value as SourceType)) {
    throw new BadRequestError(`"sourceType" must be one of: ${SOURCE_TYPES.join(', ')}.`);
  }
  return value as SourceType;
}

function parseSourceSystem(value: unknown): SourceSystem {
  if (value === undefined) return 'manual';
  if (typeof value !== 'string' || !SOURCE_SYSTEMS.includes(value as SourceSystem)) {
    throw new BadRequestError(
      `"sourceSystem" must be one of: ${SOURCE_SYSTEMS.join(', ')}.`
    );
  }
  return value as SourceSystem;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new BadRequestError(`"${field}" must be a string.`);
  return value.trim() || undefined;
}

function parseTimestamp(value: unknown, field: string, fallback: string): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') throw new BadRequestError(`"${field}" must be a string.`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestError(`"${field}" is not a valid date.`);
  }
  return parsed.toISOString();
}

async function listEvidence(accountId: string): Promise<Response> {
  const loaded = await readAggregate(accountId);
  if (!loaded) return error(404, 'Account not found.');
  const sorted = [...loaded.aggregate.evidence].sort((a, b) => b.asOf.localeCompare(a.asOf));
  return jsonWithRev(sorted, loaded.aggregate.rev);
}

async function addEvidence(req: Request, accountId: string): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(req);
  const now = new Date().toISOString();

  const verbatim = requireString(body.verbatim, 'verbatim');
  const sourceType = parseSourceType(body.sourceType);
  const sourceSystem = parseSourceSystem(body.sourceSystem);
  const externalId = optionalString(body.externalId, 'externalId');
  const stakeholderId = optionalString(body.stakeholderId, 'stakeholderId');

  const item: EvidenceItem = {
    id: newId(),
    sourceType,
    sourceSystem,
    sourceRef: optionalString(body.sourceRef, 'sourceRef'),
    externalUrl: optionalString(body.externalUrl, 'externalUrl'),
    externalId,
    verbatim,
    capturedAt: now,
    // asOf defaults to now but is meant to be the date the thing was true;
    // staleness is computed from it, not from capture time.
    asOf: parseTimestamp(body.asOf, 'asOf', now),
    confidential: body.confidential === true,
    stakeholderId,
  };

  const outcome = await mutateAggregate(accountId, expectedRev(req), (aggregate) => {
    if (stakeholderId && !aggregate.stakeholders.some((s) => s.id === stakeholderId)) {
      throw new BadRequestError('stakeholderId does not exist on this account.');
    }

    // Idempotency: a re-synced external record must not duplicate.
    if (externalId) {
      const existing = aggregate.evidence.find(
        (e) => e.externalId === externalId && e.sourceSystem === sourceSystem
      );
      if (existing) return { item: existing, created: false };
    }

    aggregate.evidence.push(item);
    appendEvent(
      aggregate,
      newEvent(
        'evidence_added',
        `Evidence added (${sourceType}${item.sourceRef ? `: ${item.sourceRef}` : ''}).`,
        { entityRef: `evidence:${item.id}` }
      )
    );
    return { item, created: true };
  });

  if (!outcome) return error(404, 'Account not found.');
  return jsonWithRev(outcome.result.item, outcome.aggregate.rev, outcome.result.created ? 201 : 200);
}

async function updateEvidence(
  req: Request,
  accountId: string,
  evidenceId: string
): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(req);

  const outcome = await mutateAggregate(accountId, expectedRev(req), (aggregate) => {
    const item = aggregate.evidence.find((e) => e.id === evidenceId);
    if (!item) return null;

    if (body.verbatim !== undefined) item.verbatim = requireString(body.verbatim, 'verbatim');
    if (body.sourceType !== undefined) item.sourceType = parseSourceType(body.sourceType);
    if (body.sourceRef !== undefined) item.sourceRef = optionalString(body.sourceRef, 'sourceRef');
    if (body.externalUrl !== undefined) {
      item.externalUrl = optionalString(body.externalUrl, 'externalUrl');
    }
    if (body.confidential !== undefined) item.confidential = body.confidential === true;
    if (body.asOf !== undefined) item.asOf = parseTimestamp(body.asOf, 'asOf', item.asOf);

    // Downgrading a source to an inference must un-prove anything resting on it.
    const demotions = reconcileClaims(aggregate.claims, aggregate.evidence);
    for (const demotion of demotions) {
      appendEvent(
        aggregate,
        newEvent(
          'claim_status_changed',
          `"${demotion.claim.text}" moved from ${demotion.from} to ${demotion.to}.`,
          { entityRef: `claim:${demotion.claim.id}`, reason: demotion.reason }
        )
      );
    }

    return { item, demoted: demotions.length };
  });

  if (!outcome) return error(404, 'Account not found.');
  if (!outcome.result) return error(404, 'Evidence not found.');
  return jsonWithRev(outcome.result.item, outcome.aggregate.rev);
}

async function removeEvidence(
  req: Request,
  accountId: string,
  evidenceId: string
): Promise<Response> {
  const outcome = await mutateAggregate(accountId, expectedRev(req), (aggregate) => {
    const item = aggregate.evidence.find((e) => e.id === evidenceId);
    if (!item) return null;

    aggregate.evidence = aggregate.evidence.filter((e) => e.id !== evidenceId);
    appendEvent(
      aggregate,
      newEvent(
        'evidence_removed',
        `Evidence removed (${item.sourceType}${item.sourceRef ? `: ${item.sourceRef}` : ''}).`,
        { entityRef: `evidence:${evidenceId}` }
      )
    );

    // Champion signals citing this evidence stop counting; clear the reference
    // so the UI shows the signal as untested rather than silently ignored.
    for (const signal of aggregate.signals) {
      if (signal.evidenceId === evidenceId) {
        signal.evidenceId = undefined;
        signal.observed = false;
        appendEvent(
          aggregate,
          newEvent('signal_recorded', `Champion signal "${signal.signalType}" reset.`, {
            entityRef: `signal:${signal.id}`,
            reason: 'The evidence supporting it was removed.',
          })
        );
      }
    }

    const demotions = reconcileClaims(aggregate.claims, aggregate.evidence);
    for (const demotion of demotions) {
      appendEvent(
        aggregate,
        newEvent(
          'claim_status_changed',
          `"${demotion.claim.text}" moved from ${demotion.from} to ${demotion.to}.`,
          { entityRef: `claim:${demotion.claim.id}`, reason: demotion.reason }
        )
      );
    }

    return { demoted: demotions.length };
  });

  if (!outcome) return error(404, 'Account not found.');
  if (!outcome.result) return error(404, 'Evidence not found.');
  return json({ success: true, claimsDemoted: outcome.result.demoted });
}
