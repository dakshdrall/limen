/**
 * Domain model for Limen.
 *
 * Every amount in this file is a stringified integer in the asset's smallest
 * unit, and is handled as `bigint` once parsed. There is no `number` anywhere
 * in the amount path, and no rounding that is not integer truncation biased
 * toward less permission.
 */

/** A Stellar address: `C...` contract or `G...` account. */
export type Address = string;

/** An integer amount in the asset's smallest unit, as a decimal string. */
export type Amount = string;

export interface TokenMovement {
  asset: Address;
  from: Address;
  to: Address;
  amount: Amount;
}

export interface Invocation {
  contractId: Address;
  functionName: string;
  args: string[];
  movements: TokenMovement[];
}

export interface ObservedTransaction {
  hash: string;
  // TODO(roadmap): 'mainnet' is in the union for shape stability only. The
  // ingest route refuses it and there is no mainnet code path in this MVP.
  network: 'testnet' | 'mainnet' | 'simulated';
  ledger: number;
  /** The account the policy installs on. */
  source: Address;
  invocations: Invocation[];
}

export interface ContextRule {
  allowedContracts: Address[];
  allowedFunctions: Record<Address, string[]>;
  validFromLedger: number;
  validUntilLedger: number;
}

export type PolicyConfig =
  | { kind: 'spending_limit'; asset: Address; limit: Amount; windowLedgers: number }
  | { kind: 'function_allowlist'; contractId: Address; functions: string[] };

export interface PolicyProposal {
  contextRule: ContextRule;
  /** Max 5 — the OpenZeppelin context rule limit. Synthesis throws above it. */
  policies: PolicyConfig[];
  /** Structured, one line per derived constraint. Input to Claude, never its output. */
  rationale: string[];
  /** Always true in this MVP. */
  compositionOnly: boolean;
}

export interface Decision {
  permitted: boolean;
  reasons: string[];
}

/**
 * Arguments to `synthesize`. These are the only values a user's answer to a
 * clarifying question can influence, and they only ever arrive here after an
 * explicit selection in the UI — never from a model, and never by default.
 */
export interface SynthesisOptions {
  /**
   * Headroom in integer basis points. 10_000 === 1.0 === cap equals observed
   * outflow exactly.
   *
   * Basis points rather than a float because a float here would reintroduce
   * non-integer arithmetic at the exact moment the cap is computed. The
   * multiply-then-divide below truncates, so the cap always rounds *down*.
   */
  headroomBps: number;
  /** Rolling window for every derived spending limit. */
  windowLedgers: number;
  /** Context rule lifetime, counted from `observed.ledger`. */
  validityLedgers: number;
}

/** Denominator for `headroomBps`. */
export const HEADROOM_SCALE = 10_000;

/** ~7 days at roughly 5 seconds per ledger. */
export const LEDGERS_PER_WEEK = 120_960;

/**
 * Defaults are deliberately the least-permissive settings that still describe
 * the observed flow: the cap equals the observed outflow exactly.
 */
export const DEFAULT_SYNTHESIS_OPTIONS: SynthesisOptions = {
  headroomBps: HEADROOM_SCALE,
  windowLedgers: LEDGERS_PER_WEEK,
  validityLedgers: LEDGERS_PER_WEEK,
};

/** OpenZeppelin context rules hold at most this many policies. */
export const MAX_POLICIES = 5;

export type SynthesisErrorCode =
  | 'no_invocations'
  | 'invalid_amount'
  | 'invalid_window'
  | 'invalid_headroom'
  | 'policy_limit_exceeded'
  | 'not_expressible';

/**
 * Thrown rather than guessed. If a constraint cannot be expressed as a
 * configuration of an existing audited primitive, synthesis fails loudly.
 */
export class SynthesisError extends Error {
  readonly code: SynthesisErrorCode;

  constructor(code: SynthesisErrorCode, message: string) {
    super(message);
    this.name = 'SynthesisError';
    this.code = code;
  }
}

export type DenyAxis =
  | 'amount'
  | 'asset'
  | 'function'
  | 'contract'
  | 'invocation'
  | 'expiry';

export interface DenyCase {
  /** The single dimension this case mutates. */
  axis: DenyAxis;
  /** Short label for the deny table row. */
  label: string;
  /** Why a correct policy must refuse this. */
  why: string;
  candidate: ObservedTransaction;
}
