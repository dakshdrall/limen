/**
 * Claude: structured rationale -> plain English.
 *
 * Claude has exactly two jobs in Limen, both of them here:
 *   1. explain a finished proposal in plain English
 *   2. ask one clarifying question about intent, and choose which of the
 *      server-defined widening options to offer
 *
 * It never authors policy. Its input is `proposal.rationale` — strings the
 * deterministic synthesizer already produced — and its output is prose plus a
 * selection from a fixed table. Nothing it returns reaches `synthesize` until
 * the user explicitly picks an option in the UI.
 */

import Anthropic from '@anthropic-ai/sdk';
import { HEADROOM_OPTIONS, HEADROOM_OPTION_IDS, resolveHeadroomOption } from '@/lib/headroom-options';

export const runtime = 'nodejs';

interface ExplainRequest {
  rationale?: unknown;
}

export interface ExplainedOption {
  id: string;
  label: string;
  headroomBps: number;
  windowLedgers: number;
}

export interface ExplainResponse {
  /** False when the explanation is unavailable; the UI falls back to raw rationale. */
  explained: boolean;
  explanation: string;
  question: string | null;
  options: ExplainedOption[];
  /** Human-readable reason the explanation is missing, when it is. */
  degraded?: string;
}

/** Every option, with its static labels. Used whenever Claude is unavailable. */
function staticOptions(): ExplainedOption[] {
  return HEADROOM_OPTIONS.map(({ id, label, headroomBps, windowLedgers }) => ({
    id,
    label,
    headroomBps,
    windowLedgers,
  }));
}

function degraded(reason: string): Response {
  // The deny table does not depend on this route. Losing Claude costs prose,
  // never correctness.
  return Response.json({
    explained: false,
    explanation: '',
    question: null,
    options: staticOptions(),
    degraded: reason,
  } satisfies ExplainResponse);
}

const SYSTEM_PROMPT = `You explain smart-account permission policies to developers reviewing them before installation.

You will be given the structured rationale lines emitted by a deterministic policy synthesizer. Each line describes one derived constraint.

Your job is to:
1. Explain, in plain English, what this policy permits and — just as importantly — what it refuses. Be concrete and specific. Name the actual functions and assets. Two to four sentences. No marketing language, no reassurance, no "this ensures your funds are safe".
2. Ask ONE clarifying question about the user's intent regarding how much spending headroom they want, and select which of the offered option ids are worth showing them.

You are NOT authoring policy. You cannot choose amounts, windows, or limits — only which pre-defined options to surface and how to phrase them. Write for a developer reading a security boundary, not a consumer.`;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    explanation: {
      type: 'string',
      description: 'Plain-English description of what the policy permits and refuses.',
    },
    question: {
      type: 'string',
      description: 'One clarifying question about spending headroom intent.',
    },
    optionIds: {
      type: 'array',
      description: 'Which of the offered option ids to show the user.',
      items: { type: 'string', enum: HEADROOM_OPTION_IDS },
    },
    optionLabels: {
      type: 'array',
      description: 'Labels for the chosen ids, in the same order as optionIds.',
      items: { type: 'string' },
    },
  },
  required: ['explanation', 'question', 'optionIds', 'optionLabels'],
  additionalProperties: false,
} as const;

export async function POST(request: Request): Promise<Response> {
  let body: ExplainRequest;
  try {
    body = (await request.json()) as ExplainRequest;
  } catch {
    return Response.json({ error: 'request body must be JSON' }, { status: 400 });
  }

  const rationale = Array.isArray(body.rationale)
    ? body.rationale.filter((line): line is string => typeof line === 'string')
    : [];

  if (rationale.length === 0) {
    return Response.json({ error: 'rationale must be a non-empty array of strings' }, { status: 400 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return degraded('ANTHROPIC_API_KEY is not set — showing the structured rationale instead.');
  }

  const client = new Anthropic();

  try {
    const message = await client.beta.messages.create({
      model: 'claude-opus-5',
      max_tokens: 16_000,
      thinking: { type: 'adaptive' },
      // Server-side refusal fallback: a declined request is re-run on the
      // recommended fallback model inside the same call rather than surfacing
      // as an error.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM_PROMPT,
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
      },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                'Derived policy rationale:',
                ...rationale.map((line) => `  ${line}`),
                '',
                'Offered option ids (you may select any subset, in any order):',
                ...HEADROOM_OPTIONS.map((o) => `  ${o.id} — ${o.label}`),
              ].join('\n'),
            },
          ],
        },
      ],
    });

    // Always check stop_reason before reading content: a refusal returns HTTP
    // 200 with empty or partial content.
    if (message.stop_reason === 'refusal') {
      return degraded('Claude declined to explain this proposal — showing the structured rationale instead.');
    }

    const text = message.content
      .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    if (text.trim().length === 0) {
      return degraded('Claude returned no explanation — showing the structured rationale instead.');
    }

    const parsed = JSON.parse(text) as {
      explanation?: unknown;
      question?: unknown;
      optionIds?: unknown;
      optionLabels?: unknown;
    };

    const ids = Array.isArray(parsed.optionIds) ? parsed.optionIds : [];
    const labels = Array.isArray(parsed.optionLabels) ? parsed.optionLabels : [];

    // Validation, not trust. Every id is resolved against the server-side
    // table; anything unrecognised is dropped rather than passed through. The
    // numbers below always come from `resolveHeadroomOption`, never from the
    // model's response.
    const options: ExplainedOption[] = [];
    ids.forEach((rawId, index) => {
      if (typeof rawId !== 'string') return;
      const option = resolveHeadroomOption(rawId);
      if (option === undefined) return;
      if (options.some((existing) => existing.id === option.id)) return;
      const label = labels[index];
      options.push({
        id: option.id,
        label: typeof label === 'string' && label.trim().length > 0 ? label : option.label,
        headroomBps: option.headroomBps,
        windowLedgers: option.windowLedgers,
      });
    });

    return Response.json({
      explained: true,
      explanation: typeof parsed.explanation === 'string' ? parsed.explanation : '',
      question: typeof parsed.question === 'string' ? parsed.question : null,
      // If Claude offered nothing usable, fall back to the full table rather
      // than leaving the user with no way to widen.
      options: options.length > 0 ? options : staticOptions(),
    } satisfies ExplainResponse);
  } catch (error) {
    return degraded(
      `Claude request failed (${error instanceof Error ? error.message : String(error)}) — showing the structured rationale instead.`,
    );
  }
}
