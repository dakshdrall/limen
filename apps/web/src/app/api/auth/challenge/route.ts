/**
 * The first half of both ceremonies: a challenge, minted here.
 *
 * One route for registration and login rather than two, because the two would
 * be the same fourteen lines and the purpose is already a first-class value —
 * `challenge.ts` namespaces the stored key by it, and `consumeChallenge`
 * refuses a challenge presented to the other ceremony. Splitting the route
 * would not add a check; it would add a second place for the rate limit to be
 * set differently.
 *
 * The response carries no identity and reads nothing about the caller. That is
 * the point of a challenge: it is a random value that means nothing until it
 * comes back inside a signature.
 */

import { createRateLimit, clientIp } from '@/lib/rate-limit';
import { issueChallenge, type ChallengePurpose } from '@/lib/challenge';
import { BadRequest, failure, readBody } from '@/lib/auth-route';

/**
 * A person logging in makes one of these. A person retrying a biometric prompt
 * makes a few. Anything past that is a script, and the thing it would be doing
 * is filling Redis with two-minute keys.
 */
const limit = createRateLimit({ max: 20, windowMs: 5 * 60 * 1000, namespace: 'auth-challenge' });

/**
 * The purpose, checked against a written-out list rather than a cast.
 *
 * Every member is named here on purpose. `ChallengePurpose` gained `'wallet'`
 * when wallet sign-in landed and this guard did not, so the route kept refusing
 * the one purpose the new ceremony needed — a 400 at the first step of a flow
 * whose every other part was in place. Widening a union does not widen the
 * validator that admits it, and the only thing that would have caught this
 * earlier is the check being somewhere a type error could reach it.
 *
 * It stays an explicit list rather than becoming a set derived from the type,
 * because a purpose is a thing this endpoint hands out to unauthenticated
 * callers. A guard that admits whatever the union happens to contain would
 * silently start minting challenges for any ceremony added later, including one
 * that was never meant to be reachable from here.
 */
const PURPOSES: readonly ChallengePurpose[] = ['register', 'login', 'wallet'];

function purposeOf(body: Record<string, unknown>): ChallengePurpose {
  const purpose = PURPOSES.find((candidate) => candidate === body.purpose);
  if (purpose !== undefined) return purpose;
  throw new BadRequest(`'purpose' must be one of: ${PURPOSES.join(', ')}.`);
}

export async function POST(request: Request): Promise<Response> {
  try {
    // `check` answers *"is this call over the budget"*, so the refusal is the
    // un-negated branch. Written the other way round this route refuses every
    // request inside the budget and admits every request beyond it, and it
    // fails **closed** on a store outage instead of open — which is how it read
    // until the M1 close-out run put a browser in front of it.
    if (await limit.check(clientIp(request))) {
      return Response.json({ error: 'rate_limited' }, { status: 429 });
    }
    const issued = await issueChallenge(purposeOf(await readBody(request)));
    return Response.json(issued, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return failure(error);
  }
}
