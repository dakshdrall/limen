/**
 * Lowering: `PolicyProposal` -> `InstallPlan`.
 *
 * Pure. No network, no Stellar SDK, no clock. The same proposal lowers to the
 * same plan every time, for the same reason `synthesize` is deterministic.
 *
 * This file is where the composition-only rule is actually enforced. Limen
 * emits no Rust, so a constraint is installable only if some already-audited
 * OpenZeppelin primitive already imposes it. Where one does not, this throws
 * and names the constraint rather than installing something broader than what
 * the user reviewed.
 *
 * The one non-obvious rule here — that a `['transfer']` allowlist is subsumed
 * by the spending limit policy — is a claim about someone else's contract. It
 * is asserted explicitly below, covered by unit tests, and checked a second
 * time against live testnet by the deny-axis survey, because a claim about
 * another repository's behaviour that only this repository's tests verify is
 * not verified at all.
 */

import type { Address, PolicyConfig, PolicyProposal } from '@limen/core';
import {
  MAX_POLICIES_PER_RULE,
  MAX_RULE_NAME_BYTES,
  NotEnforceableError,
  SPENDING_LIMIT_ENFORCED_FN,
  type InstallPlan,
  type PlannedContextRule,
  type PlannedPolicy,
} from './plan.js';

function byCodeUnit(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Rule names are `String` on-chain and bounded in bytes, not characters. */
function nameFor(contract: Address, index: number): string {
  const candidate = `limen-${index}`;
  if (new TextEncoder().encode(candidate).length > MAX_RULE_NAME_BYTES) {
    throw new NotEnforceableError(
      'name_too_long',
      candidate,
      `context rule name ${JSON.stringify(candidate)} for ${contract} exceeds ${MAX_RULE_NAME_BYTES} bytes`,
    );
  }
  return candidate;
}

export interface LowerOptions {
  /**
   * Ledger at which the rules stop being valid. Taken from the proposal's
   * context rule, which is where the synthesizer put it.
   */
  validUntilLedger?: number | null;
}

export function lower(proposal: PolicyProposal, options: LowerOptions = {}): InstallPlan {
  if (!proposal.compositionOnly) {
    throw new NotEnforceableError(
      'not_representable',
      'compositionOnly=false',
      'refusing to lower a proposal that is not composition-only; there is no code path in Limen that installs generated policy',
    );
  }

  const validUntilLedger =
    options.validUntilLedger !== undefined
      ? options.validUntilLedger
      : proposal.contextRule.validUntilLedger;

  if (validUntilLedger !== null && !Number.isInteger(validUntilLedger)) {
    throw new NotEnforceableError(
      'not_representable',
      `valid_until=${String(validUntilLedger)}`,
      'valid_until must be an integer ledger sequence or null',
    );
  }

  const spendingLimits = new Map<Address, Extract<PolicyConfig, { kind: 'spending_limit' }>>();
  const allowlists = new Map<Address, string[]>();

  for (const policy of proposal.policies) {
    if (policy.kind === 'spending_limit') {
      // Two spending limits on one asset would be two policies pinned to the
      // same context rule with the same storage key; the second install panics
      // `AlreadyInstalled` on-chain. Refuse here, where the reason is legible.
      if (spendingLimits.has(policy.asset)) {
        throw new NotEnforceableError(
          'policy_limit_exceeded',
          `spending_limit:${policy.asset}`,
          `two spending limits derived for ${policy.asset}; a context rule holds one policy instance per asset`,
        );
      }
      spendingLimits.set(policy.asset, policy);
    } else {
      allowlists.set(policy.contractId, [...policy.functions].sort(byCodeUnit));
    }
  }

  const notes: string[] = [];
  const rules: PlannedContextRule[] = [];

  // Every contract the proposal names has to end up inside a rule, or the
  // agent could call it unconstrained.
  const contracts = [...new Set([...spendingLimits.keys(), ...allowlists.keys()])].sort(byCodeUnit);

  for (const [index, contract] of contracts.entries()) {
    const limit = spendingLimits.get(contract);
    const functions = allowlists.get(contract);

    if (limit === undefined) {
      // A context rule with no policy authorizes *every* function on that
      // contract for the agent's signer. The synthesizer derived a specific
      // function list, so installing that rule would grant strictly more than
      // was reviewed. This is the multi-contract case — a router call beside a
      // token transfer — and it is refused rather than widened.
      throw new NotEnforceableError(
        'unconstrained_contract',
        `${contract}:${(functions ?? []).join(',')}`,
        `no audited policy constrains ${contract}: a context rule without a spending limit would permit every function on it, which is broader than the derived allowlist ${JSON.stringify(functions ?? [])}`,
      );
    }

    if (functions !== undefined) {
      // The subsumption claim, stated where it can fail loudly.
      const subsumed =
        functions.length === 1 && functions[0] === SPENDING_LIMIT_ENFORCED_FN;
      if (!subsumed) {
        throw new NotEnforceableError(
          'function_allowlist_not_expressible',
          `${contract}:${functions.join(',')}`,
          `no audited primitive enforces the function allowlist ${JSON.stringify(functions)} on ${contract}; the spending limit policy enforces exactly ${JSON.stringify([SPENDING_LIMIT_ENFORCED_FN])} and nothing else`,
        );
      }
      notes.push(
        `allowlist:${contract}:${functions.join(',')}:subsumed_by=spending_limit(enforce panics NotAllowed for any fn_name != ${SPENDING_LIMIT_ENFORCED_FN})`,
      );
    }

    const policies: PlannedPolicy[] = [
      {
        kind: 'spending_limit',
        asset: contract,
        limit: limit.limit,
        windowLedgers: limit.windowLedgers,
      },
    ];

    if (policies.length > MAX_POLICIES_PER_RULE) {
      throw new NotEnforceableError(
        'policy_limit_exceeded',
        contract,
        `${policies.length} policies on the rule for ${contract}, but a context rule holds at most ${MAX_POLICIES_PER_RULE}`,
      );
    }

    rules.push({
      contract,
      name: nameFor(contract, index),
      validUntilLedger,
      policies,
    });

    notes.push(
      `rule:${contract}:CallContract:valid_until=${validUntilLedger ?? 'none'}:spending_limit=${limit.limit}:window=${limit.windowLedgers}`,
    );
  }

  if (rules.length === 0) {
    throw new NotEnforceableError(
      'not_representable',
      'no policies',
      'proposal produced no installable context rules',
    );
  }

  // Stated rather than assumed: validFromLedger has no on-chain counterpart.
  notes.push(
    `not_installed:valid_from_ledger=${proposal.contextRule.validFromLedger}:reason=no counterpart on OpenZeppelin ContextRule; retained as local provenance`,
  );

  return { rules, notes };
}
