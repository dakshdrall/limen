/**
 * Who is calling the agent API.
 *
 * One question, the same one `route-session.ts` asks in the web app: **is there
 * a signed-in user, and who**. The answer comes from the same `sessions` table,
 * because there is one identity in this system and two processes reading it.
 *
 * ## The token arrives in a header, not a cookie, and that is not a workaround
 *
 * The session cookie is `SameSite=lax`, so a browser will not send it to the
 * runtime's origin on a cross-site POST — which is CSRF protection working as
 * designed, not an obstacle to route around. The web app is therefore the one
 * that talks to this API, on behalf of the person whose request it just
 * authenticated, and it presents the same session token as a bearer credential.
 * Nothing new is trusted: the token still has to hash to a live row.
 *
 * ## The hash is the contract, and divergence fails closed
 *
 * `sessions.token_hash` holds SHA-256 of the token, hex, and never the token —
 * `session.ts` gives the reason at length and it is N10's, the row this
 * project's threat table calls *"the whole argument"*. This module computes the
 * same hash independently rather than importing it, because `apps/web` is a
 * Next application this process cannot import from. If the two ever diverged,
 * every lookup here would miss and nobody would authenticate: the failure is
 * total and immediate, which is the direction a duplicated security constant
 * has to fail in.
 */

import { createHash } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import { sessions } from '@limen/db';
import type { RuntimeDb } from '@limen/db/runtime';

export interface Caller {
  userId: string;
  sessionId: string;
}

/** SHA-256, hex. The same function `apps/web/src/lib/session.ts` writes rows with. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** `Authorization: Bearer <token>`, or nothing. Never a query parameter. */
export function bearerToken(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1];
}

/**
 * The live session this token names, or nothing.
 *
 * Expiry is checked in the query rather than after it, for the reason
 * `session.ts` states: a row returned and then discarded by the caller is one
 * `if` away from a session that never ends.
 */
export async function resolveCaller(
  db: RuntimeDb,
  token: string | undefined,
  now: Date = new Date(),
): Promise<Caller | undefined> {
  if (token === undefined || token.length === 0) return undefined;

  const [row] = await db
    .select({ id: sessions.id, userId: sessions.userId })
    .from(sessions)
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, now)))
    .limit(1);

  return row === undefined ? undefined : { userId: row.userId, sessionId: row.id };
}
