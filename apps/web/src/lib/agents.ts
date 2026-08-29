/**
 * An agent, as this application's server half sees one.
 *
 * The interface here and the Drizzle implementation in `stores.ts`, for the
 * reason `session.ts` gives about its own pair: `apps/web` reaches Postgres
 * over `neon-http`, which speaks Neon's HTTP protocol, so no local Postgres can
 * exercise that path. Everything above this interface is provable against a
 * fake; the part below it is written to be boring.
 *
 * ## Every lookup is scoped by owner, and there is no unscoped one
 *
 * {@link AgentStore} has no `findById(id)`. It has `findForUser(id, userId)`,
 * and that is not a convenience — an agent id is a UUID in a URL, and a lookup
 * that took the id alone would let any signed-in user read, configure and
 * deploy any other user's agent by pasting one. The scoping belongs in the
 * query rather than in a check the caller performs afterwards, for the same
 * reason `session.ts` puts expiry in the `where` clause: *"a row that has
 * expired must not be returned and then discarded by the caller, because that
 * is one `if` away from"* the bug.
 *
 * ## What is deliberately not in this module
 *
 * **Anything about the chain.** No cap, no remaining spend, no whether a rule
 * is live. `schema.ts` forbids caching those and gives the reason —
 * *"every boundary looks perfectly obeyed if you are reading yesterday's copy
 * of it"* — and the rule applies with more force here than in the browser,
 * because a server-side copy looks authoritative.
 *
 * The agent's **status** is not an exception to that and is worth saying so.
 * `ACTIVE` means Limen deployed this agent and believes nothing has revoked it;
 * it does not mean the context rule is live on the ledger this second. Anything
 * rendering a status beside a claim about permission has to read the rule.
 */

import 'server-only';
import type { PolicyProposal } from '@limen/core';
import type { InstallPlan } from '@limen/chain/plan';
import type { AgentConfig } from './agent-config';

/** The lifecycle, as `agent_status` names it. A subset — this flow uses five. */
export type AgentStatus = 'DRAFT' | 'CONFIGURED' | 'DEPLOYING' | 'ACTIVE' | 'ERROR';

/**
 * The largest stored proposal, in characters of JSON.
 *
 * A draft is ten short string fields and a small array of addresses; four
 * kilobytes is an order of magnitude of headroom over any honest one. The cap
 * exists because this value goes into a `jsonb` column having come from a
 * request body, and the size of a thing written to a database should be bounded
 * where it enters rather than trusted to be reasonable — the same rule
 * `auth-route.ts` states for `MAX_BODY`.
 */
export const MAX_DRAFT_JSON = 4_096;

/**
 * An untrusted proposal, bounded — or nothing at all.
 *
 * Deliberately *not* a validator. The column holds what a model suggested, and
 * checking its fields here would imply the stored value had been vetted, which
 * would then be one refactor away from something trusting it. `reviveDraft`
 * narrows it at the point of use and `validate` refuses it at the point it
 * could matter; this only stops the database being used as storage for
 * something that is not a draft at all.
 *
 * Three things are refused: a non-object, an array, and anything that does not
 * serialise or serialises too large. Everything else is stored verbatim.
 */
export function boundedDraft(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  let serialised: string;
  try {
    serialised = JSON.stringify(value);
  } catch {
    // Circular, or a BigInt. Neither is a draft.
    return null;
  }
  return serialised.length > MAX_DRAFT_JSON ? null : value;
}

export interface AgentRecord {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  status: AgentStatus;
  /**
   * The limits a model proposed for this agent, if one has been asked yet.
   *
   * `unknown` on purpose. It is whatever came back from a model and was stored
   * without being trusted, so the type says exactly that and every reader has
   * to narrow it before use — `agent-config.ts`'s `reviveDraft` is the one
   * place that does. Typing it as `AgentConfigDraft` would claim the database
   * holds a valid draft, which nothing has checked at the point it is read.
   *
   * Null means no proposal was kept: an agent described before this column
   * existed, or one whose description has not been read yet. The review screen
   * treats that as "ask again", never as "there are no limits".
   */
  draft: unknown;
  /**
   * The stored trigger: what makes this agent act, or null for one that does
   * not act on a rule.
   *
   * `unknown` for `draft`'s reason and one more of its own. This column is
   * evaluated by the runtime rather than displayed by it, and the runtime
   * re-validates it on every cycle; a type here would let a screen render a
   * rule as though it were known-good when the thing that actually reads it has
   * its own opinion. The detail screen narrows it for display and says
   * "unreadable" rather than guessing when it cannot.
   */
  trigger: unknown;
}

/**
 * One row of the list at `/app/agents`, and every field is a database fact.
 *
 * The two chain-shaped values here are **pointers, not claims**. A smart
 * account address and a context rule id say *where to look*; they do not say
 * what the rule currently permits, whether it is live, or how much of the cap
 * is left. This module's header forbids the second kind and gives the reason,
 * and a list view is exactly where the temptation is strongest — N ledger reads
 * for N rows is the cost that makes a `current_cap` column look reasonable.
 *
 * It is not reasonable, and `schema.ts` rule 2 says why in the sentence this
 * screen is most at risk of disproving: *every boundary looks perfectly obeyed
 * if you are reading yesterday's copy of it*. A list of agents whose caps came
 * from a table would render a revoked agent as bounded, which is the worst
 * available failure for a permissions tool. So the cap is read from the chain
 * by whoever renders it, at a ledger it has to state — see `/api/agents`.
 */
export interface AgentSummary {
  id: string;
  name: string;
  description: string | null;
  status: AgentStatus;
  /** `C…`, once the account exists. Null for a draft, which has no account. */
  smartAccount: string | null;
  /** The rule to read the cap from. Null until a boundary was installed. */
  contextRuleId: number | null;
  createdAt: string;
}

/**
 * What a described agent needs, and nothing else.
 *
 * `createDraft` is deliberately not `create(everything)`. At the moment an
 * agent is first written there is no configuration to write with it: the model
 * proposes a name, a cap and a window, but it cannot propose the token contract
 * — a person has to paste that — so nothing yet compiles to a policy. A row
 * carrying half a policy would be a row whose `proposal_json` meant "we had not
 * finished asking", which is exactly what `DRAFT` already means.
 *
 * So the policy row lands at `CONFIGURED`, when there is one, and this
 * interface stops here until then.
 */
export interface AgentStore {
  createDraft(input: {
    userId: string;
    name: string;
    description: string;
    /** The proposal, stored so it survives the navigation to the review screen. */
    draft?: unknown;
  }): Promise<AgentRecord>;
  updateDraft(input: {
    id: string;
    userId: string;
    name: string;
    description: string;
    draft?: unknown;
  }): Promise<AgentRecord | undefined>;
  findForUser(id: string, userId: string): Promise<AgentRecord | undefined>;
  /**
   * This user's agents, newest first. Scoped by `user_id` in the query, for the
   * reason this module's header gives about there being no unscoped lookup: a
   * list is the one place where forgetting the scope returns *everyone's* rows
   * rather than one stranger's, and it would look like a working screen.
   */
  listForUser(userId: string): Promise<AgentSummary[]>;
  /**
   * The reviewed configuration becomes a `policies` row and the agent becomes
   * `CONFIGURED`. Atomic, and see {@link ConfigureInput} for why that matters.
   */
  configure(input: ConfigureInput): Promise<AgentRecord>;
  /**
   * The last transaction this agent produced, refused or not.
   *
   * A fact about the past — what was recorded when an attempt reached a ledger
   * — and never a claim about what the rule permits now. See `stores.ts`.
   */
  lastTransaction(agentId: string, userId: string): Promise<LastTransaction | undefined>;
  /** The boundary this agent was configured with, for the deploy step to install. */
  proposedPolicy(agentId: string, userId: string): Promise<ProposedPolicy | undefined>;
  /** `CONFIGURED` -> `DEPLOYING`, or `DEPLOYING` -> `ERROR`. */
  markStatus(input: { agentId: string; userId: string; status: AgentStatus }): Promise<AgentRecord>;
  /** The deployment happened and was verified against the ledger. */
  recordDeployment(input: RecordDeploymentInput): Promise<AgentRecord>;
  /**
   * The agent's server-held signing key, generated once and never regenerated.
   *
   * Returns the `G…` address only. The private half goes into `agent_keys`
   * sealed and does not come back out here — the runtime opens it, and this
   * application never needs it.
   *
   * **Idempotent by contract, not by luck.** A deploy that fails after the key
   * is written comes back through the same route, and generating a second key
   * would be the worst kind of quiet failure: the boundary already installed
   * names the *first* key, so an agent signing with the second would be refused
   * by its own account for reasons nothing on screen could explain. The unique
   * index on `agent_keys.agent_id` backs the contract, and the implementation
   * checks before writing rather than relying on catching a constraint error.
   */
  provisionAgentKey(input: { agentId: string; userId: string }): Promise<{
    agentPublicKey: string;
    /** False when a key was already there, which a retried deploy is. */
    generated: boolean;
  }>;
  /**
   * The `G…` this agent's key was generated as, or nothing.
   *
   * Read back at verification time so `/deployed` can check that the boundary
   * a browser installed names the key Limen actually holds. Without it the
   * agent address in that report is a claim the client makes about itself, and
   * a client naming a key it holds the secret for would install a boundary
   * around a key Limen cannot sign with — an agent that is bounded, recorded,
   * and permanently unable to act.
   */
  agentKeyPublic(agentId: string, userId: string): Promise<string | undefined>;
}

/** What was stored at `CONFIGURED`, read back so deploy installs exactly it. */
export interface LastTransaction {
  hash: string | null;
  reachedLedger: boolean | null;
  ledger: number | null;
  amount: string | null;
  asset: string | null;
  destination: string | null;
  /** True when the boundary itself refused it, rather than the token. */
  isBoundaryRefusal: boolean | null;
  at: string;
}

export interface ProposedPolicy {
  id: string;
  proposal: PolicyProposal;
  installPlan: InstallPlan;
  validUntilLedger: number | null;
  /**
   * The limits Limen enforces, read back so the deploy screen can render them.
   *
   * Read from the stored row rather than recomputed from the draft: what a
   * person is shown before deploying has to be what was written down, not what
   * a second derivation happens to produce.
   */
  enforcedOffChain: AgentConfig['enforcedOffChain'] | null;
}

/**
 * The facts of a deployment, after they have been checked against the ledger.
 *
 * Every field here is a claim a browser made, and the route that calls this has
 * already re-read the account's context rules over RPC and confirmed the rule
 * id, its contract and its cap against the stored plan. That ordering is the
 * point: `agent_accounts` is the one table in this flow that records facts
 * about the chain, and a row written from an unverified report would be a claim
 * about a ledger nobody looked at.
 *
 * It is still not a cache of chain state — `schema.ts` forbids that, and there
 * is no cap or liveness here. It records *what was deployed*, which the ledger
 * cannot answer later once a rule is revoked and gone.
 */
export interface RecordDeploymentInput {
  agentId: string;
  userId: string;
  policyId: string;
  smartAccountContractId: string;
  deployTxHash: string;
  installTxHash: string;
  contextRuleId: number;
  /**
   * The venue rule, for a trading agent. Null for one that only pays.
   *
   * Recorded beside the boundary rather than inferred later: a swap needs both
   * ids, and `gate.ts` looks a rule up by its saved id rather than scanning.
   */
  venueContextRuleId: number | null;
  ownerPublicKey: string;
  agentPublicKey: string;
}

/**
 * What `CONFIGURED` writes, and why it is one call rather than three.
 *
 * Three statements: drop any policy this agent had proposed before, insert the
 * one just reviewed, move the agent's status. They go through `db.batch`,
 * which the `neon-http` measurement in PLAN-V8 §7.5.2 established is atomic — a
 * deliberate constraint violation in the second statement rolled the whole
 * batch back with zero rows surviving.
 *
 * They have to be atomic because each of the interleavings is a bad state
 * somebody would then have to reason about: an agent marked `CONFIGURED` with
 * no policy row, or two proposed policies where the screen expects one, or a
 * new policy attached to an agent still marked `DRAFT`. None of those is
 * catastrophic — nothing has reached a chain at this point — but all three are
 * states that exist only because a write was interrupted, and the cheapest time
 * to not have them is now.
 *
 * This is **not** an interactive transaction and does not fall under
 * `web.ts`'s rule that a route needing one moves to `apps/runtime`. There is no
 * conditional logic between the statements; it is three writes sent together.
 *
 * ## Ownership is checked before the batch, not inside it
 *
 * The `agents` update carries `user_id` in its `where`, but the `policies`
 * insert structurally cannot — that table has no owner column, only
 * `agent_id`. So a batch alone would let a caller attach a policy to an agent
 * that is not theirs even though the status update did nothing. The store
 * reads the agent through `findForUser` first and refuses before writing
 * anything.
 *
 * A read-before-write is a race in general and is not one here: an agent's
 * owner is set at insert and there is no code path anywhere that changes it.
 * If agent transfer is ever added, this becomes wrong and the comment is where
 * to find that out.
 */
export interface ConfigureInput {
  agentId: string;
  userId: string;
  /** The reviewed name. `CONFIGURED` is where a real one becomes required. */
  name: string;
  /**
   * The derived boundary, stored whole so that what was reviewed is
   * recoverable — and so the deploy step installs *this* rather than deriving
   * a second one and hoping the two agree.
   */
  proposal: PolicyProposal;
  /**
   * What that proposal lowers to, stored beside it for the reason the schema
   * gives: the review step renders the plan, so the plan is part of what was
   * reviewed. It is derivable from the proposal — `lower` is pure — and stored
   * anyway, because a column that says what was on screen is worth more after
   * the fact than one that says what could be recomputed.
   */
  installPlan: InstallPlan;
  /** Recipients and the per-payment ceiling. Enforced by nothing today. */
  enforcedOffChain: AgentConfig['enforcedOffChain'];
  /**
   * The stored trigger, complete with the reference price the route read.
   *
   * Written to `agents.trigger_json`, not to the policy row, and the separation
   * is the point: everything in `enforcedOffChain` refuses something and this
   * starts something. `null` for an agent with no trigger, which is every
   * payment agent and any trading agent whose owner has not set a rule yet.
   *
   * `unknown` rather than a type, because this is the shape the column holds
   * and the runtime re-validates it on every cycle. A type here would suggest
   * the value had been checked at the point it was stored, and the argument
   * against that is written out on the column itself.
   */
  trigger: unknown;
  headroomBps: number;
  windowLedgers: number;
  validUntilLedger: number;
  /** `validFromLedger`. Local provenance — it has no on-chain counterpart. */
  observedLedger: number;
}

/**
 * A name for an agent whose draft has not got one yet.
 *
 * `agents.name` is `NOT NULL`, and the model is allowed to return an empty
 * name — it is told to leave things empty rather than guess. Naming the row
 * after what it is, rather than refusing to write it, keeps the DRAFT row and
 * the description it carries; the review step then makes a real name required
 * before anything is deployed.
 */
export const UNNAMED_AGENT = 'Untitled agent';

/** Trimmed, bounded, and never empty, because the column is `NOT NULL`. */
export function cleanAgentName(value: unknown, max: number): string {
  if (typeof value !== 'string') return UNNAMED_AGENT;
  const trimmed = value.trim().slice(0, max);
  return trimmed.length === 0 ? UNNAMED_AGENT : trimmed;
}
