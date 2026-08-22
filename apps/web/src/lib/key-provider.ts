/**
 * The web app's handle on the key provider. One per process, resolved lazily.
 *
 * This module constructs nothing. `@limen/custody`'s `resolveKeyProvider` is
 * the only function in the repository that builds a `KeyProvider`, and
 * `packages/custody/test/single-construction-site.test.ts` scans every
 * workspace to prove no second construction site appears — including this one.
 * So this file calls that function and caches what it returns, which is a
 * different thing from having an opinion about which provider to use.
 *
 * ## Why lazily, and not at import
 *
 * `resolveKeyProvider` throws when the master key is missing, which is correct:
 * a process that cannot wrap a key should not pretend it can. Resolving at
 * import time would turn that into a module-load failure in every route that
 * transitively imports `stores.ts` — including the ones that never touch a key,
 * like listing agents or logging in. A deployment with a missing variable would
 * present as the whole application being down rather than as deployment being
 * unavailable, and the second is both truer and easier to act on.
 *
 * So it is resolved the first time a key is actually needed, cached after that,
 * and the throw reaches the one route that asked.
 *
 * ## Server-only, and the import is what enforces it
 *
 * `server-only` at the top means a client component importing this — directly
 * or through a chain of re-exports — is a build error rather than a bundle that
 * quietly ships the path to a master key. The CI bundle grep is the second
 * layer; this is the first, and it fails earlier and more clearly.
 */

import 'server-only';
import { resolveKeyProvider, type KeyProvider } from '@limen/custody';

let cached: KeyProvider | undefined;

/**
 * The provider this deployment uses.
 *
 * Cached rather than resolved per call because resolving decodes and validates
 * the master key, and a route that seals one key would otherwise do that work
 * on every request. The provider holds the key in a private field and exposes
 * no way to read it back, so caching the object does not widen its reach beyond
 * what one resolution already does.
 */
export function keyProvider(): KeyProvider {
  cached ??= resolveKeyProvider();
  return cached;
}
