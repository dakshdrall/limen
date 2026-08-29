/**
 * Giving an agent a schedule, which is the moment it stops needing a person.
 *
 * Everything before this milestone happened because somebody pressed something.
 * This route is where that stops being true, so it is deliberately the narrowest
 * thing that can be true: an interval, on an agent that is already deployed and
 * `ACTIVE`, anchored at a first slot the caller can see.
 *
 * ## `POST` both creates and re-arms, on purpose
 *
 * After the breaker has stopped a schedule, the act that starts it again is a
 * person deciding the cause has gone — the same deliberate act as setting one
 * up. A separate "resume" button would be a way to restart a broken schedule
 * without ever having to look at why it broke, which is the failure the breaker
 * exists to prevent, reintroduced one screen along.
 *
 * `disabled_at` and `disabled_reason` are kept rather than cleared. They record
 * a stop that really happened. What resets is `consecutive_failures`, because
 * the count is a claim about the present.
 *
 * ## The first slot is now, and the grid is anchored to it
 *
 * `next_run_at` starts at the instant the schedule is armed, so the first cycle
 * runs within a tick rather than an interval later. That is also what makes
 * `due_at` predictable: every later slot is this instant plus a whole number of
 * intervals, which is the grid the partial unique index is meaningful over.
 *
 * ## Not a boundary
 *
 * An interval bounds nothing. It changes how often the agent is *asked*, and
 * every cycle that results still goes through the same gate and the same
 * installed cap. Nothing here may be rendered beside the cap for the reason
 * `enforced_offchain_json` has that name.
 */

import { clientIp, createRateLimit } from '@/lib/rate-limit';
import { requireUser } from '@/lib/route-session';
import { drizzleAgentStore } from '@/lib/stores';

export const runtime = 'nodejs';

const limit = createRateLimit({ max: 30, windowMs: 5 * 60 * 1000, namespace: 'agents-schedule' });

/**
 * The bounds on an interval, and why each end is where it is.
 *
 * A minute is the floor because the tick is thirty seconds: anything shorter
 * would claim a slot it could not have run yet and would silently behave as a
 * one-minute schedule anyway. A day is the ceiling because a longer interval is
 * a calendar, which is what `cron` is still in the schema for.
 */
export const MIN_INTERVAL_SECONDS = 60;
export const MAX_INTERVAL_SECONDS = 86_400;

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

  let body: { intervalSeconds?: unknown };
  try {
    body = (await request.json()) as { intervalSeconds?: unknown };
  } catch {
    return Response.json({ error: 'request body must be JSON' }, { status: 400 });
  }

  const intervalSeconds = body.intervalSeconds;
  if (
    typeof intervalSeconds !== 'number' ||
    !Number.isInteger(intervalSeconds) ||
    intervalSeconds < MIN_INTERVAL_SECONDS ||
    intervalSeconds > MAX_INTERVAL_SECONDS
  ) {
    return Response.json(
      {
        error: 'bad_interval',
        detail:
          `intervalSeconds must be a whole number of seconds between ${MIN_INTERVAL_SECONDS} and ` +
          `${MAX_INTERVAL_SECONDS}.`,
      },
      { status: 400 },
    );
  }

  const store = drizzleAgentStore();
  const firstRunAt = new Date();
  const schedule = await store.setSchedule({
    agentId: id,
    userId: gate.user.id,
    intervalSeconds,
    firstRunAt,
  });

  if (schedule === undefined) {
    const existing = await store.findForUser(id, gate.user.id);
    if (existing === undefined) return Response.json({ error: 'not_found' }, { status: 404 });
    return Response.json(
      {
        error: 'not_active',
        status: existing.status,
        detail:
          `Only a deployed, ACTIVE agent can be given a schedule. This agent is ${existing.status}. ` +
          `A schedule on an undeployed agent would claim slots for cycles that cannot run, and the ` +
          `breaker would then stop it for something that was never the agent's fault.`,
      },
      { status: 409 },
    );
  }

  return Response.json({ schedule });
}

/** Remove the schedule. An agent with none is not an agent that was stopped. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const gate = await requireUser();
  if ('refusal' in gate) return gate.refusal;

  if (await limit.check(clientIp(request))) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }

  const { id } = await params;
  const removed = await drizzleAgentStore().clearSchedule({ agentId: id, userId: gate.user.id });
  if (!removed) return Response.json({ error: 'not_found' }, { status: 404 });
  // A cycle already queued or running is left alone, for the reason the pause
  // route gives: a turn that may have submitted is never treated as cancelled.
  return Response.json({ schedule: null, inFlightUnaffected: true });
}
