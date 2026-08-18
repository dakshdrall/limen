/**
 * Fixed-window rate limiting, per key, shared across every instance.
 *
 * The algorithm is unchanged from `apps/web/src/lib/rate-limit.ts`, which this
 * replaces. What changed is where the counter lives, and that changes what the
 * limit *means*:
 *
 *   - **Before.** A `Map` in one process. Vercel runs many, so "20 per five
 *     minutes" was enforced 20-per-instance — a bound that loosens exactly as
 *     fast as traffic arrives, which is the wrong direction for a rate limit,
 *     and one that reset on every redeploy. The module said so in a
 *     `TODO(roadmap)` and the README documented it.
 *   - **After.** One counter in Redis, incremented atomically. `INCR` settles
 *     the race that made a shared counter impossible to do correctly with
 *     read-then-write: N instances all reading 19 and all writing 20 is how a
 *     limit of 20 lets 20N through.
 *
 * ## `check` is async now, and that is a real change at the call sites
 *
 * Six route handlers call it. All were already `async`, so the change is one
 * `await` each — but it is a network round trip in front of every request to a
 * public endpoint, which is a cost worth naming rather than hiding. It is the
 * right trade: the endpoints being limited all make several RPC calls of their
 * own, so one more round trip is noise against what they already do, and an
 * unbounded flood against them is not.
 *
 * ## Failure is deliberately not silent, and deliberately not fatal
 *
 * If the store is unreachable, `check` returns `false` — the request proceeds —
 * and the failure is reported through `onError`. Fail-open rather than
 * fail-closed, because the alternative is a Redis outage taking down every
 * public endpoint in the application, and the thing being protected is a cost
 * ceiling rather than a security boundary. **This is the one place in this
 * repository where a fence fails open**, so it says so out loud rather than
 * being discovered: the security boundary is `__check_auth` on the account, and
 * nothing here is load-bearing for it.
 */

import type { KeyValue } from './kv.js';

export interface RateLimit {
  /** True when this call exceeds the budget and should be refused. */
  check(key: string): Promise<boolean>;
}

export interface RateLimitOptions {
  kv: KeyValue;
  max: number;
  windowMs: number;
  /**
   * Distinguishes one limiter from another in the shared store.
   *
   * Required rather than defaulted. Six limiters with different budgets share
   * one Redis, and two of them colliding on a key would silently enforce the
   * tighter of the two on both — a bug that presents as "the API is randomly
   * refusing me" and is invisible in either module.
   */
  namespace: string;
  /** Where a store failure is reported. Never swallowed. */
  onError?: (error: unknown) => void;
}

export function createRateLimit({ kv, max, windowMs, namespace, onError }: RateLimitOptions): RateLimit {
  if (namespace.length === 0) throw new Error('createRateLimit: namespace must not be empty.');
  const ttlSeconds = Math.ceil(windowMs / 1000);

  return {
    async check(key: string): Promise<boolean> {
      try {
        const count = await kv.incrementInWindow(`ratelimit:${namespace}:${key}`, ttlSeconds);
        return count > max;
      } catch (error) {
        // Named, never swallowed. A rate limiter that has silently stopped
        // limiting is indistinguishable from one that is working until
        // somebody floods it.
        onError?.(error);
        return false;
      }
    },
  };
}
