/**
 * The workspace passcode the API requires on every request.
 *
 * It lives in localStorage rather than in a cookie so that the app stays a
 * static bundle with no session endpoint, and it is cleared the moment the
 * server rejects it, which is what puts the passcode screen back up.
 */

const KEY = 'account-signal.passcode';

const listeners = new Set<() => void>();

export function getPasscode(): string | null {
  return localStorage.getItem(KEY);
}

export function setPasscode(value: string): void {
  localStorage.setItem(KEY, value);
  for (const listener of listeners) listener();
}

export function clearPasscode(): void {
  localStorage.removeItem(KEY);
  for (const listener of listeners) listener();
}

export function onPasscodeChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
