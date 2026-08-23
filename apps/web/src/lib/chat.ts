/**
 * The step between a sentence and a tool call, and the step it deliberately is not.
 *
 * The web chat has two halves and they run in different processes. This is the
 * first: a message like *"what's my balance"* becomes `{ tool: 'get_balance' }`,
 * or a message like *"hello"* becomes a sentence back. The second half — running
 * the tool — is `apps/runtime`, reached over HTTP, because a payment that is
 * only in flight inside a Next.js request handler is a payment that disappears
 * when the handler does (§7.5.4).
 *
 * ## One model call, not an agent loop
 *
 * The obvious shape here is a tool-use loop: ask the model, run the tool, hand
 * the result back, let it narrate. This does the first turn only, and stops.
 *
 * That is a §4.4 decision rather than a cost one. A `ToolResult` is already a
 * five-way outcome with a constraint name, a ledger opinion and sometimes a
 * transaction hash, and §4.4's whole point is that *refused by Limen* must not
 * borrow *refused by the network*'s badge. Handing that union to a model and
 * asking it to describe the outcome is exactly how the badge gets borrowed: the
 * model has no way to know that the absence of a hash is a finding rather than
 * a field it should smooth over. So the structured result is rendered as
 * itself, by the client, from the union — and the model's job ends at choosing
 * which tool to call.
 *
 * The model is therefore never told what happened. It cannot apologise for a
 * refusal, explain one away, or claim a payment settled. It picks a tool.
 *
 * ## The tool definitions are declared here, not imported
 *
 * `apps/web` does not depend on `@limen/runtime` and should not start now — the
 * runtime holds a key provider and a database pool, and importing it into a
 * React app to reach two JSON schemas would drag both across a boundary that
 * exists on purpose.
 *
 * The cost is that these definitions can drift from the runtime's. That is
 * bounded rather than ignored: the runtime validates arguments against its own
 * Zod schema and returns `unknown_tool` for a name it does not have, so drift
 * surfaces as a refused turn and not as a wrong payment. `chat.test.ts` pins the
 * two names, and `tools/index.ts` is the file to change when a third is added.
 */

import 'server-only';
import Anthropic from '@anthropic-ai/sdk';

/**
 * The same model the draft generator uses, and for the same reason: this is the
 * step where a misread sentence becomes a transfer, so it is not the place to
 * economise.
 */
export const CHAT_MODEL = 'claude-opus-5';

/**
 * Mirrors `apps/runtime/src/tools/*`. The descriptions are copied rather than
 * paraphrased — they are what the model reads to decide, and a description that
 * drifts from the tool's actual behaviour is a bug that looks like a prompt.
 */
const TOOL_DEFINITIONS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'get_balance',
    description:
      "Read the agent's smart account balance and the balance of the classic account that pays its " +
      'transaction fees. Both are returned in stroops with the ledger they were read at.',
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    name: 'send_payment',
    description:
      'Send XLM from the agent’s smart account to an address. The amount is in stroops — the smallest ' +
      'unit, 1 XLM = 10,000,000 stroops — as a string of digits, never a decimal.',
    input_schema: {
      type: 'object',
      properties: {
        destination: {
          type: 'string',
          description:
            'A Stellar address: 56 characters starting with G (an account) or C (a contract).',
        },
        stroops: {
          type: 'string',
          description:
            'A positive whole number of stroops, as a string of digits. 1 XLM = 10000000 stroops. ' +
            'Never a decimal, and never abbreviated.',
        },
      },
      required: ['destination', 'stroops'],
      additionalProperties: false,
    },
    strict: true,
  },
];

/** The names above, for the test that pins them and for callers that list them. */
export const CHAT_TOOL_NAMES = TOOL_DEFINITIONS.map((tool) => tool.name);

const SYSTEM_PROMPT = [
  'You are the conversational front end of a Limen agent — a Stellar account that acts on its',
  "owner's behalf inside limits the owner set, enforced by the network rather than by you.",
  '',
  'Your only job is to decide which tool a message is asking for, and to call it. You do not',
  'report results: the interface renders what the tool returns, with its own provenance. So call',
  'a tool and stop, or answer briefly when no tool applies.',
  '',
  'Rules that matter:',
  '- Amounts are in stroops, as a string of digits. 1 XLM = 10000000 stroops. Convert before',
  '  calling: "5 XLM" is "50000000". Never pass a decimal.',
  '- Never invent a destination address. If a payment request does not contain one, ask for it',
  '  instead of calling the tool.',
  '- Do not predict whether a payment will be allowed, and do not reassure. The agent has limits',
  '  you cannot see, the network enforces them, and guessing out loud is how a refusal turns into',
  '  a broken promise.',
  '- If the message is not a request for either tool, reply in one or two sentences.',
].join('\n');

/** What the route does next: enqueue a turn, or say something back. */
export type ChatDecision =
  | { kind: 'tool'; tool: string; arguments: Record<string, unknown> }
  | { kind: 'text'; text: string }
  /**
   * The model could not be reached or declined. Separate from `text` because the
   * interface owes the user a different thing here — this is §4.4's *agent
   * error*, and it must never be mistaken for the agent having answered.
   */
  | { kind: 'agent_error'; detail: string };

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * History is passed in rather than held here, so this stays a function of its
 * arguments and the route owns where conversation state lives.
 */
export async function decideChatTurn(
  message: string,
  history: readonly ChatTurn[] = [],
  client: Anthropic = new Anthropic(),
): Promise<ChatDecision> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...history.map((turn) => ({ role: turn.role, content: turn.text }) as const),
    { role: 'user' as const, content: message },
  ];

  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await client.beta.messages.create({
      model: CHAT_MODEL,
      max_tokens: 4_000,
      thinking: { type: 'adaptive' },
      // Same fallback posture as the draft generator. A policy decline on
      // "send 10 XLM to G..." would otherwise strand the turn with no answer.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM_PROMPT,
      output_config: { effort: 'low' },
      tools: TOOL_DEFINITIONS,
      messages,
    });
  } catch (error) {
    return {
      kind: 'agent_error',
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  // Checked before anything reads `content`: a refusal is HTTP 200 with empty
  // or partial content, so a reader that trusts `content` sees a blank answer
  // and calls it success.
  if (response.stop_reason === 'refusal') {
    return { kind: 'agent_error', detail: 'The model declined to act on that message.' };
  }

  const toolUse = response.content.find(
    (block): block is Anthropic.Beta.BetaToolUseBlock => block.type === 'tool_use',
  );

  if (toolUse !== undefined) {
    // `input` is parsed JSON from the SDK, never a string to match on — the
    // escaping in a tool call's arguments is not stable across models.
    const args =
      typeof toolUse.input === 'object' && toolUse.input !== null
        ? (toolUse.input as Record<string, unknown>)
        : {};
    return { kind: 'tool', tool: toolUse.name, arguments: args };
  }

  const text = response.content
    .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();

  if (text.length === 0) {
    return { kind: 'agent_error', detail: 'The model returned nothing.' };
  }

  return { kind: 'text', text };
}
