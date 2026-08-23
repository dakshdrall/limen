/**
 * One turn, from a claimed job to a finished row.
 *
 * This is the first entry in the worker's handler registry, and `index.ts` said
 * what that registry is: *every entry here is a thing the runtime will do to a
 * user's money*. It stayed empty from M1 until the fences that make a payment
 * safe existed, and this is the milestone that put one in.
 *
 * ## The three ways a delivery arrives, and what each means
 *
 * At-least-once delivery makes duplicates a certainty rather than a risk, so
 * the claim is where the work actually begins:
 *
 *   - **Claimed** (`queued → running`). Ordinary. Run the turn.
 *   - **Not claimed, already `done`.** A duplicate delivery of a turn that
 *     finished. There is nothing to do and nothing to report — the result the
 *     caller polls for is already there.
 *   - **Not claimed, still `running`.** A worker died holding this turn. It is
 *     **not** re-run, because *"died before submitting"* and *"died after
 *     submitting"* are indistinguishable from here and the wrong guess pays
 *     someone twice. It is closed out as an infrastructure error that says
 *     which of those it was, using the marker `payment.ts` writes before it
 *     sends anything.
 *
 * That third branch is the whole of §7.5.4 reason 1 in one place: durable
 * execution is not a queue that redelivers, it is a queue that redelivers plus
 * a record that says whether redelivering is safe.
 */

import { z } from 'zod';
import type { KeyProvider } from '@limen/custody';
import { invokeTool, TOOLS } from './tools/index.js';
import type { ToolResult } from './tools/types.js';
import type { Job, JobHandler } from './worker-types.js';
import type { RuntimeStore, TurnRecord } from './store.js';

/** The one job kind the runtime knows how to run. */
export const TURN_JOB_KIND = 'turn.run';

/**
 * The payload, validated rather than trusted.
 *
 * A job comes out of Redis as JSON that some other process wrote. Parsing it
 * with the same discipline the tool arguments get means a malformed job fails
 * as a bad job, in one place, rather than as a `TypeError` three layers into a
 * handler.
 */
const payloadSchema = z.strictObject({
  turnId: z.string().uuid(),
  agentId: z.string().uuid(),
  userId: z.string().uuid(),
});

export type TurnJobPayload = z.infer<typeof payloadSchema>;

export interface TurnDeps {
  store: RuntimeStore;
  provider: KeyProvider;
  rpcUrl: string;
}

export function turnHandler(deps: TurnDeps): JobHandler {
  return async (job: Job): Promise<void> => {
    const parsed = payloadSchema.safeParse(job.payload);
    if (!parsed.success) {
      // Thrown, so the worker records it against the job's kind. There is no
      // turn id to write a result to — that is what makes this different from
      // every failure below, all of which end up on a row somebody is polling.
      throw new Error(`turn.run: malformed payload: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
    }

    const { turnId, agentId, userId } = parsed.data;
    const claimed = await deps.store.claimTurn(turnId);

    if (claimed === undefined) {
      await resolveUnclaimed(deps.store, turnId);
      return;
    }

    await runClaimedTurn(deps, claimed, { agentId, userId });
  };
}

/**
 * A turn the claim did not take: finished already, or stranded by a dead
 * worker.
 */
async function resolveUnclaimed(store: RuntimeStore, turnId: string): Promise<void> {
  const existing = await store.turnById(turnId);
  if (existing === undefined || existing.status === 'done') return;

  // `running`, and this process did not start it. `payment.ts` writes a
  // `submitting` marker before anything is sent, so the two cases can be told
  // apart — which is the difference between "retry is safe" and "a payment may
  // already be on a ledger", and nobody should have to guess which.
  const marker = existing.result as { stage?: string } | null;
  const mayHaveSubmitted = marker?.stage === 'submitting';

  await store.abandonTurn(turnId, {
    stage: 'abandoned',
    mayHaveSubmitted,
    summary: mayHaveSubmitted
      ? 'A worker stopped while this payment was in flight, so it may already be on a ledger. It was ' +
        'not retried, because a submitted payment and an unsubmitted one look identical from here and ' +
        'retrying could pay twice. Check the account activity for a transaction before trying again.'
      : 'A worker stopped before this turn submitted anything. Nothing was signed and nothing moved.',
    previous: existing.result,
  });
}

async function runClaimedTurn(
  deps: TurnDeps,
  turn: TurnRecord,
  { agentId, userId }: { agentId: string; userId: string },
): Promise<void> {
  const agent = await deps.store.agentForTurn(agentId, userId);

  if (agent === undefined) {
    await deps.store.finishTurn({
      turnId: turn.id,
      outcome: 'infra_error',
      result: {
        summary:
          'This agent could not be loaded, so nothing was attempted. It may have been deleted between ' +
          'the request being accepted and this turn running.',
        stage: 'agent_not_found',
      },
    });
    return;
  }

  const request = turn.request;
  let result: ToolResult;

  if (request.kind === 'tool') {
    result = await invokeTool(TOOLS, request.tool, request.arguments, {
      agent,
      store: deps.store,
      provider: deps.provider,
      rpcUrl: deps.rpcUrl,
      // Reads are simulated from the agent's own funded account. Simulation
      // needs a source account with a sequence number and nothing else — it
      // never signs and is never charged — and using the agent's own means one
      // fewer address to configure and one fewer thing to be wrong.
      read: { rpcUrl: deps.rpcUrl, simulationSource: agent.feeAccount },
      turnId: turn.id,
    });
  } else {
    // Unreachable through the HTTP surface, which validates the request shape
    // before it enqueues. Handled rather than asserted, because a row written
    // by an older build is a real thing a running process can meet.
    result = {
      outcome: 'agent_error',
      summary: 'This turn asked for something this build does not know how to do.',
      detail: `Unsupported request kind: ${JSON.stringify((request as { kind: string }).kind)}.`,
    };
  }

  await deps.store.finishTurn({ turnId: turn.id, outcome: result.outcome, result });
}
