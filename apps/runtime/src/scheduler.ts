/**
 * The tick, the breaker, and the seam a notification leaves through.
 *
 * `store.ts` holds the four statements this is built from and the arguments for
 * their shapes. This file is the policy on top of them: how often to look, how
 * long an in-flight turn may block, what counts as a failure, and who is told
 * when a schedule stops.
 *
 * ## Why an agent can be due and still not run
 *
 * A claimed slot is not a promise that a cycle happens. Two things can stand in
 * the way, and both are recorded rather than silently swallowed:
 *
 *   - **A live turn.** An agent already working does not need a second cycle
 *     queued behind the first, and enqueuing one is how a slow drain becomes a
 *     stampede. The slot is consumed and skipped, with an audit row saying so.
 *   - **A turn past the staleness bound.** That one is closed first, and then
 *     the cycle runs. See below.
 *
 * The slot is consumed either way. That is the no-catch-up rule again: a
 * skipped window is a missed window, and it is never made up.
 *
 * ## The staleness bound, and the turn it exists for
 *
 * A worker that dies between `sendTransaction` and recording leaves a turn
 * `running` with a `submitting` marker and no way to resolve it — the whole
 * point of `turn.ts`'s third branch is that such a turn must never be re-run,
 * because "died before submitting" and "died after submitting" are
 * indistinguishable from here. Left alone it blocks its agent's schedule
 * forever, and the agent goes quiet with every screen still saying ACTIVE.
 *
 * Ten minutes. An agent turn is 15–45 seconds, so the bound is more than an
 * order of magnitude above the honest worst case and no real turn is ever cut
 * short by it; and it is short enough that an agent on the shortest sensible
 * interval misses one slot rather than a day of them. Detection lands within a
 * tick of the bound, so the true worst case is ten and a half minutes.
 *
 * What fires is **not a retry**. `expireStaleTurn` closes the row with a result
 * that reads the marker and says which of *nothing was signed* and *a
 * transaction may be on a ledger* this was, an audit row carrying the same
 * distinction, and — if the turn belonged to a schedule — a count against the
 * breaker. That last part matters: a worker dying every cycle would otherwise
 * fail silently forever, because nothing would ever call `finishTurn` and
 * nothing would ever count.
 *
 * ## The breaker does not stop anything quietly
 *
 * Three consecutive cycles that end as neither succeeded nor a legitimate
 * no-trade, and the schedule stops. That is three facts, not one:
 *
 *   1. `enabled = false`, with `disabled_at` and `disabled_reason`, so the row
 *      says a breaker stopped it rather than a person.
 *   2. An audit row — `schedule.disabled`, actor `system` — carrying the count,
 *      the reason, and the agent, so the history says when and why.
 *   3. A notification through `ScheduleNotifier`, which today writes a line and
 *      tomorrow is where Telegram plugs in.
 *
 * The agent's own `status` is deliberately **not** written. It is still
 * deployed, its boundary is still installed, and it can still be run by hand,
 * so `ERROR` would be false about all three. What the screens read instead are
 * the schedule's own columns, which is why they exist.
 */

import type { Queue } from './queue.js';
import type { RuntimeStore, StaleTurn, ToolOutcome } from './store.js';
import { TURN_JOB_KIND } from './turn.js';

/** How often the tick looks for due work. */
export const TICK_INTERVAL_MS = 30_000;

/**
 * How long a turn may stay in flight before it stops blocking its schedule.
 *
 * Ten minutes; the file header argues the number. It is exported because the
 * tick and `blockingTurn` must agree on it — two bounds a few seconds apart
 * would produce an agent that is neither blocked nor expired.
 */
export const STALE_TURN_MS = 10 * 60 * 1000;

/**
 * How many schedules one tick will claim.
 *
 * Bounds a tick's appetite rather than the worker's throughput — the worker is
 * serial and these queue behind each other regardless. An unbounded claim would
 * move every `next_run_at` forward in one pass and make a slow drain look like a
 * working schedule.
 */
export const CLAIM_LIMIT = 25;

/**
 * Something a person would want to be told about, on its way out of the runtime.
 *
 * The seam, and deliberately the whole of it. Today `logScheduleNotifier` writes
 * a line; when `apps/telegram` can send a message it is passed in here and
 * nothing in this file changes. Keeping the seam an argument rather than an
 * import is what stops the scheduler growing a transport.
 *
 * It is never awaited in a way that can fail a tick: a notification that throws
 * must not be able to stop a schedule from running, which would be a reporting
 * channel with the power to break the thing it reports on.
 */
export type ScheduleEvent =
  | {
      kind: 'schedule_disabled';
      agentId: string;
      taskId: string;
      consecutiveFailures: number;
      reason: string;
    }
  | {
      kind: 'turn_expired';
      agentId: string;
      turnId: string;
      /** The half a person has to act on: check the ledger, or do nothing. */
      mayHaveSubmitted: boolean;
    };

export type ScheduleNotifier = (event: ScheduleEvent) => void | Promise<void>;

/** The default. A line on stdout, which is what a deployment's logs collect. */
export const logScheduleNotifier: ScheduleNotifier = (event) => {
  if (event.kind === 'schedule_disabled') {
    console.log(
      `limen runtime: schedule ${event.taskId} for agent ${event.agentId} disabled after ` +
        `${event.consecutiveFailures} consecutive failures (${event.reason}). It will not run again ` +
        `until somebody resumes it.`,
    );
    return;
  }
  console.log(
    `limen runtime: turn ${event.turnId} for agent ${event.agentId} expired past the staleness bound. ` +
      (event.mayHaveSubmitted
        ? 'A submitting marker was on it, so a transaction may be on a ledger — it was NOT retried.'
        : 'Nothing was signed.'),
  );
};

/**
 * Whether an outcome counts against the breaker.
 *
 * Only `succeeded` does not, and that one word covers both cases it has to: a
 * cycle that traded, and a cycle that read the price and legitimately decided
 * not to. `turn.ts` gives a no-trade cycle the `succeeded` outcome for exactly
 * this reason — it ran and it reported — so a patient agent cannot trip its own
 * breaker by being patient.
 *
 * Everything else counts, including a refusal. An over-cap refusal reaches a
 * ledger, so retrying it every slot pays a fee every slot, and the burn lands on
 * the fee account rather than on the capped balance.
 */
export function countsAgainstBreaker(outcome: CycleOutcome): boolean {
  return outcome !== 'succeeded';
}

/**
 * What a scheduled cycle ended as.
 *
 * A turn's own outcome, plus the one thing that is not an outcome because no
 * turn ever produced it: a turn the tick had to close because it could never
 * resolve. That case has to reach the breaker under its own name — recording it
 * as `infra_error` would be true of the row and useless to somebody asking why
 * a schedule stopped.
 */
export type CycleOutcome = ToolOutcome | 'turn_expired';

export interface BreakerDeps {
  store: RuntimeStore;
  notify: ScheduleNotifier;
}

/** A notification must never be able to fail the thing it is reporting on. */
async function announce(notify: ScheduleNotifier, event: ScheduleEvent): Promise<void> {
  try {
    await notify(event);
  } catch (error: unknown) {
    console.error(
      `limen runtime: a schedule notification failed and was dropped: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Feed one cycle's outcome to the breaker, and say so out loud if it tripped.
 *
 * Called by whoever *finished* the turn — the worker for an ordinary cycle, the
 * tick for one it expired. Both go through here so the audit row and the
 * notification have one shape and cannot drift apart.
 */
export async function recordCycleOutcome(
  deps: BreakerDeps,
  input: { taskId: string; agentId: string; turnId: string; outcome: CycleOutcome },
): Promise<void> {
  const state = await deps.store.recordScheduleOutcome({
    taskId: input.taskId,
    counts: countsAgainstBreaker(input.outcome),
    reason: input.outcome,
  });

  if (!state.disabled) return;

  await deps.store.audit({
    actor: 'system',
    actorId: null,
    action: 'schedule.disabled',
    target: input.agentId,
    result: input.outcome,
    metadata: {
      taskId: input.taskId,
      turnId: input.turnId,
      consecutiveFailures: state.consecutiveFailures,
      // Said out loud in the row itself, because somebody reading this a week
      // later needs to know the agent was not touched.
      agentStatusUnchanged: true,
    },
  });

  await announce(deps.notify, {
    kind: 'schedule_disabled',
    agentId: input.agentId,
    taskId: input.taskId,
    consecutiveFailures: state.consecutiveFailures,
    reason: input.outcome,
  });
}

export interface TickerDeps {
  store: RuntimeStore;
  /**
   * Narrowed to the one method used, so a test can hand over a recorder
   * without standing up Redis to prove a slot was enqueued.
   */
  queue: Pick<Queue, 'enqueue'>;
  notify?: ScheduleNotifier;
  /** Injected so a test can drive time without waiting thirty seconds for it. */
  now?: () => Date;
}

/**
 * Every thirty seconds: claim what is due, and enqueue a cycle for each.
 *
 * Thirty rather than the shortest interval an agent can have, because the tick
 * is a cheap indexed read and the alternative is a schedule whose real
 * resolution is however often somebody remembered to look. A slot claimed at
 * most thirty seconds late is a schedule; a slot claimed whenever is not.
 */
export class Ticker {
  private readonly deps: TickerDeps;
  private readonly notify: ScheduleNotifier;
  private readonly now: () => Date;
  private timer: NodeJS.Timeout | undefined;
  /** The tick in flight, so `stop` can wait for it rather than cutting it off. */
  private inFlight: Promise<void> | undefined;
  private stopping = false;

  constructor(deps: TickerDeps) {
    this.deps = deps;
    this.notify = deps.notify ?? logScheduleNotifier;
    this.now = deps.now ?? ((): Date => new Date());
  }

  start(): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => {
      // Never two at once. A tick that overran its interval must not have a
      // second one claiming behind it — the claim would be safe, but the skip
      // decision would be made against a turn the first tick had not created yet.
      if (this.inFlight !== undefined) return;
      this.inFlight = this.tick().finally(() => {
        this.inFlight = undefined;
      });
    }, TICK_INTERVAL_MS);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    // The tick in flight finishes. Its turns are already rows and already
    // enqueued, or they are not; cutting it off mid-loop would consume slots
    // for cycles nobody enqueued.
    await this.inFlight;
  }

  /**
   * One pass. Public because a test drives it directly, and because a caller
   * that wants a tick right now should not have to wait for the interval.
   *
   * It never throws. A tick that died on one bad row would take the timer's
   * next thirty seconds with it and every schedule after it in the list, so
   * each schedule is attempted inside its own guard and the whole pass inside
   * another.
   */
  async tick(): Promise<void> {
    try {
      const now = this.now();
      const claimed = await this.deps.store.claimDueTasks({ now, limit: CLAIM_LIMIT });

      for (const schedule of claimed) {
        if (this.stopping) return;
        try {
          await this.runSchedule(schedule, now);
        } catch (error: unknown) {
          console.error(
            `limen runtime: schedule ${schedule.taskId} for agent ${schedule.agentId} failed to ` +
              `start: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    } catch (error: unknown) {
      console.error(
        `limen runtime: a scheduler tick failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async runSchedule(
    schedule: { taskId: string; agentId: string; userId: string; dueAt: Date },
    now: Date,
  ): Promise<void> {
    const { store, queue } = this.deps;

    // Stale first, so a turn that can never resolve stops blocking *this* slot
    // rather than the one after it.
    const cutoff = new Date(now.getTime() - STALE_TURN_MS);
    const expired = await store.expireStaleTurn({ agentId: schedule.agentId, cutoff });
    if (expired !== undefined) await this.reportExpired(expired);

    const blocking = await store.blockingTurn({
      agentId: schedule.agentId,
      staleAfterMs: STALE_TURN_MS,
      now,
    });

    if (blocking !== undefined) {
      // The slot is spent. Recorded rather than dropped, because "this agent
      // did not trade at 14:15" has two very different explanations and the
      // history has to say which one this was.
      await store.audit({
        actor: 'system',
        actorId: null,
        action: 'schedule.skipped',
        target: schedule.agentId,
        result: 'turn_in_flight',
        metadata: {
          taskId: schedule.taskId,
          dueAt: schedule.dueAt.toISOString(),
          blockingTurnId: blocking.turnId,
          blockingStatus: blocking.status,
        },
      });
      return;
    }

    // `api` because the channel enum has no word for a schedule, and inventing
    // one is a migration this milestone does not need: `scheduled_task_id` is
    // already the honest signal, and it is not null exactly here.
    const turn = await store.createTurn({
      agentId: schedule.agentId,
      channel: 'api',
      request: { kind: 'cycle' },
      schedule: { taskId: schedule.taskId, dueAt: schedule.dueAt },
    });

    await queue.enqueue({
      kind: TURN_JOB_KIND,
      idempotencyKey: turn.id,
      payload: { turnId: turn.id, agentId: schedule.agentId, userId: schedule.userId },
    });

    await store.audit({
      actor: 'system',
      actorId: null,
      action: 'schedule.enqueued',
      target: schedule.agentId,
      result: 'queued',
      metadata: {
        taskId: schedule.taskId,
        dueAt: schedule.dueAt.toISOString(),
        turnId: turn.id,
      },
    });
  }

  private async reportExpired(expired: StaleTurn): Promise<void> {
    await this.deps.store.audit({
      actor: 'system',
      actorId: null,
      action: 'schedule.turn_expired',
      target: expired.agentId,
      result: expired.mayHaveSubmitted ? 'may_have_submitted' : 'nothing_signed',
      metadata: {
        turnId: expired.turnId,
        startedAt: expired.startedAt.toISOString(),
        staleAfterMs: STALE_TURN_MS,
        // Said explicitly, because the one thing a reader must not conclude
        // from an expiry is that the turn was retried.
        retried: false,
      },
    });

    await announce(this.notify, {
      kind: 'turn_expired',
      agentId: expired.agentId,
      turnId: expired.turnId,
      mayHaveSubmitted: expired.mayHaveSubmitted,
    });

    // A dead worker still has to reach the breaker. Without this a process that
    // dies every cycle fails silently forever: nothing calls `finishTurn`,
    // nothing counts, and the schedule keeps claiming slots it cannot run.
    if (expired.scheduledTaskId !== null) {
      await recordCycleOutcome(
        { store: this.deps.store, notify: this.notify },
        {
          taskId: expired.scheduledTaskId,
          agentId: expired.agentId,
          turnId: expired.turnId,
          outcome: 'turn_expired',
        },
      );
    }
  }
}
