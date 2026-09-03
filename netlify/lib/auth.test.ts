import { afterEach, describe, expect, it } from 'vitest';
import { Unauthorized, requireAccess } from './auth';

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
  it('lets everyone in when the deploy sets no passcode', () => {
    withPasscode(undefined);
    expect(() => requireAccess(requestWith())).not.toThrow();
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
