/**
 * Registration: a passkey becomes a user.
 *
 * The route is an adapter and nothing else — `lib/auth.ts` decides everything,
 * and `attestation.ts` reads the key out of the response the authenticator
 * produced rather than out of a field the client computed. The two headers
 * together are the argument for why this shape; there is nothing to add here.
 *
 * ## What this endpoint can be used for, stated because it is public
 *
 * Anybody can call it, and a successful call creates a row. That is what
 * registration is, and the honest description of the exposure is: an unbounded
 * caller can create users, so it is rate-limited, and a created user holds
 * nothing — no account, no key, no funds — until a later ceremony that requires
 * the passkey to actually sign. §7.3's identity and owner are the same
 * credential, so a user created without the credential in hand is a row that
 * can never do anything.
 */

import { clientIp, createRateLimit } from '@/lib/rate-limit';
import { cleanDisplayName, registerPasskey } from '@/lib/auth';
import {
  authDeps,
  decodeField,
  failure,
  isSecureRequest,
  publicUser,
  readBody,
  setSessionCookie,
} from '@/lib/auth-route';

/** Tighter than the challenge limit: this one writes a row. */
const limit = createRateLimit({ max: 10, windowMs: 5 * 60 * 1000, namespace: 'auth-register' });

export async function POST(request: Request): Promise<Response> {
  try {
    const address = clientIp(request);
    // `check` answers *"is this call over the budget"*, so the refusal is the
    // un-negated branch. Written the other way round this route refuses every
    // request inside the budget and admits every request beyond it, and it
    // fails **closed** on a store outage instead of open — which is how it read
    // until the M1 close-out run put a browser in front of it.
    if (await limit.check(address)) return Response.json({ error: 'rate_limited' }, { status: 429 });

    const body = await readBody(request);
    const result = await registerPasskey(authDeps(), {
      clientDataJSON: decodeField(body, 'clientDataJSON'),
      attestationObject: decodeField(body, 'attestationObject'),
      credentialId: decodeField(body, 'credentialId'),
      displayName: cleanDisplayName(body.displayName),
      address,
    });

    await setSessionCookie(result.token, isSecureRequest(request));
    return Response.json(
      { user: publicUser(result.user) },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    return failure(error);
  }
}
