import { describe, expect, it } from 'vitest';
import {
  citationCount,
  claimInvariantError,
  clampStatus,
  demotionsIfRemoved,
  highestSupportedStatus,
  isStale,
  reconcileClaims,
  staleClaims,
} from './claims';
import type { Claim, ClaimStatus, EvidenceItem, SourceType } from './types';

const NOW = new Date('2026-06-01T00:00:00.000Z');

function evidence(
  id: string,
  sourceType: SourceType = 'news',
  asOf = '2026-05-01'
): EvidenceItem {
  return {
    id,
    sourceType,
    sourceSystem: 'manual',
    verbatim: `verbatim ${id}`,
    capturedAt: asOf,
    asOf,
    confidential: false,
  };
}

function claim(
  id: string,
  status: ClaimStatus,
  evidenceIds: string[],
  overrides: Partial<Claim> = {}
): Claim {
  return {
    id,
    text: `claim ${id}`,
    status,
    category: 'devin_fit',
    evidenceIds,
    asOf: '2026-05-01',
    createdAt: '2026-05-01',
    ...overrides,
  };
}

describe('claimInvariantError', () => {
  it('accepts a FACT citing a verifiable source', () => {
    expect(
      claimInvariantError(claim('c1', 'FACT', ['e1']), [evidence('e1')])
    ).toBeNull();
  });

  it('rejects a FACT with no citations', () => {
    expect(claimInvariantError(claim('c1', 'FACT', []), [])).toMatch(
      /must cite at least one/
    );
  });

  it('rejects a FACT supported only by inference', () => {
    expect(
      claimInvariantError(claim('c1', 'FACT', ['e1']), [
        evidence('e1', 'inference'),
      ])
    ).toMatch(/Inference alone/);
  });

  it('accepts a FACT when one of several citations is verifiable', () => {
    expect(
      claimInvariantError(claim('c1', 'FACT', ['e1', 'e2']), [
        evidence('e1', 'inference'),
        evidence('e2', 'earnings_call'),
      ])
    ).toBeNull();
  });

  it('rejects any claim citing evidence that does not exist', () => {
    expect(
      claimInvariantError(claim('c1', 'HYPOTHESIS', ['ghost']), [evidence('e1')])
    ).toMatch(/does not exist/);
  });

  it('accepts a HYPOTHESIS with no citations', () => {
    expect(claimInvariantError(claim('c1', 'HYPOTHESIS', []), [])).toBeNull();
  });

  it('accepts a HYPOTHESIS supported only by inference', () => {
    expect(
      claimInvariantError(claim('c1', 'HYPOTHESIS', ['e1']), [
        evidence('e1', 'inference'),
      ])
    ).toBeNull();
  });

  it('rejects an UNKNOWN that cites evidence', () => {
    expect(
      claimInvariantError(claim('c1', 'UNKNOWN', ['e1']), [evidence('e1')])
    ).toMatch(/cannot cite evidence/);
  });

  it('accepts an UNKNOWN with no citations', () => {
    expect(claimInvariantError(claim('c1', 'UNKNOWN', []), [])).toBeNull();
  });
});

describe('highestSupportedStatus', () => {
  it('is FACT with a verifiable citation', () => {
    expect(highestSupportedStatus(['e1'], [evidence('e1')])).toBe('FACT');
  });

  it('is HYPOTHESIS with only inference', () => {
    expect(
      highestSupportedStatus(['e1'], [evidence('e1', 'inference')])
    ).toBe('HYPOTHESIS');
  });

  it('is UNKNOWN with nothing cited', () => {
    expect(highestSupportedStatus([], [evidence('e1')])).toBe('UNKNOWN');
  });
});

describe('clampStatus', () => {
  it('leaves a supported FACT alone', () => {
    expect(clampStatus('FACT', ['e1'], [evidence('e1')])).toBe('FACT');
  });

  it('downgrades an unsupported FACT to HYPOTHESIS', () => {
    expect(
      clampStatus('FACT', ['e1'], [evidence('e1', 'inference')])
    ).toBe('HYPOTHESIS');
  });

  it('downgrades an uncited FACT all the way to UNKNOWN', () => {
    expect(clampStatus('FACT', [], [])).toBe('UNKNOWN');
  });

  it('upgrades an UNKNOWN that cites evidence to HYPOTHESIS', () => {
    expect(clampStatus('UNKNOWN', ['e1'], [evidence('e1')])).toBe('HYPOTHESIS');
  });
});

describe('reconcileClaims', () => {
  it('demotes a FACT that lost its only citation', () => {
    const claims = [claim('c1', 'FACT', ['e1'])];
    const demotions = reconcileClaims(claims, []);

    expect(demotions).toHaveLength(1);
    expect(demotions[0]).toMatchObject({ claimId: 'c1', from: 'FACT', to: 'HYPOTHESIS' });
    expect(claims[0].status).toBe('HYPOTHESIS');
    expect(claims[0].evidenceIds).toEqual([]);
  });

  it('keeps a FACT that still has another verifiable citation', () => {
    const claims = [claim('c1', 'FACT', ['e1', 'e2'])];
    const demotions = reconcileClaims(claims, [evidence('e2')]);

    expect(demotions).toEqual([]);
    expect(claims[0].status).toBe('FACT');
    expect(claims[0].evidenceIds).toEqual(['e2']);
  });

  it('demotes a FACT left with only inference', () => {
    const claims = [claim('c1', 'FACT', ['e1', 'e2'])];
    reconcileClaims(claims, [evidence('e2', 'inference')]);

    expect(claims[0].status).toBe('HYPOTHESIS');
  });

  it('leaves a HYPOTHESIS that lost all citations as a HYPOTHESIS', () => {
    const claims = [claim('c1', 'HYPOTHESIS', ['e1'])];
    const demotions = reconcileClaims(claims, []);

    expect(demotions).toEqual([]);
    expect(claims[0].status).toBe('HYPOTHESIS');
    expect(claims[0].evidenceIds).toEqual([]);
  });
});

describe('citation impact', () => {
  it('counts citing claims', () => {
    const claims = [claim('c1', 'FACT', ['e1']), claim('c2', 'HYPOTHESIS', ['e1', 'e2'])];
    expect(citationCount('e1', claims)).toBe(2);
    expect(citationCount('e2', claims)).toBe(1);
  });

  it('previews only the claims that would actually be demoted', () => {
    const ev = [evidence('e1'), evidence('e2')];
    const claims = [
      claim('c1', 'FACT', ['e1']),
      claim('c2', 'FACT', ['e1', 'e2']),
      claim('c3', 'HYPOTHESIS', ['e1']),
    ];

    expect(demotionsIfRemoved('e1', claims, ev).map((c) => c.id)).toEqual(['c1']);
  });
});

describe('staleness', () => {
  it('flags a claim whose evidence is older than 90 days', () => {
    const old = evidence('e1', 'news', '2026-01-01');
    const c = claim('c1', 'FACT', ['e1'], { asOf: '2026-01-01' });
    expect(isStale(c, [old], NOW)).toBe(true);
  });

  it('does not flag a recently reviewed claim', () => {
    const old = evidence('e1', 'news', '2026-01-01');
    const c = claim('c1', 'FACT', ['e1'], { asOf: '2026-01-01', reviewedAt: '2026-05-20' });
    expect(isStale(c, [old], NOW)).toBe(false);
  });

  it('does not flag a claim resting on fresh evidence', () => {
    const c = claim('c1', 'FACT', ['e1'], { asOf: '2026-01-01' });
    expect(isStale(c, [evidence('e1', 'news', '2026-05-20')], NOW)).toBe(false);
  });

  it('never flags an UNKNOWN, which is stale by definition', () => {
    const c = claim('c1', 'UNKNOWN', [], { asOf: '2020-01-01' });
    expect(isStale(c, [], NOW)).toBe(false);
  });

  it('flags an old claim with no evidence left to date it', () => {
    const c = claim('c1', 'HYPOTHESIS', [], { asOf: '2020-01-01' });
    expect(isStale(c, [], NOW)).toBe(true);
  });

  it('collects every stale claim', () => {
    const ev = [evidence('e1', 'news', '2026-01-01'), evidence('e2', 'news', '2026-05-25')];
    const claims = [
      claim('c1', 'FACT', ['e1'], { asOf: '2026-01-01' }),
      claim('c2', 'FACT', ['e2'], { asOf: '2026-05-25' }),
    ];
    expect(staleClaims(claims, ev, NOW).map((c) => c.id)).toEqual(['c1']);
  });
});
