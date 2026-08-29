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
 * The request carries nothing but the intent. The pair and the trigger are the
 * agent's own — collected by the builder, stored on the row, and read by the
 * runtime when it runs the cycle — so this route cannot influence what the
 * agent does beyond asking it to act once. A cycle is therefore reproducible
 * from the agent alone: press the button twice and the same rule is evaluated
 * twice, against whatever the price is at the time.
 *
 * An agent with no trigger reads the price and trades nothing, which is a real
 * outcome and is reported as one rather than as a failure.
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

  // No body is read, and none is required. There is nothing a caller could put
  // in one that this route would honour — the strategy is on the agent — so
  // parsing one would only create a way for a request to look like it
  // configured something it did not.
  const started = await startCycle(id, await sessionToken(), { channel: 'web' });

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
