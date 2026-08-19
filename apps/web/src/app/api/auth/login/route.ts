/**
 * Login: an assertion becomes a session.
 *
 * This is the path §7.3 exists for. The deployed verifier checks neither
 * `origin` nor `rpIdHash`, so an assertion is evidence that a credential signed
 * some bytes and evidence of nothing about which site asked — and a login that
 * accepted assertions the way the contract does would accept one collected by
 * any site the user visits. `verifyAssertion` is what makes that not the case,
 * and this route's only job is to hand it the right expectation and to put the
 * resulting session in a cookie.
 */

import { clientIp, createRateLimit } from '@/lib/rate-limit';
import { loginWithPasskey } from '@/lib/auth';
import {
  authDeps,
  base64Url,
  decodeField,
  failure,
  isSecureRequest,
  readBody,
  setSessionCookie,
} from '@/lib/auth-route';

/**
 * Looser than registration and for a different reason.
 *
 * A failed login is a person whose biometric prompt timed out at least as often
 * as it is somebody probing, and the thing a rate limit protects here is not
 * guessing — a P-256 signature is not guessable — but the cost of verifying.
 * The challenge store is the real limit on replay: every attempt spends one.
 */
const limit = createRateLimit({ max: 20, windowMs: 5 * 60 * 1000, namespace: 'auth-login' });

export async function POST(request: Request): Promise<Response> {
  try {
    const address = clientIp(request);
    if (!(await limit.check(address))) return Response.json({ error: 'rate_limited' }, { status: 429 });

    const body = await readBody(request);
    const result = await loginWithPasskey(authDeps(), {
      clientDataJSON: decodeField(body, 'clientDataJSON'),
      authenticatorData: decodeField(body, 'authenticatorData'),
      signature: decodeField(body, 'signature'),
      credentialId: decodeField(body, 'credentialId'),
      address,
    });

    await setSessionCookie(result.token, isSecureRequest(request));
    return Response.json(
      {
        user: {
          id: result.user.id,
          displayName: result.user.displayName,
          credentialId: base64Url(result.user.credentialId),
        },
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    return failure(error);
  }
}
