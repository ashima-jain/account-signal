import { describe, expect, it } from 'vitest';
import { applyThesis, type ThesisResult } from '../functions/thesis';
import {
  emptyAggregate,
  type AccountAggregate,
  type Action,
  type Claim,
  type EvidenceItem,
} from '../../src/domain/types';

function evidence(id: string): EvidenceItem {
  return {
    id,
    sourceType: 'engineering_blog',
    sourceSystem: 'web_research',
    externalUrl: 'https://example.com/post',
    verbatim: `verbatim ${id}`,
    capturedAt: '2026-05-20',
    asOf: '2026-05-20',
    confidential: false,
    status: 'FACT',
  };
}

function claim(overrides: Partial<Claim>): Claim {
  return {
    id: 'c1',
    text: 'They run 1,200 engineers',
    status: 'HYPOTHESIS',
    category: 'engineering_scale',
    evidenceIds: ['e1'],
    asOf: '2026-05-20',
    createdAt: '2026-05-20',
    ...overrides,
  };
}

function action(overrides: Partial<Action>): Action {
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

function aggregate(overrides: Partial<AccountAggregate> = {}): AccountAggregate {
  return {
    ...emptyAggregate({
      id: 'a1',
      companyName: 'Northwind Logistics',
      createdAt: '2026-05-01',
      updatedAt: '2026-05-01',
    }),
    evidence: [evidence('e1')],
    ...overrides,
  };
}

const result: ThesisResult = {
  whyItMatters: 'Large platform org with a migration they cannot staff.',
  claims: [
    {
      text: 'They run 1,400 engineers across 4,000 repos',
      category: 'engineering_scale',
      status: 'FACT',
      evidenceRefs: [0],
    },
  ],
};

describe('applyThesis', () => {
  it('replaces generated claims and leaves hand-written ones alone', () => {
    const account = aggregate({
      claims: [
        claim({ id: 'manual', text: 'CTO told me they froze hiring', generated: false }),
        claim({ id: 'gen', category: 'engineering_scale', generated: true }),
      ],
    });

    applyThesis(account, result);

    const texts = account.claims.map((c) => c.text);
    expect(texts).toContain('CTO told me they froze hiring');
    expect(texts).toContain('They run 1,400 engineers across 4,000 repos');
    expect(account.claims.some((c) => c.id === 'gen')).toBe(false);
    expect(account.claims.find((c) => c.generated)?.supersedesClaimId).toBe('gen');
  });

  it('moves actions onto the claim that replaced the one they resolved', () => {
    const account = aggregate({
      claims: [claim({ id: 'gen', generated: true })],
      actions: [action({ resolvesClaimIds: ['gen'] })],
    });

    applyThesis(account, result);

    const replacement = account.claims.find((c) => c.generated);
    expect(account.actions[0].resolvesClaimIds).toEqual([replacement?.id]);
  });

  it('drops references to claims that nothing replaced', () => {
    const account = aggregate({
      claims: [claim({ id: 'gen', category: 'urgency', generated: true })],
      actions: [action({ resolvesClaimIds: ['gen', 'never-existed'] })],
    });

    applyThesis(account, result);

    expect(account.actions[0].resolvesClaimIds).toEqual([]);
  });
});
