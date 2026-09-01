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
  oneOf,
  optionalString,
  readJson,
  requireString,
} from '../lib/http';
import { appendEvent, mutateAggregate, newId, readAggregate } from '../lib/store';
import { reconcileClaims } from '../../src/domain/claims';
import {
  CLAIM_STATUSES,
  EVIDENCE_CATEGORIES,
  isVerifiableSource,
  SOURCE_SYSTEMS,
  SOURCE_TYPES,
  type ClaimStatus,
  type EvidenceItem,
} from '../../src/domain/types';

export default async (request: Request, context: Context): Promise<Response> =>
  handle(async () => {
    const { id, eid } = context.params;

    if (request.method === 'GET') {
      const loaded = await readAggregate(id);
      if (!loaded) return errorResponse('Account not found.', 404);
      return json(loaded.aggregate.evidence);
    }

    if (request.method === 'POST') return addEvidence(request, id);
    if (request.method === 'PATCH' && eid) return updateEvidence(request, id, eid);
    if (request.method === 'DELETE' && eid) return removeEvidence(request, id, eid);
    return methodNotAllowed(request.method);
  });

async function addEvidence(request: Request, id: string): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(request);
  const now = new Date().toISOString();

  const item: EvidenceItem = {
    id: newId(),
    sourceType: oneOf(body.sourceType, SOURCE_TYPES, 'sourceType'),
    sourceSystem: oneOf(body.sourceSystem, SOURCE_SYSTEMS, 'sourceSystem', 'manual'),
    sourceRef: optionalString(body.sourceRef, 'sourceRef'),
    externalUrl: optionalString(body.externalUrl, 'externalUrl'),
    externalId: optionalString(body.externalId, 'externalId'),
    verbatim: requireString(body.verbatim, 'verbatim'),
    capturedAt: now,
    asOf: isoDate(body.asOf, 'asOf', now),
    confidential: body.confidential === true,
    stakeholderId: optionalString(body.stakeholderId, 'stakeholderId'),
    evidenceCategory: body.evidenceCategory
      ? oneOf(body.evidenceCategory, EVIDENCE_CATEGORIES, 'evidenceCategory')
      : undefined,
    signalType: optionalString(body.signalType, 'signalType'),
    whyItMatters: optionalString(body.whyItMatters, 'whyItMatters'),
    implicationForDevin: optionalString(body.implicationForDevin, 'implicationForDevin'),
    nextDiscoveryQuestion: optionalString(body.nextDiscoveryQuestion, 'nextDiscoveryQuestion'),
    status: body.status ? oneOf(body.status, CLAIM_STATUSES, 'status') : undefined,
  };

  assertStatusIsSupportable(item.status, item);

  const updated = await mutateAggregate(id, expectedRevOf(request), (aggregate) => {
    // Re-syncing the same upstream record must not duplicate it.
    if (item.externalId) {
      const existing = aggregate.evidence.find((e) => e.externalId === item.externalId);
      if (existing) {
        Object.assign(existing, { ...item, id: existing.id, capturedAt: existing.capturedAt });
        appendEvent(aggregate, 'evidence_updated', `Re-ingested evidence ${item.externalId}.`, {
          entityRef: `evidence:${existing.id}`,
        });
        return;
      }
    }

    aggregate.evidence.push(item);
    appendEvent(aggregate, 'evidence_added', truncate(item.verbatim), {
      entityRef: `evidence:${item.id}`,
    });
  });

  if (!updated) return errorResponse('Account not found.', 404);
  return aggregateResponse(updated, 201);
}

async function updateEvidence(request: Request, id: string, eid: string): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(request);

  let missing = false;
  const updated = await mutateAggregate(id, expectedRevOf(request), (aggregate) => {
    const item = aggregate.evidence.find((e) => e.id === eid);
    if (!item) {
      missing = true;
      return;
    }

    const previousStatus = item.status;

    if (body.verbatim !== undefined) item.verbatim = requireString(body.verbatim, 'verbatim');
    if (body.sourceRef !== undefined) item.sourceRef = optionalString(body.sourceRef, 'sourceRef');
    if (body.externalUrl !== undefined) {
      item.externalUrl = optionalString(body.externalUrl, 'externalUrl');
    }
    if (body.asOf !== undefined) item.asOf = isoDate(body.asOf, 'asOf');
    if (body.confidential !== undefined) item.confidential = body.confidential === true;
    if (body.evidenceCategory !== undefined) {
      item.evidenceCategory = oneOf(body.evidenceCategory, EVIDENCE_CATEGORIES, 'evidenceCategory');
    }
    if (body.stakeholderId !== undefined) {
      item.stakeholderId = optionalString(body.stakeholderId, 'stakeholderId');
    }
    if (body.status !== undefined) {
      const status = body.status === null ? undefined : oneOf(body.status, CLAIM_STATUSES, 'status');
      assertStatusIsSupportable(status, item);
      item.status = status;
    }

    if (previousStatus !== item.status) {
      appendEvent(
        aggregate,
        'evidence_status_changed',
        `${truncate(item.verbatim)} marked ${item.status ?? 'unreviewed'}.`,
        { entityRef: `evidence:${item.id}` }
      );
    } else {
      appendEvent(aggregate, 'evidence_updated', truncate(item.verbatim), {
        entityRef: `evidence:${item.id}`,
      });
    }
  });

  if (!updated || missing) return errorResponse('Evidence not found.', 404);
  return aggregateResponse(updated);
}

async function removeEvidence(request: Request, id: string, eid: string): Promise<Response> {
  let missing = false;
  const updated = await mutateAggregate(id, expectedRevOf(request), (aggregate) => {
    const item = aggregate.evidence.find((e) => e.id === eid);
    if (!item) {
      missing = true;
      return;
    }

    aggregate.evidence = aggregate.evidence.filter((e) => e.id !== eid);
    appendEvent(aggregate, 'evidence_removed', truncate(item.verbatim), {
      entityRef: `evidence:${eid}`,
    });

    // Anything that leaned on this evidence has to give up its standing.
    for (const demotion of reconcileClaims(aggregate.claims, aggregate.evidence)) {
      const claim = aggregate.claims.find((c) => c.id === demotion.claimId);
      appendEvent(
        aggregate,
        'claim_demoted',
        `"${truncate(claim?.text ?? demotion.claimId)}" demoted to ${demotion.to}.`,
        { entityRef: `claim:${demotion.claimId}`, reason: demotion.reason }
      );
    }
    for (const wedge of aggregate.wedges) {
      wedge.evidenceIds = wedge.evidenceIds.filter((wid) => wid !== eid);
    }
  });

  if (!updated || missing) return errorResponse('Evidence not found.', 404);
  return aggregateResponse(updated);
}

/** Marking a piece of inference as a FACT is the exact move the app exists to stop. */
function assertStatusIsSupportable(status: ClaimStatus | undefined, item: EvidenceItem): void {
  if (status === 'FACT' && !isVerifiableSource(item.sourceType)) {
    throw new InvariantViolation(
      'Inference cannot be marked as a fact. Record the source that would prove it instead.'
    );
  }
}

function truncate(text: string, max = 120): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export const config: Config = {
  path: ['/api/accounts/:id/evidence', '/api/accounts/:id/evidence/:eid'],
};
