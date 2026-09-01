import { describe, expect, it } from 'vitest';
import { nextBestAction, nextBestActions, type NbaTier } from './nba';
import {
  emptyAggregate,
  inferDealStage,
  type AccountAggregate,
  type Action,
  type Claim,
  type ChampionSignal,
  type EvidenceItem,
  type Stakeholder,
  type Wedge,
} from './types';

const NOW = new Date('2026-06-01T00:00:00.000Z');

function account(overrides: Partial<AccountAggregate> = {}): AccountAggregate {
  return {
    ...emptyAggregate({
      id: 'a1',
      companyName: 'Northwind Logistics',
      createdAt: '2026-05-01',
      updatedAt: '2026-05-01',
    }),
    ...overrides,
  };
}

function evidence(id: string, asOf = '2026-05-20'): EvidenceItem {
  return {
    id,
    sourceType: 'news',
    sourceSystem: 'web_research',
    verbatim: `verbatim ${id}`,
    capturedAt: asOf,
    asOf,
    confidential: false,
  };
}

function claim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: 'c1',
    text: 'They run 1,200 engineers across 4,000 repos',
    status: 'FACT',
    category: 'engineering_scale',
    evidenceIds: ['e1'],
    asOf: '2026-05-20',
    createdAt: '2026-05-20',
    ...overrides,
  };
}

function person(overrides: Partial<Stakeholder> = {}): Stakeholder {
  return {
    id: 's1',
    name: 'Priya Raman',
    role: 'VP Platform Engineering',
    emails: [],
    mapRoles: [],
    priorities: [],
    influence: 4,
    relationshipStrength: 3,
    posture: 'neutral',
    whatToLearn: [],
    createdAt: '2026-05-01',
    ...overrides,
  };
}

function wedge(overrides: Partial<Wedge> = {}): Wedge {
  return {
    id: 'w1',
    useCase: 'Java 8 to 17 migration across payment services',
    devinUseCase: 'migration',
    businessProblem: 'Vendor support ends this year',
    technicalProblem: '180 services still on Java 8',
    whyDevin: 'Parallel sessions can grind through repo after repo',
    likelyOwnerRole: 'Platform lead',
    sponsorRole: 'VP Engineering',
    evidenceIds: ['e1'],
    discoveryQuestion: 'Which services are blocking the upgrade?',
    disqualifiers: [],
    proofPoints: [],
    status: 'candidate',
    createdAt: '2026-05-01',
    ...overrides,
  };
}

function action(overrides: Partial<Action> = {}): Action {
  return {
    id: 'act1',
    objective: 'Scope the pilot repo',
    channel: 'call',
    messageOrAction: 'Walk through the migration backlog',
    whyThisPersonNow: 'They own the toolchain',
    desiredOutcome: 'Agreed pilot scope',
    horizon: 'this_week',
    status: 'open',
    resolvesClaimIds: [],
    createdAt: '2026-05-20',
    ...overrides,
  };
}

/** Signals covering `count` types, each citing evidence that exists. */
function signalsFor(stakeholderId: string, types: ChampionSignal['signalType'][]) {
  return types.map((signalType, i) => ({
    id: `sig-${stakeholderId}-${i}`,
    stakeholderId,
    signalType,
    observed: true,
    evidenceId: 'e1',
  }));
}

function tierOf(candidates: ReturnType<typeof nextBestActions>, key: string): NbaTier | undefined {
  return candidates.find((c) => c.key === key)?.tier;
}

describe('deal stage inference', () => {
  it('is discovery with no claims', () => {
    expect(inferDealStage(account())).toBe('discovery');
  });

  it('is evaluation once claims exist', () => {
    expect(inferDealStage(account({ claims: [claim()] }))).toBe('evaluation');
  });

  it('is negotiation once a wedge is validated', () => {
    expect(
      inferDealStage(
        account({ claims: [claim()], wedges: [wedge({ status: 'validated' })] })
      )
    ).toBe('negotiation');
  });
});

describe('nextBestAction', () => {
  it('tells an empty account to do research first, and nothing else', () => {
    const candidates = nextBestActions(account(), NOW);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].key).toBe('no_evidence');
    expect(candidates[0].tier).toBe('Critical');
  });

  it('asks for a thesis when there is evidence but no claims', () => {
    const top = nextBestAction(account({ evidence: [evidence('e1')] }), NOW);
    expect(top?.key).toBe('no_thesis');
  });

  it('ranks Critical above High', () => {
    const candidates = nextBestActions(
      account({
        evidence: [evidence('e1')],
        claims: [claim({ id: 'c9', status: 'UNKNOWN', evidenceIds: [] })],
      }),
      NOW
    );
    const scores = candidates.map((c) => c.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(candidates[0].tier).toBe('Critical');
  });
});

describe('stage-dependent priority', () => {
  const base = {
    evidence: [evidence('e1')],
    stakeholders: [person()],
  };

  it('treats a missing economic buyer as Low in discovery and Critical in negotiation', () => {
    const discovery = nextBestActions(account(base), NOW);
    expect(tierOf(discovery, 'no_economic_buyer')).toBe('Low');

    const evaluation = nextBestActions(account({ ...base, claims: [claim()] }), NOW);
    expect(tierOf(evaluation, 'no_economic_buyer')).toBe('High');

    const negotiation = nextBestActions(
      account({ ...base, claims: [claim()], wedges: [wedge({ status: 'validated' })] }),
      NOW
    );
    expect(tierOf(negotiation, 'no_economic_buyer')).toBe('Critical');
  });

  it('escalates the champion test from High in discovery to Critical later', () => {
    const withChampion = {
      ...base,
      stakeholders: [person({ mapRoles: ['champion'] })],
    };
    expect(tierOf(nextBestActions(account(withChampion), NOW), 'champion_test')).toBe('High');
    expect(
      tierOf(nextBestActions(account({ ...withChampion, claims: [claim()] }), NOW), 'champion_test')
    ).toBe('Critical');
  });

  it('escalates stale-claim revalidation from Medium in evaluation to High in negotiation', () => {
    const stale = {
      evidence: [evidence('e1', '2026-01-01')],
      claims: [claim({ asOf: '2026-01-01' })],
      stakeholders: [person()],
    };
    expect(tierOf(nextBestActions(account(stale), NOW), 'stale_claims')).toBe('Medium');
    expect(
      tierOf(
        nextBestActions(account({ ...stale, wedges: [wedge({ status: 'validated' })] }), NOW),
        'stale_claims'
      )
    ).toBe('High');
  });

  it('escalates the security contact gap to Critical only in negotiation', () => {
    expect(tierOf(nextBestActions(account(base), NOW), 'no_security_contact')).toBe('Low');
    expect(
      tierOf(
        nextBestActions(
          account({ ...base, claims: [claim()], wedges: [wedge({ status: 'validated' })] }),
          NOW
        ),
        'no_security_contact'
      )
    ).toBe('Critical');
  });
});

describe('individual rules', () => {
  it('flags unknowns only while nothing is booked to resolve them', () => {
    const unknown = claim({ id: 'c9', status: 'UNKNOWN', evidenceIds: [] });
    const withUnknown = account({ evidence: [evidence('e1')], claims: [unknown] });
    expect(tierOf(nextBestActions(withUnknown, NOW), 'unresolved_unknowns')).toBe('High');

    const booked = account({
      ...withUnknown,
      actions: [action({ resolvesClaimIds: ['c9'] })],
    });
    expect(tierOf(nextBestActions(booked, NOW), 'unresolved_unknowns')).toBeUndefined();
  });

  it('names the cheapest next champion test in the suggestion', () => {
    const state = account({
      evidence: [evidence('e1')],
      stakeholders: [person({ mapRoles: ['champion'] })],
      signals: signalsFor('s1', ['explains_politics', 'shares_nonpublic_info']),
    });
    const candidate = nextBestActions(state, NOW).find((c) => c.key === 'champion_test');
    expect(candidate?.why).toMatch(/Coach with 2 of 8/);
    expect(candidate?.suggestedAction).toMatch(/shape the use case|Proving/);
  });

  it('stops asking for a champion once one is validated', () => {
    const state = account({
      evidence: [evidence('e1')],
      stakeholders: [person({ mapRoles: ['champion'] })],
      signals: signalsFor('s1', [
        'explains_politics',
        'shapes_use_case',
        'advocates_when_absent',
        'has_personal_motivation',
      ]),
    });
    expect(tierOf(nextBestActions(state, NOW), 'champion_test')).toBeUndefined();
  });

  it('asks for a wedge when every wedge is disqualified', () => {
    const state = account({
      evidence: [evidence('e1')],
      claims: [claim()],
      wedges: [wedge({ status: 'disqualified', disqualifiedReason: 'No budget' })],
    });
    expect(tierOf(nextBestActions(state, NOW), 'no_wedge')).toBe('High');
  });

  it('flags overdue actions', () => {
    const state = account({
      evidence: [evidence('e1')],
      claims: [claim()],
      actions: [action({ dueAt: '2026-05-15' })],
    });
    const candidate = nextBestActions(state, NOW).find((c) => c.key === 'overdue_actions');
    expect(candidate?.tier).toBe('High');
    expect(candidate?.why).toMatch(/2026-05-15/);
  });

  it('pushes for proof of the right to win while it is unproven', () => {
    const state = account({
      evidence: [evidence('e1')],
      claims: [
        claim({ id: 'c2', category: 'right_to_win', status: 'HYPOTHESIS', evidenceIds: ['e1'] }),
      ],
    });
    expect(tierOf(nextBestActions(state, NOW), 'right_to_win_unproven')).toBe('High');
  });
});
