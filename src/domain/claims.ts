/**
 * Claim invariants.
 *
 * This module is the reason the product is trustworthy. A model asked to label
 * its own output will call a plausible guess a fact, so the rule is enforced
 * here in code and checked on the server for every write, whether the claim was
 * typed by the seller or generated.
 */

import type { Claim, ClaimStatus, EvidenceItem, ID } from './types';

/** A claim's asOf older than this is shown as needing re-validation. */
export const CLAIM_STALE_AFTER_DAYS = 90;

/**
 * Model reasoning is stored honestly as evidence so its influence is visible,
 * but it can never promote a claim to FACT. Otherwise the system launders its
 * own guesses into facts.
 */
export function canSupportFact(item: EvidenceItem): boolean {
  return item.sourceType !== 'inference';
}

/** Evidence a claim cites that still exists, in the order cited. */
export function citedEvidence(claim: Claim, evidence: EvidenceItem[]): EvidenceItem[] {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  return claim.evidenceIds
    .map((id) => byId.get(id))
    .filter((e): e is EvidenceItem => e !== undefined);
}

/** Ids the claim cites that no longer resolve. */
export function danglingEvidenceIds(claim: Claim, evidence: EvidenceItem[]): ID[] {
  const ids = new Set(evidence.map((e) => e.id));
  return claim.evidenceIds.filter((id) => !ids.has(id));
}

/**
 * Returns an error message when the claim breaks an invariant, or null.
 *
 * - FACT needs at least one citation that resolves and is not an inference.
 * - UNKNOWN must cite nothing. Holding evidence and still calling something
 *   unknown hides work that has already been done; it is at least a hypothesis.
 * - No claim may cite evidence that does not exist.
 */
export function claimInvariantError(claim: Claim, evidence: EvidenceItem[]): string | null {
  if (claim.text.trim() === '') return 'Claim text cannot be empty.';

  const dangling = danglingEvidenceIds(claim, evidence);
  if (dangling.length > 0) {
    return `Claim cites evidence that does not exist: ${dangling.join(', ')}.`;
  }

  const cited = citedEvidence(claim, evidence);

  if (claim.status === 'FACT') {
    if (cited.length === 0) {
      return 'A FACT must cite at least one piece of evidence. Record the evidence first, or mark this a HYPOTHESIS.';
    }
    if (!cited.some(canSupportFact)) {
      return 'A FACT cannot rest only on inference. Cite a source you can point to, or mark this a HYPOTHESIS.';
    }
  }

  if (claim.status === 'UNKNOWN' && cited.length > 0) {
    return 'An UNKNOWN cannot cite evidence. If you have evidence for it, it is at least a HYPOTHESIS.';
  }

  return null;
}

/**
 * The strongest status the citations actually justify. Used to demote claims
 * when their supporting evidence is deleted or downgraded, so removing a source
 * silently un-proves whatever rested on it.
 */
export function supportedStatus(claim: Claim, evidence: EvidenceItem[]): ClaimStatus {
  const cited = citedEvidence(claim, evidence);
  if (cited.length === 0) return 'UNKNOWN';
  if (!cited.some(canSupportFact)) return 'HYPOTHESIS';
  return 'FACT';
}

export interface ClaimDemotion {
  claim: Claim;
  from: ClaimStatus;
  to: ClaimStatus;
  reason: string;
}

/**
 * Brings every claim back within the invariants after an evidence change and
 * reports what moved, so each demotion can be written to the change log.
 * Only ever downgrades: promotion stays a deliberate act by the seller.
 */
export function reconcileClaims(claims: Claim[], evidence: EvidenceItem[]): ClaimDemotion[] {
  const demotions: ClaimDemotion[] = [];
  const ids = new Set(evidence.map((e) => e.id));

  for (const claim of claims) {
    claim.evidenceIds = claim.evidenceIds.filter((id) => ids.has(id));

    // A HYPOTHESIS with no evidence is legitimate: it is a guess awaiting a
    // test. Only a FACT can be invalidated by losing its support.
    if (claim.status !== 'FACT') continue;

    // Recomputed rather than keyed off removals, so downgrading a source to an
    // inference also demotes whatever rested on it.
    const supported = supportedStatus(claim, evidence);
    if (supported === 'FACT') continue;

    claim.status = supported;
    demotions.push({
      claim,
      from: 'FACT',
      to: supported,
      reason:
        supported === 'UNKNOWN'
          ? 'Supporting evidence was removed.'
          : 'Only inference-based evidence remains.',
    });
  }

  return demotions;
}

export function claimIsStale(claim: Claim, now: Date = new Date()): boolean {
  const reference = claim.reviewedAt ?? claim.asOf;
  const age = now.getTime() - new Date(reference).getTime();
  return age > CLAIM_STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
}
