/**
 * Single-axis mutations of an observed transaction.
 *
 * Each case changes exactly ONE dimension, so a failure points at exactly one
 * over-permissive dimension of the derived policy. A case that changed two
 * things at once would tell you the policy is wrong without telling you where.
 */

import type {
  DenyCase,
  Invocation,
  ObservedTransaction,
  PolicyProposal,
  TokenMovement,
} from './types.js';

/**
 * Fixed synthetic addresses. Constants, never generated — a random address
 * would make the deny table differ between runs, and the whole point of this
 * module is that the same transaction produces the same table every time.
 */
const UNOBSERVED_ASSET = 'CASSETNOTOBSERVEDINTHISFLOWAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const UNOBSERVED_CONTRACT = 'CCONTRACTNEVEROBSERVEDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const PRIVILEGED_FUNCTION = 'set_admin';
const FALLBACK_FUNCTION = 'upgrade';

/** Plain-JSON deep clone. The domain model has no dates, maps, or cycles. */
function cloneTx(tx: ObservedTransaction): ObservedTransaction {
  return JSON.parse(JSON.stringify(tx)) as ObservedTransaction;
}

/** Index of the first movement that sends `asset` out of the source account. */
function findFirstOutflow(
  tx: ObservedTransaction,
  asset: string,
): { invocation: number; movement: number } | undefined {
  for (let i = 0; i < tx.invocations.length; i++) {
    const invocation = tx.invocations[i] as Invocation;
    for (let j = 0; j < invocation.movements.length; j++) {
      const movement = invocation.movements[j] as TokenMovement;
      if (movement.from === tx.source && movement.asset === asset) {
        return { invocation: i, movement: j };
      }
    }
  }
  return undefined;
}

function grossOutflow(tx: ObservedTransaction, asset: string): bigint {
  let total = 0n;
  for (const invocation of tx.invocations) {
    for (const movement of invocation.movements) {
      if (movement.from !== tx.source) continue;
      if (movement.asset !== asset) continue;
      total += BigInt(movement.amount);
    }
  }
  return total;
}

/**
 * Every case here must be refused by a correct policy. The suite asserts
 * exactly that, per axis.
 */
export function generateDenyCases(
  observed: ObservedTransaction,
  proposal: PolicyProposal,
): DenyCase[] {
  const cases: DenyCase[] = [];

  const firstLimit = proposal.policies.find((p) => p.kind === 'spending_limit');
  const firstInvocation = observed.invocations[0];

  // --- axis: amount -------------------------------------------------------
  if (firstLimit !== undefined && firstLimit.kind === 'spending_limit') {
    const asset = firstLimit.asset;
    const cap = BigInt(firstLimit.limit);
    const site = findFirstOutflow(observed, asset);
    if (site !== undefined) {
      const candidate = cloneTx(observed);
      const invocation = candidate.invocations[site.invocation] as Invocation;
      const movement = invocation.movements[site.movement] as TokenMovement;
      // Raise this one movement so the gross outflow lands exactly one unit
      // over the cap — the smallest possible violation, which is the one a
      // sloppy `>=` / `>` boundary would let through.
      const delta = cap + 1n - grossOutflow(observed, asset);
      movement.amount = (BigInt(movement.amount) + delta).toString();
      cases.push({
        axis: 'amount',
        label: `${(cap + 1n).toString()} of ${asset} (cap + 1)`,
        why: `moves one unit more than the derived cap of ${cap.toString()}`,
        candidate,
      });
    }
  }

  // --- axis: asset --------------------------------------------------------
  if (firstLimit !== undefined && firstLimit.kind === 'spending_limit') {
    const site = findFirstOutflow(observed, firstLimit.asset);
    if (site !== undefined) {
      const candidate = cloneTx(observed);
      const invocation = candidate.invocations[site.invocation] as Invocation;
      const movement = invocation.movements[site.movement] as TokenMovement;
      movement.asset = UNOBSERVED_ASSET;
      cases.push({
        axis: 'asset',
        label: `same amount, unlisted asset`,
        why: 'moves an asset that no spending limit in the proposal covers',
        candidate,
      });
    }
  }

  // --- axis: function -----------------------------------------------------
  if (firstInvocation !== undefined) {
    const permitted = proposal.contextRule.allowedFunctions[firstInvocation.contractId] ?? [];
    const foreign = permitted.includes(PRIVILEGED_FUNCTION) ? FALLBACK_FUNCTION : PRIVILEGED_FUNCTION;
    const candidate = cloneTx(observed);
    (candidate.invocations[0] as Invocation).functionName = foreign;
    cases.push({
      axis: 'function',
      label: `${foreign}() on an in-scope contract`,
      why: `permitting ${permitted.join(', ') || 'the observed functions'} must not imply permitting ${foreign}`,
      candidate,
    });
  }

  // --- axis: contract -----------------------------------------------------
  if (firstInvocation !== undefined) {
    const candidate = cloneTx(observed);
    (candidate.invocations[0] as Invocation).contractId = UNOBSERVED_CONTRACT;
    cases.push({
      axis: 'contract',
      label: 'same call, contract never observed',
      why: 'targets a contract that is not in the context rule',
      candidate,
    });
  }

  // --- axis: invocation ---------------------------------------------------
  {
    const candidate = cloneTx(observed);
    candidate.invocations.push({
      contractId: UNOBSERVED_CONTRACT,
      functionName: 'transfer',
      args: [],
      movements: [],
    });
    cases.push({
      axis: 'invocation',
      label: 'original flow + one appended invocation',
      why: 'the observed flow is permitted, but not with an extra call bolted onto the end',
      candidate,
    });
  }

  // --- axis: expiry -------------------------------------------------------
  {
    const candidate = cloneTx(observed);
    candidate.ledger = proposal.contextRule.validUntilLedger + 1;
    cases.push({
      axis: 'expiry',
      label: `identical flow at ledger ${candidate.ledger}`,
      why: `the context rule expires at ledger ${proposal.contextRule.validUntilLedger}`,
      candidate,
    });
  }

  return cases;
}
