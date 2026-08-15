/**
 * The contracts and endpoints the write path addresses, in the browser.
 *
 * A leaf module in the same sense `key-roles.ts` and `@limen/chain/network` are:
 * it imports two JSON files and one string constant, and nothing that reaches
 * the Stellar SDK. A screen that needs to *name* the verifier — `docs` renders
 * its address — must not pay for a signing library to do it.
 *
 * Every value here is transcribed from a file that records where it came from,
 * never typed in:
 *
 * - `wasm/manifest.json` records the OpenZeppelin tag, commit, and toolchain
 *   each wasm hash was built from, and states plainly that byte-for-byte
 *   reproducibility is not claimed.
 * - `deployments/testnet.json` records the deploy transaction for each shared
 *   contract, so every address below is checkable in an explorer.
 *
 * The wasm hash and the upload transaction hash are different things and are
 * kept apart deliberately: `manifest.contracts.account.wasmHash` is what
 * `createCustomContract` takes, and `deployments.uploads.account` is the
 * transaction that put it on the network. Passing the second where the first
 * belongs deploys nothing and fails in a way that reads like a network problem.
 */

import { DEFAULT_TESTNET_RPC_URL } from '@limen/chain/network';
import manifest from '../../../../packages/chain/src/wasm/manifest.json';
import deployments from '../../../../packages/chain/deployments/testnet.json';

/**
 * The RPC endpoint the browser talks to.
 *
 * `NEXT_PUBLIC_STELLAR_RPC_URL`, and deliberately not `SOROBAN_RPC_URL`. They
 * are two endpoints because they are two things: the server-side one may be a
 * keyed endpoint and the README promises it never reaches the browser, so the
 * two must not share a name that invites someone to "just expose it".
 *
 * PLAN-V4 §6: proxying simulate and send through a Limen route was considered
 * and rejected. It would put a Limen server in the write path — the one place
 * this project has said it will not be — and a general-purpose RPC proxy is an
 * open relay wearing a helpful hat. The consequence, stated rather than
 * discovered: no Limen rate limit applies to the write path, because no Limen
 * server is in it.
 *
 * Read at module scope because Next.js inlines `NEXT_PUBLIC_*` at build time;
 * there is no runtime lookup to defer.
 */
export const RPC_URL = process.env.NEXT_PUBLIC_STELLAR_RPC_URL ?? DEFAULT_TESTNET_RPC_URL;

/** Hex hash of the account wasm `createCustomContract` instantiates. */
export const ACCOUNT_WASM_HASH = manifest.contracts.account.wasmHash;

/** The ed25519 verifier every `External` signer in this repository names. */
export const ED25519_VERIFIER = deployments.shared.ed25519Verifier.contract;

/**
 * The WebAuthn verifier a passkey-owned account names instead.
 *
 * Deployed since V4 and unused until V7 §5. `deployments/testnet.json`'s
 * `webauthnRun` block is the first thing that signed through it, and records
 * what the contract actually requires — a 65-byte uncompressed key, an
 * XDR-encoded `WebAuthnSigData`, a low-S signature, and the User Verified bit.
 */
export const WEBAUTHN_VERIFIER = deployments.shared.webauthnVerifier.contract;

/** The `spending_limit` policy contract an installed boundary points at. */
export const SPENDING_LIMIT_POLICY = deployments.shared.spendingLimitPolicy.contract;

/**
 * Where the account wasm came from, for a screen that wants to say so.
 *
 * Rendered rather than kept for reference: "composition only" is a claim about
 * provenance, and a claim about provenance that cannot name its source is an
 * assertion. The tag and commit are the answer to "audited by whom, at what
 * version".
 */
export const WASM_SOURCE = {
  repository: manifest.source.repository,
  tag: manifest.source.tag,
  commit: manifest.source.commit,
} as const;
