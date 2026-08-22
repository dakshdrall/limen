/**
 * The Drizzle half of `UserStore`, `SessionStore` and `AgentStore` — the part
 * no test here can reach.
 *
 * `session.ts` explains why these interfaces exist: `apps/web` reaches Postgres
 * over `neon-http`, which speaks Neon's HTTP protocol, so a local Postgres
 * container cannot exercise this path at all. Everything above the interface is
 * provable against a fake, and this file is what is left over. It is written to
 * be as small and as boring as it can be, because *small and boring* is the
 * only quality control available to code that cannot be run in CI.
 *
 * So: no conditionals, no partial updates, no query built from a variable, and
 * one statement per method wherever one will do.
 *
 * ## The one method that is three statements, and why it did not move
 *
 * `configure` sends three writes through `db.batch`. The rule this header used
 * to state without qualification — *if something ever wants a transaction, it
 * moves to `apps/runtime`* — is about **interactive** transactions, which is
 * what `neon-http` cannot do and what `web.ts` is careful to say. Three writes
 * with no logic between them are not that, and PLAN-V8 §7.5.2's measurement
 * against live Neon settled the behaviour rather than leaving it inferred:
 * `db.transaction()` throws and leaves no rows, and `db.batch()` is atomic —
 * proved by a deliberate constraint violation rolling the whole batch back.
 *
 * The exception is narrow on purpose. A method here that needed to *read* a row
 * and then decide what to write based on it would still belong in the runtime,
 * and `configure`'s ownership check is deliberately not that: it refuses before
 * the batch rather than branching inside it. See `agents.ts`.
 *
 * ## Bytes in the database, bytes in the interface
 *
 * `passkey_credential_id` and `passkey_public_key` are `bytea`, surfaced by the
 * schema's custom type as `Uint8Array`. They stay bytes the whole way through:
 * the base64url spelling exists only at the HTTP boundary, in the routes, and
 * a lookup compares bytes to bytes. Two spellings of the same credential id —
 * padded and unpadded base64url, say — would be two different rows.
 */

import 'server-only';
import { and, eq, gt } from 'drizzle-orm';
import { agentAccounts, agents, policies, sessions, users } from '@limen/db';
import type { WebDb } from '@limen/db/web';
import type { UserRecord, UserStore } from './auth';
import type { SessionRecord, SessionStore } from './session';
import type { AgentRecord, AgentStatus, AgentStore, ProposedPolicy } from './agents';
import { webDb } from './db';

function toUser(row: {
  id: string;
  displayName: string | null;
  passkeyCredentialId: Uint8Array | null;
  passkeyPublicKey: Uint8Array | null;
}): UserRecord | undefined {
  // A passkey user with either column null is a row that cannot log in. It is
  // returned as "no such user" rather than as a user with an empty key,
  // because the alternative is a `verifyAssertion` call against zero bytes and
  // an error from WebCrypto about key import, three layers from the cause.
  if (row.passkeyCredentialId === null || row.passkeyPublicKey === null) return undefined;
  return {
    id: row.id,
    displayName: row.displayName,
    credentialId: row.passkeyCredentialId,
    publicKey: row.passkeyPublicKey,
  };
}

export function drizzleUserStore(db: WebDb = webDb()): UserStore {
  return {
    async findByCredentialId(credentialId) {
      const [row] = await db.select().from(users).where(eq(users.passkeyCredentialId, credentialId)).limit(1);
      return row === undefined ? undefined : toUser(row);
    },

    async findById(id) {
      const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      return row === undefined ? undefined : toUser(row);
    },

    async createPasskeyUser({ credentialId, publicKey, displayName }) {
      const [row] = await db
        .insert(users)
        .values({ authMethod: 'passkey', passkeyCredentialId: credentialId, passkeyPublicKey: publicKey, displayName })
        .returning();
      const created = row === undefined ? undefined : toUser(row);
      if (created === undefined) {
        // Unreachable unless the insert above stops writing both columns. It
        // throws rather than returning undefined so that a future edit which
        // breaks the pair fails here instead of at the next login.
        throw new Error('stores: the inserted user came back without a credential.');
      }
      return created;
    },
  };
}

export function drizzleSessionStore(db: WebDb = webDb()): SessionStore {
  return {
    async create({ userId, tokenHash, expiresAt, createdIpHash }): Promise<SessionRecord> {
      const [row] = await db.insert(sessions).values({ userId, tokenHash, expiresAt, createdIpHash }).returning();
      if (row === undefined) throw new Error('stores: the inserted session came back empty.');
      return { id: row.id, userId: row.userId, expiresAt: row.expiresAt };
    },

    async findValid(tokenHash, now) {
      // Expiry is in the query, never after it — `session.ts`'s third rule.
      // `gt` and not `gte`: a session expiring on this exact instant has
      // expired, and the boundary should fall on the safe side of a clock that
      // two processes read a millisecond apart.
      const [row] = await db
        .select()
        .from(sessions)
        .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
        .limit(1);
      return row === undefined ? undefined : { id: row.id, userId: row.userId, expiresAt: row.expiresAt };
    },

    async deleteByTokenHash(tokenHash) {
      await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
    },

    async deleteAllForUser(userId) {
      await db.delete(sessions).where(eq(sessions.userId, userId));
    },
  };
}

/**
 * Agents, scoped to their owner in the query rather than by the caller.
 *
 * Both reads and both writes carry `user_id` in the `where`. There is no method
 * here that takes an agent id alone, and `agents.ts` explains why: an agent id
 * is a UUID in a URL, and an unscoped lookup would let any signed-in user
 * configure and deploy any other user's agent by pasting one. A check the
 * caller performs after the row comes back is one `if` away from not happening.
 *
 * `status` is narrowed on the way out. The column's enum has eight values and
 * this flow uses five; a row carrying one of the other three — `PAUSED`,
 * `REVOKED`, `EXPIRED`, all of which the runtime will write — is returned as
 * itself rather than coerced, and `narrowStatus` throws instead of guessing. A
 * silent fallback to `DRAFT` would let a revoked agent render as a fresh one.
 */
function narrowStatus(status: string): AgentStatus {
  if (
    status === 'DRAFT' ||
    status === 'CONFIGURED' ||
    status === 'DEPLOYING' ||
    status === 'ACTIVE' ||
    status === 'ERROR'
  ) {
    return status;
  }
  throw new Error(
    `stores: agent status ${JSON.stringify(status)} is outside the set this screen renders. ` +
      'It is a real value in the agent_status enum, so widen AgentStatus and the screen together rather than defaulting it.',
  );
}

function toAgent(row: {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  status: string;
}): AgentRecord {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    description: row.description,
    status: narrowStatus(row.status),
  };
}

export function drizzleAgentStore(db: WebDb = webDb()): AgentStore {
  return {
    async createDraft({ userId, name, description }) {
      const [row] = await db.insert(agents).values({ userId, name, description }).returning();
      if (row === undefined) throw new Error('stores: the inserted agent came back empty.');
      return toAgent(row);
    },

    async updateDraft({ id, userId, name, description }) {
      const [row] = await db
        .update(agents)
        .set({ name, description })
        .where(and(eq(agents.id, id), eq(agents.userId, userId)))
        .returning();
      return row === undefined ? undefined : toAgent(row);
    },

    async findForUser(id, userId) {
      const [row] = await db
        .select()
        .from(agents)
        .where(and(eq(agents.id, id), eq(agents.userId, userId)))
        .limit(1);
      return row === undefined ? undefined : toAgent(row);
    },

    /**
     * The one method here that is not a single statement, and the header's rule
     * says such a thing moves to `apps/runtime`. It does not, and the exception
     * is narrow enough to state: that rule is about **interactive** transactions
     * — multi-statement work with logic between the statements — which
     * `neon-http` genuinely cannot do. This is three writes sent together
     * through `db.batch`, with no logic between them, which the §7.5.2
     * measurement established is atomic on this driver.
     *
     * `agents.ts`'s `ConfigureInput` carries the rest of the argument, including
     * why ownership is checked before the batch rather than inside it.
     */
    async configure(input) {
      const owned = await db
        .select()
        .from(agents)
        .where(and(eq(agents.id, input.agentId), eq(agents.userId, input.userId)))
        .limit(1);
      if (owned[0] === undefined) {
        throw new AgentNotFound(input.agentId);
      }

      const [, , updated] = await db.batch([
        // Reconfiguring replaces rather than accumulates. A second proposed
        // policy on one agent would leave the screen choosing between them.
        db
          .delete(policies)
          .where(and(eq(policies.agentId, input.agentId), eq(policies.status, 'proposed'))),
        db.insert(policies).values({
          agentId: input.agentId,
          source: 'described',
          // No observed transaction exists, so no hash. The null is the record
          // that nothing was observed — see `agent-config.ts`.
          observedTxHash: null,
          observedLedger: input.observedLedger,
          headroomBps: input.headroomBps,
          windowLedgers: input.windowLedgers,
          validUntilLedger: input.validUntilLedger,
          proposalJson: input.proposal,
          installPlanJson: input.installPlan,
          enforcedOffchainJson: input.enforcedOffChain,
          status: 'proposed',
        }),
        db
          .update(agents)
          .set({ name: input.name, status: 'CONFIGURED' })
          .where(and(eq(agents.id, input.agentId), eq(agents.userId, input.userId)))
          .returning(),
      ]);

      const row = updated[0];
      if (row === undefined) {
        // Unreachable: ownership was established above and nothing deletes an
        // agent on this path. It throws rather than returning undefined so a
        // future edit that breaks the pairing fails here instead of leaving a
        // CONFIGURED agent the caller believes does not exist.
        throw new Error('stores: the configured agent came back empty.');
      }
      return toAgent(row);
    },

    /**
     * The boundary this agent was configured with.
     *
     * Joined through `agents` so the owner scoping is in the query rather than
     * in the caller, the same as everything else here — `policies` has no
     * `user_id` of its own, so the scope has to come from the agent it hangs
     * off.
     */
    async proposedPolicy(agentId, userId) {
      const [row] = await db
        .select({
          id: policies.id,
          proposalJson: policies.proposalJson,
          installPlanJson: policies.installPlanJson,
          validUntilLedger: policies.validUntilLedger,
        })
        .from(policies)
        .innerJoin(agents, eq(policies.agentId, agents.id))
        .where(
          and(
            eq(policies.agentId, agentId),
            eq(policies.status, 'proposed'),
            eq(agents.userId, userId),
          ),
        )
        .limit(1);

      if (row === undefined) return undefined;
      if (row.proposalJson === null || row.installPlanJson === null) {
        // A proposed policy with no proposal is a row `configure` cannot have
        // written. It throws rather than being reported as "not configured",
        // because the two need different answers: one is "go and configure it"
        // and the other is a bug.
        throw new Error(`stores: policy ${row.id} is proposed but carries no proposal.`);
      }

      return {
        id: row.id,
        proposal: row.proposalJson as ProposedPolicy['proposal'],
        installPlan: row.installPlanJson as ProposedPolicy['installPlan'],
        validUntilLedger: row.validUntilLedger,
      };
    },

    async markStatus({ agentId, userId, status }) {
      const [row] = await db
        .update(agents)
        .set({ status })
        .where(and(eq(agents.id, agentId), eq(agents.userId, userId)))
        .returning();
      if (row === undefined) throw new AgentNotFound(agentId);
      return toAgent(row);
    },

    /**
     * Three writes again, and atomic for a sharper reason than `configure`'s.
     *
     * A transaction has already reached a ledger by the time this is called.
     * If the `agent_accounts` insert landed and the `policies` update did not,
     * Limen would hold a deployed smart account whose boundary it still
     * believes is merely proposed — and the screen that offers to deploy would
     * offer to deploy it again, against an account that already has the rule.
     * That is the one interleaving here that costs a second transaction on a
     * real network.
     */
    async recordDeployment(input) {
      const owned = await db
        .select()
        .from(agents)
        .where(and(eq(agents.id, input.agentId), eq(agents.userId, input.userId)))
        .limit(1);
      if (owned[0] === undefined) throw new AgentNotFound(input.agentId);

      const [, , updated] = await db.batch([
        db.insert(agentAccounts).values({
          agentId: input.agentId,
          smartAccountContractId: input.smartAccountContractId,
          deployTxHash: input.deployTxHash,
          // The account's owner signer is the browser's local key on this
          // path. A passkey-owned account is B9's work, not this flow's.
          ownerSignerKind: 'ed25519',
          ownerPublicKey: input.ownerPublicKey,
          agentPublicKey: input.agentPublicKey,
          contextRuleId: input.contextRuleId,
          installTxHash: input.installTxHash,
        }),
        db
          .update(policies)
          .set({
            status: 'installed',
            installTxHash: input.installTxHash,
            contextRuleId: input.contextRuleId,
          })
          .where(eq(policies.id, input.policyId)),
        db
          .update(agents)
          .set({ status: 'ACTIVE', deployedAt: new Date() })
          .where(and(eq(agents.id, input.agentId), eq(agents.userId, input.userId)))
          .returning(),
      ]);

      const row = updated[0];
      if (row === undefined) throw new Error('stores: the deployed agent came back empty.');
      return toAgent(row);
    },
  };
}

/**
 * The agent is not this user's, or is not there.
 *
 * One error for both, because telling an unauthorised caller that an id exists
 * is the distinction worth not making. Its own type so a route can map it to a
 * 404 without matching on a message.
 */
export class AgentNotFound extends Error {
  constructor(id: string) {
    super(`No agent ${id} for this user.`);
    this.name = 'AgentNotFound';
  }
}
