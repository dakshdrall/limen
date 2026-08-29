/**
 * In-memory stand-ins, for the tests that are about logic rather than storage.
 *
 * `store-postgres.test.ts` covers what Postgres actually does — the claim being
 * single-winner is a property of the database, not of this file, and asserting
 * it against a fake would be writing a fake that agrees with the design. What
 * these are for is everything above that line: which branch runs, what gets
 * recorded, and what the caller is told.
 */

import { randomUUID } from 'node:crypto';
import { BREAKER_THRESHOLD } from '../src/store.js';
import type {
  AgentForTurn,
  RuntimeStore,
  ToolOutcome,
  TurnChannel,
  TurnRecord,
  TurnRequest,
} from '../src/store.js';

export const AGENT_ID = '11111111-1111-4111-8111-111111111111';
export const USER_ID = '22222222-2222-4222-8222-222222222222';

export function fakeAgent(overrides: Partial<AgentForTurn> = {}): AgentForTurn {
  return {
    id: AGENT_ID,
    userId: USER_ID,
    name: 'payer',
    status: 'ACTIVE',
    smartAccount: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
    agentPublicKey: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    ownerPublicKey: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
    ownerSignerKind: 'passkey',
    feeAccount: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    contextRuleId: 1,
    sealedKey: {
      ciphertext: new Uint8Array([1, 2, 3]),
      wrappedDataKey: new Uint8Array([4, 5, 6]),
      kmsKeyId: 'env-master-key/test',
      algorithm: 'ed25519-seed:aes-256-gcm/aes-256-gcm-envelope-v1',
    },
    enforcedOffchain: null,
    trigger: null,
    ...overrides,
  };
}

/** A row of `scheduled_tasks`, reduced to what a tick reads and writes. */
export interface FakeSchedule {
  taskId: string;
  agentId: string;
  userId: string;
  intervalSeconds: number;
  nextRunAt: Date;
  enabled: boolean;
  consecutiveFailures: number;
  disabledAt: Date | null;
  disabledReason: string | null;
}

export interface Recorded {
  toolExecutions: { id: string; toolName: string; args: unknown }[];
  /** Every re-stamp the store was asked for, applied or refused by the guard. */
  restamps: { agentId: string; mustBeAbove: string; trigger: unknown; applied: boolean }[];
  decisions: { id: string; decision: string; reason: string | null }[];
  outcomes: { id: string; outcome: ToolOutcome }[];
  transactions: unknown[];
  audits: unknown[];
  turns: Map<string, TurnRecord>;
  /**
   * Schedules the tick can claim, seeded by the test that needs them.
   *
   * Enough of `scheduled_tasks` to drive a tick and no more. The properties
   * worth doubting — that two ticks cannot both own a slot, that the breaker's
   * count and its disable are one statement — are properties of Postgres and
   * are asserted in `store-postgres.test.ts`. What this reproduces is the
   * *contract*, so a tick test can reach the branches that matter.
   */
  schedules: Map<string, FakeSchedule>;
}

export function fakeStore(options: { agent?: AgentForTurn | undefined } = {}): {
  store: RuntimeStore;
  recorded: Recorded;
} {
  const agent = 'agent' in options ? options.agent : fakeAgent();
  let nextId = 0;
  const recorded: Recorded = {
    toolExecutions: [],
    restamps: [],
    decisions: [],
    outcomes: [],
    transactions: [],
    audits: [],
    turns: new Map(),
    schedules: new Map(),
  };

  const store: RuntimeStore = {
    async agentForTurn(agentId, userId) {
      if (agent === undefined) return undefined;
      return agentId === agent.id && userId === agent.userId ? agent : undefined;
    },

    async createTurn({ agentId, channel, request, schedule }) {
      const turn: TurnRecord = {
        // A real id, because the HTTP routes match a uuid shape. A fake that
        // handed out `turn-1` would make a route test pass or fail for a reason
        // that has nothing to do with the route.
        id: randomUUID(),
        agentId,
        channel: channel as TurnChannel,
        status: 'queued',
        request: request as TurnRequest,
        result: null,
        outcome: null,
        createdAt: new Date('2026-08-23T00:00:00Z'),
        startedAt: null,
        finishedAt: null,
        scheduledTaskId: schedule?.taskId ?? null,
      };
      recorded.turns.set(turn.id, turn);
      return turn;
    },

    async claimTurn(turnId) {
      const turn = recorded.turns.get(turnId);
      if (turn === undefined || turn.status !== 'queued') return undefined;
      const claimed = { ...turn, status: 'running' as const, startedAt: new Date() };
      recorded.turns.set(turnId, claimed);
      return claimed;
    },

    async turnById(turnId) {
      return recorded.turns.get(turnId);
    },

    async abandonTurn(turnId, result) {
      const turn = recorded.turns.get(turnId);
      if (turn === undefined || turn.status !== 'running') return;
      recorded.turns.set(turnId, {
        ...turn,
        status: 'done',
        outcome: 'infra_error',
        result,
        finishedAt: new Date(),
      });
    },

    async markSubmitting(turnId, result) {
      const turn = recorded.turns.get(turnId);
      if (turn !== undefined) recorded.turns.set(turnId, { ...turn, result });
    },

    async finishTurn({ turnId, outcome, result }) {
      const turn = recorded.turns.get(turnId);
      if (turn !== undefined) {
        recorded.turns.set(turnId, { ...turn, status: 'done', outcome, result, finishedAt: new Date() });
      }
    },

    async readTurn(turnId, userId) {
      const turn = recorded.turns.get(turnId);
      if (turn === undefined) return undefined;
      return agent !== undefined && userId === agent.userId ? turn : undefined;
    },

    async recordToolExecution({ toolName, args }) {
      const id = `exec-${++nextId}`;
      recorded.toolExecutions.push({ id, toolName, args });
      return id;
    },

    async setToolDecision({ id, decision, reason }) {
      recorded.decisions.push({ id, decision, reason });
    },

    async completeToolExecution({ id, outcome }) {
      recorded.outcomes.push({ id, outcome });
    },

    async recordTransaction(input) {
      recorded.transactions.push(input);
    },

    /**
     * The guard, in the fake, for the reason the real one is in SQL.
     *
     * `store-postgres.test.ts` proves the `WHERE` clause actually refuses an
     * upward write, because that is a property of Postgres and asserting it
     * against a fake would be writing a fake that agrees with the design. What
     * this reproduces is the *contract* — the write applies only where the
     * stored reference is still above the new one — so a caller test can reach
     * the branch that records `not_restamped` rather than only ever seeing the
     * happy path. A fake agent with no stored trigger has nothing to compare
     * against and applies, which is the shape every cycle test here uses.
     */
    async restampTrigger({ agentId, mustBeAbove, trigger }) {
      const stored = (agent?.trigger as { referencePrice?: string } | null)?.referencePrice;
      const applied = stored === undefined ? true : BigInt(stored) > BigInt(mustBeAbove);
      recorded.restamps.push({ agentId, mustBeAbove, trigger, applied });
      return applied;
    },

    async claimDueTasks({ now, limit }) {
      const claimed = [];
      for (const schedule of [...recorded.schedules.values()].sort(
        (a, b) => a.nextRunAt.getTime() - b.nextRunAt.getTime(),
      )) {
        if (claimed.length >= limit) break;
        if (!schedule.enabled) continue;
        if (schedule.nextRunAt.getTime() > now.getTime()) continue;
        if (agent !== undefined && agent.id === schedule.agentId && agent.status !== 'ACTIVE') continue;

        const dueAt = schedule.nextRunAt;
        const interval = schedule.intervalSeconds * 1000;
        // Forward to the next slot on the grid, never to the missed one. The
        // real advance is the same expression in SQL.
        const missed = Math.floor((now.getTime() - dueAt.getTime()) / interval) + 1;
        schedule.nextRunAt = new Date(dueAt.getTime() + missed * interval);
        claimed.push({
          taskId: schedule.taskId,
          agentId: schedule.agentId,
          userId: schedule.userId,
          dueAt,
          nextRunAt: schedule.nextRunAt,
          consecutiveFailures: schedule.consecutiveFailures,
        });
      }
      return claimed;
    },

    async blockingTurn({ agentId, staleAfterMs, now }) {
      const cutoff = now.getTime() - staleAfterMs;
      const live = [...recorded.turns.values()]
        .filter((turn) => turn.agentId === agentId && turn.status !== 'done')
        .filter((turn) => (turn.status === 'running' ? (turn.startedAt ?? turn.createdAt) : turn.createdAt).getTime() >= cutoff)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const turn = live[0];
      if (turn === undefined) return undefined;
      return { turnId: turn.id, status: turn.status, startedAt: turn.startedAt };
    },

    async expireStaleTurn({ agentId, cutoff }) {
      const stale = [...recorded.turns.values()]
        .filter((turn) => turn.agentId === agentId && turn.status !== 'done')
        .filter((turn) => (turn.status === 'running' ? (turn.startedAt ?? turn.createdAt) : turn.createdAt).getTime() < cutoff.getTime())
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      const turn = stale[0];
      if (turn === undefined) return undefined;

      const marker = turn.result as { stage?: string } | null;
      const mayHaveSubmitted = marker?.stage === 'submitting';
      recorded.turns.set(turn.id, {
        ...turn,
        status: 'done',
        outcome: 'infra_error',
        finishedAt: new Date(),
        result: { stage: 'expired', mayHaveSubmitted, previous: turn.result },
      });
      return {
        turnId: turn.id,
        agentId,
        startedAt: turn.startedAt ?? turn.createdAt,
        mayHaveSubmitted,
        scheduledTaskId: turn.scheduledTaskId,
      };
    },

    async recordScheduleOutcome({ taskId, counts, reason }) {
      const schedule = recorded.schedules.get(taskId);
      if (schedule === undefined) return { consecutiveFailures: 0, disabled: false };
      if (!counts) {
        schedule.consecutiveFailures = 0;
        return { consecutiveFailures: 0, disabled: !schedule.enabled };
      }
      schedule.consecutiveFailures += 1;
      if (schedule.consecutiveFailures >= BREAKER_THRESHOLD && schedule.enabled) {
        schedule.enabled = false;
        schedule.disabledAt = new Date();
        schedule.disabledReason = reason;
      }
      return { consecutiveFailures: schedule.consecutiveFailures, disabled: !schedule.enabled };
    },

    async audit(input) {
      recorded.audits.push(input);
    },
  };

  return { store, recorded };
}
