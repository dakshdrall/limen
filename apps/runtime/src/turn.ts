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
import { executeTradingDecision, type TradingConfig } from './trading.js';
import type { KeyProvider } from '@limen/custody';
import { invokeTool, TOOLS } from './tools/index.js';
import type { ToolResult } from './tools/types.js';
import type { Job, JobHandler } from './worker-types.js';
import type { AgentForTurn, RuntimeStore, TurnRecord } from './store.js';
import { logScheduleNotifier, recordCycleOutcome, type ScheduleNotifier } from './scheduler.js';

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

/**
 * A stored trigger, validated rather than trusted.
 *
 * This used to validate a request body: the trigger arrived from the browser
 * with every cycle, because no row held one. It now validates
 * `agents.trigger_json`, and the change of subject is the whole point — an
 * agent has a rule for when to trade, and nobody retypes it per run.
 *
 * Still `strictObject`, and still parsed on every cycle. The column is written
 * by the configure route after validation, but a column is not a promise: an
 * older build, a hand-edited row, or a future field all reach this line, and a
 * trigger this schema cannot read is reported as `trigger_unreadable` rather
 * than being coerced into something evaluable.
 */
const storedTriggerSchema = z.strictObject({
  kind: z.literal('price_drop'),
  referencePrice: z.string().regex(/^[0-9]{1,39}$/),
  referenceLedger: z.number().int().nonnegative(),
  dropBps: z.number().int().min(1).max(10_000),
  amount: z.string().regex(/^[1-9][0-9]{0,38}$/),
});

/** `INPUT/OUTPUT`, as `enforcedOffchain.allowedPairs` stores it. */
const PAIR = /^(C[A-Z2-7]{55})\/(C[A-Z2-7]{55})$/;

/**
 * One cycle's configuration, read off the agent rather than off a request.
 *
 * Two things have to be true before a cycle can run, and each absence is
 * reported as itself rather than as a generic failure:
 *
 *   - **An allowed pair.** `enforcedOffchain.allowedPairs` is Limen's list of
 *     what this agent may trade, and an empty one means *no pair is allowed* —
 *     the same direction `gate.ts` reads it in. A cycle with no pair has
 *     nothing to price, so it does not reach the venue at all.
 *   - **A readable trigger.** A null trigger is legitimate and is not handled
 *     here: it travels into `executeTradingDecision`, which reads the price,
 *     records it, and reports *no trigger configured*. What is handled here is
 *     a trigger that exists and cannot be parsed, which is a third fact and
 *     must never be flattened into either of the other two — telling somebody
 *     their agent has no rule when it has one Limen could not read is a lie
 *     about which of the two is wrong.
 *
 * The pair is taken from the first entry. That is a real limitation stated
 * rather than hidden: an agent with two allowed pairs trades the first on a
 * cycle, because one trigger names one reference price and a reference is
 * denominated in one pair. Two pairs need two triggers, which needs the
 * roadmap's second trigger field.
 */
function cycleConfigFor(
  agent: AgentForTurn,
): { value: TradingConfig } | { problem: Extract<ToolResult, { outcome: 'agent_error' }> } {
  const pair = agent.enforcedOffchain?.allowedPairs?.[0];
  const matched = pair === undefined ? null : PAIR.exec(pair);
  if (matched === null) {
    return {
      problem: {
        outcome: 'agent_error',
        summary:
          'This agent has no allowed pair, so there is nothing for it to trade and no price to ' +
          'read. Limen refuses every swap until a pair is configured; nothing was evaluated and ' +
          'nothing reached a ledger.',
        detail: `pair_not_configured: ${pair === undefined ? 'no allowed pair' : `unreadable pair ${pair}`}`,
      },
    };
  }

  if (agent.trigger === null || agent.trigger === undefined) {
    // Legitimate, and deliberately not a problem. The cycle runs, prices the
    // pair, and says there was nothing to evaluate.
    return { value: { inputAsset: matched[1]!, outputAsset: matched[2]!, trigger: null } };
  }

  const parsed = storedTriggerSchema.safeParse(agent.trigger);
  if (!parsed.success) {
    return {
      problem: {
        outcome: 'agent_error',
        summary:
          'This agent has a stored trigger that Limen could not read, so nothing was evaluated ' +
          'and nothing was traded. This is not the same as having no trigger: the rule is there ' +
          'and this build could not make sense of it, so the cycle refused rather than guessing ' +
          'at what it meant.',
        detail: `trigger_unreadable: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`)
          .join('; ')}`,
      },
    };
  }

  return { value: { inputAsset: matched[1]!, outputAsset: matched[2]!, trigger: parsed.data } };
}

export interface TurnDeps {
  store: RuntimeStore;
  provider: KeyProvider;
  rpcUrl: string;
  /**
   * Where a tripped breaker is announced. Defaults to a log line.
   *
   * The worker feeds the breaker because the worker is what *finishes* a turn,
   * and a schedule whose failures were counted by the next tick instead would
   * disable one cycle later than it should — one more cycle that reaches a
   * ledger and pays a fee to be refused.
   */
  notify?: ScheduleNotifier;
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
  } else if (request.kind === 'cycle') {
    // One cycle, configured entirely from storage. The tool context is built
    // exactly as it is for a tool call — the cycle runs `swap_tokens` through
    // it, so anything different here would be a second way to reach the same
    // write path.
    //
    // Nothing about this cycle comes from the caller. The pair is the agent's
    // allowed pair and the trigger is the agent's stored rule, so pressing the
    // button twice runs the same strategy twice, and a cycle is reproducible
    // from the agent alone rather than from the agent plus whatever was typed
    // into a form at the time.
    const config = cycleConfigFor(agent);

    if ('problem' in config) {
      result = config.problem;
    } else {
      const executionId = await deps.store.recordToolExecution({
        agentId: agent.id,
        toolName: 'trading_cycle',
        args: config.value,
      });
      const cycle = await executeTradingDecision(
        {
          agent,
          store: deps.store,
          provider: deps.provider,
          rpcUrl: deps.rpcUrl,
          read: { rpcUrl: deps.rpcUrl, simulationSource: agent.feeAccount },
          turnId: turn.id,
          executionId,
        },
        config.value,
      );
      // The cycle's own result when it did not trade, and the swap's when it
      // did. A cycle that decided not to act is a success — it ran and
      // reported — and calling it anything else would make an activity log of
      // ordinary quiet look like a log of failures.
      result = cycle.swap ?? {
        outcome: 'succeeded',
        summary: cycle.summary,
        data: {
          price: cycle.price?.outFor.toString() ?? null,
          probeAmount: cycle.price?.probeAmount.toString() ?? null,
          ledger: cycle.price?.ledger ?? null,
          traded: false,
        },
        evidence: null,
      };
      await deps.store.completeToolExecution({ id: executionId, outcome: result.outcome });
    }
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

  // Only a scheduled turn has a breaker to feed. A turn a person started by
  // hand is not a schedule failing, and counting one would let somebody stop
  // their own schedule by pressing Run Agent three times against a venue that
  // happened to be down.
  if (turn.scheduledTaskId !== null) {
    await recordCycleOutcome(
      { store: deps.store, notify: deps.notify ?? logScheduleNotifier },
      {
        taskId: turn.scheduledTaskId,
        agentId: turn.agentId,
        turnId: turn.id,
        outcome: result.outcome,
      },
    );
  }
}
