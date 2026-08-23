/**
 * The model chooses a tool. Everything else about the turn is not its decision.
 *
 * Two properties here are the reason this file exists, and both are about what
 * `decideChatTurn` refuses to do rather than what it does:
 *
 *   1. **A refusal is never returned as an answer.** `stop_reason: 'refusal'`
 *      arrives as HTTP 200 with empty or partial content. A reader that goes
 *      straight to `content` sees a blank string and reports it as the agent
 *      having replied with nothing, which is indistinguishable in the interface
 *      from the agent having nothing to say. It has to come back as
 *      `agent_error` — §4.4's first row — and the test asserts the tag.
 *   2. **The four failure shapes stay distinct.** Declined, threw, returned
 *      nothing, and answered in words are four different things the interface
 *      owes the user four different responses to. A union that collapsed any
 *      two of them would be smaller and would lie.
 *
 * The tool names are pinned because `apps/web` declares them rather than
 * importing them from `apps/runtime` — see the comment in `chat.ts`. This test
 * is the tripwire on the copy, and a third tool is expected to fail it.
 */

import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { CHAT_MODEL, CHAT_TOOL_NAMES, decideChatTurn } from '@/lib/chat';

/**
 * A client that answers with one canned message, and records what it was asked.
 *
 * Typed through `unknown` rather than by implementing `Anthropic`: the SDK's
 * client is a large surface and this exercises one method on it. The cast is
 * here, once, rather than at each call site.
 */
function fakeClient(reply: Partial<Anthropic.Beta.BetaMessage> | (() => never)): {
  client: Anthropic;
  calls: Anthropic.Beta.MessageCreateParamsNonStreaming[];
} {
  const calls: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
  const create = async (params: Anthropic.Beta.MessageCreateParamsNonStreaming) => {
    calls.push(params);
    if (typeof reply === 'function') reply();
    return { stop_reason: 'end_turn', content: [], ...reply } as Anthropic.Beta.BetaMessage;
  };
  return { client: { beta: { messages: { create } } } as unknown as Anthropic, calls };
}

const textBlock = (text: string) => ({ type: 'text' as const, text, citations: null });
const toolBlock = (name: string, input: unknown) => ({
  type: 'tool_use' as const,
  id: 'toolu_1',
  name,
  input,
});

describe('the tools the chat offers', () => {
  it('is exactly the two the runtime implements', () => {
    // `apps/runtime/src/tools/index.ts` is the other half of this pair. If a
    // tool lands there and not here the model cannot reach it; if one lands
    // here and not there the runtime answers `unknown_tool`. Neither is
    // silent, but both are avoidable, and this is where they are caught.
    expect(CHAT_TOOL_NAMES).toEqual(['get_balance', 'send_payment']);
  });
});

describe('decideChatTurn', () => {
  it('returns the tool and its arguments when the model calls one', async () => {
    const { client } = fakeClient({
      stop_reason: 'tool_use',
      content: [toolBlock('send_payment', { destination: 'GABC', stroops: '50000000' })],
    });

    const decision = await decideChatTurn('send 5 XLM to GABC', [], client);

    expect(decision).toEqual({
      kind: 'tool',
      tool: 'send_payment',
      arguments: { destination: 'GABC', stroops: '50000000' },
    });
  });

  it('prefers the tool call when the model also narrates', async () => {
    // Models often emit a sentence before the call. The sentence is not the
    // answer and must not be rendered as one — the turn is a tool call.
    const { client } = fakeClient({
      stop_reason: 'tool_use',
      content: [textBlock('Let me check that.'), toolBlock('get_balance', {})],
    });

    const decision = await decideChatTurn("what's my balance", [], client);

    expect(decision).toEqual({ kind: 'tool', tool: 'get_balance', arguments: {} });
  });

  it('returns text when no tool applies', async () => {
    const { client } = fakeClient({ content: [textBlock('  I can check balances.  ')] });

    expect(await decideChatTurn('hello', [], client)).toEqual({
      kind: 'text',
      text: 'I can check balances.',
    });
  });

  it('reports a refusal as an agent error rather than as an empty answer', async () => {
    const { client } = fakeClient({ stop_reason: 'refusal', content: [] });

    const decision = await decideChatTurn('do something disallowed', [], client);

    expect(decision.kind).toBe('agent_error');
  });

  it('reports a refusal as an agent error even when content came back', async () => {
    // The dangerous shape: a refusal that still carries text. Reading `content`
    // first would return a plausible sentence and lose the refusal entirely.
    const { client } = fakeClient({
      stop_reason: 'refusal',
      content: [textBlock('Sure, sending that now.')],
    });

    expect(await decideChatTurn('...', [], client)).toEqual({
      kind: 'agent_error',
      detail: 'The model declined to act on that message.',
    });
  });

  it('reports an empty response as an agent error, not as an empty message', async () => {
    const { client } = fakeClient({ content: [] });

    expect((await decideChatTurn('hello', [], client)).kind).toBe('agent_error');
  });

  it('reports a thrown error as an agent error and keeps its message', async () => {
    const { client } = fakeClient(() => {
      throw new Error('connection reset');
    });

    expect(await decideChatTurn('hello', [], client)).toEqual({
      kind: 'agent_error',
      detail: 'connection reset',
    });
  });

  it('tolerates a tool call whose input is not an object', async () => {
    // `strict` makes this unlikely rather than impossible, and the failure mode
    // if it is not handled is a crash in a request handler rather than a
    // refused turn.
    const { client } = fakeClient({
      stop_reason: 'tool_use',
      content: [toolBlock('get_balance', null)],
    });

    expect(await decideChatTurn('balance', [], client)).toEqual({
      kind: 'tool',
      tool: 'get_balance',
      arguments: {},
    });
  });
});

describe('what the model is sent', () => {
  it('puts the history before the new message, in order', async () => {
    const { client, calls } = fakeClient({ content: [textBlock('ok')] });

    await decideChatTurn(
      'and the second one?',
      [
        { role: 'user', text: 'what is my balance' },
        { role: 'assistant', text: 'I checked it.' },
      ],
      client,
    );

    expect(calls[0]?.messages).toEqual([
      { role: 'user', content: 'what is my balance' },
      { role: 'assistant', content: 'I checked it.' },
      { role: 'user', content: 'and the second one?' },
    ]);
  });

  it('offers both tools, and asks for the model this repository pays for', async () => {
    const { client, calls } = fakeClient({ content: [textBlock('ok')] });

    await decideChatTurn('hello', [], client);

    expect(calls[0]?.model).toBe(CHAT_MODEL);
    expect(calls[0]?.tools?.map((tool) => ('name' in tool ? tool.name : ''))).toEqual(
      CHAT_TOOL_NAMES,
    );
  });

  it('sends no tool result back, because the model is never told what happened', async () => {
    // The §4.4 property, asserted on the request rather than argued in a
    // comment: there is one call and its messages carry no `tool_result`.
    const { client, calls } = fakeClient({
      stop_reason: 'tool_use',
      content: [toolBlock('get_balance', {})],
    });

    await decideChatTurn('balance', [], client);

    expect(calls).toHaveLength(1);
    const serialised = JSON.stringify(calls[0]?.messages);
    expect(serialised).not.toContain('tool_result');
  });
});
