/**
 * Tests for the champion tier computation.
 *
 * The tier is a pure function of signals and evidence. If these pass, the
 * tier cannot be inflated by self-reported enthusiasm — a signal counts only
 * when observed AND citing evidence that still exists.
 */

import { describe, expect, it } from 'vitest';
import {
  championTier,
  evidencedSignalTypes,
  nextChampionTest,
  postureConflict,
} from './champion';
import type {
  ChampionSignal,
  ChampionSignalType,
  EvidenceItem,
} from './types';

function makeEvidence(id: string, overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    id,
    sourceType: 'conversation',
    sourceSystem: 'manual',
    verbatim: 'They did the thing.',
    capturedAt: '2026-01-01T00:00:00Z',
    asOf: '2026-01-01T00:00:00Z',
    confidential: false,
    ...overrides,
  };
}

function makeSignal(
  type: ChampionSignalType,
  opts: { observed?: boolean; evidenceId?: string; stakeholderId?: string } = {}
): ChampionSignal {
  return {
    id: `sig-${type}`,
    stakeholderId: opts.stakeholderId ?? 'st-1',
    signalType: type,
    observed: opts.observed ?? true,
    // Use 'ev-1' by default, but respect an explicit undefined.
    evidenceId: 'evidenceId' in opts ? opts.evidenceId : 'ev-1',
    observedAt: '2026-01-01T00:00:00Z',
  };
}

const ALL_EVIDENCE = [makeEvidence('ev-1')];

describe('evidencedSignalTypes', () => {
  it('counts observed signals with live evidence', () => {
    const signals = [makeSignal('explains_politics')];
    const seen = evidencedSignalTypes(signals, ALL_EVIDENCE);
    expect(seen.has('explains_politics')).toBe(true);
  });

  it('ignores unobserved signals', () => {
    const signals = [makeSignal('explains_politics', { observed: false })];
    const seen = evidencedSignalTypes(signals, ALL_EVIDENCE);
    expect(seen.size).toBe(0);
  });

  it('ignores signals citing deleted evidence', () => {
    const signals = [makeSignal('explains_politics', { evidenceId: 'gone' })];
    const seen = evidencedSignalTypes(signals, ALL_EVIDENCE);
    expect(seen.size).toBe(0);
  });

  it('ignores signals with no evidenceId', () => {
    const signals = [makeSignal('explains_politics', { evidenceId: undefined })];
    const seen = evidencedSignalTypes(signals, ALL_EVIDENCE);
    expect(seen.size).toBe(0);
  });
});

describe('championTier', () => {
  it('returns Contact with no signals', () => {
    expect(championTier([], ALL_EVIDENCE)).toBe('Contact');
  });

  it('returns Coach with one trust signal', () => {
    const signals = [makeSignal('explains_politics')];
    expect(championTier(signals, ALL_EVIDENCE)).toBe('Coach');
  });

  it('returns Coach with shares_nonpublic_info', () => {
    const signals = [makeSignal('shares_nonpublic_info')];
    expect(championTier(signals, ALL_EVIDENCE)).toBe('Coach');
  });

  it('returns Potential Champion with 3+ signals including a lateral intro', () => {
    const signals = [
      makeSignal('explains_politics'),
      makeSignal('shares_nonpublic_info'),
      makeSignal('introduces_sideways'),
    ];
    expect(championTier(signals, ALL_EVIDENCE)).toBe('Potential Champion');
  });

  it('returns Potential Champion with 3+ signals including upward access', () => {
    const signals = [
      makeSignal('explains_politics'),
      makeSignal('shares_nonpublic_info'),
      makeSignal('gives_access_to_dm'),
    ];
    expect(championTier(signals, ALL_EVIDENCE)).toBe('Potential Champion');
  });

  it('does not promote to Potential Champion without access-granting signal', () => {
    const signals = [
      makeSignal('explains_politics'),
      makeSignal('shares_nonpublic_info'),
      makeSignal('shapes_use_case'),
    ];
    expect(championTier(signals, ALL_EVIDENCE)).toBe('Coach');
  });

  it('returns Validated Champion with all required signals and 5+', () => {
    const signals = [
      makeSignal('advocates_when_absent'),
      makeSignal('has_personal_motivation'),
      makeSignal('introduces_upward'),
      makeSignal('explains_politics'),
      makeSignal('shares_nonpublic_info'),
    ];
    expect(championTier(signals, ALL_EVIDENCE)).toBe('Validated Champion');
  });

  it('does not reach Validated Champion without advocates_when_absent', () => {
    const signals = [
      makeSignal('has_personal_motivation'),
      makeSignal('introduces_upward'),
      makeSignal('explains_politics'),
      makeSignal('shares_nonpublic_info'),
      makeSignal('shapes_use_case'),
    ];
    expect(championTier(signals, ALL_EVIDENCE)).toBe('Potential Champion');
  });
});

describe('nextChampionTest', () => {
  it('returns the cheapest untested signal', () => {
    const signals = [makeSignal('shares_nonpublic_info')];
    const test = nextChampionTest(signals, ALL_EVIDENCE);
    expect(test?.signalType).toBe('explains_politics');
  });

  it('returns null when all 8 are evidenced', () => {
    const allTypes: ChampionSignalType[] = [
      'shares_nonpublic_info',
      'explains_politics',
      'shapes_use_case',
      'introduces_sideways',
      'introduces_upward',
      'gives_access_to_dm',
      'has_personal_motivation',
      'advocates_when_absent',
    ];
    const signals = allTypes.map((t) => makeSignal(t));
    const test = nextChampionTest(signals, ALL_EVIDENCE);
    expect(test).toBeNull();
  });
});

describe('postureConflict', () => {
  it('flags champion posture with non-validated tier', () => {
    expect(postureConflict('champion', 'Coach')).toContain('champion');
    expect(postureConflict('champion', 'Coach')).toContain('Coach');
  });

  it('does not flag champion posture with validated tier', () => {
    expect(postureConflict('champion', 'Validated Champion')).toBeNull();
  });

  it('flags coach posture with no evidenced signals', () => {
    expect(postureConflict('coach', 'Contact')).toContain('coach');
  });

  it('does not flag coach posture with Coach tier', () => {
    expect(postureConflict('coach', 'Coach')).toBeNull();
  });

  it('flags detractor posture with validated champion tier', () => {
    expect(postureConflict('detractor', 'Validated Champion')).toContain('contradict');
  });
});
