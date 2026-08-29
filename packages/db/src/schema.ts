/**
 * The schema, and the four things it deliberately cannot hold.
 *
 * PLAN-V8 Part V, written out as Drizzle tables. Every table here is either
 * something the ledger cannot answer (a conversation, an audit trail, a
 * schedule) or a pointer to something it can. The distinction is the whole
 * design and it is enforced below rather than described.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHAT THIS SCHEMA MUST NEVER HOLD                                         │
 * │                                                                          │
 * │ 1. A plaintext secret, under any name. `AgentKey` holds ciphertext and   │
 * │    a wrapped data key and nothing else. A schema test asserts no column  │
 * │    in any table is named for a secret in a form that could be one.       │
 * │ 2. A cached claim about chain state — an installed cap, a remaining      │
 * │    spend, whether a rule is live. Those are read from the ledger on      │
 * │    every render. This is `lib/store.ts`'s rule, inherited by the server  │
 * │    for exactly the same reason it exists in the browser.                 │
 * │ 3. A Telegram username. It is not identity (brief §20), and storing it   │
 * │    invites it being treated as one.                                      │
 * │ 4. A raw IP address. `Session` carries a hash, for the same reason       │
 * │    `api/report/route.ts` reads an IP for a rate limit and never reports  │
 * │    it.                                                                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ## Rule 2 is the one that will be argued with, so it is stated precisely
 *
 * The temptation is a `current_cap` column so a list view does not need N
 * ledger reads. `apps/web/src/lib/store.ts` already refuses this in the browser
 * and gives the reason: *a cached copy would be a claim about the past rendered
 * as the present*. A policy revoked on another device, or expired while the
 * process was asleep, would still list as live. For a permissions tool that is
 * the worst available failure — every boundary looks perfectly obeyed if you
 * are reading yesterday's copy of it.
 *
 * Where a denormalised copy is genuinely unavoidable for a list view, the
 * column is named `*_last_seen` and the ledger it was read at is stored beside
 * it and rendered with it. There is exactly one such pair in this schema
 * (`fee_balance_last_seen` / `fee_balance_ledger`), and the naming is what makes
 * a reviewer able to find every one of them with a grep.
 *
 * ## Amounts
 *
 * Every one is `amount()` — `numeric(39, 0)` surfaced as `bigint`. See
 * `amount.ts`; there is no `float8` anywhere near a value that bounds what an
 * agent may spend, and a schema test proves it rather than trusting this
 * paragraph.
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  customType,
} from 'drizzle-orm/pg-core';
import { amount } from './amount.js';

/**
 * Raw bytes, as `bytea`.
 *
 * Drizzle has no first-class `bytea`, and the alternative — base64 in a `text`
 * column — was rejected for a reason specific to this schema: the values stored
 * this way are a passkey public key, a ciphertext and a wrapped data key, and
 * text columns holding key-shaped material are exactly what the "no plaintext
 * secret" schema test has to reason about. Keeping them typed as bytes means
 * the test can distinguish "bytes that are ciphertext" from "text that might be
 * anything" structurally.
 */
const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
  fromDriver(value: Buffer): Uint8Array {
    return new Uint8Array(value);
  },
  toDriver(value: Uint8Array): Buffer {
    return Buffer.from(value);
  },
});

/**
 * A timestamp that is always UTC and always has a zone.
 *
 * `timestamp without time zone` is the default in Postgres and is a trap: two
 * processes in different zones write the same instant as different values. The
 * agent runtime is one long-lived container and the web app is many short-lived
 * functions; they must not be able to disagree about when a session expires.
 */
const instant = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

// ──────────────────────────────────────────────────────────────── enumerations

/**
 * `network` is a one-member union, and that is the level-1 mainnet gate.
 *
 * The same shape `@limen/core`'s `types.ts` uses and for the same reason: the
 * column exists so the schema does not have to change when mainnet arrives, and
 * has exactly one legal value so that it cannot arrive by accident. Adding
 * `'mainnet'` here is a deliberate, greppable, one-line act.
 */
export const network = pgEnum('network', ['testnet']);

/**
 * How a user proves who they are — which is not how their account is owned.
 *
 * `'wallet'` joined this enum when Freighter sign-in landed, and the distinction
 * it introduces is the one thing about it worth stating in the schema: a
 * `'wallet'` user authenticates with a Stellar keypair held in a browser
 * extension, and their smart account is still owned by the browser's disposable
 * key. Nothing in this table describes on-chain ownership; `agent_accounts`
 * does, through `owner_signer_kind`, and that column is untouched by wallet
 * sign-in. See the README's "The wallet button, and what it does not do".
 */
export const authMethod = pgEnum('auth_method', ['passkey', 'browser_key', 'wallet']);

export const agentStatus = pgEnum('agent_status', [
  'DRAFT',
  'CONFIGURED',
  'DEPLOYING',
  'ACTIVE',
  'PAUSED',
  'REVOKED',
  'EXPIRED',
  'ERROR',
]);

/** Brief §17's two modes. Not decoration: each compiles to a different policy. */
export const policySource = pgEnum('policy_source', ['demonstrated', 'described']);

export const riskLevel = pgEnum('risk_level', ['conservative', 'balanced', 'autonomous']);

export const ownerSignerKind = pgEnum('owner_signer_kind', ['passkey', 'ed25519']);

export const channel = pgEnum('channel', ['telegram', 'web', 'api']);

export const messageRole = pgEnum('message_role', ['user', 'assistant', 'tool', 'system']);

export const policyDecision = pgEnum('policy_decision', ['permit', 'refuse', 'confirm_required']);

/**
 * §4.4's four outcomes, plus success, never collapsed.
 *
 * This is the same vocabulary `lib/verdict.ts` pins at exactly four states on
 * the client, carried into the database so a stored row cannot say something
 * the interface has no way to render. The two that must never merge are
 * `refused_by_limen` and `refused_by_network`: the first never reached a ledger
 * and is evidence of nothing, the second has a hash. A single `refused` value
 * would make that distinction unrecoverable after the fact, which is precisely
 * when it matters.
 */
export const toolOutcome = pgEnum('tool_outcome', [
  'agent_error',
  'refused_by_limen',
  'refused_by_network',
  'infra_error',
  'succeeded',
]);

export const auditActor = pgEnum('audit_actor', ['user', 'agent', 'system', 'operator']);

export const policyStatus = pgEnum('policy_status', ['proposed', 'installed', 'revoked', 'expired']);

// ─────────────────────────────────────────────────────────────────────── tables

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: instant('created_at').notNull().defaultNow(),
    authMethod: authMethod('auth_method').notNull(),
    /** The credential id, as the authenticator returned it. */
    passkeyCredentialId: bytea('passkey_credential_id'),
    /**
     * 65-byte uncompressed SEC1, which is the form the on-chain verifier takes.
     * Stored in the contract's shape rather than in a JWK or a COSE map so that
     * what is registered and what is installed as an `External` signer are the
     * same bytes, not two encodings of the same point.
     */
    passkeyPublicKey: bytea('passkey_public_key'),
    /**
     * The `G…` address of a wallet user, as the strkey it is displayed as.
     *
     * Text and not `bytea`, which is the opposite of the choice made two columns
     * up, and the reason is that these two values are used for opposite things.
     * `passkey_public_key` is *installed on chain* as `Signer::External`, so it
     * is stored in the contract's shape to keep what is registered and what is
     * installed the same bytes. An address here is never installed anywhere: it
     * is an identity to look a user up by and a string to render. Strkey is the
     * canonical, checksummed, single spelling of that identity — an ed25519
     * public key has two base32 spellings only if somebody writes the encoder
     * twice — so storing the decoded bytes would mean re-encoding on every read
     * for display and gaining nothing.
     *
     * Null for every passkey user, and unique so one address is one account.
     */
    stellarAddress: text('stellar_address'),
    displayName: text('display_name'),
  },
  (table) => [
    uniqueIndex('users_passkey_credential_id_key').on(table.passkeyCredentialId),
    uniqueIndex('users_stellar_address_key').on(table.stellarAddress),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: instant('created_at').notNull().defaultNow(),
    expiresAt: instant('expires_at').notNull(),
    /**
     * SHA-256 of the cookie's token. **Never the token itself.**
     *
     * Added when sessions were actually implemented, because the shape this
     * table had without it forced the wrong design: with no token column the
     * cookie has to carry `id`, and then every live session token in the system
     * is sitting in a column in plaintext. A read-only database compromise
     * would hand over the ability to act as any logged-in user.
     *
     * That matters here more than it does in most applications because N10 —
     * the row this project's threat table calls *"the whole argument"* — is
     * built on a database compromise being survivable. The claim is that
     * an attacker with the database can forge Limen's own opinion but cannot
     * widen an agent's authority, since the chain is what enforces. Handing
     * that same attacker every user's session would not break the on-chain
     * guarantee, but it would let them act as the user everywhere the chain is
     * not the boundary, and it would make N10 a narrower claim than it reads
     * as.
     *
     * A hash is a one-way function of a value the server never needs to
     * reproduce — it only needs to recognise one — so there is no cost to
     * storing it this way and no reason not to. Unique, because two sessions
     * hashing the same is a token collision and should be a constraint
     * violation rather than an ambiguous lookup.
     */
    tokenHash: text('token_hash').notNull(),
    /**
     * Hashed, and the IP itself is never stored.
     *
     * It is here to make "this session moved continent mid-life" answerable
     * without making "where was this person" answerable. A hash supports the
     * first question and not the second, which is the whole of what a session
     * needs.
     */
    createdIpHash: text('created_ip_hash'),
  },
  (table) => [
    index('sessions_user_id_idx').on(table.userId),
    index('sessions_expires_at_idx').on(table.expiresAt),
    uniqueIndex('sessions_token_hash_key').on(table.tokenHash),
  ],
);

export const telegramLinks = pgTable(
  'telegram_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    telegramUserId: text('telegram_user_id').notNull(),
    linkedAt: instant('linked_at').notNull().defaultNow(),
    pairedViaTokenId: uuid('paired_via_token_id'),
    // Username deliberately absent. Brief §20: it is not identity, it is
    // user-changeable, and a column for it is an invitation to resolve an
    // account by one.
  },
  (table) => [uniqueIndex('telegram_links_telegram_user_id_key').on(table.telegramUserId)],
);

export const agents = pgTable(
  'agents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    /**
     * The limits a model *proposed*, before anybody corrected them.
     *
     * Written when the description is read and replaced whenever it is read
     * again. It exists because the builder is one step per screen: the
     * proposal has to survive the navigation from the description to the
     * review, and a back-navigation to the description and forward again.
     * While the builder was a single screen this lived in React state, which
     * is exactly as long as that arrangement lasted.
     *
     * **This is not `policies.proposal_json` and must not be confused with
     * it.** That row is written by `configure`, after a person has read these
     * numbers and corrected them, and it records what was *accepted* — it is
     * the thing the install plan is derived from and the thing the chain ends
     * up enforcing. This column records what was *suggested*, is never read by
     * anything that builds a transaction, and carries no authority at all.
     *
     * Untyped `jsonb` for the same reason the column is untrusted: it holds
     * whatever a model returned, and the server re-validates every field
     * through `validate` before any of it reaches a policy. A schema here
     * would suggest the contents had been checked at the point they were
     * stored, which they have not.
     */
    draftJson: jsonb('draft_json'),
    /**
     * What makes this agent act, in numbers. Null for an agent that does not
     * trade, and null is never "not yet filled in".
     *
     * `executeTradingDecision` evaluates this rather than the sentence in
     * `description`. That split is the honest version of "evaluate the
     * strategy": parsing prose at cycle time would mean a trade whose reason
     * cannot be reproduced, and a structured trigger read by a pure function
     * gives a decision anybody can recompute from the audit row.
     *
     * **This is not a limit and must never be rendered as one.** Everything in
     * `policies.enforced_offchain_json` refuses something; this starts
     * something. Filed in that column it would render under "Enforced by
     * Limen", where a rule that begins a trade reads as a rule that stops one —
     * which is the misrepresentation that column's name exists to prevent, in
     * the other direction. Hence a column here, beside `description` and
     * `risk_level`: what this agent *is*, not what bounds it.
     *
     * Untyped `jsonb` for `draft_json`'s reason. The runtime re-validates it on
     * every cycle and reports a trigger it cannot parse as `trigger_unreadable`
     * — a distinct fact from "no trigger configured", because telling somebody
     * their agent has no rule when it has one Limen broke is a lie about which
     * of them is wrong.
     *
     *
     * ## The reference moves down and never up, and that is not a missing case
     *
     * A cycle that trades re-stamps `referencePrice` to the price it traded
     * at, so a `price_drop` agent buys each further fall instead of firing
     * once and then either never again or on every cycle forever. The
     * re-stamp is a ratchet: it only ever lowers the reference, which only
     * ever makes the trigger *harder* to fire.
     *
     * Upward movement is **take profit** — a different strategy, with its own
     * trigger kind, its own field and its own test. It is not this one's
     * unwritten half, and reading a downward-only ratchet as an oversight gets
     * the design backwards. A ratchet that could also widen would be an agent
     * loosening its own rule with no person present, which is the one
     * direction of self-mutation this project will not ship. It is refused
     * twice: by `restampReference`, and again by the `WHERE` clause of the
     * UPDATE that writes it.
     *
     * `{ kind: 'price_drop', referencePrice, referenceLedger, dropBps, amount }`
     * today. `referenceLedger` is carried because a price is a read, and every
     * read value in this schema states the ledger it was read at.
     */
    triggerJson: jsonb('trigger_json'),
    status: agentStatus('status').notNull().default('DRAFT'),
    network: network('network').notNull().default('testnet'),
    modelProvider: text('model_provider'),
    modelId: text('model_id'),
    systemInstructions: text('system_instructions'),
    /** Compiles to a policy, not to a badge. */
    riskLevel: riskLevel('risk_level').notNull().default('conservative'),
    createdAt: instant('created_at').notNull().defaultNow(),
    deployedAt: instant('deployed_at'),
    pausedAt: instant('paused_at'),
    revokedAt: instant('revoked_at'),
  },
  (table) => [index('agents_user_id_idx').on(table.userId)],
);

export const agentAccounts = pgTable(
  'agent_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    smartAccountContractId: text('smart_account_contract_id').notNull(),
    deployTxHash: text('deploy_tx_hash'),
    ownerSignerKind: ownerSignerKind('owner_signer_kind').notNull(),
    ownerPublicKey: text('owner_public_key').notNull(),
    /** `G…`. The PUBLIC half only — the private half is in `agentKeys`, encrypted. */
    agentPublicKey: text('agent_public_key').notNull(),
    /** The classic account that pays fees. A real, separate, smaller exposure — §3.2. */
    agentFeeAccount: text('agent_fee_account'),
    contextRuleId: integer('context_rule_id'),
    installTxHash: text('install_tx_hash'),
    /**
     * The venue rule's id, for a trading agent. Null for a payment agent.
     *
     * A trading agent's authority is two context rules, not one: the token rule
     * above carries the spending limit, and this one authorizes calls to the
     * swap venue. Both ids go into a swap's `AuthPayload` — one per auth
     * context — so both have to be recorded.
     *
     * Recorded rather than discovered. `gate.ts` looks a rule up **by the id
     * saved at deployment**, never by scanning for one that looks right, so
     * that a revoked rule reads as absent instead of being silently replaced by
     * a different rule that happens to match. A venue rule found by scanning
     * would break exactly that property.
     *
     * Null is meaningful and is not "not yet filled in": an agent with no venue
     * rule cannot swap, and `swap_tokens` refuses on that basis rather than
     * guessing an id.
     */
    venueContextRuleId: integer('venue_context_rule_id'),
    venueInstallTxHash: text('venue_install_tx_hash'),
    /**
     * The one denormalised chain value in this schema, and it is named so it
     * can be found.
     *
     * The fee balance is not a boundary — it bounds how much XLM a key holder
     * could burn on fees, which §3.2 records as a distinct exposure from the
     * spending cap and requires the dashboard to render as a distinct,
     * differently-labelled number. It is cached because a fee balance being
     * seconds stale misleads nobody, and it carries the ledger it was read at
     * because every render of it has to state that ledger.
     *
     * Nothing about the *boundary* is cached. There is no `current_cap`, no
     * `remaining_spend`, and no `is_live`.
     */
    feeBalanceLastSeen: amount('fee_balance_last_seen'),
    feeBalanceLedger: integer('fee_balance_ledger'),
  },
  (table) => [uniqueIndex('agent_accounts_agent_id_key').on(table.agentId)],
);

/**
 * The §3 answer, in one table.
 *
 * Envelope encryption: a per-agent data key encrypts the seed, and a master key
 * held by a `KeyProvider` wraps the data key. Two columns, both ciphertext,
 * and **no plaintext column exists at any point under any name** — asserted by
 * a schema test rather than by review, because "nobody would add that" is the
 * kind of guarantee that holds until somebody does.
 *
 * `kmsKeyId` is here from the **first** migration, before there is a second
 * provider to distinguish. §7.5.3 requires it: the env-var master key ships at
 * M2 and a real KMS is a mainnet precondition, and rows written before the swap
 * have to stay attributable to the provider that wrapped them afterwards. A
 * column added later cannot say anything about the rows that already exist,
 * which is the one thing it would be needed for.
 */
export const agentKeys = pgTable(
  'agent_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    /**
     * `G…`, the public half. Not a secret, and here for a specific reason.
     *
     * `agent_accounts.agent_public_key` holds the same value, and that row does
     * not exist until a deployment has been verified against the ledger. The
     * key is generated *before* the deploy — the boundary being installed names
     * it — so between those two moments this is the only place the address is
     * recorded.
     *
     * The alternative was deriving it by opening the sealed seed, which would
     * mean decrypting key material to answer a question about a public value.
     * That is the wrong trade in both directions: it widens how often the seed
     * is in memory, and it makes a cheap read expensive.
     *
     * It is the one column here that is not ciphertext, which is why the closed
     * set in `schema.test.ts` had to be changed by hand to admit it. A public
     * key is not plaintext key material; the rule that set enforces is that no
     * column can hold the *private* half, and that is unchanged.
     */
    agentPublicKey: text('agent_public_key').notNull(),
    /** The seed, encrypted under the data key. Never anything else. */
    ciphertext: bytea('ciphertext').notNull(),
    /** The data key, encrypted under the master key. */
    wrappedDataKey: bytea('wrapped_data_key').notNull(),
    /** Which `KeyProvider` wrapped it. Recorded on every row from migration 0000. */
    kmsKeyId: text('kms_key_id').notNull(),
    algorithm: text('algorithm').notNull(),
    createdAt: instant('created_at').notNull().defaultNow(),
    rotatedAt: instant('rotated_at'),
  },
  (table) => [uniqueIndex('agent_keys_agent_id_key').on(table.agentId)],
);

export const policies = pgTable(
  'policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    source: policySource('source').notNull(),
    /**
     * Provenance, and local-only by construction.
     *
     * `observedLedger` is `validFromLedger` — it has no counterpart on an
     * OpenZeppelin context rule, which is why `PolicyDetail.tsx` renders it
     * outside the on-chain block. The same rule applies here: these two columns
     * are this application's history, not the network's, and nothing that
     * renders them may present them as chain state.
     */
    observedTxHash: text('observed_tx_hash'),
    observedLedger: integer('observed_ledger'),
    headroomBps: integer('headroom_bps'),
    windowLedgers: integer('window_ledgers'),
    validUntilLedger: integer('valid_until_ledger'),
    /** The `PolicyProposal`, verbatim. Stored whole so what was reviewed is recoverable. */
    proposalJson: jsonb('proposal_json'),
    /** The `InstallPlan`, verbatim, for the same reason. */
    installPlanJson: jsonb('install_plan_json'),
    /**
     * The B8 column, and the name is doing the work.
     *
     * Recipient allowlists and daily limits cannot be enforced on chain by any
     * audited primitive, so they are enforced by Limen — and every render of
     * anything in here must say so. `enforced_offchain` rather than `limits` or
     * `extra_policy`: a column called `limits` would let a screen list these
     * beside the installed cap as though the network refused both, which is the
     * one misrepresentation this project cannot make.
     */
    enforcedOffchainJson: jsonb('enforced_offchain_json'),
    installTxHash: text('install_tx_hash'),
    contextRuleId: integer('context_rule_id'),
    status: policyStatus('status').notNull().default('proposed'),
    createdAt: instant('created_at').notNull().defaultNow(),
  },
  (table) => [index('policies_agent_id_idx').on(table.agentId)],
);

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    channel: channel('channel').notNull(),
    /** The channel's own id for this thread — a Telegram chat, a web session. */
    externalId: text('external_id'),
    createdAt: instant('created_at').notNull().defaultNow(),
  },
  (table) => [index('conversations_agent_id_idx').on(table.agentId)],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: messageRole('role').notNull(),
    content: text('content'),
    toolCallsJson: jsonb('tool_calls_json'),
    createdAt: instant('created_at').notNull().defaultNow(),
  },
  (table) => [index('messages_conversation_id_idx').on(table.conversationId, table.createdAt)],
);

export const toolExecutions = pgTable(
  'tool_executions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
    toolName: text('tool_name').notNull(),
    argumentsJson: jsonb('arguments_json'),
    policyDecision: policyDecision('policy_decision'),
    /**
     * Why the gate decided what it decided, in the words a person is shown.
     *
     * Not nullable-by-habit: §4.4 requires a refusal to name its constraint,
     * and a refusal row with no reason is the generic failure the whole error
     * vocabulary exists to prevent. It is nullable only because a permit does
     * not need one.
     */
    policyReason: text('policy_reason'),
    decisionTokenId: uuid('decision_token_id'),
    outcome: toolOutcome('outcome'),
    createdAt: instant('created_at').notNull().defaultNow(),
  },
  (table) => [index('tool_executions_agent_id_idx').on(table.agentId, table.createdAt)],
);

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    toolExecutionId: uuid('tool_execution_id').references(() => toolExecutions.id, { onDelete: 'set null' }),
    hash: text('hash'),
    /**
     * The distinction the whole error vocabulary rests on.
     *
     * A refusal that never reached a ledger is evidence of nothing. This column
     * is what lets a row be rendered as *refused by Limen* rather than
     * borrowing the badge of a network refusal, and it is separate from `hash`
     * being null because a submitted transaction can have a hash and still not
     * have closed.
     */
    reachedLedger: boolean('reached_ledger').notNull().default(false),
    ledger: integer('ledger'),
    amount: amount('amount'),
    asset: text('asset'),
    destination: text('destination'),
    opResultName: text('op_result_name'),
    contractErrorCodes: integer('contract_error_codes').array(),
    isBoundaryRefusal: boolean('is_boundary_refusal'),
    isRevokedRule: boolean('is_revoked_rule'),
    createdAt: instant('created_at').notNull().defaultNow(),
  },
  (table) => [index('transactions_agent_id_idx').on(table.agentId, table.createdAt), index('transactions_hash_idx').on(table.hash)],
);

/**
 * Append-only, and the grant is what makes that true.
 *
 * No `UPDATE` or `DELETE` for the application role — enforced by the migration
 * that creates the role, not by nobody writing the statement. An audit trail
 * the application can rewrite is a log, and this table exists precisely for the
 * cases where somebody is asking what happened and the answer is contested.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actor: auditActor('actor').notNull(),
    actorId: text('actor_id'),
    action: text('action').notNull(),
    target: text('target'),
    result: text('result'),
    metadataJson: jsonb('metadata_json'),
    createdAt: instant('created_at').notNull().defaultNow(),
  },
  (table) => [index('audit_events_created_at_idx').on(table.createdAt), index('audit_events_actor_idx').on(table.actor, table.actorId)],
);

/** Brief §6's "pay my contractor 20 USDC every Friday". */
export const scheduledTasks = pgTable(
  'scheduled_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    cron: text('cron').notNull(),
    nextRunAt: instant('next_run_at'),
    lastRunAt: instant('last_run_at'),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: instant('created_at').notNull().defaultNow(),
  },
  // Partial: a scheduler only ever looks at enabled tasks, and a disabled one
  // should not cost an index entry or be reachable from the due-work query.
  (table) => [index('scheduled_tasks_next_run_at_idx').on(table.nextRunAt).where(sql`enabled`)],
);

/**
 * Replay defence (§10), and the reason durable execution needs a database row
 * rather than a queue guarantee.
 *
 * §7.5.4 reason 1: an agent turn that dies after submission and before
 * recording has spent funds with no record. At-least-once delivery means the
 * retry must be able to tell "not yet submitted" from "submitted, result
 * unknown" — and only a row written *before* submission, in the same database
 * the result is written to, can answer that.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    key: text('key').primaryKey(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    responseJson: jsonb('response_json'),
    createdAt: instant('created_at').notNull().defaultNow(),
  },
  (table) => [index('idempotency_keys_agent_id_idx').on(table.agentId)],
);

/**
 * One accepted request, and the only thing a caller has to poll.
 *
 * PLAN-V8 §7.5.4 decides the shape this table serves: a request is verified,
 * enqueued and acknowledged in under a second, and the work happens in the
 * worker. That decision leaves a hole Part V did not name — **the thing the
 * caller is now waiting on** — and this is it. Without a row, "your turn is
 * running" is a fact held in one process's memory, which is the same mistake
 * `env.ts` refuses when it declines an in-memory queue.
 *
 * One table for every surface, deliberately. The web chat and the Telegram bot
 * ask the same question — *is it done, and what happened* — and answering it
 * from two places would mean two ways for a result to be lost and two paths to
 * debug when one is. `channel` records which surface asked; nothing about the
 * answer depends on it.
 *
 * ## Status and outcome are two columns because they are two facts
 *
 * `status` is transport: queued, running, done. `outcome` is §4.4's vocabulary,
 * and a turn that ended in a refusal is `done` — not `failed`. Collapsing them
 * would give a refusal and a crashed process the same rendering, which is the
 * distinction this whole error vocabulary exists to keep.
 *
 * ## What `result_json` may hold, and why that is not rule 2's cache
 *
 * It holds what the caller is shown: an outcome, a hash, a refusal reason, a
 * balance. A balance is chain state, so the prohibition is worth answering
 * directly. This is a **transcript**, not a cache: it records what was said at a
 * moment, is never read back to decide anything, and every chain value written
 * into it carries the ledger it was read at — the same obligation
 * `*_last_seen` carries, met by the value's own shape rather than by a column
 * name. The gate re-reads the chain on every turn and consults nothing here.
 */
export const turnStatus = pgEnum('turn_status', ['queued', 'running', 'done']);

export const turns = pgTable(
  'turns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    /** Null until there is a conversation to belong to — the web chat, M4's second half. */
    conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
    channel: channel('channel').notNull(),
    status: turnStatus('status').notNull().default('queued'),
    /** What was asked, verbatim: a tool invocation now, a message when the loop lands. */
    requestJson: jsonb('request_json').notNull(),
    /** What to render. See the header on why a balance may live here. */
    resultJson: jsonb('result_json'),
    /** §4.4's five, never collapsed. Null while the turn is still queued or running. */
    outcome: toolOutcome('outcome'),
    createdAt: instant('created_at').notNull().defaultNow(),
    /**
     * Set by the claim, and the claim is what makes a duplicate harmless.
     *
     * At-least-once delivery means redelivery is a certainty, not a risk. A
     * worker claims a turn with a conditional update on `status = 'queued'`, so
     * a second delivery of the same turn matches no row and does no work. A
     * turn found already `running` is a worker that died mid-turn: it is
     * **not** retried, because "died before submitting" and "died after
     * submitting" are indistinguishable from here, and the wrong guess pays a
     * contractor twice.
     */
    startedAt: instant('started_at'),
    finishedAt: instant('finished_at'),
  },
  (table) => [index('turns_agent_id_idx').on(table.agentId, table.createdAt)],
);
