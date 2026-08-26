/**
 * Next Best Action engine.
 *
 * The NBA is computed from account state, not prompted from an LLM. A model
 * asked "what should I do next?" will always produce a plausible-sounding
 * answer; the point is to produce the right answer, which means deriving it
 * from what the evidence actually supports.
 *
 * Scoring uses named tiers (Critical / High / Medium / Low) weighted by the
 * deal stage. The same candidate changes priority depending on where the
 * deal is: "no economic buyer" is Low in discovery (premature) but Critical
 * in negotiation (blocking close). The champion test is High in discovery
 * and Critical in evaluation/negotiation — relationship work is the
 * highest-leverage activity in enterprise sales.
 *
 * Each candidate is a suggestion, not a stored action. The seller picks one
 * and commits it as an Action with a concrete message and desired outcome.
 */

import type {
  AccountAggregate,
  Channel,
  DealStage,
  Horizon,
  ID,
} from './types';
import { inferDealStage } from './types';
import { claimIsStale } from './claims';
import { championTier, nextChampionTest } from './champion';

export type NbaTier = 'critical' | 'high' | 'medium' | 'low';

export const NBA_TIER_ORDER: Record<NbaTier, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export const NBA_TIER_LABELS: Record<NbaTier, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export interface NbaCandidate {
  id: string;
  objective: string;
  whyNow: string;
  desiredOutcome: string;
  channel: Channel;
  horizon: Horizon;
  /** Which claim or stakeholder this candidate is about, for linking. */
  claimId?: ID;
  stakeholderId?: ID;
  /** Priority tier — Critical > High > Medium > Low. */
  tier: NbaTier;
  /** The deal stage when this candidate was generated, for display. */
  stage: DealStage;
}

/**
 * Tier matrix: [discovery, evaluation, negotiation]
 * Each candidate generator looks up its tier by stage.
 */
const TIERS = {
  overdue:        ['critical', 'critical', 'critical'] as NbaTier[],
  noEvidence:     ['critical', 'low',      'low']      as NbaTier[],
  noEconomicBuyer:['low',      'high',     'critical'] as NbaTier[],
  noStakeholders: ['high',     'low',      'low']      as NbaTier[],
  unknownClaim:   ['medium',   'high',     'medium']   as NbaTier[],
  championTest:   ['high',     'critical', 'critical'] as NbaTier[],
  staleClaim:     ['low',      'medium',   'high']     as NbaTier[],
};

function tierFor(candidate: keyof typeof TIERS, stage: DealStage): NbaTier {
  const idx = DEAL_STAGE_INDEX[stage];
  return TIERS[candidate][idx];
}

const DEAL_STAGE_INDEX: Record<DealStage, number> = {
  discovery: 0,
  evaluation: 1,
  negotiation: 2,
};

/**
 * Generates candidates from the account state and returns them ranked by tier.
 * The list is finite and honest: if there is nothing to do, it returns empty.
 */
export function nextBestActions(aggregate: AccountAggregate): NbaCandidate[] {
  const candidates: NbaCandidate[] = [];
  const stage = inferDealStage(aggregate);

  // 1. Overdue open actions — something is slipping right now.
  const now = Date.now();
  for (const action of aggregate.actions) {
    if (action.status !== 'open' || !action.dueAt) continue;
    if (new Date(action.dueAt).getTime() < now) {
      candidates.push({
        id: `overdue-${action.id}`,
        objective: action.objective,
        whyNow: `This action was due ${new Date(action.dueAt).toLocaleDateString()} and is overdue.`,
        desiredOutcome: action.desiredOutcome,
        channel: action.channel,
        horizon: 'this_week',
        stakeholderId: action.stakeholderId,
        tier: tierFor('overdue', stage),
        stage,
      });
    }
  }

  // 2. No evidence at all — the account is a blank page.
  if (aggregate.evidence.length === 0) {
    candidates.push({
      id: 'first-evidence',
      objective: 'Record the first piece of evidence for this account',
      whyNow:
        'There is no evidence yet. Everything in the system has to cite evidence, so this is the first thing to do.',
      desiredOutcome: 'At least one piece of evidence in the ledger.',
      channel: 'other',
      horizon: 'this_week',
      tier: tierFor('noEvidence', stage),
      stage,
    });
  }

  // 3. No economic buyer identified — you cannot close without one.
  const hasEconomicBuyer = aggregate.stakeholders.some((s) =>
    s.mapRoles.includes('economic_buyer')
  );
  if (!hasEconomicBuyer && aggregate.stakeholders.length > 0) {
    candidates.push({
      id: 'identify-economic-buyer',
      objective: 'Identify who controls the budget for this initiative',
      whyNow:
        'No one on the stakeholder map is marked as Economic Buyer. You cannot forecast a close date without one.',
      desiredOutcome: 'A named person with budget authority is on the map.',
      channel: 'call',
      horizon: 'this_week',
      tier: tierFor('noEconomicBuyer', stage),
      stage,
    });
  }

  // 4. No stakeholders — you cannot progress an account alone.
  if (aggregate.stakeholders.length === 0 && aggregate.evidence.length > 0) {
    candidates.push({
      id: 'first-stakeholder',
      objective: 'Add the first person you are talking to at this account',
      whyNow:
        'There is evidence but no stakeholders. An account with no people on the map cannot progress.',
      desiredOutcome: 'At least one stakeholder with a role and posture.',
      channel: 'other',
      horizon: 'this_week',
      tier: tierFor('noStakeholders', stage),
      stage,
    });
  }

  // 5. UNKNOWN claims — each one blocks a part of the thesis.
  for (const claim of aggregate.claims) {
    if (claim.status !== 'UNKNOWN') continue;
    candidates.push({
      id: `resolve-unknown-${claim.id}`,
      objective: `Resolve: ${claim.text}`,
      whyNow:
        'This is an explicit unknown. Every unknown in the thesis is a gap that the next action should go and fill.',
      desiredOutcome: 'This moves from UNKNOWN to at least HYPOTHESIS with a citation.',
      channel: 'call',
      horizon: 'this_week',
      claimId: claim.id,
      tier: tierFor('unknownClaim', stage),
      stage,
    });
  }

  // 6. Champion test — the next signal to test, for the most promising stakeholder.
  const rankedStakeholders = [...aggregate.stakeholders]
    .map((s) => ({
      stakeholder: s,
      tier: championTier(
        aggregate.signals.filter((sig) => sig.stakeholderId === s.id),
        aggregate.evidence
      ),
    }))
    .sort((a, b) => {
      const order = ['Validated Champion', 'Potential Champion', 'Coach', 'Contact'];
      return order.indexOf(a.tier) - order.indexOf(b.tier);
    });

  for (const { stakeholder, tier } of rankedStakeholders) {
    if (tier === 'Validated Champion') continue;
    const test = nextChampionTest(
      aggregate.signals.filter((sig) => sig.stakeholderId === stakeholder.id),
      aggregate.evidence
    );
    if (!test) continue;

    candidates.push({
      id: `champion-test-${stakeholder.id}-${test.signalType}`,
      objective: `Test ${stakeholder.name}: ${labelForSignal(test.signalType)}`,
      whyNow: test.why,
      desiredOutcome: `If observed with evidence, ${stakeholder.name} moves toward a higher champion tier.`,
      channel: 'call',
      horizon: 'next_2_weeks',
      stakeholderId: stakeholder.id,
      tier: tierFor('championTest', stage),
      stage,
    });
    // Only suggest one champion test at a time.
    break;
  }

  // 7. Stale claims — important but not urgent.
  for (const claim of aggregate.claims) {
    if (claim.status === 'UNKNOWN') continue;
    if (!claimIsStale(claim)) continue;
    candidates.push({
      id: `revalidate-${claim.id}`,
      objective: `Re-validate: "${claim.text}"`,
      whyNow: `This ${claim.status.toLowerCase()} has not been reviewed in over 90 days. It may no longer be true.`,
      desiredOutcome: 'Either confirm it is still true or update the status.',
      channel: 'call',
      horizon: 'next_30_days',
      claimId: claim.id,
      tier: tierFor('staleClaim', stage),
      stage,
    });
  }

  return candidates.sort((a, b) => NBA_TIER_ORDER[a.tier] - NBA_TIER_ORDER[b.tier]);
}

/** The single top candidate, or null when the account needs nothing. */
export function nextBestAction(aggregate: AccountAggregate): NbaCandidate | null {
  const ranked = nextBestActions(aggregate);
  return ranked[0] ?? null;
}

function labelForSignal(type: string): string {
  const labels: Record<string, string> = {
    explains_politics: 'whether they explain internal politics',
    shares_nonpublic_info: 'whether they share non-public information',
    shapes_use_case: 'whether they help shape the use case',
    introduces_sideways: 'whether they introduce you sideways',
    introduces_upward: 'whether they introduce you upward',
    gives_access_to_dm: 'whether they give access to decision makers',
    has_personal_motivation: 'whether they have personal motivation',
    advocates_when_absent: 'whether they advocate when absent',
  };
  return labels[type] ?? type;
}
