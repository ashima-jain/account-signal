import { afterEach, describe, expect, it } from 'vitest';
import { NotConfigured, Unauthorized, requireAccess } from './auth';

const withPasscode = (value: string | undefined): void => {
  if (value === undefined) delete process.env.ACCESS_PASSCODE;
  else process.env.ACCESS_PASSCODE = value;
};

const requestWith = (authorization?: string): Request =>
  new Request('https://example.com/api/accounts', {
    headers: authorization ? { authorization } : {},
  });

afterEach(() => withPasscode(undefined));

describe('requireAccess', () => {
  it('fails closed when the deploy has no passcode', () => {
    withPasscode(undefined);
    expect(() => requireAccess(requestWith('Bearer anything'))).toThrow(NotConfigured);
  });

  it('rejects a missing or wrong passcode', () => {
    withPasscode('correct-horse');
    expect(() => requireAccess(requestWith())).toThrow(Unauthorized);
    expect(() => requireAccess(requestWith('Bearer wrong'))).toThrow(Unauthorized);
    expect(() => requireAccess(requestWith('correct-horse'))).toThrow(Unauthorized);
  });

  it('accepts the configured passcode', () => {
    withPasscode('correct-horse');
    expect(() => requireAccess(requestWith('Bearer correct-horse'))).not.toThrow();
  });
});
