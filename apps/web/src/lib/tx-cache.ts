/**
 * Resolved transactions, by hash, in memory.
 *
 * A confirmed Soroban transaction is immutable, so there is no staleness
 * question here — only eviction. Entries are dropped oldest-first once the map
 * is full.
 *
 * TODO(roadmap): shared state, alongside the rate limiter and the waitlist
 * store. Process-local means a cold start begins empty and two instances do not
 * share work. That is acceptable for an MVP whose upstream is a public testnet
 * RPC, and it is the option that survives a cold start with no new dependency.
 */

import type { ObservedTransaction } from '@limen/core';

const MAX_ENTRIES = 256;

const entries = new Map<string, ObservedTransaction>();

export function getCached(hash: string): ObservedTransaction | undefined {
  const hit = entries.get(hash);
  if (hit === undefined) return undefined;
  // Re-insert so recently used entries are evicted last.
  entries.delete(hash);
  entries.set(hash, hit);
  return hit;
}

export function putCached(hash: string, observed: ObservedTransaction): void {
  entries.delete(hash);
  entries.set(hash, observed);
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next();
    if (oldest.done === true) break;
    entries.delete(oldest.value);
  }
}

/** Test seam. Never called by the route. */
export function clearCache(): void {
  entries.clear();
}
