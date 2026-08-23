/**
 * Redelivery, which is a certainty rather than a risk.
 *
 * `queue.ts` chose at-least-once delivery deliberately: a worker that dies
 * mid-turn must be able to leave recoverable work. The price is duplicates, and
 * this file is where the price is paid. The three branches:
 *
 *   - a fresh turn is claimed and run;
 *   - a duplicate of a finished turn does nothing at all;
 *   - a turn found `running` is **not re-run**, and is closed out with a
 *     message that distinguishes "nothing was sent" from "a payment may already
 *     be on a ledger".
 *
 * The third is the one that matters. §7.5.4 reason 1 asks for a retry that can
 * tell those apart, and the marker `payment.ts` writes before it submits is
 * what makes the answer a fact rather than a guess.
 */

import { describe, expect, it } from 'vitest';
import { turnHandler, TURN_JOB_KIND } from '../src/turn.js';
import { fakeStore, fakeAgent, AGENT_ID, USER_ID } from './fakes.js';
import type { Job } from '../src/queue.js';

const deps = (store: ReturnType<typeof fakeStore>['store']) => ({
  store,
  provider: {} as never,
  rpcUrl: 'https://rpc.invalid',
});

const job = (payload: unknown): Job => ({
  kind: TURN_JOB_KIND,
  idempotencyKey: 'k',
  payload,
  enqueuedAt: new Date().toISOString(),
});

describe('a malformed job is a bad job, not a crash three layers in', () => {
  it('throws with the payload named, so the worker records it against the kind', async () => {
    const { store } = fakeStore();
    await expect(turnHandler(deps(store))(job({ turnId: 'nope' }))).rejects.toThrow(/malformed payload/);
  });
});

describe('a duplicate delivery does nothing', () => {
  it('leaves a finished turn exactly as it was', async () => {
    const { store, recorded } = fakeStore();
    const turn = await store.createTurn({
      agentId: AGENT_ID,
      channel: 'web',
      request: { kind: 'tool', tool: 'get_balance', arguments: {} },
    });
    await store.claimTurn(turn.id);
    await store.finishTurn({ turnId: turn.id, outcome: 'succeeded', result: { summary: 'first' } });

    await turnHandler(deps(store))(job({ turnId: turn.id, agentId: AGENT_ID, userId: USER_ID }));

    const after = recorded.turns.get(turn.id);
    expect(after?.outcome).toBe('succeeded');
    expect(after?.result).toEqual({ summary: 'first' });
  });
});

describe('a turn stranded by a dead worker is closed out, never re-run', () => {
  it('says nothing was sent when there is no submission marker', async () => {
    const { store, recorded } = fakeStore();
    const turn = await store.createTurn({
      agentId: AGENT_ID,
      channel: 'web',
      request: { kind: 'tool', tool: 'send_payment', arguments: {} },
    });
    await store.claimTurn(turn.id); // a previous worker took it, then died

    await turnHandler(deps(store))(job({ turnId: turn.id, agentId: AGENT_ID, userId: USER_ID }));

    const after = recorded.turns.get(turn.id);
    expect(after?.status).toBe('done');
    expect(after?.outcome).toBe('infra_error');
    const result = after?.result as { mayHaveSubmitted: boolean; summary: string };
    expect(result.mayHaveSubmitted).toBe(false);
    expect(result.summary).toMatch(/Nothing was signed and nothing moved/);
  });

  it('says a payment may already be on a ledger when the marker is there', async () => {
    // The expensive case, and the reason `payment.ts` writes before it sends.
    // "Died before submitting" and "died after submitting" are indistinguishable
    // without this row, and the wrong guess pays a contractor twice.
    const { store, recorded } = fakeStore();
    const turn = await store.createTurn({
      agentId: AGENT_ID,
      channel: 'web',
      request: { kind: 'tool', tool: 'send_payment', arguments: {} },
    });
    await store.claimTurn(turn.id);
    await store.markSubmitting(turn.id, { stage: 'submitting', stroops: '40000000' });

    await turnHandler(deps(store))(job({ turnId: turn.id, agentId: AGENT_ID, userId: USER_ID }));

    const result = recorded.turns.get(turn.id)?.result as {
      mayHaveSubmitted: boolean;
      summary: string;
      previous: { stroops: string };
    };
    expect(result.mayHaveSubmitted).toBe(true);
    expect(result.summary).toMatch(/may/i);
    expect(result.summary).toMatch(/could pay twice|check the account activity/i);
    // The marker is kept rather than overwritten: what it was doing is the
    // evidence somebody needs to go and look for the transaction.
    expect(result.previous.stroops).toBe('40000000');
  });
});

describe('a turn whose agent has gone', () => {
  it('is an infrastructure error, not a refusal', async () => {
    // Nothing refused anything here. Reporting it as a refusal would claim a
    // boundary did something it never saw.
    const { store, recorded } = fakeStore({ agent: undefined });
    const turn = await store.createTurn({
      agentId: AGENT_ID,
      channel: 'web',
      request: { kind: 'tool', tool: 'get_balance', arguments: {} },
    });

    await turnHandler(deps(store))(job({ turnId: turn.id, agentId: AGENT_ID, userId: USER_ID }));

    const after = recorded.turns.get(turn.id);
    expect(after?.outcome).toBe('infra_error');
    expect((after?.result as { stage: string }).stage).toBe('agent_not_found');
  });
});

describe('a claimed turn runs its tool and records the outcome', () => {
  it('finishes with the tool’s outcome, whatever it is', async () => {
    // `rpc.invalid` is unreachable, so `get_balance` ends as an infrastructure
    // error — which is the assertion: the handler writes what the tool returned
    // rather than deciding for itself, and an unreachable RPC is never a refusal.
    const { store, recorded } = fakeStore({ agent: fakeAgent() });
    const turn = await store.createTurn({
      agentId: AGENT_ID,
      channel: 'web',
      request: { kind: 'tool', tool: 'get_balance', arguments: {} },
    });

    await turnHandler(deps(store))(job({ turnId: turn.id, agentId: AGENT_ID, userId: USER_ID }));

    const after = recorded.turns.get(turn.id);
    expect(after?.status).toBe('done');
    expect(after?.outcome).toBe('infra_error');
    expect(recorded.outcomes.at(-1)?.outcome).toBe('infra_error');
  });
});
