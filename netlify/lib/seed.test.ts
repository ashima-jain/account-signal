import { describe, expect, it } from 'vitest';
import { applySeed, type SeedResult } from '../functions/seed-background';
import { emptyAggregate, type AccountAggregate } from '../../src/domain/types';

function aggregate(): AccountAggregate {
  return emptyAggregate({
    id: 'a1',
    companyName: 'Acme',
    createdAt: '2026-05-20',
    updatedAt: '2026-05-20',
  });
}

function result(overrides: Partial<SeedResult>): SeedResult {
  return {
    whyItMatters: 'Large engineering org mid-migration.',
    evidence: [],
    claims: [],
    stakeholders: [],
    wedges: [],
    ...overrides,
  };
}

describe('applySeed', () => {
  it('drops evidence the model returned with nothing quoted', () => {
    const account = aggregate();

    applySeed(
      account,
      result({
        evidence: [
          {
            category: 'engineering_scale',
            verbatim: '  ',
            sourceType: 'engineering_blog',
            externalUrl: 'https://example.com/a',
            status: 'FACT',
          },
          {
            category: 'engineering_scale',
            verbatim: 'They run 1,200 engineers.',
            sourceType: 'engineering_blog',
            externalUrl: 'https://example.com/b',
            status: 'FACT',
          },
        ],
      })
    );

    expect(account.evidence).toHaveLength(1);
    expect(account.evidence[0].verbatim).toBe('They run 1,200 engineers.');
  });

  it('keeps positional citations pointing at the item the model meant', () => {
    const account = aggregate();

    applySeed(
      account,
      result({
        evidence: [
          {
            category: 'engineering_scale',
            sourceType: 'inference',
            status: 'HYPOTHESIS',
          },
          {
            category: 'engineering_scale',
            verbatim: 'They run 1,200 engineers.',
            sourceType: 'engineering_blog',
            externalUrl: 'https://example.com/b',
            status: 'FACT',
          },
        ],
        claims: [
          {
            text: 'Cites the dropped item',
            category: 'engineering_scale',
            status: 'HYPOTHESIS',
            evidenceRefs: [0],
          },
          {
            text: 'Cites the surviving item',
            category: 'engineering_scale',
            status: 'FACT',
            evidenceRefs: [1],
          },
        ],
      })
    );

    expect(account.claims[0].evidenceIds).toEqual([]);
    expect(account.claims[1].evidenceIds).toEqual([account.evidence[0].id]);
    expect(account.claims[1].status).toBe('FACT');
  });
});
