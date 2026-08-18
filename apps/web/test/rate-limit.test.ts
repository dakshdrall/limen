/**
 * What is left in `apps/web` once the limiter and the cache moved.
 *
 * V8 M1 lifted both algorithms into `@limen/kv`, along with the store they run
 * against, retiring the two `TODO(roadmap)`s that said they were process-local.
 * The assertions about *behaviour* moved with them and are now in
 * `packages/kv/test/` — where they run against a real Redis as well as the
 * in-memory implementation, which is a stronger test than either module could
 * have had while the store was a `Map` in this app.
 *
 * Three of the old assertions are gone rather than moved, and they are worth
 * naming so their absence is a decision:
 *
 *   - **the LRU eviction test.** The cache is bounded by a TTL now, not by an
 *     entry count. Redis has its own memory policy, so the bound that matters
 *     is time; `packages/kv` asserts the TTL is honoured, against a real Redis.
 *   - **the injected `now`.** `check` no longer takes a clock, because the
 *     window is Redis's `EXPIRE` and cannot be faked from the caller.
 *     `packages/kv/test/contract.test.ts` waits the window out for real, which
 *     is the only version of that test that can run against both stores.
 *   - **the synchronous assertions.** Every call is a round trip now.
 *
 * What stays here is what is genuinely about this app: reading a client address
 * out of an HTTP request, and the binding that hands the shared cache to the
 * ingest route.
 */

import { describe, expect, it } from 'vitest';
import type { ObservedTransaction } from '@limen/core';
import { clientIp } from '@/lib/rate-limit';
import { clearCache, getCached, putCached } from '@/lib/tx-cache';

describe('client ip', () => {
  const withHeaders = (headers: Record<string, string>) => new Request('http://localhost/', { headers });

  it('takes the first hop of x-forwarded-for', () => {
    expect(clientIp(withHeaders({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }))).toBe('203.0.113.9');
  });

  it('falls back to x-real-ip, then to a constant', () => {
    expect(clientIp(withHeaders({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4');
    expect(clientIp(withHeaders({}))).toBe('unknown');
  });
});

describe('the transaction cache binding', () => {
  const tx = (hash: string): ObservedTransaction => ({
    hash,
    network: 'testnet',
    ledger: 1,
    source: 'G'.repeat(56),
    invocations: [{ contractId: 'C'.repeat(56), functionName: 'transfer', args: [] }],
  });

  it('round-trips through the shared store', async () => {
    clearCache();
    expect(await getCached('missing')).toBeUndefined();
    await putCached('abc', tx('abc'));
    expect((await getCached('abc'))?.hash).toBe('abc');
  });

  it('survives a JSON round trip with its shape intact', async () => {
    // New, and the thing the old in-process cache could not get wrong: entries
    // are serialised now, so a field that does not survive `JSON.stringify`
    // would come back missing rather than being the same object reference.
    clearCache();
    const original = tx('def');
    await putCached('def', original);
    expect(await getCached('def')).toEqual(original);
  });
});
