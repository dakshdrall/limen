/**
 * A sentence in, a draft configuration out.
 *
 * The second of Claude's jobs in Limen, and the same shape as the first. In
 * `/api/explain` the model reads a finished proposal and explains it; here it
 * reads a description and proposes form fields. Neither authors policy, and
 * this one is further from doing so than it looks: what it returns is the same
 * `AgentConfigDraft` a person typing into an empty form produces, and it takes
 * the same path through `validate` afterwards.
 *
 * `lib/agent-generation.ts` holds the prompt, the schema and the re-derivation
 * of every field. This file is the adapter: session, rate limit, call, degrade.
 *
 * ## Degradation is a first-class path, not an error
 *
 * With no `ANTHROPIC_API_KEY` this returns an empty draft carrying the
 * description, and the screen renders the form for the person to fill in
 * themselves. That is the whole feature minus the convenience, and it is what
 * CI exercises, since CI has no key. `/api/explain` takes the same position and
 * says why: losing Claude costs prose, never correctness. Here it costs typing.
 *
 * ## Why this needs a session when `/api/explain` does not
 *
 * It spends money per call. `/api/explain` is reachable from a public screen
 * and is bounded by a rate limit alone; this one is only reachable from a
 * screen that already requires a sign-in, so requiring one here costs nothing
 * and closes an unauthenticated hole into a paid API. The rate limit is still
 * there, because a session is not a budget.
 */

import Anthropic from '@anthropic-ai/sdk';
import { requireUser } from '@/lib/route-session';
import { clientIp, createRateLimit } from '@/lib/rate-limit';
import { MAX_DESCRIPTION_LENGTH, emptyDraft, type AgentConfigDraft } from '@/lib/agent-config';
import {
  GENERATION_MODEL,
  OUTPUT_SCHEMA,
  SYSTEM_PROMPT,
  draftFromModel,
  userPrompt,
  type GenerationNote,
} from '@/lib/agent-generation';

export const runtime = 'nodejs';

export interface GenerateResponse {
  /** False when the draft is empty because the model was unavailable. */
  generated: boolean;
  draft: AgentConfigDraft;
  notes: GenerationNote[];
  /** Why the draft is empty, when it is. Rendered, not logged. */
  degraded?: string;
}

/** Ten generations per five minutes. Each one is a paid upstream call. */
const limit = createRateLimit({ max: 10, windowMs: 5 * 60 * 1000, namespace: 'agents-generate' });

function degraded(description: string, reason: string): Response {
  return Response.json({
    generated: false,
    draft: { ...emptyDraft(), description },
    notes: [],
    degraded: reason,
  } satisfies GenerateResponse);
}

export async function POST(request: Request): Promise<Response> {
  let description: string;
  try {
    const body = (await request.json()) as { description?: unknown };
    if (typeof body.description !== 'string') throw new Error('description must be a string');
    description = body.description.trim();
  } catch (error) {
    return Response.json(
      {
        error: `request body must be {"description": string}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
      { status: 400 },
    );
  }

  if (description.length === 0) {
    return Response.json({ error: 'description must not be empty' }, { status: 400 });
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return Response.json(
      { error: `description must be at most ${MAX_DESCRIPTION_LENGTH} characters` },
      { status: 400 },
    );
  }

  // The session first, so an unauthenticated caller cannot spend a rate-limit
  // slot — let alone an upstream call.
  const gate = await requireUser();
  if ('refusal' in gate) return gate.refusal;

  if (await limit.check(clientIp(request))) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return degraded(
      description,
      'ANTHROPIC_API_KEY is not set, so nothing was generated. Fill the limits in yourself — the review step is the same either way.',
    );
  }

  const client = new Anthropic();

  try {
    const message = await client.beta.messages.create({
      model: GENERATION_MODEL,
      max_tokens: 8_000,
      thinking: { type: 'adaptive' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM_PROMPT,
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
      },
      messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt(description) }] }],
    });

    // A refusal returns HTTP 200 with empty or partial content, so `stop_reason`
    // is checked before anything reads `content`.
    if (message.stop_reason === 'refusal') {
      return degraded(
        description,
        'Claude declined to draft this agent. Fill the limits in yourself, or rewrite the description.',
      );
    }

    const text = message.content
      .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    if (text.trim().length === 0) {
      return degraded(description, 'Claude returned nothing. Fill the limits in yourself.');
    }

    const { draft, notes } = draftFromModel(JSON.parse(text), description);
    return Response.json({ generated: true, draft, notes } satisfies GenerateResponse);
  } catch (error) {
    return degraded(
      description,
      `The draft could not be generated (${
        error instanceof Error ? error.message : String(error)
      }). Fill the limits in yourself.`,
    );
  }
}
