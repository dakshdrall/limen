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

function purposeOf(body: Record<string, unknown>): ChallengePurpose {
  if (body.purpose === 'register' || body.purpose === 'login') return body.purpose;
  throw new BadRequest("'purpose' must be 'register' or 'login'.");
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
