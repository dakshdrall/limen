/**
 * The subpath the client imports: `@limen/chain/browser`.
 *
 * Two things this entry point is for, and it is worth separating them because
 * only one of them is about bundle size.
 *
 * **It is a boundary, not a bundle trick.** Everything reachable from here is
 * asserted — on source, and at runtime against the SDK's browser build with
 * `globalThis.Buffer` deleted — to use no `Buffer`, no `node:` import, and no
 * `process`. `test/browser-bundle.test.ts` is what makes that a fact rather
 * than an intention. `index.ts` carries no such promise: `events.ts` and
 * anything else that grows a Node dependency stays reachable from there and
 * unreachable from here.
 *
 * **It keeps `lower` cheap.** `api/lower/route.ts` used to exist "purely to
 * keep the Stellar SDK — which `@limen/chain`'s index pulls in — out of the
 * browser bundle." V4 ends that arrangement, because there is no signing
 * without the SDK in the browser. But the landing and the read-only screens
 * still should not pay for it: `lower` and the plan types are re-exported from
 * `./lower` and `./plan` directly, both of which import nothing from the SDK,
 * so a screen that only lowers a proposal pulls in neither this module nor the
 * SDK. Screens that write use a dynamic `import()` of this module.
 *
 * There is no mainnet passphrase anywhere in this graph, and CI greps the built
 * client bundle to prove it.
 */

export { TESTNET_PASSPHRASE, DEFAULT_TESTNET_RPC_URL, FRIENDBOT_URL, type SupportedPassphrase } from './network.js';

export { concatBytes, fromHex, rawEd25519FromAddress, scvBytes, sha256, toHex } from './bytes.js';

export {
  MAX_POLICIES_PER_RULE,
  MAX_RULE_NAME_BYTES,
  NotEnforceableError,
  SPENDING_LIMIT_ENFORCED_FN,
  type InstallPlan,
  type NotEnforceableCode,
  type PlannedContextRule,
  type PlannedPolicy,
} from './plan.js';

export { lower, type LowerOptions } from './lower.js';

export {
  BOUNDARY_REFUSAL_CODES,
  CONTRACT_ERRORS,
  REVOKED_RULE_CODES,
  SMART_ACCOUNT_ERRORS,
  SPENDING_LIMIT_ERRORS,
  describeContractError,
  isBoundaryRefusal,
  isRevokedRule,
} from './errors.js';

export {
  authDigest,
  authPayload,
  callContractType,
  delegatedSigner,
  externalSigner,
  i128,
  spendingLimitParams,
  structMap,
  type SignerSignature,
} from './authpayload.js';

export {
  ContractReadError,
  isLive,
  readAllContextRules,
  readContextRule,
  readContextRuleCount,
  readSpendingLimit,
  type InstalledContextRule,
  type InstalledSigner,
  type InstalledSpendingLimit,
  type ReadOptions,
} from './read.js';

export {
  deployAccountFunction,
  deployAccountOperation,
  deployedContractAddress,
  ownerSignerScVal,
  randomSalt,
  type DeployAccountOptions,
  type OwnerSigner,
} from './deploy.js';

export {
  addContextRuleFunction,
  contextRuleIdFrom,
  installFunctions,
  type InstallContext,
} from './install.js';

export { removeContextRuleFunction, removePolicyFunction } from './revoke.js';

export {
  invokeContract,
  nativeTokenId,
  transferFunction,
  type TransferOptions,
} from './token.js';

export {
  assertDistinctSigners,
  assertTestnet,
  signAs,
  type Ed25519Signer,
  type SignAuthEntryOptions,
} from './sign.js';

export {
  contractErrorCodes,
  enforcingFootprint,
  opResultName,
  reachedLedger,
  recordAuthEntries,
  simulationErrorCode,
  submitAuthorized,
  submitWithBorrowedFootprint,
  waitForTransaction,
  type AuthEntrySigner,
  type BorrowedFootprintOptions,
  type EnvelopeSigner,
  type SubmitOptions,
  type SubmitResult,
} from './submit.js';
