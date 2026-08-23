import type { Account, ResearchOutput, ResearchRequest } from './types';

const API_BASE = '/api';

export async function generateResearch(request: ResearchRequest): Promise<ResearchOutput> {
  const res = await fetch(`${API_BASE}/research`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `Research failed: ${res.status}`);
  }
  return res.json();
}

export async function listAccounts(): Promise<Account[]> {
  const res = await fetch(`${API_BASE}/accounts`);
  if (!res.ok) throw new Error('Failed to load accounts');
  return res.json();
}

export async function getAccount(id: string): Promise<Account> {
  const res = await fetch(`${API_BASE}/accounts/${id}`);
  if (!res.ok) throw new Error('Failed to load account');
  return res.json();
}

export async function createAccount(account: Omit<Account, 'id' | 'createdAt' | 'updatedAt'>): Promise<Account> {
  const res = await fetch(`${API_BASE}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(account),
  });
  if (!res.ok) throw new Error('Failed to save account');
  return res.json();
}

export async function updateAccount(id: string, account: Partial<Account>): Promise<Account> {
  const res = await fetch(`${API_BASE}/accounts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(account),
  });
  if (!res.ok) throw new Error('Failed to update account');
  return res.json();
}

export async function deleteAccount(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/accounts/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete account');
}
