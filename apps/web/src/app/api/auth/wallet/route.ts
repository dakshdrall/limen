/**
 * Wallet sign-in: a SEP-53 signature becomes a session.
 *
 * The counterpart of `/api/auth/login`, and the same shape — decode the body,
 * call the one function in `auth.ts` that decides everything, put the resulting
 * session in a cookie. What differs is only what is being verified.
 *
 * ## Why this route does not check an origin
 *
 * `/api/auth/login` exists because the deployed WebAuthn verifier checks
 * neither `origin` nor `rpIdHash`, so an assertion is evidence a credential
 * signed *some* bytes and evidence of nothing about which site asked. There is
 * no equivalent hole to plug here, because there is no equivalent binding to
 * begin with: SEP-53 signs the bare message, so a signature over this
 * challenge is exactly that and nothing more.
 *
 * What makes it safe is the challenge itself. It is 32 random bytes this server
 * minted, stored under a `wallet:` key with a two-minute TTL, and spent on
 * first use — so a signature collected by another site is worthless unless that
 * site can also get a challenge this server issued *and* spend it first, and
 * spending it is what stops the same one being replayed here.
 *
 * The honest limit, stated because it is the kind of thing that should not be
 * discovered later: this proves possession of the key, not the intent of its
 * holder to sign in *to Limen specifically*. Binding intent to the origin would
 * mean putting a domain in the signed message, which SEP-53 supports and
 * Freighter renders. It is not done here because the message a user sees should
 * then be worth reading, and that is a copy decision rather than a code one.
 * `TODO(roadmap)`: put the origin in the challenge text and show it on screen.
 */

import { clientIp, createRateLimit } from '@/lib/rate-limit';
import { loginWithWallet } from '@/lib/auth';
import { authDeps, BadRequest, failure, isSecureRequest, publicUser, readBody, setSessionCookie } from '@/lib/auth-route';

export const runtime = 'nodejs';

/**
 * The same budget as the passkey login, for the same reason.
 *
 * An ed25519 signature is not guessable, so what a limit protects is the cost
 * of verifying one — and the challenge store is the real bound on replay, since
 * every attempt spends a challenge. A person whose wallet popup timed out
 * retries a few times; past that it is a script.
 */
const limit = createRateLimit({ max: 20, windowMs: 5 * 60 * 1000, namespace: 'auth-wallet' });

/** A `G…` is 56 characters. The cap is a bound before any parsing, not a format check. */
const MAX_ADDRESS = 64;

/** The challenge is base64url of 32 bytes — 43 characters. */
const MAX_CHALLENGE = 64;

// There is deliberately no cap constant for `signedMessage`. It is forwarded as
// `unknown` so `decodeSignature` can recognise the v3 Buffer shape, and it is
// bounded twice already: `readBody` refuses a body over MAX_BODY before it is
// parsed, and `wallet-auth.ts` refuses a signature over 128 characters. A
// third bound here would only be a place for the three to disagree.

function field(body: Record<string, unknown>, name: string, max: number): string {
  const value = body[name];
  if (typeof value !== 'string' || value.length === 0) throw new BadRequest(`'${name}' is missing.`);
  if (value.length > max) throw new BadRequest(`'${name}' is longer than ${max} characters.`);
  return value;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const ip = clientIp(request);
    // `check` answers *"is this call over the budget"*, so the refusal is the
    // un-negated branch — the same shape as the other auth routes, and written
    // this way round deliberately: the inverted form refuses every request
    // inside the budget and admits every one beyond it, and fails open.
    if (await limit.check(ip)) return Response.json({ error: 'rate_limited' }, { status: 429 });

    const body = await readBody(request);
    const result = await loginWithWallet(authDeps(), {
      address: field(body, 'address', MAX_ADDRESS),
      challenge: field(body, 'challenge', MAX_CHALLENGE),
      // Passed through untouched rather than read as a string here. The v3
      // Buffer shape has to reach `decodeSignature` intact so it can be
      // refused *as a legacy wallet* — coercing it to a string first would
      // turn an actionable "update Freighter" into "the signature is not
      // base64", which tells the person nothing they can do anything about.
      signedMessage: body.signedMessage,
      ip,
    });

    await setSessionCookie(result.token, isSecureRequest(request));
    return Response.json({ user: publicUser(result.user) }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return failure(error);
  }
}
