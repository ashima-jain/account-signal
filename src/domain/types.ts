/**
 * Domain model shared by the browser bundle and the serverless functions.
 *
 * Nothing in this file talks to the network or to storage: it is the vocabulary
 * plus the invariants that the rest of the system is not allowed to break.
 */

export type ID = string;

// ─── Evidence ────────────────────────────────────────────────────────────────

export type SourceType =
  | 'earnings_call'
  | 'filing'
  | 'job_posting'
  | 'engineering_blog'
  | 'repo_activity'
  | 'conference_talk'
  | 'news'
  | 'linkedin'
  | 'conversation'
  | 'document'
  | 'inference';

export const SOURCE_TYPES: SourceType[] = [
  'earnings_call',
  'filing',
  'job_posting',
  'engineering_blog',
  'repo_activity',
  'conference_talk',
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
  engineering_blog: 'Engineering blog',
  repo_activity: 'Public repo activity',
  conference_talk: 'Conference talk',
  news: 'News',
  linkedin: 'LinkedIn',
  conversation: 'Conversation',
  document: 'Document',
  inference: 'Inference (unverified)',
};

/**
 * `inference` is the one source type that can never support a FACT: it records
 * the seller's or the model's reasoning, not an observation of the world.
 */
export function isVerifiableSource(sourceType: SourceType): boolean {
  return sourceType !== 'inference';
}

export type SourceSystem =
  | 'manual'
  | 'web_research'
  | 'granola'
  | 'gmail'
  | 'calendar'
  | 'crm'
  | 'notion'
  | 'linkedin';

export const SOURCE_SYSTEMS: SourceSystem[] = [
  'manual',
  'web_research',
  'granola',
  'gmail',
  'calendar',
  'crm',
  'notion',
  'linkedin',
];

/** The four criteria an account is qualified against. */
export type EvidenceCategory =
  | 'engineering_scale'
  | 'devin_fit'
  | 'urgency'
  | 'right_to_win';

export const EVIDENCE_CATEGORIES: EvidenceCategory[] = [
  'engineering_scale',
  'devin_fit',
  'urgency',
  'right_to_win',
];

export const EVIDENCE_CATEGORY_LABELS: Record<EvidenceCategory, string> = {
  engineering_scale: 'Engineering Scale',
  devin_fit: 'Devin Use-Case Fit',
  urgency: 'Urgency / Trigger',
  right_to_win: 'Right to Win',
};

export const EVIDENCE_CATEGORY_QUESTIONS: Record<EvidenceCategory, string> = {
  engineering_scale:
    'How many engineers, how many repos, how much legacy surface area is there to work on?',
  devin_fit:
    'Is there parallelisable, well-specified engineering work Devin sessions can own end to end?',
  urgency: 'What happened recently that makes this a this-quarter problem?',
  right_to_win:
    'Why us, why now, and what access or proof do we have that a competitor does not?',
};

/** The kinds of engineering work Devin is bought to do. */
export type DevinUseCase =
  | 'migration'
  | 'refactor'
  | 'test_coverage'
  | 'bug_backlog'
  | 'dependency_upgrade'
  | 'code_review'
  | 'codebase_qa'
  | 'incident_response'
  | 'ci_maintenance'
  | 'feature_delivery'
  | 'other';

export const DEVIN_USE_CASES: DevinUseCase[] = [
  'migration',
  'refactor',
  'test_coverage',
  'bug_backlog',
  'dependency_upgrade',
  'code_review',
  'codebase_qa',
  'incident_response',
  'ci_maintenance',
  'feature_delivery',
  'other',
];

export const DEVIN_USE_CASE_LABELS: Record<DevinUseCase, string> = {
  migration: 'Migration (framework, language, cloud)',
  refactor: 'Large-scale refactor / codemod',
  test_coverage: 'Test coverage backfill',
  bug_backlog: 'Bug and ticket backlog burn-down',
  dependency_upgrade: 'Dependency and CVE remediation',
  code_review: 'PR review and code standards',
  codebase_qa: 'Codebase Q&A and onboarding (Wiki / Search)',
  incident_response: 'Incident triage and on-call support',
  ci_maintenance: 'CI, flaky tests and build maintenance',
  feature_delivery: 'Parallel feature delivery',
  other: 'Other',
};

export interface EvidenceItem {
  id: ID;
  sourceType: SourceType;
  sourceSystem: SourceSystem;
  /** Human label for where this came from, e.g. "Q3 FY26 earnings call". */
  sourceRef?: string;
  externalUrl?: string;
  /** Idempotency key so re-ingesting the same record does not duplicate it. */
  externalId?: string;
  /** The quote, or a factual summary tight enough to be quoted back. */
  verbatim: string;
  /** When we recorded it. */
  capturedAt: string;
  /** When the underlying fact was true. Staleness is measured from this. */
  asOf: string;
  /** Shared in confidence: never repeat it in generated outreach. */
  confidential: boolean;
  stakeholderId?: ID;
  evidenceCategory?: EvidenceCategory;
  /** Narrow signal name, e.g. "software_engineer_headcount". */
  signalType?: string;
  whyItMatters?: string;
  /** What this implies for a Devin deployment specifically. */
  implicationForDevin?: string;
  nextDiscoveryQuestion?: string;
  /** Seller-confirmed status. Undefined means nobody has reviewed it yet. */
  status?: ClaimStatus;
}

// ─── Claims ──────────────────────────────────────────────────────────────────

export type ClaimStatus = 'FACT' | 'HYPOTHESIS' | 'UNKNOWN';

export const CLAIM_STATUSES: ClaimStatus[] = ['FACT', 'HYPOTHESIS', 'UNKNOWN'];

export type ClaimCategory =
  | 'engineering_scale'
  | 'devin_fit'
  | 'urgency'
  | 'right_to_win'
  | 'why_matters'
  | 'why_now'
  | 'trigger'
  | 'business_init'
  | 'tech_init'
  | 'problem'
  | 'value';

export const CLAIM_CATEGORIES: ClaimCategory[] = [
  'engineering_scale',
  'devin_fit',
  'urgency',
  'right_to_win',
  'why_matters',
  'why_now',
  'trigger',
  'business_init',
  'tech_init',
  'problem',
  'value',
];

export const CLAIM_CATEGORY_LABELS: Record<ClaimCategory, string> = {
  engineering_scale: 'Engineering Scale',
  devin_fit: 'Devin Use-Case Fit',
  urgency: 'Urgency / Trigger',
  right_to_win: 'Right to Win',
  why_matters: 'Why this account matters',
  why_now: 'Why now',
  trigger: 'Trigger event',
  business_init: 'Business initiative',
  tech_init: 'Technical initiative',
  problem: 'Problem to solve',
  value: 'Value at stake',
};

/** The four category claims double as the qualification ratings on the thesis. */
export const RATING_CLAIM_CATEGORIES: ClaimCategory[] = [
  'engineering_scale',
  'devin_fit',
  'urgency',
  'right_to_win',
];

export interface Claim {
  id: ID;
  text: string;
  status: ClaimStatus;
  category: ClaimCategory;
  /** Evidence this claim rests on. A FACT needs at least one verifiable item. */
  evidenceIds: ID[];
  /** Set when a newer claim replaces this one, so strategy history survives. */
  supersedesClaimId?: ID;
  asOf: string;
  reviewedAt?: string;
  createdAt: string;
}

// ─── Wedges ──────────────────────────────────────────────────────────────────

export type WedgeStatus = 'candidate' | 'testing' | 'validated' | 'disqualified';

export const WEDGE_STATUSES: WedgeStatus[] = [
  'candidate',
  'testing',
  'validated',
  'disqualified',
];

export const WEDGE_STATUS_LABELS: Record<WedgeStatus, string> = {
  candidate: 'Candidate',
  testing: 'Testing',
  validated: 'Validated',
  disqualified: 'Disqualified',
};

export interface ProofPoint {
  id: ID;
  capability: string;
  claim: string;
  sourceUrl?: string;
  /** Drafted proof points start unverified and render as such. */
  verified: boolean;
}

export interface Wedge {
  id: ID;
  useCase: string;
  devinUseCase: DevinUseCase;
  businessProblem: string;
  technicalProblem: string;
  /** Why an autonomous engineer beats hiring, offshoring or an IDE copilot. */
  whyDevin: string;
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
  user: 'User (engineer)',
  security_procurement: 'Security / Procurement',
  potential_detractor: 'Potential Detractor',
};

export const BUYER_ROLE_HINTS: Record<BuyerRole, string> = {
  economic_buyer: 'Owns the budget line the platform seat count comes out of.',
  executive_sponsor: 'CTO / VP Eng who has to say the strategy out loud.',
  champion: 'Sells for you when you are not in the room.',
  technical_decision_maker: 'Platform or DevEx lead who owns the toolchain.',
  evaluator: 'Runs the pilot and scores the sessions.',
  user: 'Engineers whose tickets Devin picks up.',
  security_procurement: 'Reviews code access, SOC 2, data residency, VPC.',
  potential_detractor: 'Believes agents are a threat, or owns a rival bet.',
};

/** The seller's read on a person, kept separate from the computed tier. */
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

export const RATINGS: Rating[] = [1, 2, 3, 4, 5];

export interface Stakeholder {
  id: ID;
  name: string;
  role: string;
  businessUnit?: string;
  emails: string[];
  linkedinUrl?: string;
  /** People hold several roles at once; an Economic Buyer is often a Detractor. */
  mapRoles: BuyerRole[];
  priorities: string[];
  relevance?: string;
  influence: Rating;
  relationshipStrength: Rating;
  posture: Posture;
  accessPath?: string;
  whatToLearn: string[];
  lastContactAt?: string;
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
  has_personal_motivation: 'Has personal or business motivation',
  advocates_when_absent: 'Advocates when I am not in the room',
};

export const CHAMPION_SIGNAL_TESTS: Record<ChampionSignalType, string> = {
  shares_nonpublic_info:
    'Ask what the internal agent strategy is and who else is being evaluated.',
  explains_politics: 'Ask who has to agree before a platform tool gets funded.',
  shapes_use_case:
    'Ask them to pick the first repo and the first ticket queue for the pilot.',
  introduces_sideways: 'Ask for an intro to a peer team lead with the same backlog.',
  introduces_upward: 'Ask for 20 minutes with their VP to review the pilot scope.',
  gives_access_to_dm: 'Ask who signs and request a working session with them.',
  has_personal_motivation:
    'Ask what a successful agent rollout would mean for their own roadmap.',
  advocates_when_absent:
    'Give them a one-pager and ask them to run it in a meeting you are not in.',
};

export type ChampionTier =
  | 'Contact'
  | 'Coach'
  | 'Potential Champion'
  | 'Validated Champion';

export const CHAMPION_TIERS: ChampionTier[] = [
  'Contact',
  'Coach',
  'Potential Champion',
  'Validated Champion',
];

export interface ChampionSignal {
  id: ID;
  stakeholderId: ID;
  signalType: ChampionSignalType;
  observed: boolean;
  /** Required when observed. An unevidenced signal does not count. */
  evidenceId?: ID;
  observedAt?: string;
  note?: string;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export type Horizon = 'this_week' | 'next_2_weeks' | 'next_30_days';

export const HORIZONS: Horizon[] = ['this_week', 'next_2_weeks', 'next_30_days'];

export const HORIZON_LABELS: Record<Horizon, string> = {
  this_week: 'This week',
  next_2_weeks: 'Next 2 weeks',
  next_30_days: 'Next 30 days',
};

export type Channel =
  | 'email'
  | 'linkedin'
  | 'call'
  | 'warm_intro'
  | 'exec_outreach'
  | 'technical_session'
  | 'pilot_session'
  | 'partner_si'
  | 'event'
  | 'other';

export const CHANNELS: Channel[] = [
  'email',
  'linkedin',
  'call',
  'warm_intro',
  'exec_outreach',
  'technical_session',
  'pilot_session',
  'partner_si',
  'event',
  'other',
];

export const CHANNEL_LABELS: Record<Channel, string> = {
  email: 'Email',
  linkedin: 'LinkedIn',
  call: 'Call',
  warm_intro: 'Warm intro',
  exec_outreach: 'Exec outreach',
  technical_session: 'Technical session',
  pilot_session: 'Live Devin session on their repo',
  partner_si: 'Partner / SI',
  event: 'Event',
  other: 'Other',
};

export type ActionStatus = 'open' | 'done' | 'dropped';

/**
 * One entity backs both the 30-day plan and the Next Best Action, so the two
 * views can never disagree about what is outstanding.
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
  horizon: Horizon;
  status: ActionStatus;
  dueAt?: string;
  completedAt?: string;
  outcomeNote?: string;
  /** Which UNKNOWNs this action is meant to close. Feeds NBA scoring. */
  resolvesClaimIds: ID[];
  createdAt: string;
}

// ─── Deal stage ──────────────────────────────────────────────────────────────

export type DealStage = 'discovery' | 'evaluation' | 'negotiation';

export const DEAL_STAGE_LABELS: Record<DealStage, string> = {
  discovery: 'Discovery',
  evaluation: 'Evaluation',
  negotiation: 'Negotiation',
};

/**
 * Derived from account state rather than set by hand, so the stage cannot drift
 * away from what the account actually contains.
 */
export function inferDealStage(aggregate: AccountAggregate): DealStage {
  if (aggregate.wedges.some((w) => w.status === 'validated')) return 'negotiation';
  if (aggregate.claims.length > 0) return 'evaluation';
  return 'discovery';
}

// ─── Change log ──────────────────────────────────────────────────────────────

export type ChangeType =
  | 'account_created'
  | 'account_updated'
  | 'account_seeded'
  | 'evidence_added'
  | 'evidence_updated'
  | 'evidence_removed'
  | 'evidence_status_changed'
  | 'claim_added'
  | 'claim_updated'
  | 'claim_removed'
  | 'claim_demoted'
  | 'wedge_added'
  | 'wedge_updated'
  | 'wedge_disqualified'
  | 'stakeholder_added'
  | 'stakeholder_updated'
  | 'stakeholder_removed'
  | 'signal_recorded'
  | 'signal_removed'
  | 'champion_tier_changed'
  | 'action_added'
  | 'action_updated'
  | 'action_removed'
  | 'thesis_generated';

export interface ChangeEvent {
  id: ID;
  at: string;
  type: ChangeType;
  /** e.g. "claim:9f2c". */
  entityRef?: string;
  summary: string;
  reason?: string;
}

export const EVENTS_CAP = 200;

// ─── Aggregate ───────────────────────────────────────────────────────────────

export interface Account {
  id: ID;
  companyName: string;
  domain?: string;
  createdAt: string;
  updatedAt: string;
}

/** Everything about one account, stored as a single blob. */
export interface AccountAggregate {
  /** Monotonic write counter. Clients echo it back as `If-Match: "rev-N"`. */
  rev: number;
  account: Account;
  evidence: EvidenceItem[];
  claims: Claim[];
  wedges: Wedge[];
  stakeholders: Stakeholder[];
  signals: ChampionSignal[];
  actions: Action[];
  events: ChangeEvent[];
  /** Narrative answer to "why does this account matter". */
  whyItMatters?: string;
  /** Set while a seed run is in flight so the UI can keep polling. */
  seedStatus?: 'running' | 'complete' | 'failed';
  seedError?: string;
}

/** Portfolio row, derived from the aggregate on every write. */
export interface AccountIndexEntry {
  id: ID;
  companyName: string;
  domain?: string;
  updatedAt: string;
  evidenceCount: number;
  factCount: number;
  unknownCount: number;
  stakeholderCount: number;
  validatedChampions: number;
  validatedWedges: number;
  openActions: number;
  nextActionDueAt?: string;
  dealStage: DealStage;
  seedStatus?: 'running' | 'complete' | 'failed';
  needsAttention: boolean;
}

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
