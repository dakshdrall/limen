/**
 * `InstallPlan` -> `add_context_rule` calls. Unsigned.
 *
 * The split is deliberate: this file turns a reviewed plan into host functions
 * and stops. It does not simulate, sign, or submit, so what gets installed can
 * be inspected — and unit-tested — without a network, and the code that puts a
 * signature on it cannot quietly widen it on the way past.
 *
 * The on-chain signature, read out of the deployed wasm's spec section rather
 * than from a summary of it:
 *
 *     add_context_rule(context_type: Udt, name: String, valid_until: Option<u32>,
 *                      signers: Vec, policies: Map)
 */

import { xdr } from '@stellar/stellar-sdk';
import { Address } from '@stellar/stellar-sdk';
import type { InstallPlan, PlannedContextRule } from './plan.js';
import { callContractType, externalSigner, spendingLimitParams } from './authpayload.js';
import { assertDistinctSigners } from './sign.js';

export interface InstallContext {
  /** The smart account the rule is written to. */
  smartAccount: string;
  /** The ed25519 verifier contract the agent's signer is registered against. */
  verifier: string;
  /** The audited spending limit policy contract. */
  spendingLimitPolicy: string;
  /** The agent's raw 32-byte ed25519 public key. */
  agentPublicKey: Uint8Array;
  /**
   * The owner's raw public key.
   *
   * Present for one reason: so `assertDistinctSigners` can run here, at the
   * moment the boundary is built, rather than only at submission. A boundary
   * whose bounded key is the key that installed it is not a boundary, and the
   * cheapest place to refuse to build one is before it exists.
   */
  ownerPublicKey: Uint8Array;
}

function invoke(contract: string, fn: string, args: xdr.ScVal[]): xdr.HostFunction {
  return xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: new Address(contract).toScAddress(),
      functionName: fn,
      args,
    }),
  );
}

/**
 * `Option<u32>`: `Some(n)` is the value itself, `None` is void.
 *
 * Not a detail to get wrong quietly. Sending `u32(0)` for "no expiry" installs
 * a rule that expired at ledger zero, which reads on a screen as a rule that is
 * simply gone.
 */
function optionalU32(value: number | null): xdr.ScVal {
  return value === null ? xdr.ScVal.scvVoid() : xdr.ScVal.scvU32(value);
}

export function addContextRuleFunction(
  rule: PlannedContextRule,
  context: InstallContext,
): xdr.HostFunction {
  const policies = rule.policies.map(
    (policy) =>
      new xdr.ScMapEntry({
        key: new Address(context.spendingLimitPolicy).toScVal(),
        val: spendingLimitParams(BigInt(policy.limit), policy.windowLedgers),
      }),
  );

  return invoke(context.smartAccount, 'add_context_rule', [
    callContractType(rule.contract),
    xdr.ScVal.scvString(rule.name),
    optionalU32(rule.validUntilLedger),
    xdr.ScVal.scvVec([externalSigner(context.verifier, context.agentPublicKey)]),
    xdr.ScVal.scvMap(policies),
  ]);
}

/**
 * Every rule in the plan, as unsigned host functions.
 *
 * One per rule, and one submission per rule: `add_context_rule` returns the
 * `ContextRule` it created, and the id in that return value is the only
 * trustworthy source for what was installed. Batching them into one
 * transaction would save a fee and lose the ability to attribute an id to a
 * rule, which is the fact every later screen depends on.
 */
export function installFunctions(plan: InstallPlan, context: InstallContext): xdr.HostFunction[] {
  assertDistinctSigners(context.ownerPublicKey, context.agentPublicKey);
  return plan.rules.map((rule) => addContextRuleFunction(rule, context));
}

/**
 * The `id` field out of the `ContextRule` that `add_context_rule` returned.
 *
 * Read from the transaction, never assumed. Rule ids come from an on-chain
 * counter, so every install gets a new one, and a hardcoded id would silently
 * drive the wrong rule — including, eventually, someone else's.
 */
export function contextRuleIdFrom(returnValue: xdr.ScVal | undefined): number {
  for (const entry of returnValue?.map() ?? []) {
    if (entry.key().sym().toString() === 'id') return entry.val().u32();
  }
  throw new Error('add_context_rule did not return a ContextRule with an id');
}
