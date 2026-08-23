/**
 * A sentence in, a turn id out.
 *
 * This is the seam between the two halves of the web chat. It does four things
 * and deliberately not a fifth:
 *
 *   1. Authenticate, and scope the agent to the signed-in user.
 *   2. Ask the model which tool the message wants (`chat.ts`).
 *   3. Hand that tool to the runtime, which runs it (`runtime-client.ts`).
 *   4. Return the turn id the client polls.
 *
 * The fifth — waiting for the result — is what §7.5.4 rules out. A turn takes
 * 15–45 seconds and can move money; a handler that awaited one would be killed
 * by the platform somewhere in the middle, and a payment in flight inside a
 * dead handler is the failure the whole accept-fast shape exists to prevent.
 *
 * ## The agent is looked up here even though the runtime looks it up again
 *
 * `postTurn` scopes the agent to the caller too, and that check is the one that
 * counts. This one exists so a message to somebody else's agent — or to an
 * agent that was never deployed — costs nothing at the model. Spending an Opus
 * call to discover a 404 is a bill for a question already answerable.
 */

import { clientIp, createRateLimit } from '@/lib/rate-limit';
import { requireUser } from '@/lib/route-session';
import { sessionToken } from '@/lib/auth-route';
import { drizzleAgentStore } from '@/lib/stores';
import { decideChatTurn, type ChatTurn } from '@/lib/chat';
import { startTurn } from '@/lib/runtime-client';

export const runtime = 'nodejs';

/**
 * Tighter than the deploy route's. Every accepted message is an Opus call and
 * possibly a payment, and both are worth a budget.
 */
const limit = createRateLimit({ max: 30, windowMs: 10 * 60 * 1000, namespace: 'agent-chat' });

/** Long enough to say something, short enough that nobody pastes a novel. */
const MAX_MESSAGE = 2_000;

/**
 * How much of the conversation is sent back to the model.
 *
 * History is carried by the client rather than read from `conversations`, and
 * that is a scope decision worth naming: it makes this route stateless and the
 * transcript per-tab. It is also why the cap is here — the client is untrusted,
 * so the bound on what reaches the model has to be enforced server-side.
 */
const MAX_HISTORY = 20;

interface ChatBody {
  message?: unknown;
  history?: unknown;
}

function parseHistory(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (entry): entry is { role: 'user' | 'assistant'; text: string } =>
        typeof entry === 'object' &&
        entry !== null &&
        'role' in entry &&
        'text' in entry &&
        (entry.role === 'user' || entry.role === 'assistant') &&
        typeof entry.text === 'string' &&
        entry.text.length > 0,
    )
    .slice(-MAX_HISTORY)
    .map((entry) => ({ role: entry.role, text: entry.text.slice(0, MAX_MESSAGE) }));
}

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

  let body: ChatBody;
  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return Response.json({ error: 'bad_request', message: 'Body must be JSON.' }, { status: 400 });
  }

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (message.length === 0) {
    return Response.json({ error: 'bad_request', message: 'A message is required.' }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE) {
    return Response.json(
      { error: 'bad_request', message: `A message is at most ${MAX_MESSAGE} characters.` },
      { status: 400 },
    );
  }

  const agent = await drizzleAgentStore().findForUser(id, gate.user.id);
  if (agent === undefined) return Response.json({ error: 'not_found' }, { status: 404 });

  if (agent.status !== 'ACTIVE') {
    // A tool call against an undeployed agent has no account to act on. Said
    // here rather than discovered in the worker, where it would arrive as an
    // infrastructure error and read like an outage.
    return Response.json(
      {
        error: 'not_active',
        message: `This agent is ${agent.status}. Deploy it before talking to it.`,
      },
      { status: 409 },
    );
  }

  const decision = await decideChatTurn(message, parseHistory(body.history));

  // Two of the three arms never reach the runtime. Neither is a failure of the
  // agent — one is the model answering in words, the other is §4.4's *agent
  // error* — and both are returned as themselves rather than as a broken turn.
  if (decision.kind === 'text') {
    return Response.json({ kind: 'text', text: decision.text });
  }
  if (decision.kind === 'agent_error') {
    return Response.json({ kind: 'agent_error', detail: decision.detail });
  }

  const started = await startTurn(id, await sessionToken(), {
    tool: decision.tool,
    arguments: decision.arguments,
    channel: 'web',
  });

  if (!started.ok) {
    // The runtime's failures are reported as the runtime's, with the word it
    // used. A 400 `unknown_tool` here means `chat.ts` and the runtime's tool
    // table have drifted, and flattening it to "something went wrong" would
    // hide the one clue that says so.
    const status = started.kind === 'http' ? started.status : 503;
    return Response.json(
      {
        error: started.kind === 'http' ? started.error : started.kind,
        message:
          started.kind === 'http'
            ? `The runtime refused this turn (${started.error}).`
            : started.detail,
      },
      { status },
    );
  }

  return Response.json(
    { kind: 'turn', turnId: started.value.turnId, tool: decision.tool, arguments: decision.arguments },
    { status: 202 },
  );
}
