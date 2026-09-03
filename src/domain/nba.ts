/**
 * Next Best Action: a deterministic read of the account, not a generated one.
 *
 * Each rule looks for one specific gap and, if it finds it, returns a candidate
 * whose priority depends on the deal stage. The same gap is worth different
 * amounts at different times — "no economic buyer" is background noise in
 * Discovery and the only thing that matters in Negotiation.
 */

import { assessChampion, isChampionTrack } from './champion';
import { isStale } from './claims';
import {
  BUYER_ROLE_LABELS,
  DEAL_STAGE_LABELS,
  inferDealStage,
  type AccountAggregate,
  type DealStage,
  type ID,
} from './types';

export type NbaTier = 'Critical' | 'High' | 'Medium' | 'Low';

export const TIER_WEIGHT: Record<NbaTier, number> = {
  Critical: 400,
  High: 300,
  Medium: 200,
  Low: 100,
};

export interface NbaCandidate {
  /** Stable key for the rule that produced this, e.g. "champion_test". */
  key: string;
  title: string;
  /** Why this is the gap, stated in terms of what the account does or does not have. */
  why: string;
  /** The concrete thing to do next. */
  suggestedAction: string;
  tier: NbaTier;
  score: number;
  stakeholderId?: ID;
  wedgeId?: ID;
  claimIds?: ID[];
}

type StageTiers = Record<DealStage, NbaTier>;

function candidate(
  stage: DealStage,
  tiers: StageTiers,
  fields: Omit<NbaCandidate, 'tier' | 'score'>
): NbaCandidate {
  const tier = tiers[stage];
  return { ...fields, tier, score: TIER_WEIGHT[tier] };
}

export function nextBestActions(
  aggregate: AccountAggregate,
  now: Date = new Date()
): NbaCandidate[] {
  const stage = inferDealStage(aggregate);
  const { evidence, claims, stakeholders, signals, wedges, actions } = aggregate;
  const openActions = actions.filter((a) => a.status === 'open');
  const out: NbaCandidate[] = [];

  // Nothing to reason about yet.
  if (evidence.length === 0) {
    out.push(
      candidate(stage, { discovery: 'Critical', evaluation: 'Critical', negotiation: 'Critical' }, {
        key: 'no_evidence',
        title: 'Research the account',
        why: 'There is no evidence on this account, so every downstream judgment would be a guess.',
        suggestedAction:
          'Run the research seed, or record what you already know in the Evidence Ledger.',
      })
    );
    return out;
  }

  if (claims.length === 0) {
    out.push(
      candidate(stage, { discovery: 'Critical', evaluation: 'High', negotiation: 'High' }, {
        key: 'no_thesis',
        title: 'Generate the thesis',
        why: `${evidence.length} pieces of evidence are recorded but nothing has been turned into a claim.`,
        suggestedAction:
          'Generate the thesis, then confirm each proposed FACT against its citation.',
      })
    );
  }

  // Unresolved UNKNOWNs with nothing scheduled to close them.
  const unresolvedUnknowns = claims.filter(
    (c) =>
      c.status === 'UNKNOWN' &&
      !openActions.some((a) => a.resolvesClaimIds.includes(c.id))
  );
  if (unresolvedUnknowns.length > 0) {
    out.push(
      candidate(stage, { discovery: 'Critical', evaluation: 'High', negotiation: 'Medium' }, {
        key: 'unresolved_unknowns',
        title: `Close ${unresolvedUnknowns.length} open unknown${unresolvedUnknowns.length === 1 ? '' : 's'}`,
        why: `${unresolvedUnknowns.length} claim${unresolvedUnknowns.length === 1 ? ' is' : 's are'} marked UNKNOWN with no action booked to resolve ${unresolvedUnknowns.length === 1 ? 'it' : 'them'}: "${unresolvedUnknowns[0].text}"`,
        suggestedAction:
          'Book a discovery conversation and attach it to the unknowns it would answer.',
        claimIds: unresolvedUnknowns.map((c) => c.id),
      })
    );
  }

  // Champion coverage.
  const championTrack = stakeholders.filter((s) => isChampionTrack(s, signals));
  const assessments = championTrack.map((s) => ({
    stakeholder: s,
    assessment: assessChampion(s.id, signals, evidence),
  }));
  const validated = assessments.filter(
    (a) => a.assessment.tier === 'Validated Champion'
  );

  if (validated.length === 0) {
    const best = assessments
      .slice()
      .sort((a, b) => b.assessment.count - a.assessment.count)[0];

    if (best) {
      const test = best.assessment.nextTest;
      out.push(
        candidate(stage, { discovery: 'High', evaluation: 'Critical', negotiation: 'Critical' }, {
          key: 'champion_test',
          title: `Run the next champion test on ${best.stakeholder.name}`,
          why: `${best.stakeholder.name} is a ${best.assessment.tier} with ${best.assessment.count} of 8 evidenced signals. No one on this account is a Validated Champion.`,
          suggestedAction: test
            ? `${test.test} Proving "${test.label}" moves them towards ${test.unlocks}.`
            : 'All eight signals are evidenced — review the citations and confirm the tier.',
          stakeholderId: best.stakeholder.id,
        })
      );
    } else {
      out.push(
        candidate(stage, { discovery: 'High', evaluation: 'Critical', negotiation: 'Critical' }, {
          key: 'no_champion_track',
          title: 'Find someone who could be a champion',
          why: 'No stakeholder on this account is on the champion track.',
          suggestedAction:
            'Pick the engineering leader closest to the backlog you want Devin to own and start the 8-signal test.',
        })
      );
    }
  }

  // Signals asserted without a citation are not evidence, and pretending
  // otherwise is how a deal gets called committed on a coach.
  const unevidenced = assessments.reduce(
    (n, a) => n + a.assessment.unevidencedSignals.length,
    0
  );
  if (unevidenced > 0) {
    out.push(
      candidate(stage, { discovery: 'Medium', evaluation: 'Medium', negotiation: 'High' }, {
        key: 'unevidenced_signals',
        title: `Cite ${unevidenced} unevidenced champion signal${unevidenced === 1 ? '' : 's'}`,
        why: 'Signals are marked observed but cite no evidence, so they do not count towards any tier.',
        suggestedAction:
          'Attach the meeting note or message that proves each signal, or unmark it.',
      })
    );
  }

  // Buyer map coverage.
  const rolesPresent = new Set(stakeholders.flatMap((s) => s.mapRoles));
  if (!rolesPresent.has('economic_buyer')) {
    out.push(
      candidate(stage, { discovery: 'Low', evaluation: 'High', negotiation: 'Critical' }, {
        key: 'no_economic_buyer',
        title: 'Identify the economic buyer',
        why: 'No stakeholder is mapped as the economic buyer, so nobody on the map can sign.',
        suggestedAction: `Ask your strongest contact who owns the platform budget line, then map them as ${BUYER_ROLE_LABELS.economic_buyer}.`,
      })
    );
  }
  if (!rolesPresent.has('technical_decision_maker')) {
    out.push(
      candidate(stage, { discovery: 'Medium', evaluation: 'High', negotiation: 'High' }, {
        key: 'no_technical_dm',
        title: 'Identify the technical decision maker',
        why: 'Nobody is mapped as the technical decision maker for the toolchain Devin has to live in.',
        suggestedAction:
          'Find the platform or developer-experience lead and map them.',
      })
    );
  }
  if (!rolesPresent.has('security_procurement')) {
    out.push(
      candidate(stage, { discovery: 'Low', evaluation: 'Medium', negotiation: 'Critical' }, {
        key: 'no_security_contact',
        title: 'Get ahead of security review',
        why: 'No security or procurement contact is mapped. Repo access review is the usual reason an agent pilot stalls.',
        suggestedAction:
          'Ask your champion who reviews source-code access and start that conversation early.',
      })
    );
  }

  const detractors = stakeholders.filter(
    (s) => s.posture === 'detractor' || s.mapRoles.includes('potential_detractor')
  );
  if (detractors.length > 0) {
    out.push(
      candidate(stage, { discovery: 'Low', evaluation: 'Medium', negotiation: 'High' }, {
        key: 'unmanaged_detractor',
        title: `Neutralise ${detractors[0].name}`,
        why: `${detractors[0].name} (${detractors[0].role}) is mapped as a detractor.`,
        suggestedAction:
          'Find out what they are protecting and give your champion the counter-argument in writing.',
        stakeholderId: detractors[0].id,
      })
    );
  }

  // Wedges.
  const liveWedges = wedges.filter((w) => w.status !== 'disqualified');
  const testing = liveWedges.filter((w) => w.status === 'testing');
  if (liveWedges.length === 0) {
    out.push(
      candidate(stage, { discovery: 'High', evaluation: 'High', negotiation: 'Medium' }, {
        key: 'no_wedge',
        title: 'Pick a wedge use case',
        why: 'There is no live use case, so there is nothing concrete for a first Devin deployment to do.',
        suggestedAction:
          'Name one bounded backlog — a migration, a coverage gap, a CVE queue — and write it up as a wedge.',
      })
    );
  } else if (!liveWedges.some((w) => w.status === 'validated') && testing.length > 0) {
    out.push(
      candidate(stage, { discovery: 'Medium', evaluation: 'High', negotiation: 'High' }, {
        key: 'validate_wedge',
        title: `Validate "${testing[0].useCase}"`,
        why: `"${testing[0].useCase}" has been in testing with no validating evidence.`,
        suggestedAction: testing[0].discoveryQuestion
          ? `Ask: ${testing[0].discoveryQuestion}`
          : 'Run a scoped session on their repo and record the outcome as evidence.',
        wedgeId: testing[0].id,
      })
    );
  }

  const unevidencedWedges = liveWedges.filter((w) => w.evidenceIds.length === 0);
  if (unevidencedWedges.length > 0) {
    out.push(
      candidate(stage, { discovery: 'Medium', evaluation: 'Medium', negotiation: 'Medium' }, {
        key: 'unevidenced_wedge',
        title: `Evidence the wedge "${unevidencedWedges[0].useCase}"`,
        why: 'This use case cites no evidence, which means it is currently our idea rather than their problem.',
        suggestedAction:
          'Attach the job posting, incident, or quote that shows they actually have this problem.',
        wedgeId: unevidencedWedges[0].id,
      })
    );
  }

  // Freshness.
  const stale = claims.filter((c) => isStale(c, evidence, now));
  if (stale.length > 0) {
    out.push(
      candidate(stage, { discovery: 'Low', evaluation: 'Medium', negotiation: 'High' }, {
        key: 'stale_claims',
        title: `Revalidate ${stale.length} stale claim${stale.length === 1 ? '' : 's'}`,
        why: `${stale.length} claim${stale.length === 1 ? ' rests' : 's rest'} on evidence older than 90 days: "${stale[0].text}"`,
        suggestedAction:
          'Confirm each one is still true, then mark it reviewed — or demote it.',
        claimIds: stale.map((c) => c.id),
      })
    );
  }

  // Right to win cannot be asserted from desk research alone.
  const rightToWin = claims.find((c) => c.category === 'right_to_win');
  if (rightToWin && rightToWin.status !== 'FACT') {
    out.push(
      candidate(stage, { discovery: 'Medium', evaluation: 'High', negotiation: 'High' }, {
        key: 'right_to_win_unproven',
        title: 'Prove the right to win',
        why: `Right to win is still ${rightToWin.status}: "${rightToWin.text}"`,
        suggestedAction:
          'Get one first-party data point — a relationship, a pilot result, an internal mandate — and record it.',
        claimIds: [rightToWin.id],
      })
    );
  }

  // Commitments already made.
  const overdue = openActions.filter(
    (a) => a.dueAt && new Date(a.dueAt).getTime() < now.getTime()
  );
  if (overdue.length > 0) {
    out.push(
      candidate(stage, { discovery: 'High', evaluation: 'High', negotiation: 'Critical' }, {
        key: 'overdue_actions',
        title: `Clear ${overdue.length} overdue action${overdue.length === 1 ? '' : 's'}`,
        why: `"${overdue[0].objective}" was due ${overdue[0].dueAt?.slice(0, 10)} and is still open.`,
        suggestedAction: overdue[0].messageOrAction || 'Do it, or drop it honestly.',
      })
    );
  }

  if (openActions.length === 0) {
    out.push(
      candidate(stage, { discovery: 'High', evaluation: 'High', negotiation: 'High' }, {
        key: 'no_open_actions',
        title: 'Book the next step',
        why: 'Nothing is scheduled on this account.',
        suggestedAction:
          'Turn the top gap above into an action with a date and a desired outcome.',
      })
    );
  }

  // Sort is stable, so rules declared earlier win ties at the same tier.
  return out.sort((a, b) => b.score - a.score);
}

export function nextBestAction(
  aggregate: AccountAggregate,
  now: Date = new Date()
): NbaCandidate | null {
  return nextBestActions(aggregate, now)[0] ?? null;
}

export function stageLabel(aggregate: AccountAggregate): string {
  return DEAL_STAGE_LABELS[inferDealStage(aggregate)];
}
