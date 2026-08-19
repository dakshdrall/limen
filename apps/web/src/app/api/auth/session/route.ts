/**
 * Who the cookie names, or nobody.
 *
 * `{ user: null }` with a 200 rather than a 401, because "not logged in" is a
 * successful answer to this question — it is what the app asks on every load to
 * decide which screen to render, and an error status for the ordinary case
 * makes every console and every error-reporting hook noisier for no reader's
 * benefit.
 *
 * `no-store`, and the route is uncached by construction: reading a cookie is a
 * request-time API, so Next cannot prerender this. The header is there for the
 * hop in between — a proxy that cached this response would serve one person's
 * identity to the next.
 */

import { currentUser } from '@/lib/auth';
import { drizzleSessionStore, drizzleUserStore } from '@/lib/stores';
import { base64Url, failure, sessionToken } from '@/lib/auth-route';

export async function GET(): Promise<Response> {
  try {
    const user = await currentUser(
      { users: drizzleUserStore(), sessions: drizzleSessionStore() },
      await sessionToken(),
    );

    return Response.json(
      {
        user:
          user === undefined
            ? null
            : { id: user.id, displayName: user.displayName, credentialId: base64Url(user.credentialId) },
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    return failure(error);
  }
}
