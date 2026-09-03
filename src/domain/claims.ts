/**
 * The judgment layer for evidence and claims.
 *
 * The model may propose that something is a FACT. Whether it *is* one is
 * decided here, by code, against the evidence actually on the account.
 */

import {
  isVerifiableSource,
  type Claim,
  type ClaimStatus,
  type EvidenceItem,
  type ID,
} from './types';

/** A claim is stale once its supporting evidence is this old and unreviewed. */
export const STALE_AFTER_DAYS = 90;

export function daysBetween(from: string, to: string | Date = new Date()): number {
  const end = typeof to === 'string' ? new Date(to) : to;
  const ms = end.getTime() - new Date(from).getTime();
  return Math.floor(ms / 86_400_000);
}

function byId(evidence: EvidenceItem[]): Map<ID, EvidenceItem> {
  return new Map(evidence.map((e) => [e.id, e]));
}

/**
 * The single gate every claim write passes through.
 *
 * Returns a human-readable reason the claim is invalid, or null when it holds:
 *   1. every cited evidence id must exist
 *   2. a FACT must cite at least one non-inference item
 *   3. an UNKNOWN must cite nothing — evidence makes it a HYPOTHESIS at worst
 */
export function claimInvariantError(
  claim: Pick<Claim, 'status' | 'evidenceIds' | 'text'>,
  evidence: EvidenceItem[]
): string | null {
  const index = byId(evidence);

  const missing = claim.evidenceIds.filter((id) => !index.has(id));
  if (missing.length > 0) {
    return `Claim cites evidence that does not exist on this account: ${missing.join(', ')}.`;
  }

  if (claim.status === 'FACT') {
    const support = claim.evidenceIds
      .map((id) => index.get(id))
      .filter((e): e is EvidenceItem => Boolean(e))
      .filter((e) => isVerifiableSource(e.sourceType));
    if (support.length === 0) {
      return 'A FACT must cite at least one piece of evidence from a verifiable source. Inference alone is a HYPOTHESIS.';
    }
  }

  if (claim.status === 'UNKNOWN' && claim.evidenceIds.length > 0) {
    return 'An UNKNOWN cannot cite evidence. If you have evidence, it is at least a HYPOTHESIS.';
  }

  return null;
}

/** The strongest status a claim is entitled to, given what it cites. */
export function highestSupportedStatus(
  evidenceIds: ID[],
  evidence: EvidenceItem[]
): ClaimStatus {
  const index = byId(evidence);
  const cited = evidenceIds
    .map((id) => index.get(id))
    .filter((e): e is EvidenceItem => Boolean(e));
  if (cited.some((e) => isVerifiableSource(e.sourceType))) return 'FACT';
  if (cited.length > 0) return 'HYPOTHESIS';
  return 'UNKNOWN';
}

/**
 * Coerces a proposed claim into the strongest status the evidence supports.
 * Used on the seed and thesis paths, where the model supplies the status.
 */
export function clampStatus(
  proposed: ClaimStatus,
  evidenceIds: ID[],
  evidence: EvidenceItem[]
): ClaimStatus {
  const ceiling = highestSupportedStatus(evidenceIds, evidence);
  if (proposed === 'FACT' && ceiling !== 'FACT') {
    return ceiling === 'HYPOTHESIS' ? 'HYPOTHESIS' : 'UNKNOWN';
  }
  if (proposed === 'UNKNOWN' && evidenceIds.length > 0) return 'HYPOTHESIS';
  return proposed;
}

export interface Demotion {
  claimId: ID;
  from: ClaimStatus;
  to: ClaimStatus;
  reason: string;
}

/**
 * Brings claims back in line with the evidence after something is deleted.
 * Mutates the claims in place and reports what changed, so the caller can write
 * the demotions to the change log.
 *
 * A HYPOTHESIS that loses its last citation stays a HYPOTHESIS: an unevidenced
 * guess is still a legitimate guess, it just cannot be promoted.
 */
export function reconcileClaims(
  claims: Claim[],
  evidence: EvidenceItem[]
): Demotion[] {
  const index = byId(evidence);
  const demotions: Demotion[] = [];

  for (const claim of claims) {
    const kept = claim.evidenceIds.filter((id) => index.has(id));
    const lost = claim.evidenceIds.length - kept.length;
    claim.evidenceIds = kept;

    if (claim.status !== 'FACT') continue;
    if (highestSupportedStatus(kept, evidence) === 'FACT') continue;

    demotions.push({
      claimId: claim.id,
      from: 'FACT',
      to: 'HYPOTHESIS',
      reason:
        lost > 0
          ? 'Lost its last verifiable citation when evidence was removed.'
          : 'No longer cites evidence from a verifiable source.',
    });
    claim.status = 'HYPOTHESIS';
  }

  return demotions;
}

/**
 * Stale means: nobody has looked at this claim in 90 days and the evidence it
 * rests on is older than that too. Revalidating (setting reviewedAt) clears it
 * without needing new evidence.
 */
export function isStale(
  claim: Claim,
  evidence: EvidenceItem[],
  now: Date = new Date()
): boolean {
  if (claim.status === 'UNKNOWN') return false;

  const lastLookedAt = claim.reviewedAt ?? claim.asOf ?? claim.createdAt;
  if (daysBetween(lastLookedAt, now) < STALE_AFTER_DAYS) return false;

  const index = byId(evidence);
  const freshest = claim.evidenceIds
    .map((id) => index.get(id)?.asOf)
    .filter((asOf): asOf is string => Boolean(asOf))
    .sort()
    .at(-1);

  if (!freshest) return true;
  return daysBetween(freshest, now) >= STALE_AFTER_DAYS;
}

export function staleClaims(
  claims: Claim[],
  evidence: EvidenceItem[],
  now: Date = new Date()
): Claim[] {
  return claims.filter((c) => isStale(c, evidence, now));
}

/** How many claims cite a given evidence item. Drives the removal warning. */
export function citationCount(evidenceId: ID, claims: Claim[]): number {
  return claims.filter((c) => c.evidenceIds.includes(evidenceId)).length;
}

/** Claims that would be demoted if this evidence item were removed. */
export function demotionsIfRemoved(
  evidenceId: ID,
  claims: Claim[],
  evidence: EvidenceItem[]
): Claim[] {
  const remaining = evidence.filter((e) => e.id !== evidenceId);
  return claims.filter(
    (c) =>
      c.status === 'FACT' &&
      c.evidenceIds.includes(evidenceId) &&
      highestSupportedStatus(
        c.evidenceIds.filter((id) => id !== evidenceId),
        remaining
      ) !== 'FACT'
  );
}
