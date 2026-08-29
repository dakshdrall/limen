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

import { and, desc, eq, sql } from 'drizzle-orm';
import {
  agentAccounts,
  agentKeys,
  agents,
  auditEvents,
  policies,
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

export interface RuntimeStore {
  agentForTurn(agentId: string, userId: string): Promise<AgentForTurn | undefined>;
  createTurn(input: {
    agentId: string;
    channel: TurnChannel;
    request: TurnRequest;
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

    async createTurn({ agentId, channel, request }) {
      const [row] = await db
        .insert(turns)
        .values({ agentId, channel, requestJson: request })
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
