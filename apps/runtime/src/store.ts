/**
 * Every row the money path reads or writes, in one place.
 *
 * `apps/web`'s `stores.ts` is deliberately small and boring because nothing in
 * CI can reach `neon-http`. The opposite is true here: this path is a plain
 * `pg.Pool`, so a local Postgres exercises it exactly as production does, and
 * `test/store-postgres.test.ts` runs against one. Where the web store had to be
 * kept trivially reviewable, this one is kept *tested*.
 *
 * ## The claim, and why it is an UPDATE rather than a SELECT
 *
 * `claimTurn` is the single-writer discipline §7.5.4 reason 3 asks for, and it
 * is one statement:
 *
 *     UPDATE turns SET status = 'running' WHERE id = $1 AND status = 'queued'
 *
 * At-least-once delivery makes duplicates a certainty. Two workers reserving
 * the same job — or one worker seeing it twice after a restart — both run this,
 * and Postgres serialises them: exactly one update matches a row, the other
 * matches none and returns nothing. A `SELECT` followed by an `UPDATE` would
 * have a window between them, and the window is a duplicate payment.
 *
 * ## What a turn found `running` means, and why it is not retried
 *
 * A worker that died mid-turn leaves `status = 'running'`. Redelivery must not
 * re-run it, because *"died before submitting"* and *"died after submitting"*
 * are indistinguishable from the outside and the wrong guess pays a contractor
 * twice. So `claimTurn` refuses it, and `abandonTurn` closes it out as an
 * infrastructure error that says plainly that a submission may have happened.
 * `markSubmitting` is what makes that message specific rather than a guess: it
 * writes the in-flight tool execution onto the turn *before* anything is sent,
 * so the difference between "never submitted" and "may have submitted" is a
 * fact in the database rather than an inference.
 */

import { and, desc, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import {
  agentAccounts,
  agentKeys,
  agents,
  auditEvents,
  policies,
  scheduledTasks,
  toolExecutions,
  transactions,
  turns,
} from '@limen/db';
import type { RuntimeDb } from '@limen/db/runtime';
import type { SealedAgentKey } from '@limen/custody';
import type { EnforcedOffchain } from './policy/gate.js';

/** What was asked. A tool invocation today; a chat message when the loop lands. */
export type TurnRequest =
  | { kind: 'tool'; tool: string; arguments: unknown }
  /**
   * One trading cycle: read the price, evaluate, maybe swap.
   *
   * Its own kind rather than a tool, because it is not one call — it is a read,
   * a decision and possibly a write, and the decision is the part worth
   * recording separately. A cycle that arrived as `swap_tokens` would lose the
   * reason it traded, which is the only thing making the trade reproducible.
   *
   * **It carries nothing.** The pair and the trigger are read from the agent
   * when the worker runs it, so this row records an intent — *run this agent
   * once* — rather than a configuration. A `config` field used to live here,
   * carrying a trigger the browser invented per press; a stored row holding one
   * would mean two cycles of the same agent could run different strategies and
   * the difference would live in a request body nobody kept.
   */
  | { kind: 'cycle' };

export type TurnChannel = 'web' | 'telegram' | 'api';

export type ToolOutcome =
  | 'agent_error'
  | 'refused_by_limen'
  | 'refused_by_network'
  | 'infra_error'
  | 'succeeded';

export interface TurnRecord {
  id: string;
  agentId: string;
  channel: TurnChannel;
  status: 'queued' | 'running' | 'done';
  request: TurnRequest;
  result: unknown;
  outcome: ToolOutcome | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  /**
   * The schedule this turn was started for, or null for one a person started.
   *
   * Carried on the record because the breaker is fed by whoever *finishes* the
   * turn, and that is the worker rather than the tick that enqueued it. Without
   * it the handler would have to ask which schedule this was, and a schedule
   * whose failures are counted one tick late is a schedule that disables one
   * cycle after it should have.
   */
  scheduledTaskId: string | null;
}

/**
 * Everything one turn needs about its agent, read once.
 *
 * Deliberately **not** the boundary. There is no cap here, no remaining spend
 * and no rule: those are read from the chain by the gate on every turn, per the
 * prohibition `schema.ts` inherits from `store.ts`. What is here is the set of
 * pointers needed to *go and read* it — the account to ask about, the rule id
 * to ask for, and the key to sign with.
 */
export interface AgentForTurn {
  id: string;
  userId: string;
  name: string;
  status: string;
  smartAccount: string;
  /** `G…`, the public half. The private half is `sealedKey`, and stays sealed. */
  agentPublicKey: string;
  /**
   * The owner signer, carried so the write path can prove the two are not one.
   *
   * `install.ts` calls `assertDistinctSigners` before it builds a rule, and
   * `sign.test.ts` scans for that call in every module holding both keys. The
   * reason travels with the pair: *a boundary the bounded party could have
   * installed itself proves nothing*. The runtime holds both — the owner's
   * public half from this row, the agent's key from the sealed one — so it owes
   * the same check before it signs.
   */
  ownerPublicKey: string;
  ownerSignerKind: 'passkey' | 'ed25519';
  /** The classic account paying fees. Falls back to the agent's own address. */
  feeAccount: string;
  contextRuleId: number | null;
  /**
   * The venue rule's id, or null for an agent that cannot trade.
   *
   * A swap's `AuthPayload` names one context rule per auth context, and a
   * router call raises two. This is the second — see the column's own comment
   * in the schema for why it is recorded rather than found by scanning.
   */
  venueContextRuleId: number | null;
  sealedKey: SealedAgentKey;
  /**
   * B8's column, read as what it is: constraints **Limen** enforces, because no
   * audited on-chain primitive can. Anything read from here and acted on must
   * be reported as a Limen refusal — never as the network's.
   */
  enforcedOffchain: EnforcedOffchain | null;
  /**
   * `agents.trigger_json`, exactly as stored, and deliberately `unknown`.
   *
   * This is what makes the agent act, and it is the one field here the runtime
   * *evaluates* rather than points at. It arrives untyped for `draft_json`'s
   * reason: nothing checked it at the point it was written, so a type here
   * would be a claim this row cannot support. `turn.ts` parses it against a
   * schema on every cycle and reports a trigger it cannot read as
   * `trigger_unreadable` — which is a third fact, distinct from an agent that
   * has no trigger and from one that decided not to trade.
   *
   * Null means no trigger, permanently and legitimately: that agent reads the
   * price, records it, and trades nothing.
   */
  trigger: unknown;
}

/**
 * How many cycles in a row must fail before the schedule stops.
 *
 * Three, and it lives here because this is where it is actually applied: the
 * UPDATE in `recordScheduleOutcome` compares against the value it is writing,
 * so the count and the disable are one statement and cannot disagree.
 *
 * Three rather than one, because a venue that cannot be quoted for a moment is
 * ordinary and stopping a schedule for it would be a breaker that fires on
 * weather. Three rather than ten, because every counted failure is a cycle that
 * reached a ledger and paid a fee to be refused.
 */
export const BREAKER_THRESHOLD = 3;

/**
 * A schedule the tick claimed, and the slot it claimed.
 *
 * Returned only by `claimDueTask`, and only to the caller whose conditional
 * UPDATE matched the row. Holding one is what authorises enqueuing a cycle for
 * `dueAt`; nothing else in this interface hands one out.
 */
export interface ClaimedSchedule {
  taskId: string;
  agentId: string;
  userId: string;
  /** The slot that was consumed — the `next_run_at` this claim advanced past. */
  dueAt: Date;
  /** Where `next_run_at` was moved to. Always in the future; see the schema. */
  nextRunAt: Date;
  consecutiveFailures: number;
}

/** A turn that has been running too long to keep blocking a schedule. */
export interface StaleTurn {
  turnId: string;
  agentId: string;
  startedAt: Date;
  /**
   * Whether a `submitting` marker was on the row when it was closed.
   *
   * The difference between *"nothing was signed"* and *"a transaction may be on
   * a ledger"*, and the reason `markSubmitting` exists. Carried out of the store
   * so the audit row can say which of the two this was instead of hedging.
   */
  mayHaveSubmitted: boolean;
  /**
   * The schedule this turn was started for, if any.
   *
   * The tick closes these, not the worker, so this is how an expired turn still
   * reaches the breaker. A worker that dies every cycle would otherwise fail
   * silently forever: nothing would ever call `finishTurn`, nothing would count,
   * and the schedule would keep claiming slots it could not run.
   */
  scheduledTaskId: string | null;
}

export interface RuntimeStore {
  agentForTurn(agentId: string, userId: string): Promise<AgentForTurn | undefined>;
  createTurn(input: {
    agentId: string;
    channel: TurnChannel;
    request: TurnRequest;
    /** The slot this turn fills, for a scheduled one. Absent for a manual turn. */
    schedule?: { taskId: string; dueAt: Date };
  }): Promise<TurnRecord>;
  claimTurn(turnId: string): Promise<TurnRecord | undefined>;
  abandonTurn(turnId: string, result: unknown): Promise<void>;
  markSubmitting(turnId: string, result: unknown): Promise<void>;
  finishTurn(input: { turnId: string; outcome: ToolOutcome; result: unknown }): Promise<void>;
  readTurn(turnId: string, userId: string): Promise<TurnRecord | undefined>;
  /**
   * By id alone, for the worker.
   *
   * No ownership check, deliberately: the worker is not acting for a caller, it
   * is finishing work the HTTP layer already authorised. Every read that *is*
   * on behalf of a caller goes through `readTurn`, which joins `agents` and
   * would return nothing for someone else's turn.
   */
  turnById(turnId: string): Promise<TurnRecord | undefined>;
  /**
   * Written **before** the tool runs, so a process that dies leaves a record of
   * what it was doing. The decision and the outcome arrive later, from whoever
   * makes them: the gate writes the first, the dispatcher the second.
   */
  recordToolExecution(input: { agentId: string; toolName: string; args: unknown }): Promise<string>;
  setToolDecision(input: {
    id: string;
    decision: 'permit' | 'refuse' | 'confirm_required';
    reason: string | null;
  }): Promise<void>;
  completeToolExecution(input: { id: string; outcome: ToolOutcome }): Promise<void>;
  recordTransaction(input: {
    agentId: string;
    toolExecutionId: string;
    hash: string | null;
    reachedLedger: boolean;
    ledger: number | null;
    amount: bigint | null;
    asset: string | null;
    destination: string | null;
    opResultName: string | null;
    contractErrorCodes: number[] | null;
    isBoundaryRefusal: boolean | null;
    isRevokedRule: boolean | null;
  }): Promise<void>;
  /**
   * Move a trigger's reference down, and refuse to move it any other way.
   *
   * The UPDATE applies only where the stored reference is still numerically
   * above `mustBeAbove` — which is the *new* reference, so the write happens
   * only when it lowers the number. That makes a widening re-stamp impossible
   * at the database rather than merely absent from `restampReference`: two
   * independent refusals for the one direction of self-mutation this project
   * will not ship.
   *
   * It is also what makes the write safe against a concurrent cycle. The guard
   * compares against whatever is stored *now* rather than against the value
   * this caller read, so a cycle that finishes second with an older, higher
   * price matches no row instead of walking the reference back up.
   *
   * Returns whether the row moved. `false` is not an error: it is the guard
   * doing its job, and the caller records it as `not_restamped` rather than
   * retrying into the same race.
   */
  restampTrigger(input: {
    agentId: string;
    /**
     * The stored reference must still be strictly above this for the write to
     * apply — so this is the new reference, not the one being replaced.
     */
    mustBeAbove: string;
    trigger: unknown;
  }): Promise<boolean>;
  /**
   * Take ownership of every schedule that is due, one row at a time.
   *
   * The claim, and the reason a cycle cannot be scheduled twice. Each row is
   * taken with a conditional UPDATE — `WHERE id = $1 AND next_run_at <= now()
   * AND enabled` — that advances `next_run_at` to the next future slot and
   * returns the row. Two ticks, two processes, or one tick running twice: only
   * one of them matches, and only the one holding the result enqueues.
   *
   * `limit` bounds a tick's appetite. A hundred due agents are not a hundred
   * simultaneous RPC bursts — the worker is serial and they queue — but an
   * unbounded claim would move every `next_run_at` forward in one statement and
   * make a slow drain look like a working schedule.
   *
   * Only `ACTIVE` agents are returned. The filter is in the query rather than in
   * the caller, like every other scoped read here: a paused agent is not due, it
   * is not skipped-with-a-reason, and the schedule simply does not see it.
   */
  claimDueTasks(input: { now: Date; limit: number }): Promise<ClaimedSchedule[]>;
  /**
   * Whether this agent already has work in flight, and the escape hatch.
   *
   * Returns the blocking turn, if any. A turn that is `queued` or recently
   * `running` blocks a new cycle: an agent that is already working does not need
   * a second cycle queued behind the first, and enqueuing one would be how a
   * slow drain becomes a stampede.
   *
   * `staleAfterMs` is what stops that becoming permanent silence. The turn that
   * can never be resolved — a worker that died between `sendTransaction` and
   * recording — is exactly the one that sits `running` forever, and without a
   * bound its agent would never schedule again. Past the bound it stops blocking
   * and `expireStaleTurn` closes it with a record.
   */
  blockingTurn(input: { agentId: string; staleAfterMs: number; now: Date }): Promise<
    { turnId: string; status: 'queued' | 'running'; startedAt: Date | null } | undefined
  >;
  /**
   * Close a turn that has been running past the staleness bound.
   *
   * A conditional UPDATE in `claimTurn`'s shape — `status = 'running' AND
   * started_at < cutoff` — so two tickers cannot both close it and neither can
   * close a turn that finished a moment ago.
   *
   * **It does not retry the turn, ever.** The result it writes says which of the
   * two things happened, read from the `submitting` marker: nothing was signed,
   * or a transaction may be on a ledger and must be checked before running
   * another. That is the same distinction `resolveUnclaimed` makes for a
   * redelivered turn, and for the same reason — the wrong guess trades twice.
   *
   * Returns the closed turn, or undefined when there was nothing to close.
   */
  expireStaleTurn(input: { agentId: string; cutoff: Date }): Promise<StaleTurn | undefined>;
  /**
   * Record what a scheduled cycle did, for the breaker.
   *
   * `counts` is false for the two outcomes that must not trip it: a cycle that
   * succeeded, and one that legitimately traded nothing. Anything else — a
   * refusal, an infrastructure error, an unreadable trigger — increments, and
   * the third consecutive one disables the schedule with a reason.
   *
   * Returns the schedule's state after the write, so the caller knows whether it
   * has a notification to send without reading the row again.
   */
  recordScheduleOutcome(input: { taskId: string; counts: boolean; reason: string }): Promise<{
    consecutiveFailures: number;
    disabled: boolean;
  }>;
  audit(input: {
    actor: 'user' | 'agent' | 'system' | 'operator';
    actorId: string | null;
    action: string;
    target: string | null;
    result: string | null;
    metadata: unknown;
  }): Promise<void>;
}

function toTurn(row: typeof turns.$inferSelect): TurnRecord {
  return {
    id: row.id,
    agentId: row.agentId,
    channel: row.channel,
    status: row.status,
    request: row.requestJson as TurnRequest,
    result: row.resultJson,
    outcome: row.outcome,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    scheduledTaskId: row.scheduledTaskId,
  };
}

export function drizzleRuntimeStore(db: RuntimeDb): RuntimeStore {
  return {
    async agentForTurn(agentId, userId) {
      const [row] = await db
        .select({
          id: agents.id,
          userId: agents.userId,
          name: agents.name,
          status: agents.status,
          smartAccount: agentAccounts.smartAccountContractId,
          agentPublicKey: agentAccounts.agentPublicKey,
          ownerPublicKey: agentAccounts.ownerPublicKey,
          ownerSignerKind: agentAccounts.ownerSignerKind,
          feeAccount: agentAccounts.agentFeeAccount,
          contextRuleId: agentAccounts.contextRuleId,
          venueContextRuleId: agentAccounts.venueContextRuleId,
          trigger: agents.triggerJson,
          ciphertext: agentKeys.ciphertext,
          wrappedDataKey: agentKeys.wrappedDataKey,
          kmsKeyId: agentKeys.kmsKeyId,
          algorithm: agentKeys.algorithm,
        })
        .from(agents)
        .innerJoin(agentAccounts, eq(agentAccounts.agentId, agents.id))
        .innerJoin(agentKeys, eq(agentKeys.agentId, agents.id))
        .where(and(eq(agents.id, agentId), eq(agents.userId, userId)))
        .limit(1);

      if (row === undefined) return undefined;

      // Its own query rather than a fourth join: an agent with no installed
      // policy row is a legitimate state — the boundary is on the chain and
      // this table records what was proposed — and an inner join would make
      // such an agent unreachable while looking like it did not exist.
      const [policy] = await db
        .select({ enforcedOffchainJson: policies.enforcedOffchainJson })
        .from(policies)
        .where(and(eq(policies.agentId, agentId), eq(policies.status, 'installed')))
        .orderBy(desc(policies.createdAt))
        .limit(1);

      return {
        id: row.id,
        userId: row.userId,
        name: row.name,
        status: row.status,
        smartAccount: row.smartAccount,
        agentPublicKey: row.agentPublicKey,
        ownerPublicKey: row.ownerPublicKey,
        ownerSignerKind: row.ownerSignerKind,
        // The agent signs its own fee envelope, so its address is the fee
        // source unless a separate one was recorded. Falling back to it is not
        // a guess: `deploy` funds this account precisely so it can pay.
        feeAccount: row.feeAccount ?? row.agentPublicKey,
        contextRuleId: row.contextRuleId,
        venueContextRuleId: row.venueContextRuleId,
        sealedKey: {
          ciphertext: row.ciphertext,
          wrappedDataKey: row.wrappedDataKey,
          kmsKeyId: row.kmsKeyId,
          algorithm: row.algorithm,
        },
        enforcedOffchain: (policy?.enforcedOffchainJson ?? null) as AgentForTurn['enforcedOffchain'],
        trigger: row.trigger,
      };
    },

    /**
     * The ratchet, as one statement.
     *
     * The `WHERE` does the work: the row moves only if the stored reference is
     * still strictly above the new one, so an upward re-stamp matches nothing
     * and writes nothing. `numeric` rather than a text comparison because
     * these are numbers written as strings — `'900000' > '1000000'` is true
     * lexically and false in every sense that matters here, and getting it
     * wrong would silently invert the guard rather than break it.
     */
    async restampTrigger({ agentId, mustBeAbove, trigger }) {
      const updated = await db
        .update(agents)
        .set({ triggerJson: trigger })
        .where(
          and(
            eq(agents.id, agentId),
            sql`(${agents.triggerJson} ->> 'referencePrice')::numeric > ${mustBeAbove}::numeric`,
          ),
        )
        .returning({ id: agents.id });
      return updated.length > 0;
    },

    async createTurn({ agentId, channel, request, schedule }) {
      const [row] = await db
        .insert(turns)
        .values({
          agentId,
          channel,
          requestJson: request,
          // Null for a turn a person started, which is what makes the unique
          // index partial. A scheduled turn carries its slot, and the index
          // refuses a second turn for that slot however it was reached.
          scheduledTaskId: schedule?.taskId ?? null,
          dueAt: schedule?.dueAt ?? null,
        })
        .returning();
      if (row === undefined) throw new Error('createTurn: insert returned no row.');
      return toTurn(row);
    },

    async claimTurn(turnId) {
      // One statement. See the header: a SELECT-then-UPDATE has a window in it,
      // and the window is a duplicate payment.
      const [row] = await db
        .update(turns)
        .set({ status: 'running', startedAt: new Date() })
        .where(and(eq(turns.id, turnId), eq(turns.status, 'queued')))
        .returning();
      return row === undefined ? undefined : toTurn(row);
    },

    async abandonTurn(turnId, result) {
      await db
        .update(turns)
        .set({ status: 'done', outcome: 'infra_error', resultJson: result, finishedAt: new Date() })
        .where(and(eq(turns.id, turnId), eq(turns.status, 'running')));
    },

    async markSubmitting(turnId, result) {
      await db.update(turns).set({ resultJson: result }).where(eq(turns.id, turnId));
    },

    async finishTurn({ turnId, outcome, result }) {
      await db
        .update(turns)
        .set({ status: 'done', outcome, resultJson: result, finishedAt: new Date() })
        .where(eq(turns.id, turnId));
    },

    async turnById(turnId) {
      const [row] = await db.select().from(turns).where(eq(turns.id, turnId)).limit(1);
      return row === undefined ? undefined : toTurn(row);
    },

    async readTurn(turnId, userId) {
      const [row] = await db
        .select({ turn: turns })
        .from(turns)
        .innerJoin(agents, eq(turns.agentId, agents.id))
        .where(and(eq(turns.id, turnId), eq(agents.userId, userId)))
        .limit(1);
      return row === undefined ? undefined : toTurn(row.turn);
    },

    async recordToolExecution({ agentId, toolName, args }) {
      const [row] = await db
        .insert(toolExecutions)
        .values({ agentId, toolName, argumentsJson: args })
        .returning({ id: toolExecutions.id });
      if (row === undefined) throw new Error('recordToolExecution: insert returned no row.');
      return row.id;
    },

    async setToolDecision({ id, decision, reason }) {
      await db
        .update(toolExecutions)
        .set({ policyDecision: decision, policyReason: reason })
        .where(eq(toolExecutions.id, id));
    },

    async completeToolExecution({ id, outcome }) {
      await db.update(toolExecutions).set({ outcome }).where(eq(toolExecutions.id, id));
    },

    async recordTransaction(input) {
      await db.insert(transactions).values(input);
    },

    /**
     * Candidates, then one conditional UPDATE each.
     *
     * The `SELECT` joins `agents` so `status = 'ACTIVE'` lives in the query
     * rather than in the tick — a paused agent is not due, it is not
     * skipped-with-a-reason, and the schedule simply does not see it. The
     * `EXISTS` repeats that check inside the UPDATE, because a person can pause
     * an agent between the two statements and the claim is the statement that
     * has to be right.
     *
     * **`dueAt` comes from the candidate row, and that is sound rather than
     * lucky.** `next_run_at` only ever advances *strictly into the future*, so
     * a schedule another tick already claimed fails `next_run_at <= now` and
     * matches nothing here. The only way this UPDATE matches is that nobody
     * else moved the row, which means the value read a moment ago is still the
     * slot being consumed. The partial unique index on
     * `(scheduled_task_id, due_at)` is the fence behind that argument.
     */
    async claimDueTasks({ now, limit }) {
      const candidates = await db
        .select({
          taskId: scheduledTasks.id,
          agentId: scheduledTasks.agentId,
          userId: agents.userId,
          dueAt: scheduledTasks.nextRunAt,
          intervalSeconds: scheduledTasks.intervalSeconds,
        })
        .from(scheduledTasks)
        .innerJoin(agents, eq(agents.id, scheduledTasks.agentId))
        .where(
          and(
            eq(scheduledTasks.enabled, true),
            eq(agents.status, 'ACTIVE'),
            isNotNull(scheduledTasks.intervalSeconds),
            isNotNull(scheduledTasks.nextRunAt),
            lte(scheduledTasks.nextRunAt, now),
          ),
        )
        .orderBy(scheduledTasks.nextRunAt)
        .limit(limit);

      const claimed: ClaimedSchedule[] = [];

      for (const candidate of candidates) {
        if (candidate.dueAt === null || candidate.intervalSeconds === null) continue;
        const [row] = await db
          .update(scheduledTasks)
          .set({
            // The next slot on the same grid that is strictly in the future,
            // never the slot after the one that was missed. A scheduler that
            // caught up would re-run windows it was down through, and a turn
            // that may have submitted must never be re-run. Missing slots is
            // the honest failure of the two.
            nextRunAt: sql`${scheduledTasks.nextRunAt} + make_interval(secs => ${scheduledTasks.intervalSeconds} * (floor(extract(epoch from (${now}::timestamptz - ${scheduledTasks.nextRunAt})) / ${scheduledTasks.intervalSeconds}) + 1))`,
            lastRunAt: now,
          })
          .where(
            and(
              eq(scheduledTasks.id, candidate.taskId),
              eq(scheduledTasks.enabled, true),
              lte(scheduledTasks.nextRunAt, now),
              sql`exists (select 1 from ${agents} where ${agents.id} = ${scheduledTasks.agentId} and ${agents.status} = 'ACTIVE')`,
            ),
          )
          .returning({
            nextRunAt: scheduledTasks.nextRunAt,
            consecutiveFailures: scheduledTasks.consecutiveFailures,
          });

        // No row: another tick, another process, or a redelivery got here
        // first, or the agent was paused between the two statements. Not an
        // error — losing the claim is the mechanism working.
        if (row === undefined || row.nextRunAt === null) continue;

        claimed.push({
          taskId: candidate.taskId,
          agentId: candidate.agentId,
          userId: candidate.userId,
          dueAt: candidate.dueAt,
          nextRunAt: row.nextRunAt,
          consecutiveFailures: row.consecutiveFailures,
        });
      }

      return claimed;
    },

    /**
     * The newest turn that is still live, subject to the staleness bound.
     *
     * `queued` is measured from `created_at` and `running` from `started_at`,
     * because those are the instants each state actually began. Past the bound
     * a turn stops blocking, which is the whole reason the bound exists: the
     * turn that can never be resolved is exactly the one that would otherwise
     * hold its agent's schedule shut forever.
     */
    async blockingTurn({ agentId, staleAfterMs, now }) {
      const cutoff = new Date(now.getTime() - staleAfterMs);
      const [row] = await db
        .select({ turnId: turns.id, status: turns.status, startedAt: turns.startedAt })
        .from(turns)
        .where(
          and(
            eq(turns.agentId, agentId),
            inArray(turns.status, ['queued', 'running']),
            sql`case when ${turns.status} = 'running' then coalesce(${turns.startedAt}, ${turns.createdAt}) else ${turns.createdAt} end >= ${cutoff}`,
          ),
        )
        .orderBy(desc(turns.createdAt))
        .limit(1);

      if (row === undefined) return undefined;
      // Narrowed rather than cast: `done` is excluded by the query above, and
      // the enum has no fourth member.
      return { turnId: row.turnId, status: row.status as 'queued' | 'running', startedAt: row.startedAt };
    },

    /**
     * Read the marker, then close the row with a statement only one caller wins.
     *
     * Two steps rather than one because the result written has to *say which of
     * the two things happened*, and that is read from the `submitting` marker
     * already on the row. The single-winner property is not weakened by the
     * read: the UPDATE requires the row still be live, so a second ticker — or
     * a worker that finished in between — finds nothing to close.
     *
     * It never retries. `abandonTurn`'s two sentences are reused verbatim,
     * because *"a worker stopped while this was in flight"* is the same fact
     * however it was noticed, and a second wording for it would be a second
     * thing to keep true.
     */
    async expireStaleTurn({ agentId, cutoff }) {
      const [candidate] = await db
        .select({
          turnId: turns.id,
          status: turns.status,
          startedAt: turns.startedAt,
          createdAt: turns.createdAt,
          result: turns.resultJson,
          scheduledTaskId: turns.scheduledTaskId,
        })
        .from(turns)
        .where(
          and(
            eq(turns.agentId, agentId),
            inArray(turns.status, ['queued', 'running']),
            sql`case when ${turns.status} = 'running' then coalesce(${turns.startedAt}, ${turns.createdAt}) else ${turns.createdAt} end < ${cutoff}`,
          ),
        )
        .orderBy(turns.createdAt)
        .limit(1);

      if (candidate === undefined) return undefined;

      const marker = candidate.result as { stage?: string } | null;
      const mayHaveSubmitted = marker?.stage === 'submitting';

      const [closed] = await db
        .update(turns)
        .set({
          status: 'done',
          outcome: 'infra_error',
          finishedAt: new Date(),
          resultJson: {
            stage: 'expired',
            mayHaveSubmitted,
            summary: mayHaveSubmitted
              ? 'This turn was still in flight past the staleness bound, and a submitting marker was ' +
                'on it, so a transaction may already be on a ledger. It was not retried, because a ' +
                'submitted payment and an unsubmitted one look identical from here and retrying could ' +
                'pay twice. Check the account activity for a transaction before running this agent again.'
              : 'This turn was still in flight past the staleness bound with nothing signed. It was ' +
                'closed so it would stop blocking this agent\u2019s schedule. Nothing moved.',
            previous: candidate.result,
          },
        })
        .where(and(eq(turns.id, candidate.turnId), inArray(turns.status, ['queued', 'running'])))
        .returning({ id: turns.id });

      // Somebody else closed it between the read and the write. Nothing to
      // report, and reporting it anyway would put two expiry records on one turn.
      if (closed === undefined) return undefined;

      return {
        turnId: candidate.turnId,
        agentId,
        startedAt: candidate.startedAt ?? candidate.createdAt,
        mayHaveSubmitted,
        scheduledTaskId: candidate.scheduledTaskId,
      };
    },

    /**
     * One statement, so the count and the disable cannot disagree.
     *
     * The threshold is applied inside the UPDATE against the value being
     * written, rather than against one read a moment earlier. Two cycles
     * finishing at once would otherwise both read two, both write three, and
     * both believe they were the one that tripped it — which is two
     * notifications for one event, or none.
     *
     * `disabled_at` and `disabled_reason` are written only on the transition,
     * guarded by `enabled`, so a schedule that is already stopped keeps the
     * instant and the reason it actually stopped for.
     */
    async recordScheduleOutcome({ taskId, counts, reason }) {
      if (!counts) {
        const [reset] = await db
          .update(scheduledTasks)
          .set({ consecutiveFailures: 0 })
          .where(eq(scheduledTasks.id, taskId))
          .returning({ enabled: scheduledTasks.enabled });
        return { consecutiveFailures: 0, disabled: reset !== undefined && !reset.enabled };
      }

      const [row] = await db
        .update(scheduledTasks)
        .set({
          consecutiveFailures: sql`${scheduledTasks.consecutiveFailures} + 1`,
          enabled: sql`case when ${scheduledTasks.consecutiveFailures} + 1 >= ${BREAKER_THRESHOLD} then false else ${scheduledTasks.enabled} end`,
          disabledAt: sql`case when ${scheduledTasks.consecutiveFailures} + 1 >= ${BREAKER_THRESHOLD} and ${scheduledTasks.enabled} then now() else ${scheduledTasks.disabledAt} end`,
          disabledReason: sql`case when ${scheduledTasks.consecutiveFailures} + 1 >= ${BREAKER_THRESHOLD} and ${scheduledTasks.enabled} then ${reason} else ${scheduledTasks.disabledReason} end`,
        })
        .where(eq(scheduledTasks.id, taskId))
        .returning({
          consecutiveFailures: scheduledTasks.consecutiveFailures,
          enabled: scheduledTasks.enabled,
        });

      if (row === undefined) return { consecutiveFailures: 0, disabled: false };
      return { consecutiveFailures: row.consecutiveFailures, disabled: !row.enabled };
    },

    async audit({ actor, actorId, action, target, result, metadata }) {
      await db.insert(auditEvents).values({
        actor,
        actorId,
        action,
        target,
        result,
        metadataJson: metadata,
      });
    },
  };
}

/** Kept for the health check: one round trip, no tables. */
export async function databaseReachable(db: RuntimeDb): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}
