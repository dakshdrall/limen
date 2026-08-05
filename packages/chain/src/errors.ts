/**
 * The contract error codes a refusal arrives as.
 *
 * Transcribed from `SmartAccountError` in
 * `packages/accounts/src/smart_account/mod.rs` and `SpendingLimitError` in
 * `packages/accounts/src/policies/spending_limit.rs`, at the tag pinned in
 * `wasm/manifest.json`. Each is confirmed against live testnet by the deny-axis
 * survey; see `deployments/testnet.json`.
 *
 * This table exists so a refusal can be shown as what it is. Without it, every
 * failed attempt renders as `invokeHostFunctionTrapped`, which is also what a
 * transaction that ran out of budget renders as — and reporting one as the
 * other would turn an infrastructure failure into a claim about the boundary.
 */

export const SMART_ACCOUNT_ERRORS: Readonly<Record<number, string>> = {
  3000: 'ContextRuleNotFound',
  3002: 'UnvalidatedContext',
  3003: 'ExternalVerificationFailed',
  3004: 'NoSignersAndPolicies',
  3005: 'PastValidUntil',
  3006: 'SignerNotFound',
  3007: 'DuplicateSigner',
  3008: 'PolicyNotFound',
  3009: 'DuplicatePolicy',
  3010: 'TooManySigners',
  3011: 'TooManyPolicies',
  3012: 'MathOverflow',
  3013: 'KeyDataTooLarge',
  3014: 'ContextRuleIdsLengthMismatch',
  3015: 'NameTooLong',
  3016: 'UnauthorizedSigner',
};

export const SPENDING_LIMIT_ERRORS: Readonly<Record<number, string>> = {
  3220: 'SmartAccountNotInstalled',
  3221: 'SpendingLimitExceeded',
  3222: 'InvalidLimitOrPeriod',
  3223: 'NotAllowed',
  3224: 'HistoryCapacityExceeded',
  3225: 'AlreadyInstalled',
  3226: 'LessThanZero',
  3227: 'OnlyCallContractAllowed',
};

export const CONTRACT_ERRORS: Readonly<Record<number, string>> = {
  ...SMART_ACCOUNT_ERRORS,
  ...SPENDING_LIMIT_ERRORS,
};

export function describeContractError(code: number): string {
  const name = CONTRACT_ERRORS[code];
  return name === undefined ? `Contract#${code}` : `${name}#${code}`;
}

/**
 * Which deny axis a contract error corresponds to, for the refusal table.
 *
 * `UnvalidatedContext` covers three axes — a different asset, a different
 * contract, and an expired rule all fail the same check — so the code alone
 * does not identify the axis. The axis comes from what the attempt changed;
 * this map only says which codes are a *boundary* refusal at all.
 */
export const BOUNDARY_REFUSAL_CODES: ReadonlySet<number> = new Set([
  3002, // UnvalidatedContext  - asset, contract, expiry
  3014, // ContextRuleIdsLengthMismatch - appended invocation
  3016, // UnauthorizedSigner
  3221, // SpendingLimitExceeded - amount
  3223, // NotAllowed - function
]);

/**
 * True when a failure is the boundary refusing, rather than the network
 * failing to run the attempt.
 *
 * `resourceLimitExceeded` is the trap this guards: a transaction submitted with
 * a footprint from a recording-mode simulation dies on budget before the policy
 * ever runs, and reports the same operation result as a genuine refusal.
 */
export function isBoundaryRefusal(codes: readonly number[]): boolean {
  return codes.some((c) => BOUNDARY_REFUSAL_CODES.has(c));
}

/**
 * The codes that mean the rule is not there any more.
 *
 * `remove_context_rule` deletes the storage entry
 * (`packages/accounts/src/smart_account/storage.rs:845-850`), and a later
 * `get_context_rule` for that id panics `ContextRuleNotFound`.
 *
 * `3000` is deliberately **not** in `BOUNDARY_REFUSAL_CODES` above, and this is
 * a decision rather than an omission to patch. *"The boundary refused you"* and
 * *"the boundary is gone"* are different claims. Widening the refusal set so a
 * revoked rule rendered identically to a spending-limit refusal would blur
 * exactly the distinction the deny table exists to keep sharp — and it would
 * overstate the result, by counting a rule that no longer exists as a rule that
 * did its job.
 *
 * Separate predicate, separate presentation, on the `REFUSED AT SIMULATION`
 * precedent: a third thing that is neither a permit nor a boundary deny.
 */
export const REVOKED_RULE_CODES: ReadonlySet<number> = new Set([
  3000, // ContextRuleNotFound - the rule was removed
]);

export function isRevokedRule(codes: readonly number[]): boolean {
  return codes.some((c) => REVOKED_RULE_CODES.has(c));
}
