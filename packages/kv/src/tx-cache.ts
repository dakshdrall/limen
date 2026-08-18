/**
 * Resolved transactions, by hash, shared.
 *
 * A confirmed Soroban transaction is immutable, so there is no staleness
 * question here — which is what makes this the one thing in this system that is
 * *safe* to cache. Contrast `packages/db/src/schema.ts`, which forbids caching
 * an installed cap or whether a rule is live: those change under you and a
 * cached copy is a claim about the past rendered as the present. A closed
 * transaction does not change.
 *
 * Replaces `apps/web/src/lib/tx-cache.ts`, whose `TODO(roadmap)` said the same
 * thing the rate limiter's did: process-local means a cold start begins empty
 * and two instances do not share work. On Vercel that made the cache close to
 * useless — the instance that had the entry was rarely the instance handling
 * the next request for it — so the upstream RPC was absorbing traffic a cache
 * was nominally there to prevent.
 *
 * ## Eviction is a TTL now, not an LRU bound
 *
 * The old implementation kept 256 entries and dropped the oldest. That bound
 * existed because a `Map` in a long-lived process grows forever; Redis has its
 * own memory policy, so the bound that matters here is *time*. A week is chosen
 * because the value is immutable and the only reason to expire it at all is to
 * stop paying to store transactions nobody is looking at any more.
 */

import type { KeyValue } from './kv.js';

/** A week. The value never changes; this only stops it being stored forever. */
const TTL_SECONDS = 7 * 24 * 60 * 60;

export interface TxCache<T> {
  get(hash: string): Promise<T | undefined>;
  put(hash: string, value: T): Promise<void>;
}

export interface TxCacheOptions {
  kv: KeyValue;
  /** Where a store failure is reported. Never swallowed. */
  onError?: (error: unknown) => void;
}

/**
 * Generic over the cached shape rather than importing `ObservedTransaction`.
 *
 * This package would otherwise depend on `@limen/core` for a type it only ever
 * round-trips through JSON. Keeping it generic means `@limen/kv` stays a store
 * and does not acquire an opinion about the domain — the same reason
 * `packages/shared` has no dependencies.
 */
export function createTxCache<T>({ kv, onError }: TxCacheOptions): TxCache<T> {
  return {
    async get(hash: string): Promise<T | undefined> {
      try {
        const raw = await kv.get(`tx:${hash}`);
        if (raw === null) return undefined;
        return JSON.parse(raw) as T;
      } catch (error) {
        // A cache miss and a broken cache produce the same answer here — go and
        // fetch it — but only one of them is worth waking somebody for, so they
        // are distinguished by reporting rather than by return value.
        onError?.(error);
        return undefined;
      }
    },

    async put(hash: string, value: T): Promise<void> {
      try {
        await kv.set(`tx:${hash}`, JSON.stringify(value), { ttlSeconds: TTL_SECONDS });
      } catch (error) {
        onError?.(error);
      }
    },
  };
}
