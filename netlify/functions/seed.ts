/**
 * Account seeder — strategic qualification research.
 *
 * When a new account is created, this endpoint researches the company name
 * using Claude's built-in web search tool. Claude researches 4 strategic
 * criteria — Engineering Scale, Factory Use-Case Fit, Urgency/Trigger, and
 * Right to Win — and produces structured seed data that answers:
 *
 *   "Is this account worth one of my limited strategic account slots,
 *    and what should I validate next?"
 *
 * Output:
 * - whyItMatters: a 2-3 sentence narrative explaining why this account matters
 * - 12-14 evidence items with strategic analysis and status (FACT/HYPOTHESIS/UNKNOWN)
 * - 4 rating claims (HYPOTHESIS) — one per criterion
 * - 1 thesis claim (HYPOTHESIS) — "This account is attractive because..."
 * - 3-5 UNKNOWN claims — "what must be validated before this becomes Tier 1"
 * - 5 stakeholders with buyer roles mapped
 * - 3-4 wedges based on Factory Fit research
 *
 * The UNKNOWN claims drive the NBA — they become the next actions.
 */

import type { Config, Context } from '@netlify/functions';
import Anthropic from '@anthropic-ai/sdk';
import { appendEvent, mutateAggregate, newEvent, newId, readAggregate } from '../lib/store';
import { error, expectedRev, jsonWithRev, mutationResult, toResponse } from '../lib/http';
import {
  type EvidenceItem,
  type Claim,
  type ClaimCategory,
  type ClaimStatus,
  type Stakeholder,
  type Wedge,
  type SourceType,
  type EvidenceCategory,
  type BuyerRole,
  BUYER_ROLES,
} from '../../src/domain/types';

export const config: Config = {
  path: ['/api/accounts/:accountId/seed'],
};

const SEED_JSON_SCHEMA = {
  type: 'object',
  properties: {
    whyItMatters: { type: 'string' },
    evidence: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          evidenceCategory: { type: 'string', enum: ['engineering_scale', 'factory_fit', 'urgency', 'right_to_win'] },
          signalType: { type: 'string' },
          verbatim: { type: 'string' },
          sourceType: { type: 'string', enum: ['news', 'transcript', 'job_posting', 'document', 'other'] },
          sourceRef: { type: 'string' },
          externalUrl: { type: 'string' },
          asOf: { type: 'string' },
          status: { type: 'string', enum: ['FACT', 'HYPOTHESIS', 'UNKNOWN'] },
          whyItMatters: { type: 'string' },
          implicationForFactory: { type: 'string' },
          nextDiscoveryQuestion: { type: 'string' },
        },
        required: ['evidenceCategory', 'signalType', 'verbatim', 'sourceType', 'sourceRef', 'asOf', 'status', 'whyItMatters', 'implicationForFactory', 'nextDiscoveryQuestion'],
        additionalProperties: false,
      },
    },
    claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          category: { type: 'string', enum: ['engineering_scale', 'factory_fit', 'urgency', 'right_to_win', 'why_matters', 'why_now', 'trigger', 'business_init', 'tech_init', 'problem', 'value'] },
          status: { type: 'string', enum: ['FACT', 'HYPOTHESIS', 'UNKNOWN'] },
          evidenceIndices: { type: 'array', items: { type: 'integer' } },
        },
        required: ['text', 'category', 'status', 'evidenceIndices'],
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
  required: ['whyItMatters', 'evidence', 'claims', 'stakeholders', 'wedges'],
  additionalProperties: false,
};

interface SeedData {
  whyItMatters: string;
  evidence: Array<{
    evidenceCategory: string;
    signalType: string;
    verbatim: string;
    sourceType: string;
    sourceRef: string;
    externalUrl?: string;
    asOf: string;
    status: string;
    whyItMatters: string;
    implicationForFactory: string;
    nextDiscoveryQuestion: string;
  }>;
  claims: Array<{
    text: string;
    category: string;
    status: string;
    evidenceIndices: number[];
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
      const evidenceIds: string[] = [];

      // Create evidence items.
      for (const ev of seedData.evidence) {
        const id = newId();
        evidenceIds.push(id);
        const item: EvidenceItem = {
          id,
          sourceType: ev.sourceType as SourceType,
          sourceSystem: 'manual',
          sourceRef: ev.sourceRef,
          externalUrl: ev.externalUrl,
          verbatim: ev.verbatim,
          asOf: ev.asOf,
          capturedAt: now,
          confidential: false,
          evidenceCategory: ev.evidenceCategory as EvidenceCategory,
          signalType: ev.signalType,
          status: ev.status as ClaimStatus,
          whyItMatters: ev.whyItMatters,
          implicationForFactory: ev.implicationForFactory,
          nextDiscoveryQuestion: ev.nextDiscoveryQuestion,
        };
        aggregate.evidence.push(item);
      }

      // Store the narrative.
      aggregate.whyItMatters = seedData.whyItMatters;

      // Create claims (ratings + thesis + unknowns).
      for (const c of seedData.claims) {
        const claim: Claim = {
          id: newId(),
          text: c.text,
          status: c.status as Claim['status'],
          category: c.category as ClaimCategory,
          evidenceIds: c.evidenceIndices
            .filter((i) => i >= 0 && i < evidenceIds.length)
            .map((i) => evidenceIds[i]),
          asOf: now,
          createdAt: now,
        };
        aggregate.claims.push(claim);
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
          `Account seeded: ${seedData.evidence.length} evidence, ${seedData.claims.length} claims, ${seedData.stakeholders.length} stakeholders, ${seedData.wedges.length} wedges (strategic qualification research).`,
          { entityRef: `account:${accountId}` }
        )
      );

      return {
        evidenceAdded: seedData.evidence.length,
        claimsAdded: seedData.claims.length,
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

  const system = `You are a strategic account qualification analyst for Factory, an AI coding agent platform. Your job is to research a company and determine whether it deserves one of a limited number of strategic account slots.

You have access to a web search tool. USE IT extensively to find real, current information. Search for the company across 4 strategic criteria:

## 1. Engineering Scale (2-3 evidence items)
Determine whether the account has enough engineering surface area for Factory to become a large strategic deployment.
Search for:
- Software engineer / developer headcount
- Total technology organisation size
- Application / service / repository estate
- Legacy platforms or large brownfield systems
- Technology / transformation spend
- Geographic or BU complexity
- Outsourced engineering / GSI footprint
- Importance of software to the company's core business

## 2. Factory Use-Case Fit (3-4 evidence items)
Identify whether the account has engineering workloads that are a strong fit for Factory.
Search for:
- Legacy modernisation programmes
- Cloud / application migration
- Framework or runtime upgrades
- Application rationalisation
- Testing / test automation
- Security remediation
- Developer productivity / engineering effectiveness
- Platform engineering
- Documentation / code understanding
- Incident / SRE workflows

## 3. Urgency / Trigger (2-3 evidence items)
Identify why the account may act now rather than later. Prefer evidence from the last 6-18 months.
Search for:
- New CTO / CIO / AI leader appointment
- AI or engineering transformation programme
- Migration / modernisation deadline
- Cost reduction programme
- App decommissioning target
- Cloud transformation initiative
- New developer tooling strategy
- Hiring around AI engineering / DevEx / platform
- Strategic partner announcement
- Productivity target

## 4. Right to Win (2-4 evidence items)
Determine whether Factory has a credible route to create and win the opportunity.
Search for:
- Existing relationships or warm introductions
- Relevant vertical expertise or customer references
- Incumbent GSIs, cloud partners, consultancies
- Competitive position (greenfield, complementary, entrenched incumbent)
- Prior opportunity history

IMPORTANT RULE: Right to Win cannot be rated High based on public web evidence alone. A High rating requires at least one validated internal or access signal. From web research alone, cap Right to Win at Medium.

## Output requirements

whyItMatters: A 2-3 sentence narrative explaining why this account matters to Factory, tying the 4 categories together. Be specific and honest — if the account is weak in a category, say so.

For each evidence item:
- evidenceCategory: which of the 4 criteria it belongs to
- signalType: the specific signal (e.g. "software_engineer_headcount", "legacy_modernisation", "new_cto_appointment")
- verbatim: a real quote or factual summary from search results (not made up)
- sourceType: news, transcript, job_posting, document, or other
- sourceRef: the domain or publication name
- externalUrl: the article URL if available
- asOf: ISO date (YYYY-MM-DD)
- status: FACT (confirmed by filing/earnings call or corroborated), HYPOTHESIS (single-source news/job posting), or UNKNOWN (uncertain)
- whyItMatters: why this evidence matters for account prioritisation
- implicationForFactory: what this means for Factory specifically
- nextDiscoveryQuestion: the next question to ask to validate or deepen this finding

For claims, produce:
- 4 rating claims (HYPOTHESIS): "Engineering Scale: [Low/Medium/High/Very High]", "Factory Fit: [Low/Medium/High/Very High]", "Urgency: [Low/Medium/High/Very High]", "Right to Win: [Low/Medium/High/Very High]" — each citing the evidence indices that support it
- 1 thesis claim (HYPOTHESIS): "This account is attractive because..." — citing the strongest evidence
- 3-5 UNKNOWN claims: "What must be validated before this becomes a Tier 1 account" — each an explicit gap, citing no evidence

For stakeholders (5 people):
- Use realistic role titles (e.g. "CTO", "Head of Engineering") — not real names unless you found them
- mapRoles: which buyer roles they map to: ${BUYER_ROLES.join(', ')}
- priorities: 2-3 things they likely care about
- posture: unknown (we haven't met them yet)

For wedges (3-4):
- Based on the Factory Fit research — real engineering workloads where Factory could help
- whyFactory: how Factory's AI coding agent platform specifically helps
- disqualifiers: reasons this wedge might not be viable

Do not optimise for volume. Prefer evidence that changes account prioritisation.`;

  const user = `Research "${companyName}" and produce a strategic qualification assessment. Search the web for engineering scale, Factory use-case fit, urgency/triggers, and right to win. Return a whyItMatters narrative, 12-14 evidence items (each with a status of FACT/HYPOTHESIS/UNKNOWN), 8-10 claims (4 ratings + 1 thesis + 3-5 unknowns), 5 stakeholders, and 3-4 wedges.`;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 12000,
    system,
    messages: [{ role: 'user', content: user }],
    tools: [
      {
        type: 'web_search_20250305',
        name: 'web_search',
      },
      {
        name: 'submit_seed',
        description: 'Submit the strategic qualification seed data: evidence, claims, stakeholders, and wedges.',
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
