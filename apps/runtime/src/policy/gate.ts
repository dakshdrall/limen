/**
 * The gate: what Limen checks before an agent signs, and — just as important —
 * what it deliberately does not check.
 *
 * PLAN-V8 §4.2 states the standing caveat that shapes this file: the gate is a
 * **convenience and observability layer, not the security boundary** (brief
 * §15). If it were bypassed entirely, `__check_auth` would still refuse. Its
 * job is to fail fast, to explain, and to leave a record.
 *
 * ## The one place this file departs from §4.2's checklist, and why
 *
 * §4.2 lists *"amount ≤ remaining cap?"* among the gate's checks. §X — the
 * smallest working MVP, the thing the whole product is for — says:
 *
 * > Ask for more than the cap: **the network refuses**, with a hash and a
 * > contract error code.
 *
 * Those two cannot both be satisfied by refusing over-cap requests here. A gate
 * that pre-empts the cap turns the product's central demonstration into Limen's
 * opinion, and the sentence this repository repeats — *a refusal that never
 * reached a ledger is evidence of nothing* — would then describe its own
 * behaviour.
 *
 * So the rule this file follows is sharper than a checklist:
 *
 *   **Limen refuses only what the network cannot.** Where the network is the
 *   enforcer, the call is submitted and the refusal comes back with a hash.
 *
 * The cap is still *read* — it is in `Boundary`, it is recorded, and it is what
 * lets a refusal state whether the ledger would have refused too. It is simply
 * not a veto. What Limen vetoes is what no audited on-chain primitive can see:
 * an agent that is paused, a recipient outside the allowlist (B8), and a single
 * payment over the per-payment ceiling.
 *
 * ## Two ceilings, and they are not the same instrument
 *
 * This is the distinction the paragraph above is easiest to misread as
 * contradicting, so it is spelled out. An agent has **two** limits on what one
 * payment may be, and a payment can be refused by either, for different reasons
 * and with different evidence:
 *
 * | | the **cap** | the **per-payment ceiling** |
 * |---|---|---|
 * | what it bounds | everything spent in a rolling window | one payment |
 * | who holds it | the `spending_limit` policy contract, on the account | Limen, in `policies.enforced_offchain_json` |
 * | who enforces it | the network, inside `__check_auth` | this function |
 * | a refusal by it | `refused_by_network`, **with a hash** | `refused_by_limen`, **with none** |
 * | if Limen is bypassed | still refused | not refused |
 *
 * So the rule at the top is intact: the gate still does not pre-empt the cap,
 * because the network enforces the cap. It *does* enforce the ceiling, because
 * nothing else does — a per-payment limit is not expressible in the audited
 * primitive the account installs, which is exactly the test for what belongs
 * here. `agent-config.ts` already validates that the ceiling is not greater
 * than the cap, so the two never contradict; where both would refuse, the cap
 * is the one that reaches a ledger, and the ordering below keeps it that way by
 * never intercepting a payment the ceiling permits.
 *
 * The reason this had to be added rather than being here from the start is
 * worth recording: the builder collects the ceiling, validates it, writes it to
 * `enforced_offchain_json` and renders it on screen under **"Enforced by
 * Limen"** — and nothing read it. That is a promise the product made and did
 * not keep, which is worse than not offering the field.
 *
 * ## The boundary is read from the chain, every turn, without exception
 *
 * `schema.ts` rule 2, inherited from `lib/store.ts`: a cached copy is a claim
 * about the past rendered as the present. A policy revoked on another device,
 * or a rule that expired while the process was asleep, would still read as live
 * from any table. Nothing in `decide` takes a boundary from the database, and
 * the only database facts it takes are ones the chain does not hold: the
 * agent's lifecycle status, and the off-chain allowlist.
 *
 * ## Decisions are pure, so every refusal has a test
 *
 * `readBoundary` talks to the network. `decide` does not — it is a function of
 * (what the chain said, what the database said, what was asked), which is what
 * makes the whole refusal table checkable without a testnet.
 */

import {
  isLive,
  latestLedger,
  rawEd25519FromAddress,
  readAllContextRules,
  readSpendingLimit,
  toHex,
  type InstalledContextRule,
  type ReadOptions,
} from '@limen/chain';

/**
 * Whether the ledger would have refused this too.
 *
 * §4.4 requires a Limen refusal to say so, and the third value is not
 * hedging — it is the only honest answer when the refusal happened before
 * anything was read. A `boolean` here would force a guess, and the guess that
 * reads best (*"the chain would have refused anyway"*) is the one that quietly
 * claims the network's authority for Limen's opinion.
 */
export type LedgerWould = 'refuse' | 'permit' | 'unknown';

/** The boundary as the chain holds it, at a stated ledger. */
export interface Boundary {
  ruleId: number;
  /** The contract this rule authorizes calls to. */
  contract: string | null;
  validUntilLedger: number | null;
  /** The `spending_limit` policy contract attached to the rule. */
  policyContract: string | null;
  limit: bigint;
  spentInWindow: bigint;
  /** `limit - spentInWindow`, floored at zero. Read, recorded, never a veto. */
  remaining: bigint;
  periodLedgers: number;
  /**
   * The `External` signers the rule names: each verifier, with the raw key it
   * checks, hex-encoded as the account stores it.
   *
   * The verifier travels with the key because that is where the write path gets
   * it from. `signAs` needs the contract that will check the signature, and
   * taking it from the installed rule rather than from a deployments file means
   * signing against the verifier **the account actually registered for this
   * key** — a config file and a ledger can disagree, and only one of them
   * decides whether `__check_auth` passes.
   */
  signers: { verifier: string; publicKey: string }[];
  /** The ledger every number above was true at. Every render must state it. */
  ledger: number;
}

export interface PaymentRequest {
  token: string;
  destination: string;
  amount: bigint;
}

/**
 * A swap, as the gate needs to see one.
 *
 * `token` is the asset **leaving** the account, which is what makes a swap
 * checkable by the same code as a payment: the spending limit sees the outbound
 * `transfer`, so the input asset is the one the boundary is about. `outputAsset`
 * is carried for the pair check and for nothing else.
 *
 * There is no `destination`. A swap's counterparty is a liquidity pool the
 * router chooses, not an address the caller names, so a recipient allowlist has
 * nothing to match against — see `decideSwap`.
 */
export interface SwapRequest {
  token: string;
  outputAsset: string;
  amount: bigint;
}

export interface GateInput {
  agentStatus: string;
  agentPublicKey: string;
  request: PaymentRequest;
  enforcedOffchain: EnforcedOffchain | null;
  /** `undefined` when the rule this agent was deployed with is not on the account. */
  boundary: Boundary | undefined;
}

/**
 * The constraints Limen enforces because no audited primitive can.
 *
 * Every field here is a **Limen** limit. A refusal citing one has no transaction
 * hash and never reached a ledger, and `gate.ts`'s callers are required to
 * report it as `refused_by_limen` — never as the network's. B8 is the argument;
 * this is its type.
 *
 * ## What is deliberately absent
 *
 * There is no daily or windowed amount here, and there must never be one. The
 * spending limit on the account is the cap, it is enforced by an audited policy
 * contract, and it refuses on a ledger with `SpendingLimitExceeded#3221` and a
 * hash — measured, PLAN-V8 C0. A second amount check here would turn a network
 * guarantee into Limen's opinion, which is the exact inversion `gate.ts` exists
 * to prevent. `maxPositionSize` is not that: see its own note.
 */
export interface EnforcedOffchain {
  recipients?: string[];
  perTransactionCap?: string | null;
  /**
   * Which pairs this agent may trade, as `INPUT/OUTPUT` contract ids.
   *
   * The network cannot check this and it is not close. A spending limit sees an
   * amount and a period; it has no idea which asset came back, because the
   * inbound leg is a transfer *to* the account and raises no requirement the
   * account has to authorize. So "only ever buy XLM with USDC" is unenforceable
   * on chain by construction, and is enforced here or nowhere.
   *
   * Empty or absent means no pair is allowed, and that is the safe direction:
   * an agent with no configured pair refuses every swap rather than trading
   * anything it likes. Same rule as `recipients`.
   */
  allowedPairs?: string[];
  /**
   * The largest single position, in the input asset's smallest unit.
   *
   * **This is not the daily cap and does not duplicate it.** The spending limit
   * bounds how much leaves in a *window*; this bounds how much leaves in *one
   * trade*. The network cannot express the second — the policy contract holds a
   * limit and a period and nothing per-call — so an agent under a 100 USDC
   * daily cap can legitimately spend all of it in one swap unless something
   * off-chain says otherwise.
   *
   * It is the same shape as `perTransactionCap` and kept separate on purpose:
   * that one is about payments and reads on the payment screens, and folding
   * them together would make one number mean two things on two surfaces.
   */
  maxPositionSize?: string | null;
}

export type GateDecision =
  | { decision: 'permit'; boundary: Boundary }
  | {
      decision: 'refuse';
      /** Machine-readable, and the thing a test asserts on. */
      constraint: Constraint;
      /** The sentence a person is shown. Names the constraint, never a code. */
      reason: string;
      ledgerWould: LedgerWould;
      /** Present when the chain was read before the refusal. */
      boundary: Boundary | undefined;
    };

export type Constraint =
  | 'rule_not_installed'
  | 'rule_expired'
  | 'asset_not_authorized'
  | 'agent_key_not_a_signer'
  | 'agent_not_active'
  | 'recipient_not_allowed'
  | 'per_transaction_cap'
  | 'pair_not_allowed'
  | 'max_position_size'
  | 'venue_rule_not_installed';

/**
 * Read the installed boundary, now, from the account.
 *
 * The rule is looked up by the id recorded at deployment rather than by
 * scanning for a rule that looks right. `readAllContextRules` skips ids that
 * fail to read, because `remove_context_rule` leaves a gap — so a revoked rule
 * is simply absent, and absence is the answer this function returns.
 */
export async function readBoundary(
  options: ReadOptions,
  { smartAccount, contextRuleId }: { smartAccount: string; contextRuleId: number },
): Promise<Boundary | undefined> {
  const [rules, ledger] = await Promise.all([
    readAllContextRules(options, smartAccount),
    latestLedger(options),
  ]);

  const rule = rules.find((candidate) => candidate.id === contextRuleId);
  if (rule === undefined) return undefined;

  const policyContract = rule.policies[0] ?? null;
  const spend =
    policyContract === null
      ? undefined
      : await readSpendingLimit(options, policyContract, smartAccount, rule.id);

  const limit = BigInt(spend?.limit ?? '0');
  const spent = BigInt(spend?.spentInWindow ?? '0');

  return {
    ruleId: rule.id,
    contract: rule.contract,
    validUntilLedger: rule.validUntilLedger,
    policyContract,
    limit,
    spentInWindow: spent,
    // Floored: the contract's own accounting can exceed a lowered cap, and a
    // negative "remaining" rendered anywhere would read as a credit.
    remaining: limit > spent ? limit - spent : 0n,
    periodLedgers: spend?.periodLedgers ?? 0,
    signers: externalSigners(rule),
    ledger,
  };
}

function externalSigners(rule: InstalledContextRule): { verifier: string; publicKey: string }[] {
  return rule.signers
    .filter((signer): signer is Extract<typeof signer, { kind: 'External' }> => signer.kind === 'External')
    .map(({ verifier, publicKey }) => ({ verifier, publicKey: publicKey.toLowerCase() }));
}

/**
 * The signer entry for a given `G…`, or nothing.
 *
 * The gate uses it to refuse a boundary that does not name Limen's key; the
 * write path uses the same function to find the verifier to sign against. One
 * lookup, so the key that passes the check is by construction the key that
 * signs.
 */
export function signerFor(
  boundary: Boundary,
  agentPublicKey: string,
): { verifier: string; publicKey: string } | undefined {
  const raw = toHex(rawEd25519FromAddress(agentPublicKey)).toLowerCase();
  return boundary.signers.find((signer) => signer.publicKey === raw);
}

/**
 * The decision, as a pure function of everything already gathered.
 *
 * Order matters and is not alphabetical: the chain's own conditions come first,
 * because a refusal that names *"this rule expired"* is more useful than one
 * naming a Limen policy that would also have applied — and because the two
 * Limen-only refusals at the end have to state whether the ledger would have
 * refused too, which is only knowable once the boundary has been examined.
 */
export function decide({
  agentStatus,
  agentPublicKey,
  request,
  enforcedOffchain,
  boundary,
}: GateInput): GateDecision {
  if (boundary === undefined) {
    return {
      decision: 'refuse',
      constraint: 'rule_not_installed',
      reason:
        'The context rule this agent was deployed with is not on the account. It was revoked, or the ' +
        'deployment never completed. The ledger would refuse this call for the same reason.',
      ledgerWould: 'refuse',
      boundary: undefined,
    };
  }

  if (!isLive({ validUntilLedger: boundary.validUntilLedger }, boundary.ledger)) {
    return {
      decision: 'refuse',
      constraint: 'rule_expired',
      reason:
        `This agent's boundary expired at ledger ${boundary.validUntilLedger}, and the account is at ` +
        `${boundary.ledger}. The ledger would refuse this call for the same reason.`,
      ledgerWould: 'refuse',
      boundary,
    };
  }

  if (boundary.contract !== request.token) {
    return {
      decision: 'refuse',
      constraint: 'asset_not_authorized',
      reason:
        `This agent's boundary authorizes calls to ${boundary.contract ?? 'no single contract'}, and this ` +
        `payment is in ${request.token}. The ledger would refuse this call for the same reason.`,
      ledgerWould: 'refuse',
      boundary,
    };
  }

  if (signerFor(boundary, agentPublicKey) === undefined) {
    return {
      decision: 'refuse',
      constraint: 'agent_key_not_a_signer',
      reason:
        'The installed boundary does not name the key Limen holds for this agent, so nothing Limen can ' +
        'sign with is authorized by it. The ledger would refuse this call for the same reason.',
      ledgerWould: 'refuse',
      boundary,
    };
  }

  // Everything the chain enforces has now been examined, so the two refusals
  // below can say honestly whether it would have refused as well. Over the
  // remaining cap is the one case where a Limen refusal and a network refusal
  // would agree — and saying so is the point of the field.
  const ledgerWould: LedgerWould = request.amount > boundary.remaining ? 'refuse' : 'permit';

  if (agentStatus !== 'ACTIVE') {
    return {
      decision: 'refuse',
      constraint: 'agent_not_active',
      reason:
        `This agent is ${agentStatus}, and Limen will not sign for it. Pausing is enforced by Limen and ` +
        'not by the account: the boundary is still installed, so this is Limen declining rather than the ' +
        'network refusing. Revoke to remove the authority itself.',
      ledgerWould,
      boundary,
    };
  }

  const recipients = enforcedOffchain?.recipients;
  if (recipients !== undefined && recipients.length > 0 && !recipients.includes(request.destination)) {
    return {
      decision: 'refuse',
      constraint: 'recipient_not_allowed',
      // B8, said in the words the panel has to render. No audited on-chain
      // primitive can express a recipient allowlist, so this check is computed
      // locally and there is no refusal hash to show for it — which is a
      // finding to state, not a gap to paper over.
      reason:
        `${request.destination} is not on this agent's approved-recipient list. This limit is computed ` +
        'locally by Limen — the account cannot enforce a recipient allowlist, so this refusal has no ' +
        'transaction hash and never reached a ledger.',
      ledgerWould,
      boundary,
    };
  }

  // Checked after the recipient, because a payment to the wrong payee is wrong
  // whatever its size: naming the size first would send someone to correct the
  // amount on a payment that would still be refused.
  const ceiling = enforcedOffchain?.perTransactionCap;
  if (ceiling !== undefined && ceiling !== null && ceiling.length > 0 && request.amount > BigInt(ceiling)) {
    return {
      decision: 'refuse',
      constraint: 'per_transaction_cap',
      reason:
        `This payment of ${request.amount} is over this agent's per-payment ceiling of ${ceiling}. That ` +
        'ceiling is computed locally by Limen and is not the boundary on the account — the spending ' +
        'limit installed there governs a whole window, not one payment — so this refusal has no ' +
        'transaction hash and never reached a ledger.',
      ledgerWould,
      boundary,
    };
  }

  return { decision: 'permit', boundary };
}

/** How an allowed pair is written: input and output contract ids, in that order. */
export function pairKey(inputAsset: string, outputAsset: string): string {
  return `${inputAsset}/${outputAsset}`;
}

export interface SwapGateInput {
  agentStatus: string;
  agentPublicKey: string;
  request: SwapRequest;
  enforcedOffchain: EnforcedOffchain | null;
  boundary: Boundary | undefined;
  /**
   * The venue rule's id, or null when this agent has none.
   *
   * A swap needs two context rules and this is the second. Null is a refusal
   * rather than a lookup: an agent deployed without a venue rule cannot sign a
   * router call, and guessing an id would be inventing authority.
   */
  venueRuleId: number | null;
}

/**
 * The decision for a swap.
 *
 * Deliberately built on `decide` rather than beside it. Everything the chain
 * enforces about the outbound leg is identical — the rule has to be installed,
 * live, on the right asset, and name Limen's key — and a swap that re-derived
 * those checks would be a second place for them to drift. So the shared half is
 * delegated, and only what is genuinely different is written here.
 *
 * ## What is different, and why each one is off-chain
 *
 * **The pair.** The spending limit sees the outbound `transfer` and nothing
 * else; the inbound leg is a transfer *to* the account, which raises no auth
 * requirement the account has to satisfy. The network therefore cannot know
 * what was bought, and "only buy XLM with USDC" is unenforceable on chain by
 * construction rather than by omission.
 *
 * **The position size.** The policy contract holds a limit and a period. It has
 * no per-call ceiling, so an agent under a daily cap may legitimately spend the
 * whole of it in one trade. Bounding a single trade is off-chain or nowhere.
 *
 * **What is NOT here: the amount against the cap.** That is the network's job
 * and it does it — `SpendingLimitExceeded#3221`, on a ledger, with a hash. This
 * function does not pre-empt it, and `ledgerWould` is how a Limen refusal says
 * the network would have refused too.
 *
 * ## The recipient allowlist does not apply, and that is stated rather than skipped
 *
 * A swap's counterparty is a pool the router picks. There is no address the
 * caller names, so `recipients` has nothing to match and is not consulted. A
 * check that quietly matched a pool address against a list of payees would
 * refuse every swap for a reason nobody could act on.
 */
export function decideSwap({
  agentStatus,
  agentPublicKey,
  request,
  enforcedOffchain,
  boundary,
  venueRuleId,
}: SwapGateInput): GateDecision {
  // The outbound leg is a payment as far as the boundary is concerned, so the
  // chain-facing checks are the same ones, run by the same function. The
  // destination is the account itself: a placeholder that cannot match any
  // allowlist, chosen so `decide` cannot reach its recipient branch — which is
  // meaningless here — while every check before it still runs.
  const shared = decide({
    agentStatus,
    agentPublicKey,
    request: { token: request.token, destination: request.token, amount: request.amount },
    enforcedOffchain: { perTransactionCap: enforcedOffchain?.perTransactionCap ?? null },
    boundary,
  });
  if (shared.decision === 'refuse') return shared;

  const live = shared.boundary;
  const ledgerWould: LedgerWould = request.amount > live.remaining ? 'refuse' : 'permit';

  if (venueRuleId === null) {
    return {
      decision: 'refuse',
      constraint: 'venue_rule_not_installed',
      reason:
        'This agent has no venue rule, so it cannot authorize a call to a swap venue at all. A swap ' +
        'needs two context rules — one on the token, which carries the cap, and one on the router — ' +
        'and this agent was deployed with only the first. Nothing was signed.',
      ledgerWould: 'refuse',
      boundary: live,
    };
  }

  const pairs = enforcedOffchain?.allowedPairs;
  const wanted = pairKey(request.token, request.outputAsset);
  if (pairs === undefined || pairs.length === 0 || !pairs.includes(wanted)) {
    return {
      decision: 'refuse',
      constraint: 'pair_not_allowed',
      reason:
        `This agent is not configured to trade ${wanted}. Which pair an agent may trade is computed ` +
        'locally by Limen — the account sees the amount leaving and cannot see what was bought, so it ' +
        'cannot enforce a pair — and this refusal has no transaction hash and never reached a ledger.',
      ledgerWould,
      boundary: live,
    };
  }

  const position = enforcedOffchain?.maxPositionSize;
  if (position !== undefined && position !== null && position.length > 0 && request.amount > BigInt(position)) {
    return {
      decision: 'refuse',
      constraint: 'max_position_size',
      reason:
        `This trade of ${request.amount} is over this agent's maximum position size of ${position}. That ` +
        'is a per-trade ceiling computed locally by Limen and is not the boundary on the account — the ' +
        'spending limit installed there governs a whole window, not one trade — so this refusal has no ' +
        'transaction hash and never reached a ledger.',
      ledgerWould,
      boundary: live,
    };
  }

  return { decision: 'permit', boundary: live };
}
