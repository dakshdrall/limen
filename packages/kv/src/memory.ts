/**
 * The process-local store, kept deliberately and fenced deliberately.
 *
 * This is the old behaviour of `rate-limit.ts` and `tx-cache.ts`, preserved as
 * an explicit implementation rather than as a default that happens when
 * configuration is missing. That distinction is the entire point of this file:
 *
 * > A fallback that silently reinstates process-local counters has not retired
 * > the `TODO(roadmap)`. It has moved it somewhere harder to find.
 *
 * So it exists, it is honest about what it is (`shared: false`), it is the
 * right thing for a test and for `next dev`, and `resolveKeyValue` **refuses to
 * return it in production**. In production it is Redis or the process does not
 * start — which is what makes "shared state" a property of the deployment
 * rather than an aspiration in a comment.
 *
 * ## Bounded, because an unbounded map is a slower kind of outage
 *
 * The original rate limiter swept expired windows once the map passed 4,096
 * keys, and the original transaction cache evicted oldest-first at 256 entries.
 * Both bounds are kept: this runs in a long-lived worker during local
 * development, and a map that grows with distinct keys forever is a memory leak
 * with a schedule.
 */

import type { KeyValue } from './kv.js';

interface Entry {
  value: string;
  /** Epoch millis, or `undefined` for no expiry. */
  expiresAt: number | undefined;
}

export interface MemoryKeyValueOptions {
  /** Above this, expired entries are swept and then the oldest are dropped. */
  maxKeys?: number;
  /** Injectable so window expiry can be tested without waiting. */
  now?: () => number;
}

export class MemoryKeyValue implements KeyValue {
  readonly id = 'memory' as const;
  readonly shared = false;

  readonly #entries = new Map<string, Entry>();
  readonly #maxKeys: number;
  readonly #now: () => number;

  constructor({ maxKeys = 4096, now = Date.now }: MemoryKeyValueOptions = {}) {
    this.#maxKeys = maxKeys;
    this.#now = now;
  }

  #live(key: string): Entry | undefined {
    const entry = this.#entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt !== undefined && entry.expiresAt <= this.#now()) {
      this.#entries.delete(key);
      return undefined;
    }
    return entry;
  }

  /** Opportunistic, so the map cannot grow without bound across a long process life. */
  #bound(): void {
    if (this.#entries.size <= this.#maxKeys) return;
    const now = this.#now();
    for (const [key, entry] of this.#entries) {
      if (entry.expiresAt !== undefined && entry.expiresAt <= now) this.#entries.delete(key);
    }
    // Still over: drop oldest-first. `Map` iterates in insertion order, and
    // `get` re-inserts, so this is least-recently-used.
    while (this.#entries.size > this.#maxKeys) {
      const oldest = this.#entries.keys().next();
      if (oldest.done === true) break;
      this.#entries.delete(oldest.value);
    }
  }

  get(key: string): Promise<string | null> {
    const entry = this.#live(key);
    if (entry === undefined) return Promise.resolve(null);
    // Re-insert so recently used entries are evicted last.
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return Promise.resolve(entry.value);
  }

  set(key: string, value: string, options?: { ttlSeconds?: number }): Promise<void> {
    this.#entries.delete(key);
    this.#entries.set(key, {
      value,
      expiresAt: options?.ttlSeconds === undefined ? undefined : this.#now() + options.ttlSeconds * 1000,
    });
    this.#bound();
    return Promise.resolve();
  }

  del(key: string): Promise<void> {
    this.#entries.delete(key);
    return Promise.resolve();
  }

  incrementInWindow(key: string, ttlSeconds: number): Promise<number> {
    const entry = this.#live(key);
    if (entry === undefined) {
      // First in the window: create it *and* set the expiry, which is the half
      // a naive implementation forgets and which turns a fixed window into a
      // counter that never resets.
      this.#entries.set(key, { value: '1', expiresAt: this.#now() + ttlSeconds * 1000 });
      this.#bound();
      return Promise.resolve(1);
    }
    const next = Number(entry.value) + 1;
    // Expiry deliberately untouched: the window started when the first request
    // in it arrived, not when the most recent one did.
    entry.value = String(next);
    return Promise.resolve(next);
  }

  /** Test seam. Never called by a route. */
  clear(): void {
    this.#entries.clear();
  }
}
