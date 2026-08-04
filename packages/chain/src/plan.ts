/**
 * The shape of an install, and the error thrown when a proposal cannot be one.
 *
 * An `InstallPlan` is a plain description of what will be written to the chain.
 * It contains no XDR, no SDK types, and no network calls, so the lowering that
 * produces it can be tested without either.
 */

import type { Address, Amount } from '@limen/core';

/**
 * A single OpenZeppelin context rule.
 *
 * `contextType` is always `CallContract` in this version. `Default` would
 * authorize any context, which is broader than anything the synthesizer can
 * derive, and `CreateContract` has no counterpart in the domain model.
 */
export interface PlannedContextRule {
  /** The one contract this rule authorizes calls to. */
  contract: Address;
  /**
   * Max 20 bytes — `MAX_NAME_SIZE` in the OpenZeppelin sources. Lowering
   * truncates nothing; it throws if a name would not fit.
   */
  name: string;
  /**
   * `valid_until` as an absolute ledger sequence, or `null` for no expiry.
   *
   * There is no `valid_from` on-chain. `ContextRule.validFromLedger` in the
   * domain model is provenance — the ledger the policy was derived from — and
   * is deliberately absent here rather than silently folded into this field.
   */
  validUntilLedger: number | null;
  /** Spending limit policies attached to this rule. */
  policies: PlannedPolicy[];
}

export interface PlannedPolicy {
  kind: 'spending_limit';
  /**
   * The token contract. Always equal to the enclosing rule's `contract`: the
   * OpenZeppelin policy refuses to install on any context type but
   * `CallContract`, which pins it to one token.
   */
  asset: Address;
  limit: Amount;
  windowLedgers: number;
}

export interface InstallPlan {
  rules: PlannedContextRule[];
  /**
   * One line per lowering decision, in the same spirit as
   * `PolicyProposal.rationale`: what was lowered onto what, and what was
   * subsumed rather than installed in its own right.
   */
  notes: string[];
}

export type NotEnforceableCode =
  /** A function allowlist that the spending limit policy does not already impose. */
  | 'function_allowlist_not_expressible'
  /** A contract in the proposal that no audited policy can constrain. */
  | 'unconstrained_contract'
  /** More policies on one rule than a context rule holds. */
  | 'policy_limit_exceeded'
  /** A rule name longer than the contract accepts. */
  | 'name_too_long'
  /** A value the chain cannot represent. */
  | 'not_representable';

/**
 * Thrown when a proposal cannot be installed using only audited OpenZeppelin
 * primitives.
 *
 * This is the install-time counterpart of `SynthesisError`, and it exists for
 * the same reason: the alternative to refusing is installing a boundary that is
 * broader than the one the user reviewed. A policy that permits more than it
 * displays is worse than no policy, because the user has been told they are
 * covered.
 */
export class NotEnforceableError extends Error {
  readonly code: NotEnforceableCode;
  /** The specific constraint that could not be lowered, for the UI to show. */
  readonly constraint: string;

  constructor(code: NotEnforceableCode, constraint: string, message: string) {
    super(message);
    this.name = 'NotEnforceableError';
    this.code = code;
    this.constraint = constraint;
  }
}

/** `MAX_NAME_SIZE` in `packages/accounts/src/smart_account/mod.rs`. */
export const MAX_RULE_NAME_BYTES = 20;

/** `MAX_POLICIES` per context rule in the same file. Not the same denominator
 * as `@limen/core`'s `MAX_POLICIES`, which counts across a whole proposal. */
export const MAX_POLICIES_PER_RULE = 5;

/**
 * The only function name the spending limit policy will enforce against.
 *
 * `spending_limit::enforce` matches the auth context and panics `NotAllowed`
 * for every `fn_name` except this one. That is what makes a single-function
 * allowlist enforceable with no allowlist policy — and what makes any other
 * function set unenforceable.
 */
export const SPENDING_LIMIT_ENFORCED_FN = 'transfer';
