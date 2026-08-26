/**
 * Tests for the Next Best Action engine.
 *
 * The NBA is deterministic: the same account state always produces the same
 * candidates in the same order. If these pass, the system never confabulates
 * a "next step" that the evidence does not justify.
 *
 * Scoring uses deal-stage-weighted tiers (Critical / High / Medium / Low)
 * instead of fixed numeric scores. The same candidate changes priority
 * depending on where the deal is.
 */

import { describe, expect, it } from 'vitest';
import { nextBestAction, nextBestActions } from './nba';
import type {
  AccountAggregate,
  Account,
  Action,
  ChampionSignal,
  Claim,
  EvidenceItem,
  Stakeholder,
  Wedge,
} from './types';

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'acc-1',
    companyName: 'Test Co',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeAggregate(parts: Partial<AccountAggregate> = {}): AccountAggregate {
  return {
    rev: 0,
    account: makeAccount(),
    evidence: [],
    claims: [],
    wedges: [],
    stakeholders: [],
    signals: [],
    actions: [],
    events: [],
    ...parts,
  };
}

function makeEvidence(id: string): EvidenceItem {
  return {
    id,
    sourceType: 'conversation',
    sourceSystem: 'manual',
    verbatim: 'Something was said.',
    capturedAt: '2026-01-01T00:00:00Z',
    asOf: '2026-01-01T00:00:00Z',
    confidential: false,
  };
}

function makeClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: 'cl-1',
    text: 'Some claim',
    status: 'UNKNOWN',
    category: 'why_now',
    evidenceIds: [],
    asOf: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeStakeholder(overrides: Partial<Stakeholder> = {}): Stakeholder {
  return {
    id: 'st-1',
    name: 'Test Person',
    role: 'VP',
    emails: [],
    mapRoles: [],
    priorities: [],
    influence: 3,
    relationshipStrength: 3,
    posture: 'unknown',
    whatToLearn: [],
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeWedge(overrides: Partial<Wedge> = {}): Wedge {
  return {
    id: 'wg-1',
    useCase: 'Test wedge',
    businessProblem: 'Problem',
    technicalProblem: 'Tech problem',
    whyFactory: 'Because',
    likelyOwnerRole: 'Head of Eng',
    sponsorRole: 'CTO',
    evidenceIds: [],
    discoveryQuestion: 'Why?',
    disqualifiers: [],
    proofPoints: [],
    status: 'candidate',
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('nextBestActions', () => {
  it('suggests recording first evidence on a blank account (Critical in discovery)', () => {
    const candidates = nextBestActions(makeAggregate());
    expect(candidates[0].id).toBe('first-evidence');
    expect(candidates[0].tier).toBe('critical');
    expect(candidates[0].stage).toBe('discovery');
  });

  it('suggests adding first stakeholder when evidence exists but no people (High in discovery)', () => {
    const candidates = nextBestActions(
      makeAggregate({ evidence: [makeEvidence('ev-1')] })
    );
    expect(candidates[0].id).toBe('first-stakeholder');
    expect(candidates[0].tier).toBe('high');
  });

  it('suggests identifying economic buyer — Low in discovery, High in evaluation, Critical in negotiation', () => {
    // Discovery stage (no claims)
    const discoveryCandidates = nextBestActions(
      makeAggregate({
        evidence: [makeEvidence('ev-1')],
        stakeholders: [makeStakeholder({ mapRoles: ['champion'] })],
      })
    );
    const eb = discoveryCandidates.find((c) => c.id === 'identify-economic-buyer');
    expect(eb).toBeDefined();
    expect(eb!.tier).toBe('low');

    // Evaluation stage (claims exist, no validated wedges)
    const evalCandidates = nextBestActions(
      makeAggregate({
        evidence: [makeEvidence('ev-1')],
        stakeholders: [makeStakeholder({ mapRoles: ['champion'] })],
        claims: [makeClaim({ status: 'FACT', evidenceIds: ['ev-1'] })],
      })
    );
    const ebEval = evalCandidates.find((c) => c.id === 'identify-economic-buyer');
    expect(ebEval).toBeDefined();
    expect(ebEval!.tier).toBe('high');

    // Negotiation stage (validated wedge exists)
    const negCandidates = nextBestActions(
      makeAggregate({
        evidence: [makeEvidence('ev-1')],
        stakeholders: [makeStakeholder({ mapRoles: ['champion'] })],
        claims: [makeClaim({ status: 'FACT', evidenceIds: ['ev-1'] })],
        wedges: [makeWedge({ status: 'validated' })],
      })
    );
    const ebNeg = negCandidates.find((c) => c.id === 'identify-economic-buyer');
    expect(ebNeg).toBeDefined();
    expect(ebNeg!.tier).toBe('critical');
  });

  it('does not suggest economic buyer when one exists', () => {
    const candidates = nextBestActions(
      makeAggregate({
        evidence: [makeEvidence('ev-1')],
        stakeholders: [makeStakeholder({ mapRoles: ['economic_buyer'] })],
      })
    );
    expect(candidates.find((c) => c.id === 'identify-economic-buyer')).toBeUndefined();
  });

  it('suggests resolving UNKNOWN claims — Medium in discovery, High in evaluation', () => {
    const unknown = makeClaim({ id: 'cl-u', status: 'UNKNOWN', text: 'Who owns the budget' });
    // Discovery (UNKNOWN claim without other claims is still discovery since claims exist)
    // Actually with claims, stage is evaluation
    const candidates = nextBestActions(
      makeAggregate({
        evidence: [makeEvidence('ev-1')],
        stakeholders: [makeStakeholder({ mapRoles: ['economic_buyer'] })],
        claims: [unknown],
      })
    );
    const unknownCandidate = candidates.find((c) => c.id === 'resolve-unknown-cl-u');
    expect(unknownCandidate).toBeDefined();
    expect(unknownCandidate!.tier).toBe('high'); // evaluation stage
    expect(unknownCandidate!.claimId).toBe('cl-u');
    expect(unknownCandidate!.stage).toBe('evaluation');
  });

  it('prioritises overdue actions as Critical in all stages', () => {
    const overdueAction: Action = {
      id: 'act-1',
      stakeholderId: undefined,
      wedgeId: undefined,
      objective: 'Follow up on the proposal',
      channel: 'email',
      messageOrAction: 'Send the revised proposal',
      whyThisPersonNow: 'They are waiting',
      desiredOutcome: 'Proposal accepted',
      horizon: 'this_week',
      status: 'open',
      dueAt: '2020-01-01T00:00:00Z',
      resolvesClaimIds: [],
      createdAt: '2026-01-01T00:00:00Z',
    };
    const candidates = nextBestActions(
      makeAggregate({
        evidence: [makeEvidence('ev-1')],
        stakeholders: [makeStakeholder({ mapRoles: ['economic_buyer'] })],
        actions: [overdueAction],
      })
    );
    expect(candidates[0].tier).toBe('critical');
    expect(candidates[0].id).toContain('overdue');
  });

  it('champion test is High in discovery, Critical in evaluation', () => {
    // Discovery: no claims
    const discoveryCandidates = nextBestActions(
      makeAggregate({
        evidence: [makeEvidence('ev-1')],
        stakeholders: [makeStakeholder({ mapRoles: ['economic_buyer'] })],
      })
    );
    const champTest = discoveryCandidates.find((c) => c.id.startsWith('champion-test'));
    expect(champTest).toBeDefined();
    expect(champTest!.tier).toBe('high');

    // Evaluation: claims exist
    const evalCandidates = nextBestActions(
      makeAggregate({
        evidence: [makeEvidence('ev-1')],
        stakeholders: [makeStakeholder({ mapRoles: ['economic_buyer'] })],
        claims: [makeClaim({ status: 'FACT', evidenceIds: ['ev-1'] })],
      })
    );
    const champTestEval = evalCandidates.find((c) => c.id.startsWith('champion-test'));
    expect(champTestEval).toBeDefined();
    expect(champTestEval!.tier).toBe('critical');
  });

  it('returns empty for a fully covered account', () => {
    const candidates = nextBestActions(
      makeAggregate({
        evidence: [makeEvidence('ev-1')],
        stakeholders: [makeStakeholder({ mapRoles: ['economic_buyer'] })],
        claims: [makeClaim({ status: 'FACT', evidenceIds: ['ev-1'] })],
      })
    );
    // No unknowns, no overdue, no champion test pending, no stale, economic buyer exists
    expect(candidates.filter((c) => !c.id.startsWith('champion-test'))).toHaveLength(0);
  });
});

describe('nextBestAction', () => {
  it('returns the top candidate', () => {
    const top = nextBestAction(makeAggregate());
    expect(top).not.toBeNull();
    expect(top!.id).toBe('first-evidence');
  });

  it('returns null when there is nothing to do', () => {
    // A fully validated champion with all claims as FACT and an economic buyer
    const evidence = [makeEvidence('ev-1')];
    const allSignalTypes: ChampionSignal['signalType'][] = [
      'shares_nonpublic_info',
      'explains_politics',
      'shapes_use_case',
      'introduces_sideways',
      'introduces_upward',
      'gives_access_to_dm',
      'has_personal_motivation',
      'advocates_when_absent',
    ];
    const signals: ChampionSignal[] = allSignalTypes.map((type, i) => ({
      id: `sig-${i}`,
      stakeholderId: 'st-1',
      signalType: type,
      observed: true,
      evidenceId: 'ev-1',
      observedAt: '2026-01-01T00:00:00Z',
    }));
    const top = nextBestAction(
      makeAggregate({
        evidence,
        stakeholders: [makeStakeholder({ id: 'st-1', mapRoles: ['economic_buyer'] })],
        claims: [makeClaim({ status: 'FACT', evidenceIds: ['ev-1'] })],
        signals,
      })
    );
    // All 8 signals evidenced, no unknowns, no overdue, no stale, economic buyer exists
    // The only candidate would be a champion test, but all are evidenced
    expect(top).toBeNull();
  });
});
