/**
 * Account seeder.
 *
 * When a new account is created, this endpoint researches the company name
 * using Claude's built-in web search tool. Claude finds real articles,
 * announcements, and initiatives, then returns structured seed data:
 * 10 evidence items, 5 stakeholders, and 3 wedges.
 *
 * The evidence is real — pulled from web search results, not hallucinated.
 * Stakeholders and wedges are inferred from the evidence and the company's
 * likely organisational structure.
 */

import type { Config, Context } from '@netlify/functions';
import Anthropic from '@anthropic-ai/sdk';
import { appendEvent, mutateAggregate, newEvent, newId, readAggregate } from '../lib/store';
import { error, expectedRev, jsonWithRev, mutationResult, toResponse } from '../lib/http';
import {
  type EvidenceItem,
  type Stakeholder,
  type Wedge,
  type SourceType,
  type BuyerRole,
  BUYER_ROLES,
} from '../../src/domain/types';

export const config: Config = {
  path: ['/api/accounts/:accountId/seed'],
};

const SEED_JSON_SCHEMA = {
  type: 'object',
  properties: {
    evidence: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          verbatim: { type: 'string' },
          sourceType: { type: 'string', enum: ['news', 'transcript', 'job_posting', 'document', 'other'] },
          sourceRef: { type: 'string' },
          externalUrl: { type: 'string' },
          asOf: { type: 'string' },
        },
        required: ['verbatim', 'sourceType', 'sourceRef', 'asOf'],
        additionalProperties: false,
      },
    },
    stakeholders: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          role: { type: 'string' },
          businessUnit: { type: 'string' },
          mapRoles: { type: 'array', items: { type: 'string' } },
          priorities: { type: 'array', items: { type: 'string' } },
          relevance: { type: 'string' },
          posture: { type: 'string', enum: ['unknown', 'detractor', 'neutral', 'supporter', 'coach', 'champion'] },
        },
        required: ['name', 'role', 'mapRoles', 'priorities'],
        additionalProperties: false,
      },
    },
    wedges: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          useCase: { type: 'string' },
          businessProblem: { type: 'string' },
          technicalProblem: { type: 'string' },
          whyFactory: { type: 'string' },
          likelyOwnerRole: { type: 'string' },
          sponsorRole: { type: 'string' },
          discoveryQuestion: { type: 'string' },
          disqualifiers: { type: 'array', items: { type: 'string' } },
        },
        required: ['useCase', 'businessProblem', 'technicalProblem', 'whyFactory', 'likelyOwnerRole', 'sponsorRole', 'discoveryQuestion', 'disqualifiers'],
        additionalProperties: false,
      },
    },
  },
  required: ['evidence', 'stakeholders', 'wedges'],
  additionalProperties: false,
};

interface SeedData {
  evidence: Array<{
    verbatim: string;
    sourceType: string;
    sourceRef: string;
    externalUrl?: string;
    asOf: string;
  }>;
  stakeholders: Array<{
    name: string;
    role: string;
    businessUnit?: string;
    mapRoles: string[];
    priorities: string[];
    relevance?: string;
    posture?: string;
  }>;
  wedges: Array<{
    useCase: string;
    businessProblem: string;
    technicalProblem: string;
    whyFactory: string;
    likelyOwnerRole: string;
    sponsorRole: string;
    discoveryQuestion: string;
    disqualifiers: string[];
  }>;
}

export default async (req: Request, context: Context): Promise<Response> => {
  const accountId = context.params.accountId;

  try {
    if (!accountId) return error(400, 'Missing account id.');
    if (req.method !== 'POST') return error(405, 'Use POST to seed an account.');

    const loaded = await readAggregate(accountId);
    if (!loaded) return error(404, 'Account not found.');

    // Don't re-seed if already has evidence.
    if (loaded.aggregate.evidence.length > 0) {
      return jsonWithRev(
        { skipped: true, reason: 'Account already has evidence. Seeding is only for empty accounts.' },
        loaded.aggregate.rev
      );
    }

    const apiKey = Netlify.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return error(500, 'ANTHROPIC_API_KEY is not set. Add it in Netlify environment variables.');
    }

    const companyName = loaded.aggregate.account.companyName;

    const seedData = await researchCompany(apiKey, companyName);

    const outcome = await mutateAggregate(accountId, expectedRev(req), (aggregate) => {
      const now = new Date().toISOString();

      // Create evidence items.
      for (const ev of seedData.evidence) {
        const item: EvidenceItem = {
          id: newId(),
          sourceType: ev.sourceType as SourceType,
          sourceSystem: 'manual',
          sourceRef: ev.sourceRef,
          externalUrl: ev.externalUrl,
          verbatim: ev.verbatim,
          asOf: ev.asOf,
          capturedAt: now,
          confidential: false,
        };
        aggregate.evidence.push(item);
      }

      // Create stakeholders.
      for (const s of seedData.stakeholders) {
        const stakeholder: Stakeholder = {
          id: newId(),
          name: s.name,
          role: s.role,
          businessUnit: s.businessUnit,
          emails: [],
          mapRoles: s.mapRoles.filter((r) => BUYER_ROLES.includes(r as BuyerRole)) as BuyerRole[],
          priorities: s.priorities,
          relevance: s.relevance,
          influence: 3,
          relationshipStrength: 3,
          posture: (s.posture as Stakeholder['posture']) || 'unknown',
          whatToLearn: [],
          createdAt: now,
        };
        aggregate.stakeholders.push(stakeholder);
      }

      // Create wedges.
      for (const w of seedData.wedges) {
        const wedge: Wedge = {
          id: newId(),
          useCase: w.useCase,
          businessProblem: w.businessProblem,
          technicalProblem: w.technicalProblem,
          whyFactory: w.whyFactory,
          likelyOwnerRole: w.likelyOwnerRole,
          sponsorRole: w.sponsorRole,
          evidenceIds: [],
          discoveryQuestion: w.discoveryQuestion,
          disqualifiers: w.disqualifiers,
          proofPoints: [],
          status: 'candidate',
          createdAt: now,
        };
        aggregate.wedges.push(wedge);
      }

      appendEvent(
        aggregate,
        newEvent(
          'account_updated',
          `Account seeded: ${seedData.evidence.length} evidence items, ${seedData.stakeholders.length} stakeholders, ${seedData.wedges.length} wedges (via web search).`,
          { entityRef: `account:${accountId}` }
        )
      );

      return {
        evidenceAdded: seedData.evidence.length,
        stakeholdersAdded: seedData.stakeholders.length,
        wedgesAdded: seedData.wedges.length,
      };
    });

    if (!outcome) return error(404, 'Account not found.');

    return mutationResult(outcome.aggregate, undefined);
  } catch (err) {
    return toResponse(err);
  }
};

async function researchCompany(apiKey: string, companyName: string): Promise<SeedData> {
  const anthropic = new Anthropic({ apiKey });

  const system = `You are a strategic account research assistant. Your job is to research a company and produce seed data for a sales account plan.

You have access to a web search tool. USE IT to find real, current information about the company. Search for:
1. The company's recent news, announcements, and technology initiatives
2. Their leadership team and organisational structure
3. Their technology stack, challenges, and investments
4. Their financial performance and strategic direction

Based on your research, produce:
- 10 evidence items: real verbatim quotes from articles/announcements, with source URLs and dates
- 5 stakeholders: likely decision-makers and influencers (use realistic role titles, not specific names unless you found them)
- 3 wedges: use cases where Factory (an AI coding agent platform) could solve their problems

For evidence:
- verbatim: a real quote or summary from a search result (not made up)
- sourceType: news, transcript, job_posting, document, or other
- sourceRef: the domain or publication name
- externalUrl: the article URL if available
- asOf: ISO date string (YYYY-MM-DD)

For stakeholders:
- name: use a realistic title-based name like "CTO" or "Head of Engineering" if you don't have a real name
- role: their job title
- mapRoles: which of these buyer roles they map to: ${BUYER_ROLES.join(', ')}
- priorities: 2-3 things they likely care about
- posture: unknown (we haven't met them yet)

For wedges:
- Focus on real problems the company is facing based on your research
- whyFactory: how Factory's AI coding agent platform could help
- disqualifiers: reasons this wedge might not be viable`;

  const user = `Research "${companyName}" and produce seed data for an account plan. Search the web for recent news, technology initiatives, leadership, and business challenges. Return 10 evidence items, 5 stakeholders, and 3 wedges.`;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 8000,
    system,
    messages: [{ role: 'user', content: user }],
    tools: [
      {
        type: 'web_search_20250305',
        name: 'web_search',
      },
      {
        name: 'submit_seed',
        description: 'Submit the seed data: evidence items, stakeholders, and wedges.',
        input_schema: SEED_JSON_SCHEMA,
      },
    ] as unknown as Anthropic.Tool[],
    tool_choice: { type: 'tool', name: 'submit_seed' },
  });

  const toolUse = response.content.find((b) => b.type === 'tool_use' && b.name === 'submit_seed');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('The model did not return seed data. Try again.');
  }

  return toolUse.input as SeedData;
}
