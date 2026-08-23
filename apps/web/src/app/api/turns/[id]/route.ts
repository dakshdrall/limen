/**
 * What happened, for a browser that cannot ask the runtime directly.
 *
 * The client polls this; this asks the runtime. The hop exists because of the
 * credential: the session cookie is `SameSite=lax` and will not be sent to the
 * runtime's origin, and the alternative — handing the browser a bearer token to
 * present itself — would put a session credential in JavaScript's reach for the
 * sake of saving one hop. `runtime-client.ts` states the same reasoning from
 * the other end.
 *
 * The runtime scopes the turn to the caller, so a turn belonging to somebody
 * else comes back 404 there and 404 here. This route adds no check of its own
 * and should not: a second place to decide who owns a turn is a second place
 * for the answer to differ.
 */

import { clientIp, createRateLimit } from '@/lib/rate-limit';
import { requireUser } from '@/lib/route-session';
import { sessionToken } from '@/lib/auth-route';
import { readTurn } from '@/lib/runtime-client';

export const runtime = 'nodejs';

/**
 * Generous, because this is a poll. A turn runs for 15–45 seconds and the
 * client asks roughly once a second, so a limit tuned like the chat route's
 * would cut off a conversation in the middle of its second answer.
 */
const limit = createRateLimit({ max: 600, windowMs: 10 * 60 * 1000, namespace: 'turn-poll' });

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const gate = await requireUser();
  if ('refusal' in gate) return gate.refusal;

  if (await limit.check(clientIp(request))) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }

  const { id } = await params;
  const result = await readTurn(id, await sessionToken());

  if (!result.ok) {
    const status = result.kind === 'http' ? result.status : 503;
    return Response.json(
      {
        error: result.kind === 'http' ? result.error : result.kind,
        message: result.kind === 'http' ? undefined : result.detail,
      },
      { status },
    );
  }

  return Response.json(result.value);
}
