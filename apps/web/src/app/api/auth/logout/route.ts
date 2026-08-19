/**
 * Logout: the row goes, and then the cookie goes.
 *
 * That order is the whole file. Clearing the cookie alone would leave a live
 * session token in the hands of whoever last held it — including a copy in a
 * proxy log or a browser that synced it — and "logged out" would mean "this
 * browser has forgotten", which is not what a person asking to log out is
 * asking for. `endSession` deletes the row, so the token stops working
 * everywhere on the next request, and the cookie is then cleared so this
 * browser stops sending a value that no longer names anything.
 *
 * POST rather than GET, and not only out of convention: a GET logout is a URL
 * anybody can put in an image tag, and `sameSite: 'lax'` sends the cookie on
 * top-level GETs. It would be a working cross-site logout. The cookie is not
 * sent on a cross-site POST, which is `session.ts`'s stated reason for `lax`
 * doing CSRF work here.
 */

import { endSession } from '@/lib/session';
import { drizzleSessionStore } from '@/lib/stores';
import { clearSessionCookie, failure, isSecureRequest, sessionToken } from '@/lib/auth-route';

export async function POST(request: Request): Promise<Response> {
  try {
    await endSession(drizzleSessionStore(), await sessionToken());
    await clearSessionCookie(isSecureRequest(request));
    // 204 whether or not there was a session. "You are logged out" is true in
    // both cases, and a different answer for "there was nothing to end" would
    // tell an unauthenticated caller whether a cookie it holds is live.
    return new Response(null, { status: 204 });
  } catch (error) {
    return failure(error);
  }
}
