/**
 * Account Signal domain model.
 *
 * Pure types shared by the React client and the Netlify Functions so that
 * invariants (FACT citation rules, champion tiers, action scoring) are
 * evaluated identically on both sides.
 */

export type ID = string;

// ─── Evidence ────────────────────────────────────────────────────────────────

/**
 * Which system the evidence arrived from. `manual` is the only producer today;
 * the rest exist so MCP/API ingestion is an additional producer of the same
 * shape rather than a parallel model.
 */
export type SourceSystem =
  | 'manual'
  | 'granola'
  | 'gmail'
  | 'calendar'
  | 'crm'
  | 'notion'
  | 'linkedin';

/**
 * `inference` marks the model's own reasoning. It is stored honestly as
 * evidence but can never support a FACT.
 */
export type SourceType =
  | 'earnings_call'
  | 'filing'
  | 'job_posting'
  | 'news'
  | 'linkedin'
  | 'conversation'
  | 'document'
  | 'inference';

export const SOURCE_SYSTEMS: SourceSystem[] = [
  'manual',
  'granola',
  'gmail',
  'calendar',
  'crm',
  'notion',
  'linkedin',
];

export const SOURCE_TYPES: SourceType[] = [
  'earnings_call',
  'filing',
  'job_posting',
  'news',
  'linkedin',
  'conversation',
  'document',
  'inference',
];

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  earnings_call: 'Earnings call',
  filing: 'Filing',
  job_posting: 'Job posting',
  news: 'News',
  linkedin: 'LinkedIn',
  conversation: 'Conversation',
  document: 'Document',
  inference: 'Inference (unverified)',
};

export interface EvidenceItem {
  id: ID;
  sourceType: SourceType;
  sourceSystem: SourceSystem;
  /** Human label for the source, e.g. "Q3 FY26 earnings call". */
  sourceRef?: string;
  externalUrl?: string;
  /** Idempotency key for ingestion; dedupes re-synced records. */
  externalId?: string;
  verbatim: string;
  /** When we recorded it. */
  capturedAt: string;
  /** When the underlying thing was true. Drives staleness, not capturedAt. */
  asOf: string;
  /** Shared in confidence. Constrains what generated outreach may repeat. */
  confidential: boolean;
  stakeholderId?: ID;
}

// ─── Claims ──────────────────────────────────────────────────────────────────

export type ClaimStatus = 'FACT' | 'HYPOTHESIS' | 'UNKNOWN';

export type ClaimCategory =
  | 'why_matters'
  | 'why_now'
  | 'trigger'
  | 'business_init'
  | 'tech_init'
  | 'problem'
  | 'value';

export const CLAIM_CATEGORIES: ClaimCategory[] = [
  'why_matters',
  'why_now',
  'trigger',
  'business_init',
  'tech_init',
  'problem',
  'value',
];

export const CLAIM_CATEGORY_LABELS: Record<ClaimCategory, string> = {
  why_matters: 'Why this account matters',
  why_now: 'Why now',
  trigger: 'Trigger event',
  business_init: 'Business initiative',
  tech_init: 'Technical initiative',
  problem: 'Problem to solve',
  value: 'Value at stake',
};

export interface Claim {
  id: ID;
  text: string;
  status: ClaimStatus;
  category: ClaimCategory;
  evidenceIds: ID[];
  /** Set when a newer claim replaces this one; preserves strategy history. */
  supersedesClaimId?: ID;
  asOf: string;
  reviewedAt?: string;
  createdAt: string;
}

// ─── Wedges ──────────────────────────────────────────────────────────────────

export type WedgeStatus = 'candidate' | 'testing' | 'validated' | 'disqualified';

export interface ProofPoint {
  id: ID;
  capability: string;
  claim: string;
  sourceUrl?: string;
  /** Model-drafted proof points start false and render as UNVERIFIED. */
  verified: boolean;
}

export interface Wedge {
  id: ID;
  useCase: string;
  businessProblem: string;
  technicalProblem: string;
  whyFactory: string;
  likelyOwnerRole: string;
  sponsorRole: string;
  evidenceIds: ID[];
  discoveryQuestion: string;
  disqualifiers: string[];
  proofPoints: ProofPoint[];
  status: WedgeStatus;
  disqualifiedReason?: string;
  disqualifyingEvidenceId?: ID;
  createdAt: string;
}

// ─── Stakeholders ────────────────────────────────────────────────────────────

export type BuyerRole =
  | 'economic_buyer'
  | 'executive_sponsor'
  | 'champion'
  | 'technical_decision_maker'
  | 'evaluator'
  | 'user'
  | 'security_procurement'
  | 'potential_detractor';

export const BUYER_ROLES: BuyerRole[] = [
  'economic_buyer',
  'executive_sponsor',
  'champion',
  'technical_decision_maker',
  'evaluator',
  'user',
  'security_procurement',
  'potential_detractor',
];

export const BUYER_ROLE_LABELS: Record<BuyerRole, string> = {
  economic_buyer: 'Economic Buyer',
  executive_sponsor: 'Executive Sponsor',
  champion: 'Champion',
  technical_decision_maker: 'Technical Decision Maker',
  evaluator: 'Evaluator',
  user: 'User',
  security_procurement: 'Security / Procurement',
  potential_detractor: 'Potential Detractor',
};

/** The seller's subjective read. Compare against the computed champion tier. */
export type Posture =
  | 'unknown'
  | 'detractor'
  | 'neutral'
  | 'supporter'
  | 'coach'
  | 'champion';

export const POSTURES: Posture[] = [
  'unknown',
  'detractor',
  'neutral',
  'supporter',
  'coach',
  'champion',
];

export const POSTURE_LABELS: Record<Posture, string> = {
  unknown: 'Unknown',
  detractor: 'Detractor',
  neutral: 'Neutral',
  supporter: 'Supporter',
  coach: 'Coach',
  champion: 'Champion',
};

export type Rating = 1 | 2 | 3 | 4 | 5;

export const RATING_LABELS: Record<Rating, string> = {
  1: 'Low',
  2: 'Below average',
  3: 'Average',
  4: 'Above average',
  5: 'High',
};

export interface Stakeholder {
  id: ID;
  name: string;
  role: string;
  businessUnit?: string;
  /** Join key for future Gmail/Calendar identity resolution. */
  emails: string[];
  /** Join key for future LinkedIn matching. */
  linkedinUrl?: string;
  /** People occupy several roles; an Economic Buyer is often also a Detractor. */
  mapRoles: BuyerRole[];
  priorities: string[];
  relevance?: string;
  influence: Rating;
  relationshipStrength: Rating;
  posture: Posture;
  accessPath?: string;
  whatToLearn: string[];
  lastContactAt?: string;
  /** Which system asserted lastContactAt, so ingestion can own it later. */
  lastContactSource?: SourceSystem;
  introducedByStakeholderId?: ID;
  createdAt: string;
}

// ─── Champion test ───────────────────────────────────────────────────────────

export type ChampionSignalType =
  | 'shares_nonpublic_info'
  | 'explains_politics'
  | 'shapes_use_case'
  | 'introduces_sideways'
  | 'introduces_upward'
  | 'gives_access_to_dm'
  | 'has_personal_motivation'
  | 'advocates_when_absent';

export const CHAMPION_SIGNALS: ChampionSignalType[] = [
  'shares_nonpublic_info',
  'explains_politics',
  'shapes_use_case',
  'introduces_sideways',
  'introduces_upward',
  'gives_access_to_dm',
  'has_personal_motivation',
  'advocates_when_absent',
];

export const CHAMPION_SIGNAL_LABELS: Record<ChampionSignalType, string> = {
  shares_nonpublic_info: 'Shares non-public information',
  explains_politics: 'Explains internal politics',
  shapes_use_case: 'Helps shape the use case',
  introduces_sideways: 'Introduces me sideways',
  introduces_upward: 'Introduces me upward',
  gives_access_to_dm: 'Gives access to decision makers',
  has_personal_motivation: 'Has personal / business motivation',
  advocates_when_absent: 'Advocates when I am not present',
};

export type ChampionTier =
  | 'Contact'
  | 'Coach'
  | 'Potential Champion'
  | 'Validated Champion';

export interface ChampionSignal {
  id: ID;
  stakeholderId: ID;
  signalType: ChampionSignalType;
  observed: boolean;
  /** Required when observed. An unevidenced signal counts as UNKNOWN. */
  evidenceId?: ID;
  observedAt?: string;
  note?: string;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export type Horizon = 'this_week' | 'next_2_weeks' | 'next_30_days';

export type Channel =
  | 'email'
  | 'linkedin'
  | 'call'
  | 'warm_intro'
  | 'partner_si'
  | 'exec_outreach'
  | 'technical_session'
  | 'event'
  | 'other';

export type ActionStatus = 'open' | 'done' | 'dropped';

/**
 * One entity serves both the 30-day plan (bucketed by horizon) and Next Best
 * Action (top-ranked slice), so the two views can never disagree.
 */
export interface Action {
  id: ID;
  stakeholderId?: ID;
  wedgeId?: ID;
  objective: string;
  channel: Channel;
  messageOrAction: string;
  whyThisPersonNow: string;
  desiredOutcome: string;
  dependencyActionId?: ID;
  ifSuccess?: string;
  ifFail?: string;
  horizon: Horizon;
  status: ActionStatus;
  dueAt?: string;
  completedAt?: string;
  outcomeNote?: string;
  /** Which UNKNOWNs this action is meant to resolve. Feeds NBA scoring. */
  resolvesClaimIds: ID[];
  createdAt: string;
}

// ─── Change log ──────────────────────────────────────────────────────────────

export type ChangeType =
  | 'account_created'
  | 'account_updated'
  | 'evidence_added'
  | 'evidence_removed'
  | 'claim_added'
  | 'claim_status_changed'
  | 'claim_superseded'
  | 'wedge_added'
  | 'wedge_disqualified'
  | 'stakeholder_added'
  | 'stakeholder_updated'
  | 'posture_changed'
  | 'signal_recorded'
  | 'champion_tier_changed'
  | 'action_added'
  | 'action_completed'
  | 'thesis_regenerated';

export interface ChangeEvent {
  id: ID;
  at: string;
  type: ChangeType;
  /** e.g. "claim:abc123" */
  entityRef?: string;
  summary: string;
  reason?: string;
}

// ─── Aggregate ───────────────────────────────────────────────────────────────

export interface Account {
  id: ID;
  companyName: string;
  domain?: string;
  createdAt: string;
  updatedAt: string;
}

/** Everything for one account, stored as a single blob. */
export interface AccountAggregate {
  /**
   * Monotonic write counter, for display and debugging. Concurrency itself is
   * enforced by ETag compare-and-swap in the storage layer, not by this field.
   */
  rev: number;
  account: Account;
  evidence: EvidenceItem[];
  claims: Claim[];
  wedges: Wedge[];
  stakeholders: Stakeholder[];
  signals: ChampionSignal[];
  actions: Action[];
  events: ChangeEvent[];
}

/** Lightweight portfolio row, derived from the aggregate. */
export interface AccountIndexEntry {
  id: ID;
  companyName: string;
  updatedAt: string;
  evidenceCount: number;
  factCount: number;
  unknownCount: number;
  stakeholderCount: number;
  validatedChampions: number;
  openActions: number;
  nextActionDueAt?: string;
  needsAttention: boolean;
}

export const EVENTS_CAP = 200;

export function emptyAggregate(account: Account): AccountAggregate {
  return {
    rev: 0,
    account,
    evidence: [],
    claims: [],
    wedges: [],
    stakeholders: [],
    signals: [],
    actions: [],
    events: [],
  };
}
