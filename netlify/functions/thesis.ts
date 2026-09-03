import type { Config, Context } from '@netlify/functions';
import type Anthropic from '@anthropic-ai/sdk';
import {
  aggregateResponse,
  errorResponse,
  expectedRevOf,
  handle,
} from '../lib/http';
import { appendEvent, mutateAggregate, newId, readAggregate } from '../lib/store';
import { structuredCall } from '../lib/claude';
import { clampStatus } from '../../src/domain/claims';
import {
  CLAIM_CATEGORIES,
  CLAIM_STATUSES,
  EVIDENCE_CATEGORY_LABELS,
  SOURCE_TYPE_LABELS,
  type AccountAggregate,
  type Claim,
  type ClaimCategory,
  type ClaimStatus,
  type EvidenceItem,
} from '../../src/domain/types';

const SYSTEM = `You write the account thesis for an enterprise account executive selling Devin, Cognition's autonomous AI software engineer.

Devin is bought by engineering leadership to absorb queued-up, well-specified engineering work — migrations, refactors, dependency and CVE remediation, test backfill, bug burn-down, CI repair, codebase Q&A — by running many sessions in parallel. Its value scales with the volume of that work and with the size of the engineering organisation.

You are given the evidence ledger for one account. You do not have access to anything else, and you must not add facts that are not in the ledger.

Produce:
1. A short narrative — three to five sentences — of why this account matters right now, what Devin would actually be deployed against, and what is still unproven.
2. A status for each piece of evidence: FACT if it is a verifiable observation from a named source, HYPOTHESIS if it is an interpretation, UNKNOWN if it raises a question rather than answering one.
3. A set of claims. One rating claim per criterion, worded as a rating with a short justification (for example "Engineering scale: HIGH — roughly 900 engineers across 40+ services"). Then the open unknowns: the things that must be true for this deal to work and that the ledger does not yet show.

Rules:
- Every FACT claim must cite at least one piece of evidence from a verifiable source. Cite by index.
- UNKNOWN claims cite nothing.
- Never rate Right to Win above HYPOTHESIS unless the ledger contains first-party evidence: a conversation, a document, or an internal signal. Public web material does not establish it.
- Be specific and unsentimental. An AE has to say these words to a VP of Engineering.`;

const THESIS_TOOL: Anthropic.Tool = {
  name: 'submit_thesis',
  description: 'Return the account thesis, evidence statuses, and claims.',
  input_schema: {
    type: 'object',
    required: ['whyItMatters', 'claims'],
    properties: {
      whyItMatters: { type: 'string' },
      evidenceAssessments: {
        type: 'array',
        items: {
          type: 'object',
          required: ['index', 'status'],
          properties: {
            index: { type: 'integer' },
            status: { type: 'string', enum: CLAIM_STATUSES },
            whyItMatters: { type: 'string' },
            implicationForDevin: { type: 'string' },
            nextDiscoveryQuestion: { type: 'string' },
          },
        },
      },
      claims: {
        type: 'array',
        minItems: 6,
        items: {
          type: 'object',
          required: ['text', 'category', 'status'],
          properties: {
            text: { type: 'string' },
            category: { type: 'string', enum: CLAIM_CATEGORIES },
            status: { type: 'string', enum: CLAIM_STATUSES },
            evidenceRefs: { type: 'array', items: { type: 'integer' } },
          },
        },
      },
    },
  },
};

export interface ThesisResult {
  whyItMatters: string;
  evidenceAssessments?: {
    index: number;
    status: ClaimStatus;
    whyItMatters?: string;
    implicationForDevin?: string;
    nextDiscoveryQuestion?: string;
  }[];
  claims: {
    text: string;
    category: ClaimCategory;
    status: ClaimStatus;
    evidenceRefs?: number[];
  }[];
}

export default async (request: Request, context: Context): Promise<Response> =>
  handle(request, async () => {
    if (request.method !== 'POST') {
      return errorResponse('Use POST to generate a thesis.', 405);
    }

    const id = context.params.id;
    const loaded = await readAggregate(id);
    if (!loaded) return errorResponse('Account not found.', 404);

    const { evidence, account } = loaded.aggregate;
    if (evidence.length === 0) {
      return errorResponse(
        'There is no evidence to reason over. Seed the account or add evidence first.',
        422
      );
    }

    const result = await structuredCall<ThesisResult>({
      system: SYSTEM,
      prompt: `Account: ${account.companyName}${account.domain ? ` (${account.domain})` : ''}. Today is ${new Date().toISOString().slice(0, 10)}.\n\nEvidence ledger:\n\n${renderLedger(evidence)}`,
      tool: THESIS_TOOL,
      maxTokens: 8000,
    });

    const updated = await mutateAggregate(id, expectedRevOf(request), (aggregate) => {
      applyThesis(aggregate, result);
    });

    if (!updated) return errorResponse('Account not found.', 404);
    return aggregateResponse(updated);
  });

function renderLedger(evidence: EvidenceItem[]): string {
  return evidence
    .map((item, i) => {
      const category = item.evidenceCategory
        ? EVIDENCE_CATEGORY_LABELS[item.evidenceCategory]
        : 'Uncategorised';
      const confidential = item.confidential ? ' [CONFIDENTIAL — never quote externally]' : '';
      const url = item.externalUrl ? `\n    url: ${item.externalUrl}` : '';
      return `[${i}] (${category}) ${SOURCE_TYPE_LABELS[item.sourceType]}${item.sourceRef ? ` — ${item.sourceRef}` : ''}, as of ${item.asOf}${confidential}\n    "${item.verbatim}"${url}`;
    })
    .join('\n\n');
}

export function applyThesis(aggregate: AccountAggregate, result: ThesisResult): void {
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const evidence = aggregate.evidence;

  for (const assessment of result.evidenceAssessments ?? []) {
    const item = evidence[assessment.index];
    if (!item) continue;
    // The model may not mark unverifiable material as fact, no matter how
    // plausible its reasoning was.
    item.status =
      assessment.status === 'FACT' && item.sourceType === 'inference'
        ? 'HYPOTHESIS'
        : assessment.status;
    item.whyItMatters = assessment.whyItMatters ?? item.whyItMatters;
    item.implicationForDevin = assessment.implicationForDevin ?? item.implicationForDevin;
    item.nextDiscoveryQuestion =
      assessment.nextDiscoveryQuestion ?? item.nextDiscoveryQuestion;
  }

  // Claims the seller has curated by hand survive regeneration; only the
  // previously generated set is replaced. Superseded claims keep their history
  // through supersedesClaimId.
  const curated = aggregate.claims.filter((c) => !c.generated);
  const previous = aggregate.claims.filter((c) => c.generated);
  const replacedBy = new Map<string, string>();
  let downgraded = 0;

  const claims: Claim[] = (result.claims ?? []).map((proposed) => {
    const evidenceIds = (proposed.evidenceRefs ?? [])
      .map((ref) => evidence[ref]?.id)
      .filter((id): id is string => Boolean(id));

    let status = clampStatus(proposed.status, evidenceIds, evidence);
    if (proposed.category === 'right_to_win' && status === 'FACT' && !hasFirstPartyEvidence(evidenceIds, evidence)) {
      status = 'HYPOTHESIS';
    }
    if (status !== proposed.status) downgraded += 1;

    const supersedes = previous.find((c) => c.category === proposed.category);
    const id = newId();
    if (supersedes) replacedBy.set(supersedes.id, id);

    return {
      id,
      text: proposed.text,
      status,
      category: proposed.category,
      evidenceIds: status === 'UNKNOWN' ? [] : evidenceIds,
      supersedesClaimId: supersedes?.id,
      generated: true,
      asOf: today,
      reviewedAt: now,
      createdAt: now,
    };
  });

  aggregate.claims = [...curated, ...claims];
  aggregate.whyItMatters = result.whyItMatters;

  // An action that was resolving a generated claim follows that claim to its
  // replacement rather than pointing at nothing.
  const live = new Set(aggregate.claims.map((c) => c.id));
  for (const action of aggregate.actions) {
    action.resolvesClaimIds = [
      ...new Set(
        action.resolvesClaimIds
          .map((claimId) => replacedBy.get(claimId) ?? claimId)
          .filter((claimId) => live.has(claimId))
      ),
    ];
  }

  appendEvent(
    aggregate,
    'thesis_generated',
    `Thesis regenerated from ${evidence.length} pieces of evidence into ${claims.length} claims.`,
    {
      reason: downgraded
        ? `${downgraded} proposed status${downgraded === 1 ? ' was' : 'es were'} downgraded to match the evidence.`
        : undefined,
    }
  );
}

/** Right to win rests on access, not on reading: only first-party sources count. */
function hasFirstPartyEvidence(ids: string[], evidence: EvidenceItem[]): boolean {
  return ids.some((id) => {
    const item = evidence.find((e) => e.id === id);
    if (!item) return false;
    return item.sourceType === 'conversation' || item.sourceType === 'document';
  });
}

export const config: Config = {
  path: '/api/accounts/:id/thesis/generate',
};
