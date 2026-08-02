/**
 * Deterministic policy synthesis.
 *
 * Same transaction in, byte-identical proposal out, every time. No randomness,
 * no clock, no network, no model. Every emitted policy is a configuration of an
 * existing audited OpenZeppelin primitive — `spending_limit` or a function
 * allowlist. If a constraint cannot be expressed by composing those, this file
 * throws rather than approximating.
 */

import {
  DEFAULT_SYNTHESIS_OPTIONS,
  HEADROOM_SCALE,
  MAX_POLICIES,
  SynthesisError,
  type Address,
  type ContextRule,
  type ObservedTransaction,
  type PolicyConfig,
  type PolicyProposal,
  type SynthesisOptions,
} from './types.js';

/**
 * Code-unit ordering, not locale ordering. `localeCompare` is environment- and
 * locale-dependent, which would make the output differ between a developer's
 * machine and CI — the exact thing rule 1 forbids.
 */
function byCodeUnit(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

const INTEGER_AMOUNT = /^(?:0|[1-9][0-9]*)$/;

/**
 * Amounts are integers in the asset's smallest unit. A decimal point, a sign,
 * scientific notation, or a leading zero is a malformed amount, not a number to
 * be coerced — coercing is how a float gets into the amount path.
 */
function parseAmount(raw: string, where: string): bigint {
  if (typeof raw !== 'string' || !INTEGER_AMOUNT.test(raw)) {
    throw new SynthesisError(
      'invalid_amount',
      `${where}: amount must be a non-negative integer string in the asset's smallest unit, got ${JSON.stringify(raw)}`,
    );
  }
  return BigInt(raw);
}

function validateOptions(options: SynthesisOptions): void {
  const { headroomBps, windowLedgers, validityLedgers } = options;

  if (!Number.isInteger(headroomBps)) {
    throw new SynthesisError('invalid_headroom', `headroomBps must be an integer, got ${headroomBps}`);
  }
  // Below 1.0 the cap would fall under the observed outflow, and the derived
  // policy would refuse the very transaction it was derived from.
  if (headroomBps < HEADROOM_SCALE) {
    throw new SynthesisError(
      'invalid_headroom',
      `headroomBps must be >= ${HEADROOM_SCALE} (1.0); ${headroomBps} would derive a cap below the observed outflow`,
    );
  }

  if (!Number.isInteger(windowLedgers) || windowLedgers <= 0) {
    throw new SynthesisError('invalid_window', `windowLedgers must be a positive integer, got ${windowLedgers}`);
  }
  if (!Number.isInteger(validityLedgers) || validityLedgers <= 0) {
    throw new SynthesisError('invalid_window', `validityLedgers must be a positive integer, got ${validityLedgers}`);
  }

  // A spending window longer than the context rule's lifetime is a limit that
  // never resets inside the period it governs: the rule expires before the
  // window rolls, so the "rolling" cap is really a one-shot lifetime allowance.
  if (windowLedgers > validityLedgers) {
    throw new SynthesisError(
      'invalid_window',
      `windowLedgers (${windowLedgers}) must be <= validityLedgers (${validityLedgers}); a window longer than the rule's lifetime is a limit that never resets`,
    );
  }
}

export function synthesize(
  observed: ObservedTransaction,
  options: SynthesisOptions = DEFAULT_SYNTHESIS_OPTIONS,
): PolicyProposal {
  validateOptions(options);

  if (observed.invocations.length === 0) {
    throw new SynthesisError(
      'no_invocations',
      'cannot derive a policy from a transaction with no contract invocations',
    );
  }
  if (!Number.isInteger(observed.ledger) || observed.ledger < 0) {
    throw new SynthesisError('not_expressible', `observed.ledger must be a non-negative integer, got ${observed.ledger}`);
  }

  // --- Contracts and functions -------------------------------------------
  // Two functions observed means exactly two functions permitted. Sorting is
  // what makes the output byte-identical regardless of invocation order.
  const functionsByContract = new Map<Address, Set<string>>();
  for (const invocation of observed.invocations) {
    if (!invocation.contractId) {
      throw new SynthesisError('not_expressible', 'invocation is missing a contractId');
    }
    if (!invocation.functionName) {
      throw new SynthesisError('not_expressible', `invocation on ${invocation.contractId} is missing a functionName`);
    }
    let functions = functionsByContract.get(invocation.contractId);
    if (functions === undefined) {
      functions = new Set<string>();
      functionsByContract.set(invocation.contractId, functions);
    }
    functions.add(invocation.functionName);
  }

  const allowedContracts = [...functionsByContract.keys()].sort(byCodeUnit);
  const allowedFunctions: Record<Address, string[]> = {};
  for (const contractId of allowedContracts) {
    allowedFunctions[contractId] = [...(functionsByContract.get(contractId) ?? new Set<string>())].sort(byCodeUnit);
  }

  // --- Gross outflow per asset -------------------------------------------
  // GROSS, never netted against inflows of the same asset. Netting would let a
  // round trip hide spend: send 1000 out, receive 1000 back, net zero, cap
  // untouched — and the same policy would then permit that pair an unbounded
  // number of times. Under gross accounting each outflow costs the cap for the
  // window, which is the property that makes the cap a spending bound at all.
  // Do not "simplify" this into a balance delta.
  const grossOutflow = new Map<Address, bigint>();
  for (const [index, movement] of observed.movements.entries()) {
    // Every amount is validated, including ones that do not affect the cap,
    // so malformed input fails at synthesis rather than surviving into a
    // proposal.
    const amount = parseAmount(movement.amount, `movement ${index} of ${movement.asset}`);
    if (movement.from !== observed.source) continue;
    grossOutflow.set(movement.asset, (grossOutflow.get(movement.asset) ?? 0n) + amount);
  }

  const spentAssets = [...grossOutflow.entries()]
    .filter(([, total]) => total > 0n)
    .map(([asset]) => asset)
    .sort(byCodeUnit);

  // --- Policies ----------------------------------------------------------
  const policies: PolicyConfig[] = [];
  const rationale: string[] = [];

  for (const asset of spentAssets) {
    const gross = grossOutflow.get(asset) ?? 0n;
    // Integer multiply-then-divide. Truncation rounds the cap down, which is
    // the direction that grants less permission.
    const limit = (gross * BigInt(options.headroomBps)) / BigInt(HEADROOM_SCALE);
    policies.push({
      kind: 'spending_limit',
      asset,
      limit: limit.toString(),
      windowLedgers: options.windowLedgers,
    });
    rationale.push(
      `limit:${asset}:${limit.toString()}:observed_gross_outflow=${gross.toString()}:headroom=${options.headroomBps}bps:window=${options.windowLedgers}`,
    );
  }

  for (const contractId of allowedContracts) {
    const functions = allowedFunctions[contractId] ?? [];
    policies.push({ kind: 'function_allowlist', contractId, functions });
    rationale.push(`allowlist:${contractId}:${functions.join(',')}`);
  }

  if (policies.length > MAX_POLICIES) {
    throw new SynthesisError(
      'policy_limit_exceeded',
      `derived ${policies.length} policies (${spentAssets.length} spending limits + ${allowedContracts.length} function allowlists) but an OpenZeppelin context rule holds at most ${MAX_POLICIES}`,
    );
  }

  const contextRule: ContextRule = {
    allowedContracts,
    allowedFunctions,
    validFromLedger: observed.ledger,
    validUntilLedger: observed.ledger + options.validityLedgers,
  };

  rationale.push(`contracts:${allowedContracts.join(',')}`);
  rationale.push(`window:${contextRule.validFromLedger}-${contextRule.validUntilLedger}`);

  return {
    contextRule,
    policies,
    rationale,
    // TODO(roadmap): the gate for generated Rust policies. Composition-only is
    // the whole safety argument in this MVP; nothing sets this false.
    compositionOnly: true,
  };
}
