/**
 * Run one trading cycle.
 *
 * Thin on purpose. Everything that decides anything is in the runtime — the
 * price read, the trigger, the gate, the signature — and this route's whole job
 * is to check that the caller owns this agent and hand the request across.
 * A cycle can move money, so it is authenticated and rate-limited like the chat
 * route it sits beside, and it enqueues rather than executing: the answer comes
 * back by polling the turn, the same way every other write does.
 *
 * The trigger arrives from the screen rather than from storage, and that is
 * stated rather than hidden. The builder does not collect one yet, so an agent
 * has no stored rule that says when to trade; the detail screen asks for it,
 * prefilled from the live price. A cycle with no trigger reads the price and
 * trades nothing — which is a real outcome and is reported as one.
 *
 * `TODO(roadmap)`: collect the trigger in the builder and store it beside the
 * off-chain constraints, so a cycle is reproducible from the agent alone.
 */

import { clientIp, createRateLimit } from '@/lib/rate-limit';
import { requireUser } from '@/lib/route-session';
import { sessionToken } from '@/lib/auth-route';
import { drizzleAgentStore } from '@/lib/stores';
import { startCycle } from '@/lib/runtime-client';

export const runtime = 'nodejs';

/**
 * Tighter than the chat's budget, because a cycle can submit without anybody
 * typing. Six a minute is a person pressing a button; past that it is a loop,
 * and a loop is the scheduler this milestone deliberately does not have.
 */
const limit = createRateLimit({ max: 6, windowMs: 60 * 1000, namespace: 'agent-cycle' });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const gate = await requireUser();
  if ('refusal' in gate) return gate.refusal;

  if (await limit.check(clientIp(request))) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }

  const { id } = await params;

  // Scoped by owner in the query, so somebody else's agent is not found rather
  // than found-and-refused. The runtime checks again on its own side; this one
  // is here so a 404 does not depend on the runtime being reachable.
  const agent = await drizzleAgentStore().findForUser(id, gate.user.id);
  if (agent === undefined) return Response.json({ error: 'not_found' }, { status: 404 });

  let body: { config?: unknown };
  try {
    body = (await request.json()) as { config?: unknown };
  } catch {
    return Response.json({ error: 'bad_request', message: 'Body must be JSON.' }, { status: 400 });
  }

  const config = body.config;
  if (typeof config !== 'object' || config === null) {
    return Response.json(
      { error: 'bad_request', message: 'config must be an object naming the pair to trade.' },
      { status: 400 },
    );
  }

  const started = await startCycle(id, await sessionToken(), {
    config: config as Record<string, unknown>,
    channel: 'web',
  });

  if (!started.ok) {
    // The runtime's word for its own refusal, kept rather than flattened —
    // `chat/route.ts` gives the reason: a 400 from over there is the one clue
    // that this app and the runtime have drifted.
    const status = started.kind === 'http' ? started.status : 503;
    return Response.json(
      {
        error: started.kind === 'http' ? started.error : started.kind,
        message:
          started.kind === 'http'
            ? `The runtime refused this cycle (${started.error}).`
            : started.detail,
      },
      { status },
    );
  }

  return Response.json(started.value, { headers: { 'cache-control': 'no-store' } });
}
