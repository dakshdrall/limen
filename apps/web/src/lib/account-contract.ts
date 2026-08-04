/**
 * The wire contract for `/api/account/[id]`, kept out of the route.
 *
 * Same split, and same reason, as `ingest-contract.ts`: the route imports the
 * Stellar SDK, and the screens need to know which failures mean "we could not
 * ask the chain" without dragging the SDK into the browser bundle.
 *
 * The distinction this file exists to preserve: **an account with no rules and
 * an account we could not read are different screens.** Rendering the second as
 * the first tells someone their boundary is gone when it may be intact — the
 * worst available failure for a permissions tool, and the same rule
 * `ContractReadError` enforces one layer down.
 */

export type AccountReadErrorCode =
  // the caller sent something that cannot be a smart account
  | 'bad_address'
  // the deployment cannot reach a chain at all
  | 'rpc_unconfigured'
  | 'simulation_source_unconfigured'
  // the chain was reached and would not answer
  | 'rpc_failed'
  | 'not_a_smart_account'
  // this caller is asking too often
  | 'rate_limited';

export interface AccountReadError {
  error: { code: AccountReadErrorCode; message: string; detail?: string };
}

/**
 * Codes meaning the deployment is not wired for live reads, as opposed to the
 * account being unreadable.
 *
 * A reviewer running this locally without an RPC endpoint should be told that
 * *this build* cannot look, not that *their account* is broken.
 */
export const UNCONFIGURED_CODES: ReadonlySet<AccountReadErrorCode> = new Set<AccountReadErrorCode>([
  'rpc_unconfigured',
  'simulation_source_unconfigured',
]);

/**
 * Whether a string could be a contract address, by shape alone.
 *
 * A shape check, not a checksum. `StrKey.isValidContract` verifies the CRC and
 * lives in the Stellar SDK, which is exactly what this module exists to keep
 * out of the browser — so this catches a pasted transaction hash or a `G…`
 * account immediately, and the route does the real validation. A form that
 * accepts an obviously wrong value and waits for a round trip to say so is
 * worse than one that says so as you type; a form that *claims* to have
 * validated it is worse than both.
 */
export function looksLikeContractAddress(value: string): boolean {
  return /^C[A-Z2-7]{55}$/.test(value);
}

/** A signer as the account holds it. Mirrors `InstalledSigner` in `@limen/chain`. */
export type SnapshotSigner =
  | { kind: 'External'; verifier: string; publicKey: string }
  | { kind: 'Delegated'; address: string };

export interface SnapshotPolicy {
  /** The policy contract attached to the rule. */
  contract: string;
  /**
   * What the policy contract currently holds for this rule, read from the
   * contract rather than from anything this app stored.
   */
  limit: { limit: string; periodLedgers: number; spentInWindow: string } | null;
  /**
   * Why `limit` is null, when it is. A policy contract that will not answer for
   * a rule is reported as unreadable rather than as having no limit — "no cap"
   * and "we could not read the cap" are opposite claims.
   */
  unreadable: string | null;
}

export interface SnapshotRule {
  id: number;
  name: string;
  contextType: 'Default' | 'CallContract' | 'CreateContract';
  /** The single contract this rule authorizes calls to, or null for `Default`. */
  contract: string | null;
  validUntilLedger: number | null;
  /** Liveness at `AccountSnapshot.ledger`, computed on the server from that ledger. */
  live: boolean;
  signers: SnapshotSigner[];
  policies: SnapshotPolicy[];
}

export interface AccountSnapshot {
  contractId: string;
  /**
   * The ledger this snapshot describes.
   *
   * Every liveness judgement in `rules` is relative to this number, and the
   * screen shows it. A boundary rendered without the ledger it was true at is a
   * claim about the present made from the past.
   */
  ledger: number;
  /** When the read was taken. Display only; never used to compute liveness. */
  readAt: string;
  rules: SnapshotRule[];
}
