/**
 * The web app's binding to the shared transaction cache.
 *
 * The store moved to `@limen/kv` in V8 M1, retiring this module's
 * `TODO(roadmap)`:
 *
 * > **TODO(roadmap): shared state**, alongside the rate limiter and the
 * > waitlist store. Process-local means a cold start begins empty and two
 * > instances do not share work.
 *
 * On Vercel that made the cache close to useless in practice — the instance
 * holding an entry was rarely the one handling the next request for it — so the
 * public testnet RPC was absorbing traffic a cache was nominally preventing.
 *
 * The property that made caching *safe* here is unchanged and is worth
 * restating, because it is the exception to a rule this project enforces
 * everywhere else: a confirmed Soroban transaction is immutable, so there is no
 * staleness question. `packages/db/src/schema.ts` forbids caching an installed
 * cap or whether a rule is live for precisely the opposite reason — those change
 * underneath you, and a cached copy is a claim about the past rendered as the
 * present.
 */

import type { ObservedTransaction } from '@limen/core';
import { createTxCache, MemoryKeyValue, resolveWebKeyValue } from '@limen/kv';

let store: ReturnType<typeof resolveWebKeyValue> | undefined;
let cache: ReturnType<typeof createTxCache<ObservedTransaction>> | undefined;

/** Lazy, for the same reason `rate-limit.ts` is: the build must not read the environment. */
function txCache() {
  store ??= resolveWebKeyValue();
  cache ??= createTxCache<ObservedTransaction>({
    kv: store,
    onError: (error) =>
      console.error(
        `limen tx-cache: store unavailable, falling through to RPC (${
          error instanceof Error ? error.message : 'unknown error'
        })`,
      ),
  });
  return cache;
}

export async function getCached(hash: string): Promise<ObservedTransaction | undefined> {
  return await txCache().get(hash);
}

export async function putCached(hash: string, observed: ObservedTransaction): Promise<void> {
  await txCache().put(hash, observed);
}

/**
 * Test seam. Never called by a route.
 *
 * Replaces the whole store rather than issuing a `FLUSHDB`, which is the only
 * safe way to spell this once the store might be shared: a test that could
 * empty a real Redis is a test that can empty a real Redis.
 */
export function clearCache(): void {
  store = new MemoryKeyValue();
  cache = undefined;
}
