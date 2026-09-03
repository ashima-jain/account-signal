import { describe, expect, it } from 'vitest';
import {
  assessChampion,
  cheapestNextTest,
  championTier,
  countsAsObserved,
  countValidatedChampions,
  evidencedSignalTypes,
  isChampionTrack,
} from './champion';
import type {
  ChampionSignal,
  ChampionSignalType,
  EvidenceItem,
  Stakeholder,
} from './types';

function evidence(id: string): EvidenceItem {
  return {
    id,
    sourceType: 'conversation',
    sourceSystem: 'manual',
    verbatim: `note ${id}`,
    capturedAt: '2026-05-01',
    asOf: '2026-05-01',
    confidential: false,
  };
}

/** Records the given signals as observed, each citing its own evidence item. */
function observed(types: ChampionSignalType[], stakeholderId = 's1') {
  const signals: ChampionSignal[] = types.map((signalType, i) => ({
    id: `sig${i}`,
    stakeholderId,
    signalType,
    observed: true,
    evidenceId: `e${i}`,
  }));
  const ev = types.map((_, i) => evidence(`e${i}`));
  return { signals, evidence: ev };
}

function stakeholder(overrides: Partial<Stakeholder> = {}): Stakeholder {
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

describe('countsAsObserved', () => {
  it('counts an observed signal citing evidence that exists', () => {
    const { signals, evidence: ev } = observed(['explains_politics']);
    expect(countsAsObserved(signals[0], ev)).toBe(true);
  });

  it('does not count an observed signal with no citation', () => {
    const signal: ChampionSignal = {
      id: 'sig',
      stakeholderId: 's1',
      signalType: 'explains_politics',
      observed: true,
    };
    expect(countsAsObserved(signal, [evidence('e0')])).toBe(false);
  });

  it('does not count a signal whose evidence was deleted', () => {
    const { signals } = observed(['explains_politics']);
    expect(countsAsObserved(signals[0], [])).toBe(false);
  });

  it('does not count a signal marked not observed', () => {
    const { signals, evidence: ev } = observed(['explains_politics']);
    expect(countsAsObserved({ ...signals[0], observed: false }, ev)).toBe(false);
  });
});

describe('evidencedSignalTypes', () => {
  it('deduplicates repeated signal types', () => {
    const { signals, evidence: ev } = observed([
      'explains_politics',
      'explains_politics',
    ]);
    expect(evidencedSignalTypes('s1', signals, ev)).toEqual(['explains_politics']);
  });

  it('ignores signals belonging to another stakeholder', () => {
    const { signals, evidence: ev } = observed(['explains_politics'], 's2');
    expect(evidencedSignalTypes('s1', signals, ev)).toEqual([]);
  });
});

describe('championTier', () => {
  it('is Contact with no signals', () => {
    expect(championTier('s1', [], [])).toBe('Contact');
  });

  it('is Contact with one signal', () => {
    const { signals, evidence: ev } = observed(['explains_politics']);
    expect(championTier('s1', signals, ev)).toBe('Contact');
  });

  it('is Coach with two signals', () => {
    const { signals, evidence: ev } = observed([
      'explains_politics',
      'shares_nonpublic_info',
    ]);
    expect(championTier('s1', signals, ev)).toBe('Coach');
  });

  it('is Potential Champion with four signals including access', () => {
    const { signals, evidence: ev } = observed([
      'explains_politics',
      'shares_nonpublic_info',
      'shapes_use_case',
      'introduces_upward',
    ]);
    expect(championTier('s1', signals, ev)).toBe('Potential Champion');
  });

  it('stays a Coach at four signals with no access-granting behaviour', () => {
    const { signals, evidence: ev } = observed([
      'explains_politics',
      'shares_nonpublic_info',
      'shapes_use_case',
      'has_personal_motivation',
    ]);
    expect(championTier('s1', signals, ev)).toBe('Coach');
  });

  it('is a Validated Champion with advocacy plus personal motivation', () => {
    const { signals, evidence: ev } = observed([
      'explains_politics',
      'shapes_use_case',
      'advocates_when_absent',
      'has_personal_motivation',
    ]);
    expect(championTier('s1', signals, ev)).toBe('Validated Champion');
  });

  it('needs four signals even with advocacy and motivation', () => {
    const { signals, evidence: ev } = observed([
      'advocates_when_absent',
      'has_personal_motivation',
    ]);
    expect(championTier('s1', signals, ev)).toBe('Coach');
  });

  it('drops a tier when the evidence behind a signal is deleted', () => {
    const { signals, evidence: ev } = observed([
      'explains_politics',
      'shapes_use_case',
      'advocates_when_absent',
      'has_personal_motivation',
    ]);
    const withoutOne = ev.filter((e) => e.id !== 'e0');
    expect(championTier('s1', signals, withoutOne)).toBe('Coach');
  });

  it('ignores uncited signals when computing the tier', () => {
    const { signals, evidence: ev } = observed(['explains_politics']);
    const uncited: ChampionSignal[] = [
      ...signals,
      { id: 'x1', stakeholderId: 's1', signalType: 'introduces_upward', observed: true },
      { id: 'x2', stakeholderId: 's1', signalType: 'gives_access_to_dm', observed: true },
      { id: 'x3', stakeholderId: 's1', signalType: 'advocates_when_absent', observed: true },
    ];
    expect(championTier('s1', uncited, ev)).toBe('Contact');
  });
});

describe('assessChampion', () => {
  it('reports uncited signals separately and says so in the rationale', () => {
    const { signals, evidence: ev } = observed(['explains_politics']);
    const assessment = assessChampion(
      's1',
      [
        ...signals,
        { id: 'x1', stakeholderId: 's1', signalType: 'introduces_upward', observed: true },
      ],
      ev
    );

    expect(assessment.count).toBe(1);
    expect(assessment.unevidencedSignals).toEqual(['introduces_upward']);
    expect(assessment.rationale).toMatch(/without a citation/);
  });

  it('exposes access and advocacy coverage', () => {
    const { signals, evidence: ev } = observed([
      'gives_access_to_dm',
      'advocates_when_absent',
      'has_personal_motivation',
      'shapes_use_case',
    ]);
    const assessment = assessChampion('s1', signals, ev);

    expect(assessment.hasAccess).toBe(true);
    expect(assessment.hasAdvocacy).toBe(true);
    expect(assessment.tier).toBe('Validated Champion');
  });
});

describe('cheapestNextTest', () => {
  it('suggests the cheapest untested signal from a standing start', () => {
    expect(cheapestNextTest([])?.signalType).toBe('explains_politics');
  });

  it('skips signals already evidenced', () => {
    expect(cheapestNextTest(['explains_politics'])?.signalType).toBe(
      'shares_nonpublic_info'
    );
  });

  it('goes for access once three signals are in', () => {
    const next = cheapestNextTest([
      'explains_politics',
      'shares_nonpublic_info',
      'shapes_use_case',
    ]);
    expect(next?.signalType).toBe('introduces_sideways');
    expect(next?.unlocks).toBe('Potential Champion');
  });

  it('goes for advocacy once access is proven at four signals', () => {
    const next = cheapestNextTest([
      'explains_politics',
      'shares_nonpublic_info',
      'shapes_use_case',
      'introduces_upward',
    ]);
    expect(next?.unlocks).toBe('Validated Champion');
    expect(['has_personal_motivation', 'advocates_when_absent']).toContain(
      next?.signalType
    );
  });

  it('returns nothing once all eight are evidenced', () => {
    const all = observed([
      'shares_nonpublic_info',
      'explains_politics',
      'shapes_use_case',
      'introduces_sideways',
      'introduces_upward',
      'gives_access_to_dm',
      'has_personal_motivation',
      'advocates_when_absent',
    ]);
    const assessment = assessChampion('s1', all.signals, all.evidence);
    expect(assessment.nextTest).toBeNull();
  });
});

describe('isChampionTrack', () => {
  it('includes anyone mapped as a champion', () => {
    expect(isChampionTrack(stakeholder({ mapRoles: ['champion'] }), [])).toBe(true);
  });

  it('includes anyone with a signal already recorded', () => {
    const { signals } = observed(['explains_politics']);
    expect(isChampionTrack(stakeholder(), signals)).toBe(true);
  });

  it('excludes an unrelated contact', () => {
    expect(isChampionTrack(stakeholder({ mapRoles: ['evaluator'] }), [])).toBe(false);
  });
});

describe('countValidatedChampions', () => {
  it('counts only validated champions', () => {
    const a = observed(
      ['explains_politics', 'shapes_use_case', 'advocates_when_absent', 'has_personal_motivation'],
      's1'
    );
    const people = [stakeholder(), stakeholder({ id: 's2', name: 'Sam Cole' })];
    expect(countValidatedChampions(people, a.signals, a.evidence)).toBe(1);
  });
});
