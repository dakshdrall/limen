/**
 * The testnet runs this repository has actually recorded.
 *
 * `packages/chain/deployments/testnet.json` is the evidence file: every hash in
 * it was produced against live testnet and is checkable in an explorer. This
 * module types it and looks things up. It adds nothing.
 *
 * That last sentence is the whole design constraint. The refusal evidence is the
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
 *
 * ## What the V6 rebuild changed
 *
 * The typed accessors over the deployments file survived, because they encode
 * something learned — chiefly the attribution gates below, which exist so that
 * one rule's transactions can never appear on another rule's screen.
 *
 * What did not survive was shape. V5 exported selectors built for one page's
 * worked example, and carrying those forward would have let the old page's
 * structure dictate the new one's. They were deleted and the ones below were
 * derived from what the six V6 scenes actually need. Three of them cover the
 * same blocks of the recording as before — there are only so many runs in the
 * file — but they are typed to the scene that reads them and documented against
 * it, rather than inherited.
 *
 * The one structural change is `RECORDED_REVOCATION`, which now carries
 * `permittedAmount` and both post-revoke flags as required fields. Scene 6 turns
 * on the distinction those encode, and a scene that must render a field is a
 * scene whose type should not let it forget.
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
  /** The rule the five long-lived axes were attempted against. */
  liveRuleInstallTx: string;
  /** The short-lived rule the expiry axis needed. */
  shortRuleInstallTx: string;
  axes: RecordedAxis[];
}

export interface RecordedWalkthrough {
  smartAccount: string;
  contextRuleId: number;
  cap: string;
  windowLedgers: number;
  token: string;
  /** The key the boundary was installed *for*. Not held by this application. */
  agentSigner: string;
  /** The key that signed the install. Also not held by this application. */
  ownerSigner: string;
  installTx: string;
  permittedTx: string;
  rejectedTx: string;
  rejectedError: string;
}

/**
 * The one derivation that started from a transaction observed on a live network
 * rather than from a shipped fixture.
 *
 * Scene 3's evidence — the scene that claims the boundary is read off what
 * happened rather than configured. `observedAmount` and `derivedCap` are both
 * required because the scene's entire point is that they are equal, and a type
 * that let one be absent would let the page make the claim with half the
 * evidence.
 *
 * `installedSeparately` is the seam, and it is required for the same reason:
 * this transaction was observed and derived from, and the recorded install was
 * built by the script from the same parameters — the two halves were not run in
 * one pass. Any component rendering this must render that field too.
 */
export interface RecordedDerivation {
  producedBy: string;
  hash: string;
  ledger: number;
  token: string;
  function: string;
  /** The outflow the transaction actually moved, in smallest units. */
  observedAmount: string;
  /** What `synthesize` derived from it. Equal to the above; that is the claim. */
  derivedCap: string;
  installedSeparately: string;
}

/**
 * The revoke sequence, from the acceptance run.
 *
 * Scene 6's evidence. Two things this type is careful about.
 *
 * It is a *subset*. `v4ChainRun` records eleven transactions and these are the
 * ones the revoke sequence needs. Typing the whole block would say the scene
 * reads it all; typing these says which.
 *
 * It is a different run from `RECORDED_RUN`, on a different account, and any
 * component rendering it has to say so. That is why `smartAccount`, `producedBy`
 * and `ranAt` are required rather than optional: two accounts' hashes in one
 * column read as one account's unless the page states otherwise.
 *
 * `permittedAmount` is required because scene 6 turns on it. The permitted
 * transfer deliberately spent less than the cap, which is the only reason the
 * post-revoke failure can be attributed to the rule being gone rather than to
 * the limit being reached. A scene that shows the last row without that number
 * is asking to be believed rather than showing its working.
 */
export interface RecordedRevocation {
  producedBy: string;
  ranAt: string;
  smartAccount: string;
  contextRuleId: number;
  derivedCap: string;
  windowLedgers: number;
  /** The agent spending inside the cap. The call the last step repeats. */
  permittedTx: string;
  /** Deliberately less than the cap. See above. */
  permittedAmount: string;
  /** The agent's own attempt to remove its boundary, refused by the contract. */
  agentRevokeTx: string;
  agentRevokeError: string;
  agentRevokeNote: string;
  /** The owner removing it, which the contract does permit. */
  revokeTx: string;
  /** Re-read from the chain after the write, not assumed. */
  rulesAfterRevoke: number[];
  rulesAfterRevokeNote: string;
  /** The permitted call, repeated. It now fails, and fails differently. */
  postRevokeTx: string;
  postRevokeError: string;
  /**
   * Both recorded, and both rendered. `ContextRuleNotFound#3000` is deliberately
   * absent from `BOUNDARY_REFUSAL_CODES` — "the boundary refused you" and "the
   * boundary is gone" are different claims — so the scene reads these rather
   * than deciding for itself which verdict the last row gets.
   */
  postRevokeIsBoundaryRefusal: boolean;
  postRevokeIsRevokedRule: boolean;
}

/** The verifier and policy contracts every account in this repository shares. */
export interface SharedContracts {
  ed25519Verifier: { contract: string; deployTx: string };
  webauthnVerifier: { contract: string; deployTx: string };
  spendingLimitPolicy: { contract: string; deployTx: string };
}

const walkthrough = recorded.walkthrough as RecordedWalkthrough;
const survey = recorded.denyAxisSurvey as RecordedSurvey;

/** The account every recorded run in this repository was made against. */
export const RECORDED_ACCOUNT = walkthrough.smartAccount;

/**
 * The recorded run itself, for prose that describes it.
 *
 * Deliberately separate from `walkthroughFor`, which gates on account *and*
 * rule id so that one rule's transactions never appear on another rule's
 * screen. That gate is about attribution: a screen showing a specific rule must
 * not borrow another rule's evidence. A scene describing the one run this
 * repository recorded, by name, as the worked example is not showing a rule —
 * naming it is the whole point, so the gate would have nothing to protect.
 */
export const RECORDED_RUN: RecordedWalkthrough = walkthrough;

/** Scene 3's evidence. See `RecordedDerivation`. */
export const RECORDED_DERIVATION = recorded.liveDerivation as RecordedDerivation;

/** Scene 6's evidence. See `RecordedRevocation`. */
export const RECORDED_REVOCATION = recorded.v4ChainRun as RecordedRevocation;

/** Scene 5's evidence, account-level. See `surveyFor`. */
export const RECORDED_SURVEY: RecordedSurvey = survey;

/**
 * The deployed verifier and policy contracts.
 *
 * An agent's key is registered as `External(ed25519Verifier, pubkey)`, so the
 * verifier's address is something a person wiring one up actually has to type.
 * Read from the deployments file rather than repeated in prose, because a
 * contract address transcribed by hand into documentation is a contract address
 * that will eventually be wrong.
 */
export const SHARED_CONTRACTS = recorded.shared as SharedContracts;

/** When the most recent run in the recording was made. */
export const RECORDED_AT = recorded.recordedAt;

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
