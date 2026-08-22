/**
 * @limen/custody — the key Limen holds, and what wraps it.
 *
 * **M2 added the holding to M1's wrapping.** The ordering it arrived in is the
 * whole of PLAN-V8 B4's lesson and it worked exactly as intended: the tripwire
 * in `local-key-label.test.ts` discovers its scan roots, so this directory came
 * under every fence in the repository on the day it was created, and
 * `TESTNET ONLY · AGENT KEY (LIMEN-HELD)` was in the closed label set before
 * there was anything here to label. When `agent-key.ts` landed, the label it
 * had to carry already existed and the scan was already pointed at it.
 *
 * It also produced the collision B4 predicted and did not resolve. The
 * generation scan required *the local key's* label on any file that makes a
 * keypair, and this package makes one that is not a local key — so satisfying
 * the fence as written would have meant stating, in the one place a reader
 * looks to find out where a key lives, that a server-held key is in their
 * browser. The scan is now location-aware: a browser tree must carry
 * `LOCAL_KEY_LABEL`, `packages/custody/src` must carry `AGENT_KEY_LABEL`, and
 * neither satisfies the other. Both fences stay load-bearing and neither states
 * something false.
 *
 * Server-only by construction: it imports `node:crypto`. Nothing in `apps/web`
 * may import it from a client component, and the CI bundle grep is what proves
 * that rather than the import graph being trusted.
 */

export {
  AGENT_KEY_ALGORITHM,
  generateAgentKey,
  withAgentKey,
  type GeneratedAgentKey,
  type OpenAgentKey,
  type SealedAgentKey,
} from './agent-key.js';
export type { KeyProvider, WrappedKey } from './key-provider.js';
export { WrongKeyProviderError } from './key-provider.js';
export { EnvMasterKeyProvider, type EnvMasterKeyOptions } from './env-master-key.js';
export { resolveKeyProvider, MASTER_KEY_ENV } from './provider.js';
