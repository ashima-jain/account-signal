/**
 * Thesis generator.
 *
 * The LLM proposes claims; the server enforces the FACT invariant. The model
 * is given evidence verbatim and asked to identify patterns, not to invent
 * facts. If the evidence does not support a thesis, the model returns
 * insufficient_evidence rather than confabulating.
 *
 * Every generated claim is validated against the same claimInvariantError
 * function that manual claims pass through. A claim the model labels FACT
 * that fails validation is downgraded to HYPOTHESIS; a claim citing no
 * evidence becomes UNKNOWN. The model cannot override these rules.
 */

import type { Config, Context } from '@netlify/functions';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { appendEvent, mutateAggregate, newEvent, newId, readAggregate } from '../lib/store';
import {
  BadRequestError,
  error,
  expectedRev,
  jsonWithRev,
  mutationResult,
  toResponse,
} from '../lib/http';
import {
  CLAIM_CATEGORIES,
  type Claim,
  type ClaimCategory,
  type EvidenceItem,
} from '../../src/domain/types';
import { claimInvariantError } from '../../src/domain/claims';

export const config: Config = {
  path: ['/api/accounts/:accountId/thesis/generate'],
};

const ThesisSchema = z.object({
  insufficientEvidence: z.boolean(),
  reason: z.string().nullable(),
  claims: z.array(
    z.object({
      text: z.string(),
      category: z.enum([
        'why_matters',
        'why_now',
        'trigger',
        'business_init',
        'tech_init',
        'problem',
        'value',
      ]),
      status: z.enum(['FACT', 'HYPOTHESIS', 'UNKNOWN']),
      evidenceIds: z.array(z.string()),
      reasoning: z.string(),
    })
  ),
});

type ThesisResponse = z.infer<typeof ThesisSchema>;

export default async (req: Request, context: Context): Promise<Response> => {
  const accountId = context.params.accountId;

  try {
    if (!accountId) return error(400, 'Missing account id.');
    if (req.method !== 'POST') return error(405, 'Use POST to generate a thesis.');

    const loaded = await readAggregate(accountId);
    if (!loaded) return error(404, 'Account not found.');

    const apiKey = Netlify.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return error(500, 'ANTHROPIC_API_KEY is not set. Add it in Netlify environment variables.');
    }

    if (loaded.aggregate.evidence.length === 0) {
      return error(400, 'No evidence to analyse. Record evidence first — a thesis without evidence is a guess.');
    }

    const generated = await callClaude(apiKey, loaded.aggregate.evidence, loaded.aggregate.claims);

    if (generated.insufficientEvidence) {
      return jsonWithRev(
        {
          insufficientEvidence: true,
          reason: generated.reason ?? 'The evidence does not support a thesis yet.',
          claimsAdded: 0,
        },
        loaded.aggregate.rev
      );
    }

    // Validate and convert the model's claims into domain claims.
    const newClaims: Claim[] = [];
    const downgrades: string[] = [];
    const now = new Date().toISOString();
    const evidenceById = new Map(loaded.aggregate.evidence.map((e) => [e.id, e]));

    for (const proposed of generated.claims) {
      // Only keep evidence IDs that actually exist.
      const validEvidenceIds = proposed.evidenceIds.filter((id) => evidenceById.has(id));

      const claim: Claim = {
        id: newId(),
        text: proposed.text,
        status: proposed.status,
        category: proposed.category as ClaimCategory,
        evidenceIds: validEvidenceIds,
        asOf: now,
        createdAt: now,
      };

      // The server has the final word. If the model says FACT but the
      // invariant doesn't hold, downgrade — don't discard, but don't lie.
      const invariantError = claimInvariantError(claim, loaded.aggregate.evidence);
      if (invariantError) {
        if (claim.status === 'FACT') {
          claim.status = validEvidenceIds.length > 0 ? 'HYPOTHESIS' : 'UNKNOWN';
          downgrades.push(`"${claim.text}" was downgraded from FACT to ${claim.status}.`);
        }
        // An UNKNOWN citing evidence is invalid; strip the citations.
        if (claim.status === 'UNKNOWN') {
          claim.evidenceIds = [];
        }
      }

      newClaims.push(claim);
    }

    const outcome = await mutateAggregate(accountId, expectedRev(req), (aggregate) => {
      // Replace existing claims with the generated ones.
      const oldClaimIds = new Set(aggregate.claims.map((c) => c.id));
      aggregate.claims = newClaims;

      // Clean up action references to removed claims.
      for (const action of aggregate.actions) {
        action.resolvesClaimIds = action.resolvesClaimIds.filter((id) => !oldClaimIds.has(id));
      }

      appendEvent(
        aggregate,
        newEvent(
          'thesis_regenerated',
          `Thesis regenerated: ${newClaims.length} claims${downgrades.length > 0 ? `, ${downgrades.length} downgraded` : ''}.`,
          { entityRef: `account:${accountId}` }
        )
      );

      return { claimsAdded: newClaims.length, downgrades };
    });

    if (!outcome) return error(404, 'Account not found.');

    return mutationResult(outcome.aggregate, undefined);
  } catch (err) {
    return toResponse(err);
  }
};

async function callClaude(
  apiKey: string,
  evidence: EvidenceItem[],
  existingClaims: Claim[]
): Promise<ThesisResponse> {
  const anthropic = new Anthropic({ apiKey });

  const evidenceBlock = evidence
    .map((e) => {
      const label = e.sourceType === 'inference' ? ' [INFERENCE — cannot support a FACT]' : '';
      const conf = e.confidential ? ' [CONFIDENTIAL]' : '';
      return `[${e.id}] (${e.sourceType})${label}${conf}\n${e.verbatim}`;
    })
    .join('\n\n');

  const existingBlock =
    existingClaims.length > 0
      ? existingClaims
          .map((c) => `- ${c.status}: "${c.text}" (${c.category})`)
          .join('\n')
      : '(none yet)';

  const system = `You are a strategic account analyst for an enterprise sales team.
Your job is to read the evidence and produce an account thesis: a set of claims about why this account matters, what is happening, and what is unknown.

Rules — these are enforced in code and you cannot override them:
1. A FACT must cite at least one piece of evidence that is NOT an inference. Inference evidence is marked [INFERENCE] and cannot support a FACT.
2. A HYPOTHESIS is a reasoned guess. It may cite evidence (including inference) or cite nothing.
3. An UNKNOWN is an explicit gap. It must NOT cite any evidence — if you have evidence, it is at least a HYPOTHESIS.
4. If the evidence is too thin to support any thesis, return insufficientEvidence: true with a reason. Do not confabulate.
5. Every evidenceId you cite must be one of the IDs provided below.

Categories: ${CLAIM_CATEGORIES.join(', ')}

Be honest. The point is not to sound confident but to be accurate about what is known and what is not.`;

  const user = `Evidence:
${evidenceBlock}

Existing claims:
${existingBlock}

Analyse this evidence and produce a thesis. For each claim:
- text: a single clear assertion
- category: one of ${CLAIM_CATEGORIES.join(', ')}
- status: FACT, HYPOTHESIS, or UNKNOWN
- evidenceIds: the evidence IDs that support this claim (empty for UNKNOWN)
- reasoning: one sentence on why you chose this status

If the evidence is insufficient to say anything meaningful, set insufficientEvidence to true and explain why.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250514',
    max_tokens: 2000,
    system,
    messages: [{ role: 'user', content: user }],
    tools: [
      {
        name: 'submit_thesis',
        description: 'Submit the thesis analysis with claims and evidence citations.',
        input_schema: THESIS_JSON_SCHEMA,
      } as Anthropic.Tool,
    ],
    tool_choice: { type: 'tool', name: 'submit_thesis' },
  });

  const toolUse = response.content.find((b) => b.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new BadRequestError('The model did not return a valid thesis. Try again.');
  }

  return toolUse.input as ThesisResponse;
}

/** JSON Schema for OpenAI structured outputs — matches ThesisSchema. */
const THESIS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    insufficientEvidence: { type: 'boolean' },
    reason: { type: ['string', 'null'] },
    claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          category: {
            type: 'string',
            enum: ['why_matters', 'why_now', 'trigger', 'business_init', 'tech_init', 'problem', 'value'],
          },
          status: { type: 'string', enum: ['FACT', 'HYPOTHESIS', 'UNKNOWN'] },
          evidenceIds: { type: 'array', items: { type: 'string' } },
          reasoning: { type: 'string' },
        },
        required: ['text', 'category', 'status', 'evidenceIds', 'reasoning'],
        additionalProperties: false,
      },
    },
  },
  required: ['insufficientEvidence', 'reason', 'claims'],
  additionalProperties: false,
};
