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
    ...overrides,
  };
}

export interface Recorded {
  toolExecutions: { id: string; toolName: string; args: unknown }[];
  decisions: { id: string; decision: string; reason: string | null }[];
  outcomes: { id: string; outcome: ToolOutcome }[];
  transactions: unknown[];
  audits: unknown[];
  turns: Map<string, TurnRecord>;
}

export function fakeStore(options: { agent?: AgentForTurn | undefined } = {}): {
  store: RuntimeStore;
  recorded: Recorded;
} {
  const agent = 'agent' in options ? options.agent : fakeAgent();
  let nextId = 0;
  const recorded: Recorded = {
    toolExecutions: [],
    decisions: [],
    outcomes: [],
    transactions: [],
    audits: [],
    turns: new Map(),
  };

  const store: RuntimeStore = {
    async agentForTurn(agentId, userId) {
      if (agent === undefined) return undefined;
      return agentId === agent.id && userId === agent.userId ? agent : undefined;
    },

    async createTurn({ agentId, channel, request }) {
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

    async audit(input) {
      recorded.audits.push(input);
    },
  };

  return { store, recorded };
}
