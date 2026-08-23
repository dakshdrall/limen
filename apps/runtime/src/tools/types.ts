/**
 * What a tool is, and the five things a tool call can turn out to be.
 *
 * §4.4's vocabulary, as types. The table it comes from:
 *
 * | Outcome | Source | What the user is told |
 * |---|---|---|
 * | **Agent error** | the model or the tool layer | "I couldn't work out what you meant." No hash. |
 * | **Refused by Limen** | the gate | The named constraint, and whether the ledger would also have refused. |
 * | **Refused by the network** | `isBoundaryRefusal` | The contract error code, the axis, and the hash. |
 * | **Infrastructure error** | RPC, timeout, budget | "This didn't reach the network." Never a refusal. |
 *
 * Plus success, which the database enum has and the table does not.
 *
 * ## `refused_by_limen` has no evidence field, and that is the design
 *
 * §4.4: *"row two never borrows row three's badge"*. Here that is not a
 * convention for a renderer to honour — the `refused_by_limen` arm of this
 * union **has no `evidence` property at all**, so no code path can put a hash
 * on one, and no renderer can find one to show. `design-system.test.ts` pins the
 * same distinction on the client at exactly four verdict states; this is the
 * server-side half, and `test/tools.test.ts` asserts the absence directly.
 *
 * ## A network refusal with no hash has to say why
 *
 * A boundary refusal usually fails the enforcing simulation, which produces no
 * transaction and therefore no hash. `payment.ts` goes to some trouble to get
 * such an attempt onto a ledger anyway — that is what `submitWithBorrowedFootprint`
 * is for — but it can fail to, and then the honest report is *the network
 * refused, in simulation, and there is no hash*. The union splits that arm in
 * two so the second form cannot be constructed without stating the reason: a
 * missing hash is a finding, not a blank field.
 */

import type { LedgerWould } from '../policy/gate.js';

/** A transaction anyone can look up. The thing that makes a refusal checkable. */
export interface Evidence {
  hash: string;
  /** The transaction's own status word, e.g. `FAILED`, `SUCCESS`. */
  status: string;
  /** `invokeHostFunctionTrapped` and friends. */
  opResult: string;
}

export type ToolResult =
  | {
      outcome: 'succeeded';
      summary: string;
      data: Record<string, unknown>;
      evidence: Evidence | null;
    }
  | {
      outcome: 'refused_by_limen';
      summary: string;
      constraint: string;
      /** §4.4's requirement: a Limen refusal states what the ledger would have done. */
      ledgerWould: LedgerWould;
      /** Said out loud, in every one of these, so a reader never has to infer it. */
      reachedLedger: false;
    }
  | {
      outcome: 'refused_by_network';
      summary: string;
      codes: number[];
      /** The refusal came from the boundary itself, rather than from the token. */
      boundaryRefusal: boolean;
      revokedRule: boolean;
      evidence: Evidence;
    }
  | {
      outcome: 'refused_by_network';
      summary: string;
      codes: number[];
      boundaryRefusal: boolean;
      revokedRule: boolean;
      evidence: null;
      /** Required by the type. A refusal with no hash states why there is none. */
      whyNoEvidence: string;
    }
  | { outcome: 'infra_error'; summary: string; stage: string }
  | { outcome: 'agent_error'; summary: string; detail: string };

/** True when the result carries a transaction anyone can look up. */
export function hasEvidence(
  result: ToolResult,
): result is Extract<ToolResult, { evidence: Evidence }> {
  return 'evidence' in result && result.evidence !== null;
}
