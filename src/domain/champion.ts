/**
 * Champion classification.
 *
 * Deliberately a pure function rather than an LLM call: asked to judge, a model
 * promotes whoever is senior and responsive. Seniority and responsiveness are
 * not champion signals.
 */

import type {
  ChampionSignal,
  ChampionSignalType,
  ChampionTier,
  EvidenceItem,
  Posture,
} from './types';

/**
 * A signal counts only when it is observed AND cites evidence that still
 * exists. An unevidenced claim of a signal is the seller's optimism, so it is
 * treated as UNKNOWN rather than as a yes.
 */
export function evidencedSignalTypes(
  signals: ChampionSignal[],
  evidence: EvidenceItem[]
): Set<ChampionSignalType> {
  const evidenceIds = new Set(evidence.map((e) => e.id));
  const observed = new Set<ChampionSignalType>();
  for (const signal of signals) {
    if (signal.observed && signal.evidenceId && evidenceIds.has(signal.evidenceId)) {
      observed.add(signal.signalType);
    }
  }
  return observed;
}

export function championTier(
  signals: ChampionSignal[],
  evidence: EvidenceItem[]
): ChampionTier {
  const seen = evidencedSignalTypes(signals, evidence);
  const has = (t: ChampionSignalType) => seen.has(t);
  const count = seen.size;

  // Access-granting behaviour is the dividing line between a friendly contact
  // and someone actually spending political capital.
  const opensDoors = has('introduces_upward') || has('gives_access_to_dm');

  if (
    has('advocates_when_absent') &&
    has('has_personal_motivation') &&
    opensDoors &&
    count >= 5
  ) {
    return 'Validated Champion';
  }
  if (count >= 3 && (has('introduces_sideways') || opensDoors)) {
    return 'Potential Champion';
  }
  if (count >= 1 && (has('explains_politics') || has('shares_nonpublic_info'))) {
    return 'Coach';
  }
  return 'Contact';
}

/**
 * Ordered cheapest-to-hardest. Each rung is also more diagnostic than the last,
 * so the first untested rung is both the easiest ask and the most informative.
 */
const TEST_LADDER: ChampionSignalType[] = [
  'explains_politics',
  'shares_nonpublic_info',
  'shapes_use_case',
  'introduces_sideways',
  'introduces_upward',
  'gives_access_to_dm',
  'has_personal_motivation',
  'advocates_when_absent',
];

const TEST_RATIONALE: Record<ChampionSignalType, string> = {
  explains_politics:
    'Ask who else has to agree and who would resist. Someone unwilling to map the politics is not yet a coach.',
  shares_nonpublic_info:
    'Ask about internal priorities or budget timing. Willingness to share non-public context is the first real trust signal.',
  shapes_use_case:
    'Ask them to help sharpen the use case. Co-authoring means they have started to own it.',
  introduces_sideways:
    'Ask for an introduction to a peer team. A lateral intro costs them little but proves willingness to spend social capital.',
  introduces_upward:
    'Ask for an introduction to their leadership. This is the first ask with real personal risk for them.',
  gives_access_to_dm:
    'Ask for time with whoever controls the budget. Access, not enthusiasm, is what moves an opportunity.',
  has_personal_motivation:
    'Establish what they personally gain if this succeeds. Without a personal stake, advocacy collapses under pressure.',
  advocates_when_absent:
    'Give them something to advance without you in the room, then verify it happened. This is the only true champion test.',
};

export interface ChampionTest {
  signalType: ChampionSignalType;
  why: string;
}

/** The next test worth running, or null when all eight are evidenced. */
export function nextChampionTest(
  signals: ChampionSignal[],
  evidence: EvidenceItem[]
): ChampionTest | null {
  const seen = evidencedSignalTypes(signals, evidence);
  const next = TEST_LADDER.find((t) => !seen.has(t));
  return next ? { signalType: next, why: TEST_RATIONALE[next] } : null;
}

/**
 * Surfaces disagreement between what the seller asserts and what the evidence
 * supports. The product is meant to push back, not agree.
 */
export function postureConflict(posture: Posture, tier: ChampionTier): string | null {
  if (posture === 'champion' && tier !== 'Validated Champion') {
    return `You have marked this person a champion, but the evidence supports "${tier}". Record the missing signals or downgrade the posture.`;
  }
  if (posture === 'coach' && tier === 'Contact') {
    return 'You have marked this person a coach, but no evidenced signal supports it yet.';
  }
  if (posture === 'detractor' && tier === 'Validated Champion') {
    return 'Posture and evidence contradict each other. One of them is out of date.';
  }
  return null;
}
