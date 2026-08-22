/**
 * Who is calling, for routes that are not the auth ceremonies.
 *
 * `auth-route.ts` is *"what the five auth routes share"* and deliberately says
 * so; this is what everything else shares, which is one question: **is there a
 * signed-in user, and who.** It is a separate module rather than a sixth export
 * there because the auth routes' error mapping is tuned to not being an oracle
 * for an attacker probing a login, and an ordinary route wants the opposite —
 * to say plainly that you are not signed in.
 *
 * ## Three outcomes, and the third is not an error
 *
 * `unavailable` means this deployment has no `DATABASE_URL`, so there are no
 * users at all. `db.ts` refuses at the point of use rather than at startup, and
 * that refusal arrives here as a thrown error from `webDb()`. Reporting it as
 * "not signed in" would send someone to a sign-in control that also cannot
 * work; reporting it as a 500 would call a deliberate configuration an outage.
 * It is a 503, and the screens that call these routes already render their own
 * state for it.
 */

import 'server-only';
import { currentUser } from './auth';
import { authDeps, sessionToken } from './auth-route';
import type { UserRecord } from './auth';

/**
 * The user, or the response to return instead.
 *
 * One value rather than a state plus a separate `refuse(state)`, because the
 * two-call shape does not narrow: after `if (refusal !== null) return refusal`
 * TypeScript still believes the state might be signed-out, and every route
 * ends up with a second impossible branch to satisfy it. A branch written to
 * satisfy the compiler is a branch nobody has thought about.
 *
 * So a route reads:
 *
 *     const gate = await requireUser();
 *     if ('refusal' in gate) return gate.refusal;
 *     // gate.user is a UserRecord here, by construction.
 */
export type Gate = { user: UserRecord } | { refusal: Response };

export async function requireUser(): Promise<Gate> {
  let user: UserRecord | undefined;
  try {
    user = await currentUser(authDeps(), await sessionToken());
  } catch {
    // `webDb()` throws with no `DATABASE_URL`. Deliberately not distinguished
    // from a database that is down: both mean this request cannot be answered,
    // and the difference is an operator's to find in the logs rather than a
    // caller's to read in a response body.
    return { refusal: Response.json({ error: 'unavailable' }, { status: 503 }) };
  }

  return user === undefined
    ? { refusal: Response.json({ error: 'unauthenticated' }, { status: 401 }) }
    : { user };
}
