import type { Config, Context } from '@netlify/functions';
import type Anthropic from '@anthropic-ai/sdk';
import {
  aggregateResponse,
  errorResponse,
  expectedRevOf,
  handle,
  sanitizeHttpUrl,
} from '../lib/http';
import { appendEvent, mutateAggregate, newId, readAggregate } from '../lib/store';
import { structuredCall } from '../lib/claude';
import { clampStatus } from '../../src/domain/claims';
import {
  DEVIN_USE_CASES,
  EVIDENCE_CATEGORIES,
  SOURCE_TYPES,
  isVerifiableSource,
  type AccountAggregate,
  type Claim,
  type ClaimCategory,
  type ClaimStatus,
  type DevinUseCase,
  type EvidenceCategory,
  type EvidenceItem,
  type SourceType,
  seedIsStalled,
  type Stakeholder,
  type Wedge,
} from '../../src/domain/types';

const SYSTEM = `You are a research analyst supporting an enterprise account executive at Cognition, the company behind Devin.

Devin is an autonomous AI software engineer. It is given a ticket, a repo and a goal; it plans, writes code, runs tests, opens pull requests and iterates on CI feedback in its own cloud machine. Teams run many Devin sessions in parallel. It ships alongside Devin Search and Devin Wiki for codebase question answering and auto-generated documentation, code review on pull requests, and integrations with GitHub, GitLab, Jira, Linear and Slack. It is bought by engineering leadership, not by individual developers, and it is deployed against backlogs of well-specified work: framework and language migrations, large-scale refactors and codemods, test coverage backfill, dependency and CVE remediation, bug and ticket burn-down, flaky CI repair, and onboarding onto unfamiliar code.

It is not an IDE autocomplete tool. The competitive frame is "who does the queued-up engineering work nobody has headcount for", not "who writes the next line faster".

Research the named company and qualify it against four criteria:

1. ENGINEERING SCALE — engineer headcount, number of services and repositories, monorepo or polyrepo, languages in use, hiring pace, offshore or outsourced development spend. Devin's value scales with the volume of parallelisable engineering work, so size and sprawl matter more than revenue.
2. DEVIN USE-CASE FIT — concrete, bounded engineering work that an autonomous agent could own: end-of-life framework or language versions, cloud or database migrations, monolith decomposition, low test coverage, security or dependency backlogs, a large bug queue, slow onboarding onto legacy code.
3. URGENCY / TRIGGER — what makes this a this-quarter problem: an EOL or compliance deadline, a breach or incident, a cost or efficiency mandate, a hiring freeze combined with roadmap commitments, a public AI or agent mandate from the CEO or board, a new CTO or CIO, an acquisition to integrate.
4. RIGHT TO WIN — why Cognition specifically: an existing relationship, an executive who has spoken publicly about agentic engineering, tooling that Devin integrates with cleanly, a competitor already embedded, procurement or security posture.

Rules you must follow:
- Every piece of evidence must be something you actually found. Quote or tightly summarise it and give the URL you found it at.
- Do not invent people, headcounts, quotes, or dates. If you cannot verify a person's current role, do not list them.
- Anything you are reasoning to rather than reading should be recorded with sourceType "inference" and status HYPOTHESIS or UNKNOWN.
- Right to Win can never be rated FACT from public web research. First-party proof — a relationship, a pilot, an internal mandate — is the only thing that establishes it, and you do not have access to that.
- Write in plain, specific language. No sales adjectives.`;

const SEED_TOOL: Anthropic.Tool = {
  name: 'submit_seed',
  description:
    'Return the researched account plan. Every claim must reference evidence by index.',
  input_schema: {
    type: 'object',
    required: ['whyItMatters', 'evidence', 'claims', 'stakeholders', 'wedges'],
    properties: {
      whyItMatters: {
        type: 'string',
        description:
          'Two to three sentences: why this account is worth an AE\'s time, in terms of engineering scale and the work Devin would do. Name the specific trigger.',
      },
      evidence: {
        type: 'array',
        minItems: 10,
        maxItems: 14,
        description: 'Findings spread across all four criteria.',
        items: {
          type: 'object',
          required: ['category', 'verbatim', 'sourceType', 'status'],
          properties: {
            category: { type: 'string', enum: EVIDENCE_CATEGORIES },
            signalType: {
              type: 'string',
              description: 'Snake-case signal name, e.g. software_engineer_headcount.',
            },
            verbatim: {
              type: 'string',
              description: 'The quote or a tight factual summary of what the source says.',
            },
            sourceType: { type: 'string', enum: SOURCE_TYPES },
            sourceRef: { type: 'string', description: 'e.g. "FY26 Q3 earnings call".' },
            externalUrl: { type: 'string', description: 'Where you found it. Required for any FACT.' },
            asOf: { type: 'string', description: 'ISO date the fact was true, e.g. 2026-02-14.' },
            status: { type: 'string', enum: ['FACT', 'HYPOTHESIS', 'UNKNOWN'] },
            whyItMatters: { type: 'string' },
            implicationForDevin: {
              type: 'string',
              description: 'What this implies for a Devin deployment specifically.',
            },
            nextDiscoveryQuestion: { type: 'string' },
          },
        },
      },
      claims: {
        type: 'array',
        minItems: 8,
        maxItems: 10,
        description:
          'One rating claim per criterion (worded as a rating, e.g. "Engineering scale: VERY HIGH — ..."), one overall thesis claim, and three to five open unknowns.',
        items: {
          type: 'object',
          required: ['text', 'category', 'status'],
          properties: {
            text: { type: 'string' },
            category: {
              type: 'string',
              enum: [
                'engineering_scale',
                'devin_fit',
                'urgency',
                'right_to_win',
                'why_matters',
                'why_now',
                'trigger',
                'business_init',
                'tech_init',
                'problem',
                'value',
              ],
            },
            status: { type: 'string', enum: ['FACT', 'HYPOTHESIS', 'UNKNOWN'] },
            evidenceRefs: {
              type: 'array',
              items: { type: 'integer' },
              description: 'Indexes into the evidence array. UNKNOWN claims must be empty.',
            },
          },
        },
      },
      stakeholders: {
        type: 'array',
        maxItems: 6,
        description: 'Real, currently employed people found in public sources.',
        items: {
          type: 'object',
          required: ['name', 'role'],
          properties: {
            name: { type: 'string' },
            role: { type: 'string' },
            businessUnit: { type: 'string' },
            linkedinUrl: { type: 'string' },
            mapRoles: {
              type: 'array',
              items: {
                type: 'string',
                enum: [
                  'economic_buyer',
                  'executive_sponsor',
                  'champion',
                  'technical_decision_maker',
                  'evaluator',
                  'user',
                  'security_procurement',
                  'potential_detractor',
                ],
              },
            },
            priorities: { type: 'array', items: { type: 'string' } },
            relevance: { type: 'string', description: 'Why they matter to this deal.' },
            influence: { type: 'integer', minimum: 1, maximum: 5 },
            whatToLearn: { type: 'array', items: { type: 'string' } },
            accessPath: { type: 'string' },
          },
        },
      },
      wedges: {
        type: 'array',
        minItems: 3,
        maxItems: 4,
        description: 'Bounded first deployments a Devin pilot could own.',
        items: {
          type: 'object',
          required: ['useCase', 'devinUseCase', 'businessProblem', 'technicalProblem', 'whyDevin'],
          properties: {
            useCase: { type: 'string' },
            devinUseCase: { type: 'string', enum: DEVIN_USE_CASES },
            businessProblem: { type: 'string' },
            technicalProblem: { type: 'string' },
            whyDevin: {
              type: 'string',
              description:
                'Why an autonomous agent beats hiring, offshoring, or an in-IDE assistant for this specific work.',
            },
            likelyOwnerRole: { type: 'string' },
            sponsorRole: { type: 'string' },
            discoveryQuestion: { type: 'string' },
            disqualifiers: {
              type: 'array',
              items: { type: 'string' },
              description: 'What you would have to hear to kill this wedge.',
            },
            evidenceRefs: { type: 'array', items: { type: 'integer' } },
          },
        },
      },
    },
  },
};

interface SeedEvidence {
  category: EvidenceCategory;
  signalType?: string;
  verbatim: string;
  sourceType: SourceType;
  sourceRef?: string;
  externalUrl?: string;
  asOf?: string;
  status: ClaimStatus;
  whyItMatters?: string;
  implicationForDevin?: string;
  nextDiscoveryQuestion?: string;
}

interface SeedResult {
  whyItMatters: string;
  evidence: SeedEvidence[];
  claims: {
    text: string;
    category: ClaimCategory;
    status: ClaimStatus;
    evidenceRefs?: number[];
  }[];
  stakeholders: {
    name: string;
    role: string;
    businessUnit?: string;
    linkedinUrl?: string;
    mapRoles?: Stakeholder['mapRoles'];
    priorities?: string[];
    relevance?: string;
    influence?: number;
    whatToLearn?: string[];
    accessPath?: string;
  }[];
  wedges: {
    useCase: string;
    devinUseCase: DevinUseCase;
    businessProblem: string;
    technicalProblem: string;
    whyDevin: string;
    likelyOwnerRole?: string;
    sponsorRole?: string;
    discoveryQuestion?: string;
    disqualifiers?: string[];
    evidenceRefs?: number[];
  }[];
}

export default async (request: Request, context: Context): Promise<Response> =>
  handle(request, async () => {
    if (request.method !== 'POST') {
      return errorResponse('Use POST to seed an account.', 405);
    }

    const id = context.params.id;
    const loaded = await readAggregate(id);
    if (!loaded) return errorResponse('Account not found.', 404);

    // Seeding is only ever the first act on an account. Re-running it against
    // an account someone has curated would overwrite their judgment.
    if (loaded.aggregate.evidence.length > 0) {
      return errorResponse(
        'This account already has evidence. Seeding only runs on an empty account.',
        409
      );
    }
    if (loaded.aggregate.seedStatus === 'running' && !seedIsStalled(loaded.aggregate)) {
      return errorResponse('Research is already running on this account.', 409);
    }

    const { companyName, domain } = loaded.aggregate.account;

    // Research routinely outlives the invocation that started it. Recording
    // that it is running before calling Claude is what lets the client keep
    // polling instead of staring at an empty account.
    const running = await mutateAggregate(id, expectedRevOf(request), (aggregate) => {
      aggregate.seedStatus = 'running';
      aggregate.seedStartedAt = new Date().toISOString();
      aggregate.seedError = undefined;
    });
    if (!running) return errorResponse('Account not found.', 404);

    let result: SeedResult;
    try {
      result = await structuredCall<SeedResult>({
        system: SYSTEM,
        prompt: `Research ${companyName}${domain ? ` (${domain})` : ''} and fill in submit_seed. Search the web for their engineering organisation, technology stack, recent engineering blog posts, job postings, earnings commentary, incidents, and public statements from their engineering leadership. Today is ${new Date().toISOString().slice(0, 10)}.`,
        tool: SEED_TOOL,
        allowWebSearch: true,
        maxTokens: 12000,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Research failed.';
      await mutateAggregate(id, undefined, (aggregate) => {
        aggregate.seedStatus = 'failed';
        aggregate.seedError = message;
        appendEvent(aggregate, 'account_seeded', 'Research failed.', { reason: message });
      });
      throw error;
    }

    const updated = await mutateAggregate(id, running.rev, (aggregate) => {
      applySeed(aggregate, result);
    });

    if (!updated) return errorResponse('Account not found.', 404);
    return aggregateResponse(updated);
  });

function applySeed(aggregate: AccountAggregate, result: SeedResult): void {
  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  const evidence: EvidenceItem[] = (result.evidence ?? []).map((item) => {
    const externalUrl = sanitizeHttpUrl(item.externalUrl);
    return {
      id: newId(),
      sourceType: SOURCE_TYPES.includes(item.sourceType) ? item.sourceType : 'inference',
      sourceSystem: 'web_research',
      sourceRef: item.sourceRef,
      externalUrl,
      verbatim: item.verbatim,
      capturedAt: now,
      asOf: safeDate(item.asOf, today),
      confidential: false,
      evidenceCategory: EVIDENCE_CATEGORIES.includes(item.category)
        ? item.category
        : undefined,
      signalType: item.signalType,
      whyItMatters: item.whyItMatters,
      implicationForDevin: item.implicationForDevin,
      nextDiscoveryQuestion: item.nextDiscoveryQuestion,
      status: seedEvidenceStatus(item, externalUrl),
    };
  });

  const idOf = (ref: number): string | undefined => evidence[ref]?.id;
  const refsToIds = (refs: number[] | undefined): string[] =>
    (refs ?? []).map(idOf).filter((id): id is string => Boolean(id));

  const claims: Claim[] = (result.claims ?? []).map((claim) => {
    const evidenceIds = refsToIds(claim.evidenceRefs);
    let status = clampStatus(claim.status, evidenceIds, evidence);
    // Desk research cannot establish a right to win, however confident the
    // model sounds about it.
    if (claim.category === 'right_to_win' && status === 'FACT') status = 'HYPOTHESIS';

    return {
      id: newId(),
      text: claim.text,
      status,
      category: claim.category,
      evidenceIds: status === 'UNKNOWN' ? [] : evidenceIds,
      generated: true,
      asOf: today,
      createdAt: now,
    };
  });

  const stakeholders: Stakeholder[] = (result.stakeholders ?? []).map((person) => ({
    id: newId(),
    name: person.name,
    role: person.role,
    businessUnit: person.businessUnit,
    emails: [],
    linkedinUrl: sanitizeHttpUrl(person.linkedinUrl),
    mapRoles: person.mapRoles ?? [],
    priorities: person.priorities ?? [],
    relevance: person.relevance,
    influence: clampRating(person.influence, 3),
    // Nobody has spoken to these people yet, so the relationship is cold and
    // the posture is unknown, whatever the research implies.
    relationshipStrength: 1,
    posture: 'unknown',
    accessPath: person.accessPath,
    whatToLearn: person.whatToLearn ?? [],
    createdAt: now,
  }));

  const wedges: Wedge[] = (result.wedges ?? []).map((wedge) => ({
    id: newId(),
    useCase: wedge.useCase,
    devinUseCase: DEVIN_USE_CASES.includes(wedge.devinUseCase) ? wedge.devinUseCase : 'other',
    businessProblem: wedge.businessProblem,
    technicalProblem: wedge.technicalProblem,
    whyDevin: wedge.whyDevin,
    likelyOwnerRole: wedge.likelyOwnerRole ?? '',
    sponsorRole: wedge.sponsorRole ?? '',
    evidenceIds: refsToIds(wedge.evidenceRefs),
    discoveryQuestion: wedge.discoveryQuestion ?? '',
    disqualifiers: wedge.disqualifiers ?? [],
    proofPoints: [],
    status: 'candidate',
    createdAt: now,
  }));

  aggregate.evidence = evidence;
  aggregate.claims = claims;
  aggregate.stakeholders = stakeholders;
  aggregate.wedges = wedges;
  aggregate.whyItMatters = result.whyItMatters;
  aggregate.seedStatus = 'complete';
  aggregate.seedError = undefined;

  const demoted = (result.claims ?? []).filter(
    (c, i) => c.status === 'FACT' && claims[i]?.status !== 'FACT'
  ).length;

  appendEvent(
    aggregate,
    'account_seeded',
    `Research seeded ${evidence.length} pieces of evidence, ${claims.length} claims, ${stakeholders.length} stakeholders and ${wedges.length} wedges.`,
    {
      reason: demoted
        ? `${demoted} proposed FACT${demoted === 1 ? ' was' : 's were'} downgraded: the citation did not support it.`
        : undefined,
    }
  );
}

/** A web-researched FACT has to come with a link, or it is a hypothesis. */
function seedEvidenceStatus(item: SeedEvidence, externalUrl: string | undefined): ClaimStatus {
  if (item.status !== 'FACT') return item.status ?? 'HYPOTHESIS';
  if (!isVerifiableSource(item.sourceType)) return 'HYPOTHESIS';
  if (!externalUrl) return 'HYPOTHESIS';
  return 'FACT';
}

function safeDate(value: string | undefined, fallback: string): string {
  if (!value || Number.isNaN(Date.parse(value))) return fallback;
  return value;
}

function clampRating(value: number | undefined, fallback: 1 | 2 | 3 | 4 | 5) {
  if (!value || !Number.isInteger(value) || value < 1 || value > 5) return fallback;
  return value as 1 | 2 | 3 | 4 | 5;
}

/**
 * A background function: research takes minutes, far past the ceiling on a
 * synchronous invocation. The client gets 202 immediately and learns how the
 * run ended by polling the aggregate's seedStatus.
 */
export const config: Config = {
  path: '/api/accounts/:id/seed',
};
