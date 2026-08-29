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
import { and, desc, eq, gt } from 'drizzle-orm';
import { generateAgentKey } from '@limen/custody';
import {
  agentAccounts,
  agentKeys,
  agents,
  policies,
  scheduledTasks,
  sessions,
  transactions,
  users,
} from '@limen/db';
import { keyProvider } from './key-provider';
import type { WebDb } from '@limen/db/web';
import type { UserRecord, UserStore } from './auth';
import type { SessionRecord, SessionStore } from './session';
import type { AgentRecord, AgentStatus, AgentStore, ProposedPolicy } from './agents';
import { webDb } from './db';

/**
 * A row becomes whichever kind of user it actually is, or nothing.
 *
 * The dispatch is on the columns rather than on `auth_method`, deliberately.
 * The enum says what the row *claims* to be; the columns say what it can
 * actually do. A row marked `'wallet'` with a null address cannot log in no
 * matter what the enum says, and trusting the label would mean constructing a
 * `WalletUser` whose `stellarAddress` is null — which the type forbids and
 * which would then be asserted away right here, at the one place that knows
 * better.
 *
 * Both kinds fail the same way: a row that satisfies neither shape comes back
 * as "no such user" rather than as a half-built record. The original reasoning
 * for that, written for passkeys, applies unchanged — a user with an empty key
 * surfaces as a WebCrypto import error three layers from the cause.
 */
function toUser(row: {
  id: string;
  displayName: string | null;
  passkeyCredentialId: Uint8Array | null;
  passkeyPublicKey: Uint8Array | null;
  stellarAddress: string | null;
}): UserRecord | undefined {
  if (row.passkeyCredentialId !== null && row.passkeyPublicKey !== null) {
    return {
      authMethod: 'passkey',
      id: row.id,
      displayName: row.displayName,
      credentialId: row.passkeyCredentialId,
      publicKey: row.passkeyPublicKey,
      stellarAddress: null,
    };
  }

  if (row.stellarAddress !== null && row.stellarAddress.length > 0) {
    return {
      authMethod: 'wallet',
      id: row.id,
      displayName: row.displayName,
      credentialId: null,
      publicKey: null,
      stellarAddress: row.stellarAddress,
    };
  }

  return undefined;
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

    async findByStellarAddress(address) {
      const [row] = await db.select().from(users).where(eq(users.stellarAddress, address)).limit(1);
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

    /**
     * The one insert here that can lose a race, and it is made to lose it
     * safely.
     *
     * Two first-time sign-ins from the same wallet arriving together both find
     * no row and both insert. `users_stellar_address_key` makes the second one
     * a constraint violation rather than a second account — which is exactly
     * the outcome wanted, because the alternative is a user who owns none of
     * the agents they created a moment ago.
     *
     * `onConflictDoUpdate` on the address, rather than catching the violation:
     * it is one statement, it returns the row either way, and the "update" sets
     * the address to the value it already has. That is a no-op write chosen
     * over `onConflictDoNothing` for one reason — `DO NOTHING` returns no rows
     * on conflict, so the loser of the race would get `undefined` and have to
     * re-read, and a read-then-write here is the shape this file's header says
     * belongs in the runtime.
     */
    async createWalletUser({ stellarAddress, displayName }) {
      const [row] = await db
        .insert(users)
        .values({ authMethod: 'wallet', stellarAddress, displayName })
        .onConflictDoUpdate({ target: users.stellarAddress, set: { stellarAddress } })
        .returning();
      const created = row === undefined ? undefined : toUser(row);
      if (created === undefined) {
        throw new Error('stores: the inserted wallet user came back without an address.');
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
  draftJson?: unknown;
  triggerJson?: unknown;
}): AgentRecord {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    description: row.description,
    status: narrowStatus(row.status),
    // Passed through untyped and unvalidated, which is what the column holds.
    // `?? null` rather than left undefined so "no proposal" is one value.
    draft: row.draftJson ?? null,
    trigger: row.triggerJson ?? null,
  };
}

export function drizzleAgentStore(db: WebDb = webDb()): AgentStore {
  return {
    async createDraft({ userId, name, description, draft }) {
      const [row] = await db
        .insert(agents)
        .values({ userId, name, description, draftJson: draft ?? null })
        .returning();
      if (row === undefined) throw new Error('stores: the inserted agent came back empty.');
      return toAgent(row);
    },

    /**
     * `draft` is written only when the caller supplies one.
     *
     * Renaming an agent must not erase the proposal it is being reviewed
     * against, and `set({ draftJson: undefined })` in Drizzle omits the column
     * rather than nulling it — which is the behaviour wanted, but only by
     * accident of the library. The conditional spread makes it the behaviour
     * asked for, so a future Drizzle that treats `undefined` as `NULL` does not
     * quietly delete a proposal on every rename.
     */
    async updateDraft({ id, userId, name, description, draft }) {
      const [row] = await db
        .update(agents)
        .set({ name, description, ...(draft === undefined ? {} : { draftJson: draft }) })
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
     * A left join, not an inner one, and the difference is the whole list.
     *
     * An `agents` row with no `agent_accounts` row is a draft — described but
     * never deployed — and an inner join would make every draft invisible while
     * looking like a working query. The screen's job includes showing a person
     * the agent they abandoned halfway; a list that silently omitted them would
     * be the shape of failure `agents.ts` warns about, where an abandoned
     * attempt is lost rather than visible.
     *
     * No cap column is selected, and none exists to select. See `AgentSummary`.
     */
    async listForUser(userId) {
      const rows = await db
        .select({
          id: agents.id,
          name: agents.name,
          description: agents.description,
          status: agents.status,
          createdAt: agents.createdAt,
          smartAccount: agentAccounts.smartAccountContractId,
          contextRuleId: agentAccounts.contextRuleId,
        })
        .from(agents)
        .leftJoin(agentAccounts, eq(agentAccounts.agentId, agents.id))
        .where(eq(agents.userId, userId))
        .orderBy(desc(agents.createdAt));

      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        status: row.status as AgentStatus,
        smartAccount: row.smartAccount,
        contextRuleId: row.contextRuleId,
        createdAt: row.createdAt.toISOString(),
      }));
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
          // The trigger is written in the same batch as the policy row, so an
          // agent never exists in a state where a person reviewed a rule that
          // was not stored. It is set unconditionally, including to null:
          // reconfiguring an agent to have no trigger has to clear the old one,
          // and a conditional write would leave the previous rule live under a
          // configuration that no longer mentions it.
          .set({ name: input.name, status: 'CONFIGURED', triggerJson: input.trigger })
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
          enforcedOffchainJson: policies.enforcedOffchainJson,
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
        enforcedOffChain: (row.enforcedOffchainJson ?? null) as ProposedPolicy['enforcedOffChain'],
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
          venueContextRuleId: input.venueContextRuleId,
          venueInstallTxHash: input.venueContextRuleId === null ? null : input.installTxHash,
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

    /**
     * Generate the agent's key, or hand back the one it already has.
     *
     * The read-then-write is the one place in this file that branches on a row
     * it just read, which the header says belongs in `apps/runtime`. It stays
     * here for a reason narrower than convenience: the alternative shapes are
     * worse, and the failure it guards against is not a race.
     *
     * An `onConflictDoNothing` insert would generate a keypair on every call
     * and discard all but the first, which means the ordinary retry path
     * generates key material and throws it away — cheap, but it makes "how many
     * keys has this agent had" unanswerable from the code. Catching the unique
     * violation has the same problem plus an error path that looks like a bug.
     *
     * Two concurrent deploys of one agent would still be serialised by the
     * unique index rather than by this check, so the check is not load-bearing
     * for correctness under concurrency — it is load-bearing for *not
     * generating keys speculatively*, and the index is what makes the outcome
     * safe either way.
     */
    async provisionAgentKey({ agentId, userId }) {
      const owned = await db
        .select({ id: agents.id })
        .from(agents)
        .where(and(eq(agents.id, agentId), eq(agents.userId, userId)))
        .limit(1);
      if (owned[0] === undefined) throw new AgentNotFound(agentId);

      // The public half lives on `agent_accounts`, which does not exist until
      // the deployment is recorded — so an in-flight deploy's key is found by
      // its `agent_keys` row, and the address is derived from the sealed key
      // only by opening it. That would mean decrypting a seed to answer a
      // question about a public value, so the address is kept here too.
      const existing = await db
        .select({ agentPublicKey: agentKeys.agentPublicKey })
        .from(agentKeys)
        .where(eq(agentKeys.agentId, agentId))
        .limit(1);

      const found = existing[0];
      if (found !== undefined) {
        return { agentPublicKey: found.agentPublicKey, generated: false };
      }

      const generated = await generateAgentKey({ provider: keyProvider(), agentId });

      await db.insert(agentKeys).values({
        agentId,
        agentPublicKey: generated.publicKey,
        ciphertext: generated.sealed.ciphertext,
        wrappedDataKey: generated.sealed.wrappedDataKey,
        kmsKeyId: generated.sealed.kmsKeyId,
        algorithm: generated.sealed.algorithm,
      });

      return { agentPublicKey: generated.publicKey, generated: true };
    },

    /**
     * The most recent transaction this agent produced, or nothing.
     *
     * Scoped through `agents` so the owner check is in the query, like every
     * other read here. It returns what was *recorded* — a hash, whether it
     * reached a ledger, and its contract error codes — and deliberately not
     * what the rule currently permits: this module's header forbids caching a
     * claim about chain state, and a transaction that happened is a fact about
     * the past rather than a claim about the present.
     */
    async lastTransaction(agentId, userId) {
      const [row] = await db
        .select({
          hash: transactions.hash,
          reachedLedger: transactions.reachedLedger,
          ledger: transactions.ledger,
          amount: transactions.amount,
          asset: transactions.asset,
          destination: transactions.destination,
          isBoundaryRefusal: transactions.isBoundaryRefusal,
          createdAt: transactions.createdAt,
        })
        .from(transactions)
        .innerJoin(agents, eq(transactions.agentId, agents.id))
        .where(and(eq(transactions.agentId, agentId), eq(agents.userId, userId)))
        .orderBy(desc(transactions.createdAt))
        .limit(1);
      if (row === undefined) return undefined;
      return {
        hash: row.hash,
        reachedLedger: row.reachedLedger,
        ledger: row.ledger,
        amount: row.amount === null ? null : String(row.amount),
        asset: row.asset,
        destination: row.destination,
        isBoundaryRefusal: row.isBoundaryRefusal,
        at: row.createdAt.toISOString(),
      };
    },

    /**
     * The transition names both ends, so it cannot invent a third.
     *
     * `eq(agents.status, ...)` in the WHERE is what makes this a pause rather
     * than a status setter with a nicer name: an agent mid-deploy or in ERROR
     * matches nothing and comes back undefined, and the route reports that
     * instead of moving a lifecycle nothing else in the system knows about.
     */
    async setPaused({ agentId, userId, paused }) {
      const [row] = await db
        .update(agents)
        .set({ status: paused ? 'PAUSED' : 'ACTIVE' })
        .where(
          and(
            eq(agents.id, agentId),
            eq(agents.userId, userId),
            eq(agents.status, paused ? 'ACTIVE' : 'PAUSED'),
          ),
        )
        .returning();
      return row === undefined ? undefined : toAgent(row);
    },

    async schedule(agentId, userId) {
      const [row] = await db
        .select({
          taskId: scheduledTasks.id,
          intervalSeconds: scheduledTasks.intervalSeconds,
          nextRunAt: scheduledTasks.nextRunAt,
          lastRunAt: scheduledTasks.lastRunAt,
          enabled: scheduledTasks.enabled,
          consecutiveFailures: scheduledTasks.consecutiveFailures,
          disabledAt: scheduledTasks.disabledAt,
          disabledReason: scheduledTasks.disabledReason,
        })
        .from(scheduledTasks)
        // Joined to `agents` rather than trusted from the caller, for this
        // file's rule about there being no unscoped lookup: a schedule read by
        // id alone is somebody else's schedule one bug away.
        .innerJoin(agents, eq(agents.id, scheduledTasks.agentId))
        .where(and(eq(scheduledTasks.agentId, agentId), eq(agents.userId, userId)))
        .limit(1);

      if (row === undefined) return undefined;
      return {
        taskId: row.taskId,
        intervalSeconds: row.intervalSeconds,
        nextRunAt: row.nextRunAt?.toISOString() ?? null,
        lastRunAt: row.lastRunAt?.toISOString() ?? null,
        enabled: row.enabled,
        consecutiveFailures: row.consecutiveFailures,
        disabledAt: row.disabledAt?.toISOString() ?? null,
        disabledReason: row.disabledReason,
      };
    },

    async agentKeyPublic(agentId, userId) {
      const [row] = await db
        .select({ agentPublicKey: agentKeys.agentPublicKey })
        .from(agentKeys)
        .innerJoin(agents, eq(agentKeys.agentId, agents.id))
        .where(and(eq(agentKeys.agentId, agentId), eq(agents.userId, userId)))
        .limit(1);
      return row?.agentPublicKey;
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
