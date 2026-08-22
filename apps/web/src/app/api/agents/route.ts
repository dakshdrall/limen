/**
 * Creating the row an agent is.
 *
 * `POST` writes a `DRAFT`. That happens the moment a description has been
 * turned into a proposed draft — before anything is configured, before an asset
 * has been chosen, and long before anything reaches a chain — because the row
 * is what gives the rest of the flow something to attach to and what makes an
 * abandoned attempt visible rather than lost.
 *
 * **No policy row is written here, and the absence is deliberate.** A described
 * agent has no installable boundary until a person supplies the token contract,
 * which the model is structurally unable to propose. Writing a `policies` row
 * now would mean writing one whose `proposal_json` is null and whose meaning is
 * "we had not finished asking" — which is what `DRAFT` on the agent already
 * says, in the column built to say it. The policy lands at `CONFIGURED`.
 */

import { cleanAgentName } from '@/lib/agents';
import { MAX_DESCRIPTION_LENGTH, MAX_NAME_LENGTH } from '@/lib/agent-config';
import { clientIp, createRateLimit } from '@/lib/rate-limit';
import { requireUser } from '@/lib/route-session';
import { drizzleAgentStore } from '@/lib/stores';

export const runtime = 'nodejs';

/** Writes a row per call, so it is bounded the way `/api/auth/register` is. */
const limit = createRateLimit({ max: 20, windowMs: 5 * 60 * 1000, namespace: 'agents-create' });

export async function POST(request: Request): Promise<Response> {
  const gate = await requireUser();
  if ('refusal' in gate) return gate.refusal;

  if (await limit.check(clientIp(request))) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }

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
    const agent = await drizzleAgentStore().createDraft({
      userId: gate.user.id,
      // The model is told to leave a name empty rather than invent one, and
      // `agents.name` is NOT NULL. Naming the row for what it is keeps the
      // draft and its description; the review step requires a real name before
      // anything deploys.
      name: cleanAgentName(body.name, MAX_NAME_LENGTH),
      description,
    });
    return Response.json({ agent }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    // Not returned to the caller: the text of an unexpected database error is
    // one of the few places a connection string turns up. Same rule as
    // `auth-route.ts`'s `failure`.
    console.error('limen agents: could not create a draft', error);
    return Response.json({ error: 'unavailable' }, { status: 503 });
  }
}
