/**
 * Taking a boundary back. Unsigned, like `install.ts`.
 *
 * Signatures read out of the deployed wasm's spec section:
 *
 *     remove_context_rule(context_rule_id: u32)
 *     remove_policy(context_rule_id: u32, policy_id: u32)
 *
 * `remove_policy` takes a **policy id**, not the policy's address. The address
 * is what a person sees; the id is what the contract stores. `read.ts` returns
 * both, in the same order, which is why `policyIds` exists there.
 *
 * ---
 *
 * The asymmetry this file demonstrates is enforced by the contract, not by
 * Limen declining to offer the agent a button. `remove_context_rule` requires
 * the account to authorize itself:
 *
 *     // packages/accounts/src/smart_account/mod.rs:341-342
 *     e.current_contract_address().require_auth()
 *
 * which routes back through `__check_auth` with a `Contract` context naming the
 * smart account. Whether a signer can satisfy that comes down to one line:
 *
 *     // packages/accounts/src/smart_account/storage.rs:303
 *     let context_type_matches = context_rule.context_type == ContextRuleType::Default
 *         || context_rule.context_type == required_type;
 *
 * The owner's Default rule matches any context, so it validates a call to the
 * account itself. The agent's rule is `CallContract(token)`, which does not. An
 * agent that tries to revoke its own boundary is refused by the network.
 *
 * That refusal is the direct answer to *"the agent holds a key, so what stops
 * it?"*, it costs one more submission, and `scripts/testnet.mjs` attempts it on
 * purpose so the answer is a hash rather than a paragraph.
 */

import { Address, xdr } from '@stellar/stellar-sdk';

function invoke(contract: string, fn: string, args: xdr.ScVal[]): xdr.HostFunction {
  return xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: new Address(contract).toScAddress(),
      functionName: fn,
      args,
    }),
  );
}

export function removeContextRuleFunction(smartAccount: string, contextRuleId: number): xdr.HostFunction {
  return invoke(smartAccount, 'remove_context_rule', [xdr.ScVal.scvU32(contextRuleId)]);
}

export function removePolicyFunction(
  smartAccount: string,
  contextRuleId: number,
  policyId: number,
): xdr.HostFunction {
  return invoke(smartAccount, 'remove_policy', [
    xdr.ScVal.scvU32(contextRuleId),
    xdr.ScVal.scvU32(policyId),
  ]);
}
