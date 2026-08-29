/**
 * Stopping a schedule on purpose, which is the half a breaker is not.
 *
 * The scheduler's due query filters on `agents.status = 'ACTIVE'`, so this one
 * status change stops every schedule the agent has, and stops it inside the
 * statement that makes the claim rather than in a caller that could forget. No
 * separate flag, and nothing to keep in sync.
 *
 * ## Pausing is not disabling, and the row says which
 *
 * A schedule the breaker tripped carries `disabled_at` and `disabled_reason`;
 * this route never writes either. That is deliberate: *a person turned this
 * off* and *Limen stopped it after three failures* are different facts, and a
 * screen that rendered them the same would let somebody resume a schedule
 * without ever learning why it stopped.
 *
 * Resuming does the mirror image, and also does **not** clear a tripped
 * breaker's columns. Those are history. What ends the breaker's count is a
 * cycle that succeeds, which is the only evidence that the thing it was
 * counting has actually stopped happening.
 *
 * ## A cycle already in flight is not cancelled
 *
 * Pausing stops the *next* claim. A turn already queued or running is left
 * alone, because a turn that may have submitted must never be treated as
 * cancelled — the same rule `turn.ts` follows for a redelivery. The response
 * says so rather than implying a stop that did not happen.
 */

import { clientIp, createRateLimit } from '@/lib/rate-limit';
import { requireUser } from '@/lib/route-session';
import { drizzleAgentStore } from '@/lib/stores';

export const runtime = 'nodejs';

const limit = createRateLimit({ max: 40, windowMs: 5 * 60 * 1000, namespace: 'agents-pause' });

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const gate = await requireUser();
  if ('refusal' in gate) return gate.refusal;

  if (await limit.check(clientIp(request))) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }

  const { id } = await params;

  let body: { paused?: unknown };
  try {
    body = (await request.json()) as { paused?: unknown };
  } catch {
    return Response.json({ error: 'request body must be JSON' }, { status: 400 });
  }

  // Required rather than a toggle. A toggle read from a stale screen flips the
  // opposite way to the one the person pressing it intended, and the thing
  // being flipped is whether an agent trades unattended.
  if (typeof body.paused !== 'boolean') {
    return Response.json({ error: 'paused must be true or false' }, { status: 400 });
  }

  const store = drizzleAgentStore();
  const agent = await store.setPaused({ agentId: id, userId: gate.user.id, paused: body.paused });

  if (agent === undefined) {
    // Either it is not this user's, or it is not in the status this transition
    // starts from. Read back so the answer names the status it actually found
    // instead of asserting one — and still a 404 for a row that is not theirs,
    // because telling an unauthorised caller that an id exists is the
    // distinction worth not making.
    const existing = await store.findForUser(id, gate.user.id);
    if (existing === undefined) return Response.json({ error: 'not_found' }, { status: 404 });
    return Response.json(
      {
        error: 'wrong_status',
        status: existing.status,
        detail:
          `Only an ACTIVE agent can be paused and only a PAUSED one resumed. This agent is ` +
          `${existing.status}.`,
      },
      { status: 409 },
    );
  }

  const schedule = await store.schedule(id, gate.user.id);

  return Response.json({
    status: agent.status,
    schedule: schedule ?? null,
    // Said out loud, because the one wrong thing to conclude from a successful
    // pause is that whatever the agent was doing has been stopped.
    inFlightUnaffected: true,
  });
}
