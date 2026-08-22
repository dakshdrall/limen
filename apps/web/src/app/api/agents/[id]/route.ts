/**
 * Editing the draft row, which is what regenerating does.
 *
 * Rewriting the description and generating again updates the agent that already
 * exists rather than creating a second one. Three attempts at describing the
 * same agent are one agent, and a row per attempt would make the first
 * question a dashboard has to answer — *which of these did I actually deploy* —
 * one it cannot.
 *
 * The lookup is scoped to the caller by `drizzleAgentStore`, in the `where`
 * clause rather than here. A missing row and a row belonging to someone else
 * are the same 404 on purpose: distinguishing them tells an unauthorised caller
 * that an id exists.
 */

import { cleanAgentName } from '@/lib/agents';
import { MAX_DESCRIPTION_LENGTH, MAX_NAME_LENGTH } from '@/lib/agent-config';
import { clientIp, createRateLimit } from '@/lib/rate-limit';
import { requireUser } from '@/lib/route-session';
import { drizzleAgentStore } from '@/lib/stores';

export const runtime = 'nodejs';

const limit = createRateLimit({ max: 40, windowMs: 5 * 60 * 1000, namespace: 'agents-update' });

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

  let body: { name?: unknown; description?: unknown };
  try {
    body = (await request.json()) as { name?: unknown; description?: unknown };
  } catch {
    return Response.json({ error: 'request body must be JSON' }, { status: 400 });
  }

  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (description.length === 0) {
    return Response.json({ error: 'description must not be empty' }, { status: 400 });
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return Response.json(
      { error: `description must be at most ${MAX_DESCRIPTION_LENGTH} characters` },
      { status: 400 },
    );
  }

  try {
    const agent = await drizzleAgentStore().updateDraft({
      id,
      userId: gate.user.id,
      name: cleanAgentName(body.name, MAX_NAME_LENGTH),
      description,
    });
    if (agent === undefined) return Response.json({ error: 'not_found' }, { status: 404 });
    return Response.json({ agent }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error('limen agents: could not update a draft', error);
    return Response.json({ error: 'unavailable' }, { status: 503 });
  }
}
