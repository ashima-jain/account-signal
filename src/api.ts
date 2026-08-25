/**
 * Typed API client.
 *
 * Every mutation returns the whole aggregate, so callers replace one piece of
 * state rather than reconciling sub-entities. The account's `rev` is sent as
 * If-Match on writes, which is what makes a stale tab fail loudly with 409
 * instead of quietly overwriting someone else's edit.
 */

import type {
  AccountAggregate,
  AccountIndexEntry,
  BuyerRole,
  Channel,
  ChampionSignalType,
  Claim,
  ClaimCategory,
  ClaimStatus,
  EvidenceItem,
  Horizon,
  ID,
  Posture,
  SourceSystem,
  SourceType,
  WedgeStatus,
} from './domain/types';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** The account changed underneath this tab. Callers should reload, not retry. */
export class StaleDataError extends ApiError {
  constructor(message: string) {
    super(409, message);
    this.name = 'StaleDataError';
  }
}

export interface MutationResponse {
  aggregate: AccountAggregate;
  entityId?: ID;
}

async function request<T>(path: string, init: RequestInit = {}, rev?: number): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  if (rev !== undefined) headers.set('If-Match', `"rev-${rev}"`);

  const response = await fetch(path, { ...init, headers });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}.`;
    try {
      const body = await response.json();
      if (body && typeof body.error === 'string') message = body.error;
    } catch {
      // Non-JSON error body; keep the generic message.
    }
    if (response.status === 409) throw new StaleDataError(message);
    throw new ApiError(response.status, message);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// ─── Accounts ────────────────────────────────────────────────────────────────

export interface AccountInput {
  companyName: string;
  domain?: string;
}

export const api = {
  listAccounts: () => request<AccountIndexEntry[]>('/api/accounts'),

  getAccount: (id: ID) => request<AccountAggregate>(`/api/accounts/${id}`),

  createAccount: (input: AccountInput) =>
    request<MutationResponse>('/api/accounts', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateAccount: (id: ID, rev: number, input: Partial<AccountInput>) =>
    request<MutationResponse>(
      `/api/accounts/${id}`,
      { method: 'PATCH', body: JSON.stringify(input) },
      rev
    ),

  deleteAccount: (id: ID) =>
    request<{ success: boolean }>(`/api/accounts/${id}`, { method: 'DELETE' }),

  // ─── Evidence ──────────────────────────────────────────────────────────────

  addEvidence: (accountId: ID, rev: number, input: EvidenceInput) =>
    request<MutationResponse>(
      `/api/accounts/${accountId}/evidence`,
      { method: 'POST', body: JSON.stringify(input) },
      rev
    ),

  updateEvidence: (
    accountId: ID,
    evidenceId: ID,
    rev: number,
    input: Partial<EvidenceInput>
  ) =>
    request<MutationResponse>(
      `/api/accounts/${accountId}/evidence/${evidenceId}`,
      { method: 'PATCH', body: JSON.stringify(input) },
      rev
    ),

  deleteEvidence: (accountId: ID, evidenceId: ID, rev: number) =>
    request<MutationResponse>(
      `/api/accounts/${accountId}/evidence/${evidenceId}`,
      { method: 'DELETE' },
      rev
    ),

  // ─── Claims ────────────────────────────────────────────────────────────────

  addClaim: (accountId: ID, rev: number, input: ClaimInput) =>
    request<MutationResponse>(
      `/api/accounts/${accountId}/claims`,
      { method: 'POST', body: JSON.stringify(input) },
      rev
    ),

  updateClaim: (accountId: ID, claimId: ID, rev: number, input: ClaimUpdate) =>
    request<MutationResponse>(
      `/api/accounts/${accountId}/claims/${claimId}`,
      { method: 'PATCH', body: JSON.stringify(input) },
      rev
    ),

  deleteClaim: (accountId: ID, claimId: ID, rev: number) =>
    request<MutationResponse>(
      `/api/accounts/${accountId}/claims/${claimId}`,
      { method: 'DELETE' },
      rev
    ),

  // ─── Stakeholders ──────────────────────────────────────────────────────────

  addStakeholder: (accountId: ID, rev: number, input: StakeholderInput) =>
    request<MutationResponse>(
      `/api/accounts/${accountId}/stakeholders`,
      { method: 'POST', body: JSON.stringify(input) },
      rev
    ),

  updateStakeholder: (
    accountId: ID,
    stakeholderId: ID,
    rev: number,
    input: Partial<StakeholderInput>
  ) =>
    request<MutationResponse>(
      `/api/accounts/${accountId}/stakeholders/${stakeholderId}`,
      { method: 'PATCH', body: JSON.stringify(input) },
      rev
    ),

  deleteStakeholder: (accountId: ID, stakeholderId: ID, rev: number) =>
    request<MutationResponse>(
      `/api/accounts/${accountId}/stakeholders/${stakeholderId}`,
      { method: 'DELETE' },
      rev
    ),

  // ─── Champion signals ──────────────────────────────────────────────────────

  recordSignal: (accountId: ID, rev: number, input: SignalInput) =>
    request<MutationResponse>(
      `/api/accounts/${accountId}/signals`,
      { method: 'POST', body: JSON.stringify(input) },
      rev
    ),

  updateSignal: (
    accountId: ID,
    signalId: ID,
    rev: number,
    input: Partial<SignalInput>
  ) =>
    request<MutationResponse>(
      `/api/accounts/${accountId}/signals/${signalId}`,
      { method: 'PATCH', body: JSON.stringify(input) },
      rev
    ),

  deleteSignal: (accountId: ID, signalId: ID, rev: number) =>
    request<MutationResponse>(
      `/api/accounts/${accountId}/signals/${signalId}`,
      { method: 'DELETE' },
      rev
    ),

  // ─── Actions ────────────────────────────────────────────────────────────────

  addAction: (accountId: ID, rev: number, input: ActionInput) =>
    request<MutationResponse>(
      `/api/accounts/${accountId}/actions`,
      { method: 'POST', body: JSON.stringify(input) },
      rev
    ),

  updateAction: (accountId: ID, actionId: ID, rev: number, input: Partial<ActionInput>) =>
    request<MutationResponse>(
      `/api/accounts/${accountId}/actions/${actionId}`,
      { method: 'PATCH', body: JSON.stringify(input) },
      rev
    ),

  deleteAction: (accountId: ID, actionId: ID, rev: number) =>
    request<MutationResponse>(
      `/api/accounts/${accountId}/actions/${actionId}`,
      { method: 'DELETE' },
      rev
    ),

  // ─── Thesis generator ───────────────────────────────────────────────────────

  generateThesis: (accountId: ID, rev: number) =>
    request<MutationResponse & { insufficientEvidence?: boolean; reason?: string }>(
      `/api/accounts/${accountId}/thesis/generate`,
      { method: 'POST' },
      rev
    ),

  // ─── Wedges ─────────────────────────────────────────────────────────────────

  addWedge: (accountId: ID, rev: number, input: WedgeInput) =>
    request<MutationResponse>(
      `/api/accounts/${accountId}/wedges`,
      { method: 'POST', body: JSON.stringify(input) },
      rev
    ),

  updateWedge: (accountId: ID, wedgeId: ID, rev: number, input: Partial<WedgeInput>) =>
    request<MutationResponse>(
      `/api/accounts/${accountId}/wedges/${wedgeId}`,
      { method: 'PATCH', body: JSON.stringify(input) },
      rev
    ),

  deleteWedge: (accountId: ID, wedgeId: ID, rev: number) =>
    request<MutationResponse>(
      `/api/accounts/${accountId}/wedges/${wedgeId}`,
      { method: 'DELETE' },
      rev
    ),

  // ─── Account seeding ─────────────────────────────────────────────────────────

  seedAccount: (accountId: ID, rev: number) =>
    request<MutationResponse & { skipped?: boolean; reason?: string }>(
      `/api/accounts/${accountId}/seed`,
      { method: 'POST' },
      rev
    ),
};

export interface EvidenceInput {
  sourceType: SourceType;
  sourceSystem?: SourceSystem;
  sourceRef?: string;
  externalUrl?: string;
  externalId?: string;
  verbatim: string;
  asOf?: string;
  confidential?: boolean;
  stakeholderId?: ID;
}

export interface ClaimInput {
  text: string;
  status: ClaimStatus;
  category: ClaimCategory;
  evidenceIds?: ID[];
  supersedesClaimId?: ID;
  reason?: string;
}

export interface ClaimUpdate {
  text?: string;
  status?: ClaimStatus;
  category?: ClaimCategory;
  evidenceIds?: ID[];
  revalidate?: boolean;
  reason?: string;
}

export interface StakeholderInput {
  name: string;
  role: string;
  businessUnit?: string;
  emails?: string[];
  linkedinUrl?: string;
  mapRoles?: BuyerRole[];
  priorities?: string[];
  relevance?: string;
  influence?: number;
  relationshipStrength?: number;
  posture?: Posture;
  accessPath?: string;
  whatToLearn?: string[];
  introducedByStakeholderId?: ID;
}

export interface SignalInput {
  stakeholderId: ID;
  signalType: ChampionSignalType;
  observed?: boolean;
  evidenceId?: ID;
  note?: string;
}

export interface ActionInput {
  stakeholderId?: ID;
  wedgeId?: ID;
  objective: string;
  channel?: Channel;
  messageOrAction: string;
  whyThisPersonNow: string;
  desiredOutcome: string;
  dependencyActionId?: ID;
  ifSuccess?: string;
  ifFail?: string;
  horizon: Horizon;
  dueAt?: string;
  resolvesClaimIds?: ID[];
  status?: string;
  outcomeNote?: string;
}

export type { Claim, EvidenceItem };

export interface WedgeInput {
  useCase: string;
  businessProblem: string;
  technicalProblem: string;
  whyFactory: string;
  likelyOwnerRole?: string;
  sponsorRole?: string;
  evidenceIds?: ID[];
  discoveryQuestion?: string;
  disqualifiers?: string[];
  status?: WedgeStatus;
  disqualifiedReason?: string;
  disqualifyingEvidenceId?: ID;
}
