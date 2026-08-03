/**
 * The testnet runs this repository has actually recorded.
 *
 * `packages/chain/deployments/testnet.json` is the evidence file: every hash in
 * it was produced by a script against live testnet and is checkable in an
 * explorer. This module types it and looks things up. It adds nothing.
 *
 * That last sentence is the whole design constraint. The refusal screen is the
 * product, and the thing that makes it worth anything is that its rows are
 * transcribed rather than assembled. So:
 *
 * - Nothing here synthesizes a row, fills a missing hash, or infers which
 *   context rule an attempt was made under when the recording does not say.
 * - The deny-axis survey records *which account* it ran against and, in prose,
 *   which rules it used. It does not carry a rule id per row. So it is offered
 *   as account-level evidence with its own note attached, and never as "this
 *   rule refused these six things" — which would be a stronger claim than the
 *   file supports.
 * - The walkthrough *does* record its context rule id, so its permitted and
 *   rejected pair is matched exactly and shown only on that rule's screen.
 *
 * A screen with no recorded evidence gets an empty state saying so. An absent
 * refusal is not a weaker refusal; it is no refusal, and it must read that way.
 */

import recorded from '../../../../packages/chain/deployments/testnet.json';

export interface RecordedAxis {
  axis: string;
  /** What was attempted, in the recording's own words. */
  attempt: string;
  /** The error simulation reported. */
  sim: string;
  /**
   * The error decoded from the submitted transaction's diagnostic events, or
   * the recording's note about why it could not be decoded. The expiry axis is
   * the latter case: it reached a ledger and failed there, but the run's
   * diagnostic scan did not recover the contract code, so only the simulation
   * error is attributable.
   */
  ledger: string;
  /** Present when the attempt reached a ledger. */
  hash?: string;
}

export interface RecordedSurvey {
  note: string;
  axes: RecordedAxis[];
}

export interface RecordedWalkthrough {
  smartAccount: string;
  contextRuleId: number;
  cap: string;
  windowLedgers: number;
  token: string;
  installTx: string;
  permittedTx: string;
  rejectedTx: string;
  rejectedError: string;
}

const walkthrough = recorded.walkthrough as RecordedWalkthrough;
const survey = recorded.denyAxisSurvey as RecordedSurvey;

/** The account every recorded run in this repository was made against. */
export const RECORDED_ACCOUNT = walkthrough.smartAccount;

/**
 * The permitted/rejected pair, for the one rule it was recorded against.
 *
 * Returns `undefined` for every other rule and every other account rather than
 * falling back to "the recorded run" — showing rule 5's transactions on rule 4's
 * screen would be exactly the mislabelling this whole layer exists to avoid.
 */
export function walkthroughFor(contractId: string, ruleId: number): RecordedWalkthrough | undefined {
  if (contractId !== walkthrough.smartAccount) return undefined;
  if (ruleId !== walkthrough.contextRuleId) return undefined;
  return walkthrough;
}

/**
 * The deny-axis survey, for the account it ran against.
 *
 * Account-level on purpose — see the header. The caller is responsible for
 * rendering `note`, which is where the recording says which rules were used.
 */
export function surveyFor(contractId: string): RecordedSurvey | undefined {
  return contractId === walkthrough.smartAccount ? survey : undefined;
}
