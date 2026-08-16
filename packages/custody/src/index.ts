/**
 * @limen/custody — the key Limen holds, and what wraps it.
 *
 * **At M1 this package contains the wrapping and none of the holding.** There
 * is no keygen here, no signer, and no seed: those are M2, and they land behind
 * fences that already exist rather than arriving with their own. That ordering
 * is the whole of PLAN-V8 B4's lesson — the tripwire in
 * `local-key-label.test.ts` discovers its scan roots, so this directory came
 * under every fence in the repository on the day it was created, and
 * `TESTNET ONLY · AGENT KEY (LIMEN-HELD)` was in the closed label set before
 * there was anything here to label.
 *
 * Server-only by construction: it imports `node:crypto`. Nothing in `apps/web`
 * may import it from a client component, and the CI bundle grep is what proves
 * that rather than the import graph being trusted.
 */

export type { KeyProvider, WrappedKey } from './key-provider.js';
export { WrongKeyProviderError } from './key-provider.js';
export { EnvMasterKeyProvider, type EnvMasterKeyOptions } from './env-master-key.js';
export { resolveKeyProvider, MASTER_KEY_ENV } from './provider.js';
