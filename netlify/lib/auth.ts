/**
 * Access control for every account route.
 *
 * The data here is a sales team's private account intelligence, so no route is
 * public. A single shared workspace passcode is the whole scheme: this is an
 * internal tool used by one team, and a passcode the deployer sets is both
 * enough to keep the blob store off the open internet and small enough that it
 * cannot be got subtly wrong. Leaving ACCESS_PASSCODE unset is a deliberate
 * choice to run the deploy open, so the gate simply steps aside.
 */

export class Unauthorized extends Error {
  readonly status = 401;
  constructor(message = 'A workspace passcode is required.') {
    super(message);
    this.name = 'Unauthorized';
  }
}

export function requireAccess(request: Request): void {
  const expected = process.env.ACCESS_PASSCODE;
  if (!expected) return;

  const header = request.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!presented || !timingSafeEqual(presented, expected)) throw new Unauthorized();
}

/** Comparison whose duration does not depend on where the strings diverge. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
