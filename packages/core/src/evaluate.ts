/**
 * Policy evaluation — an INDEPENDENT implementation of the rules `synthesize`
 * derives.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ DO NOT DEDUPLICATE THIS FILE AGAINST `synthesize.ts`.                    │
 * │                                                                          │
 * │ This file deliberately imports nothing from `synthesize.ts` — not a      │
 * │ comparator, not an amount parser, not the outflow summation. The         │
 * │ duplication IS the test's independence: the deny-case suite asserts that │
 * │ a proposal refuses adjacent transactions, and that assertion is worth    │
 * │ nothing if the same code both writes and checks the policy. A            │
 * │ synthesizer that is confidently wrong must not be able to agree with     │
 * │ itself.                                                                  │
 * │                                                                          │
 * │ Extracting a shared helper here would look like a cleanup and would      │
 * │ silently delete the guarantee. It is not a cleanup.                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Deny-by-default: anything this evaluator cannot positively account for —
 * including a malformed amount — produces a refusal rather than an exception,
 * so an unparseable candidate is denied rather than crashing the caller.
 */

import type { Decision, ObservedTransaction, PolicyProposal } from './types.js';

export function evaluate(proposal: PolicyProposal, candidate: ObservedTransaction): Decision {
  const reasons: string[] = [];

  const rule = proposal.contextRule;

  // --- Context rule: validity window -------------------------------------
  if (candidate.ledger < rule.validFromLedger) {
    reasons.push(
      `context rule not yet valid: ledger ${candidate.ledger} precedes validFromLedger ${rule.validFromLedger}`,
    );
  }
  if (candidate.ledger > rule.validUntilLedger) {
    reasons.push(
      `context rule expired: ledger ${candidate.ledger} is past validUntilLedger ${rule.validUntilLedger}`,
    );
  }

  // --- Context rule: contracts and functions ------------------------------
  for (const invocation of candidate.invocations) {
    const contractAllowed = rule.allowedContracts.includes(invocation.contractId);
    if (!contractAllowed) {
      reasons.push(`contract not in context rule: ${invocation.contractId}`);
      continue;
    }
    const permittedFunctions = rule.allowedFunctions[invocation.contractId];
    if (permittedFunctions === undefined || !permittedFunctions.includes(invocation.functionName)) {
      reasons.push(
        `function not permitted on ${invocation.contractId}: ${invocation.functionName}`,
      );
    }
  }

  // --- Function allowlist policies, checked independently of the rule -----
  // A proposal whose allowlist policies disagree with its own context rule
  // must fail rather than pass on the strength of one of the two agreeing.
  for (const policy of proposal.policies) {
    if (policy.kind !== 'function_allowlist') continue;
    for (const invocation of candidate.invocations) {
      if (invocation.contractId !== policy.contractId) continue;
      if (!policy.functions.includes(invocation.functionName)) {
        reasons.push(
          `function_allowlist policy for ${policy.contractId} does not permit ${invocation.functionName}`,
        );
      }
    }
  }

  // --- Spending limits ----------------------------------------------------
  // Gross outflow per asset, summed here from scratch. Inflows of the same
  // asset are NOT subtracted: a transaction that sends 1000 out and receives
  // 1000 back has spent 1000, not 0. See the matching note in synthesize.ts.
  const outflowByAsset = new Map<string, bigint>();
  let amountsWellFormed = true;

  for (const invocation of candidate.invocations) {
    for (const movement of invocation.movements) {
      if (movement.from !== candidate.source) continue;

      let value: bigint;
      try {
        if (!/^(?:0|[1-9][0-9]*)$/.test(movement.amount)) throw new Error('not an integer amount');
        value = BigInt(movement.amount);
      } catch {
        amountsWellFormed = false;
        reasons.push(
          `unparseable amount on ${invocation.contractId}.${invocation.functionName} for asset ${movement.asset}: ${JSON.stringify(movement.amount)}`,
        );
        continue;
      }

      const running = outflowByAsset.get(movement.asset);
      outflowByAsset.set(movement.asset, running === undefined ? value : running + value);
    }
  }

  const limitByAsset = new Map<string, bigint>();
  for (const policy of proposal.policies) {
    if (policy.kind !== 'spending_limit') continue;
    try {
      limitByAsset.set(policy.asset, BigInt(policy.limit));
    } catch {
      reasons.push(`spending_limit for ${policy.asset} has an unreadable limit: ${JSON.stringify(policy.limit)}`);
    }
  }

  for (const [asset, spent] of outflowByAsset) {
    if (spent <= 0n) continue;
    const cap = limitByAsset.get(asset);
    if (cap === undefined) {
      reasons.push(`no spending limit covers asset ${asset} (moves ${spent.toString()} out)`);
      continue;
    }
    if (spent > cap) {
      reasons.push(
        `spending limit exceeded for ${asset}: moves ${spent.toString()} out, cap is ${cap.toString()}`,
      );
    }
  }

  if (!amountsWellFormed && reasons.length === 0) {
    reasons.push('candidate contains amounts this evaluator could not verify');
  }

  return { permitted: reasons.length === 0, reasons };
}
