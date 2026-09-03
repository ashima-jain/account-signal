/**
 * The champion test: a pure function over evidenced signals, never an LLM call.
 *
 * A seller can believe someone is a champion. This module only counts what was
 * observed *and* cited, which is why the computed tier and the seller's posture
 * are shown side by side in the UI.
 */

import {
  CHAMPION_SIGNALS,
  CHAMPION_SIGNAL_LABELS,
  CHAMPION_SIGNAL_TESTS,
  type ChampionSignal,
  type ChampionSignalType,
  type ChampionTier,
  type EvidenceItem,
  type ID,
  type Stakeholder,
} from './types';

/** Signals that prove the person is opening doors rather than just talking. */
export const ACCESS_SIGNALS: ChampionSignalType[] = [
  'introduces_sideways',
  'introduces_upward',
  'gives_access_to_dm',
];

/** Signals that prove the person carries the deal when you are not there. */
export const ADVOCACY_SIGNALS: ChampionSignalType[] = [
  'advocates_when_absent',
  'has_personal_motivation',
];

/** Ascending effort: the cheapest thing to try is first. */
const TEST_COST_ORDER: ChampionSignalType[] = [
  'explains_politics',
  'shares_nonpublic_info',
  'shapes_use_case',
  'has_personal_motivation',
  'introduces_sideways',
  'introduces_upward',
  'gives_access_to_dm',
  'advocates_when_absent',
];

/**
 * A signal counts only when it was observed and cites evidence that still
 * exists on the account. Deleting the evidence silently un-counts the signal,
 * which is the point.
 */
export function countsAsObserved(
  signal: ChampionSignal,
  evidence: EvidenceItem[]
): boolean {
  if (!signal.observed) return false;
  if (!signal.evidenceId) return false;
  return evidence.some((e) => e.id === signal.evidenceId);
}

export function signalsFor(
  stakeholderId: ID,
  signals: ChampionSignal[]
): ChampionSignal[] {
  return signals.filter((s) => s.stakeholderId === stakeholderId);
}

export function evidencedSignalTypes(
  stakeholderId: ID,
  signals: ChampionSignal[],
  evidence: EvidenceItem[]
): ChampionSignalType[] {
  const observed = new Set<ChampionSignalType>();
  for (const signal of signalsFor(stakeholderId, signals)) {
    if (countsAsObserved(signal, evidence)) observed.add(signal.signalType);
  }
  return CHAMPION_SIGNALS.filter((t) => observed.has(t));
}

export interface ChampionAssessment {
  tier: ChampionTier;
  /** Signals observed with surviving evidence. */
  evidencedSignals: ChampionSignalType[];
  /** Claimed as observed but with no citation, so they do not count. */
  unevidencedSignals: ChampionSignalType[];
  count: number;
  hasAccess: boolean;
  hasAdvocacy: boolean;
  /** Plain-language reason for the tier, shown next to it. */
  rationale: string;
  nextTest: NextTest | null;
}

export interface NextTest {
  signalType: ChampionSignalType;
  label: string;
  test: string;
  /** What proving it would unlock. */
  unlocks: string;
}

/**
 *   0-1 evidenced signals                      → Contact
 *   2-3                                        → Coach
 *   4+ including access-granting behaviour     → Potential Champion
 *   4+ including advocacy and personal motive  → Validated Champion
 */
export function championTier(
  stakeholderId: ID,
  signals: ChampionSignal[],
  evidence: EvidenceItem[]
): ChampionTier {
  return assessChampion(stakeholderId, signals, evidence).tier;
}

export function assessChampion(
  stakeholderId: ID,
  signals: ChampionSignal[],
  evidence: EvidenceItem[]
): ChampionAssessment {
  const evidenced = evidencedSignalTypes(stakeholderId, signals, evidence);
  const claimed = signalsFor(stakeholderId, signals)
    .filter((s) => s.observed && !countsAsObserved(s, evidence))
    .map((s) => s.signalType);

  const has = (type: ChampionSignalType) => evidenced.includes(type);
  const hasAccess = ACCESS_SIGNALS.some(has);
  const hasAdvocacy = ADVOCACY_SIGNALS.every(has);
  const count = evidenced.length;

  let tier: ChampionTier;
  let rationale: string;

  if (count >= 4 && hasAdvocacy) {
    tier = 'Validated Champion';
    rationale = `${count} evidenced signals including advocacy when absent and a personal motivation.`;
  } else if (count >= 4 && hasAccess) {
    tier = 'Potential Champion';
    rationale = `${count} evidenced signals including access-granting behaviour, but advocacy is unproven.`;
  } else if (count >= 4) {
    tier = 'Coach';
    rationale = `${count} evidenced signals, but none of them open doors — this is still a coach.`;
  } else if (count >= 2) {
    tier = 'Coach';
    rationale = `${count} evidenced signals: helpful, not yet acting on your behalf.`;
  } else {
    tier = 'Contact';
    rationale =
      count === 1
        ? 'One evidenced signal. Not enough to call them anything but a contact.'
        : 'No evidenced signals yet.';
  }

  if (claimed.length > 0) {
    rationale += ` ${claimed.length} signal${claimed.length === 1 ? '' : 's'} marked observed without a citation and did not count.`;
  }

  return {
    tier,
    evidencedSignals: evidenced,
    unevidencedSignals: claimed,
    count,
    hasAccess,
    hasAdvocacy,
    rationale,
    nextTest: cheapestNextTest(evidenced),
  };
}

/**
 * The cheapest untested signal that moves this person up a tier. Advocacy and
 * access are prioritised once the count is already there, because at that point
 * the count is not what is holding the tier back.
 */
export function cheapestNextTest(
  evidenced: ChampionSignalType[]
): NextTest | null {
  const untested = TEST_COST_ORDER.filter((t) => !evidenced.includes(t));
  if (untested.length === 0) return null;

  const count = evidenced.length;
  const hasAccess = ACCESS_SIGNALS.some((t) => evidenced.includes(t));

  let target: ChampionSignalType;
  let unlocks: string;

  if (count >= 4 && !hasAccess) {
    target = untested.find((t) => ACCESS_SIGNALS.includes(t)) ?? untested[0];
    unlocks = 'Potential Champion';
  } else if (count >= 4) {
    target =
      untested.find((t) => ADVOCACY_SIGNALS.includes(t)) ?? untested[0];
    unlocks = 'Validated Champion';
  } else if (count === 3) {
    target = untested.find((t) => ACCESS_SIGNALS.includes(t)) ?? untested[0];
    unlocks = 'Potential Champion';
  } else {
    target = untested[0];
    unlocks = count >= 1 ? 'Coach' : 'a second signal towards Coach';
  }

  return {
    signalType: target,
    label: CHAMPION_SIGNAL_LABELS[target],
    test: CHAMPION_SIGNAL_TESTS[target],
    unlocks,
  };
}

/**
 * Whether to show the 8-signal panel for this person: everyone tagged champion,
 * plus anyone who already has a signal recorded against them.
 */
export function isChampionTrack(
  stakeholder: Stakeholder,
  signals: ChampionSignal[]
): boolean {
  if (stakeholder.mapRoles.includes('champion')) return true;
  if (stakeholder.posture === 'champion' || stakeholder.posture === 'coach') return true;
  return signals.some((s) => s.stakeholderId === stakeholder.id);
}

export function countValidatedChampions(
  stakeholders: Stakeholder[],
  signals: ChampionSignal[],
  evidence: EvidenceItem[]
): number {
  return stakeholders.filter(
    (s) => championTier(s.id, signals, evidence) === 'Validated Champion'
  ).length;
}
