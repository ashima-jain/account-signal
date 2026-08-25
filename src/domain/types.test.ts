/**
 * Tests for the FACT invariant — the core trust rule.
 *
 * If these pass, nothing reaches storage labelled FACT without a citation
 * that resolves to real evidence. If they fail, the product is laundering
 * guesses into facts.
 */

import { describe, expect, it } from 'vitest';
import {
  canSupportFact,
  claimInvariantError,
  reconcileClaims,
  supportedStatus,
} from './claims';
import type { Claim, EvidenceItem } from './types';

function makeEvidence(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    id: 'ev-1',
    sourceType: 'earnings_call',
    sourceSystem: 'manual',
    verbatim: 'We are consolidating tooling.',
    capturedAt: '2026-01-01T00:00:00Z',
    asOf: '2026-01-01T00:00:00Z',
    confidential: false,
    ...overrides,
  };
}

function makeClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: 'cl-1',
    text: 'They are consolidating tooling',
    status: 'FACT',
    category: 'trigger',
    evidenceIds: [],
    asOf: '2026-01-01T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('canSupportFact', () => {
  it('allows real sources', () => {
    expect(canSupportFact(makeEvidence({ sourceType: 'earnings_call' }))).toBe(true);
    expect(canSupportFact(makeEvidence({ sourceType: 'conversation' }))).toBe(true);
    expect(canSupportFact(makeEvidence({ sourceType: 'news' }))).toBe(true);
  });

  it('rejects inference', () => {
    expect(canSupportFact(makeEvidence({ sourceType: 'inference' }))).toBe(false);
  });
});

describe('claimInvariantError', () => {
  it('rejects a FACT with no evidence', () => {
    const claim = makeClaim({ status: 'FACT', evidenceIds: [] });
    expect(claimInvariantError(claim, [])).toContain('A FACT must cite');
  });

  it('rejects a FACT citing only inference', () => {
    const inference = makeEvidence({ id: 'inf-1', sourceType: 'inference' });
    const claim = makeClaim({ status: 'FACT', evidenceIds: ['inf-1'] });
    expect(claimInvariantError(claim, [inference])).toContain('cannot rest only on inference');
  });

  it('accepts a FACT citing real evidence', () => {
    const evidence = makeEvidence({ id: 'ev-1' });
    const claim = makeClaim({ status: 'FACT', evidenceIds: ['ev-1'] });
    expect(claimInvariantError(claim, [evidence])).toBeNull();
  });

  it('rejects an UNKNOWN that cites evidence', () => {
    const evidence = makeEvidence({ id: 'ev-1' });
    const claim = makeClaim({ status: 'UNKNOWN', evidenceIds: ['ev-1'] });
    expect(claimInvariantError(claim, [evidence])).toContain('UNKNOWN cannot cite');
  });

  it('accepts an UNKNOWN with no evidence', () => {
    const claim = makeClaim({ status: 'UNKNOWN', evidenceIds: [] });
    expect(claimInvariantError(claim, [])).toBeNull();
  });

  it('accepts a HYPOTHESIS with no evidence', () => {
    const claim = makeClaim({ status: 'HYPOTHESIS', evidenceIds: [] });
    expect(claimInvariantError(claim, [])).toBeNull();
  });

  it('accepts a HYPOTHESIS citing inference', () => {
    const inference = makeEvidence({ id: 'inf-1', sourceType: 'inference' });
    const claim = makeClaim({ status: 'HYPOTHESIS', evidenceIds: ['inf-1'] });
    expect(claimInvariantError(claim, [inference])).toBeNull();
  });

  it('rejects a claim citing nonexistent evidence', () => {
    const claim = makeClaim({ status: 'FACT', evidenceIds: ['ghost'] });
    expect(claimInvariantError(claim, [])).toContain('does not exist');
  });

  it('rejects empty claim text', () => {
    const claim = makeClaim({ text: '  ' });
    expect(claimInvariantError(claim, [])).toContain('cannot be empty');
  });
});

describe('supportedStatus', () => {
  it('returns UNKNOWN when no evidence is cited', () => {
    const claim = makeClaim({ evidenceIds: [] });
    expect(supportedStatus(claim, [])).toBe('UNKNOWN');
  });

  it('returns HYPOTHESIS when only inference is cited', () => {
    const inference = makeEvidence({ id: 'inf-1', sourceType: 'inference' });
    const claim = makeClaim({ evidenceIds: ['inf-1'] });
    expect(supportedStatus(claim, [inference])).toBe('HYPOTHESIS');
  });

  it('returns FACT when real evidence is cited', () => {
    const evidence = makeEvidence({ id: 'ev-1' });
    const claim = makeClaim({ evidenceIds: ['ev-1'] });
    expect(supportedStatus(claim, [evidence])).toBe('FACT');
  });
});

describe('reconcileClaims', () => {
  it('demotes a FACT to UNKNOWN when its evidence is removed', () => {
    const claim = makeClaim({ status: 'FACT', evidenceIds: ['ev-1'] });
    const demotions = reconcileClaims([claim], []);
    expect(demotions).toHaveLength(1);
    expect(demotions[0].from).toBe('FACT');
    expect(demotions[0].to).toBe('UNKNOWN');
    expect(claim.status).toBe('UNKNOWN');
    expect(claim.evidenceIds).toEqual([]);
  });

  it('demotes a FACT to HYPOTHESIS when only inference remains', () => {
    const inference = makeEvidence({ id: 'inf-1', sourceType: 'inference' });
    const claim = makeClaim({ status: 'FACT', evidenceIds: ['ev-1', 'inf-1'] });
    const demotions = reconcileClaims([claim], [inference]);
    expect(demotions).toHaveLength(1);
    expect(demotions[0].to).toBe('HYPOTHESIS');
    expect(claim.status).toBe('HYPOTHESIS');
  });

  it('does not demote a HYPOTHESIS when evidence is removed', () => {
    const claim = makeClaim({ status: 'HYPOTHESIS', evidenceIds: ['ev-1'] });
    const demotions = reconcileClaims([claim], []);
    expect(demotions).toHaveLength(0);
    expect(claim.status).toBe('HYPOTHESIS');
  });

  it('does not demote a FACT that still has real evidence', () => {
    const evidence = makeEvidence({ id: 'ev-1' });
    const claim = makeClaim({ status: 'FACT', evidenceIds: ['ev-1'] });
    const demotions = reconcileClaims([claim], [evidence]);
    expect(demotions).toHaveLength(0);
    expect(claim.status).toBe('FACT');
  });

  it('strips dangling evidence references from all claims', () => {
    const claim = makeClaim({ status: 'HYPOTHESIS', evidenceIds: ['ghost', 'ev-1'] });
    const evidence = makeEvidence({ id: 'ev-1' });
    reconcileClaims([claim], [evidence]);
    expect(claim.evidenceIds).toEqual(['ev-1']);
  });
});
