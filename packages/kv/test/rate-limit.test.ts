/**
 * The limiter, the cache, and the refusal that retires the `TODO(roadmap)`.
 *
 * These run against `MemoryKeyValue`, which is the right choice here and not a
 * compromise: what is under test is the *algorithm* — when a budget is
 * exceeded, how namespaces are kept apart, what happens when the store is
 * broken — and `contract.test.ts` is what proves the two stores agree about the
 * primitives underneath.
 */

import { describe, expect, it } from 'vitest';
import type { KeyValue } from '../src/kv.js';
import { MemoryKeyValue } from '../src/memory.js';
import { createRateLimit } from '../src/rate-limit.js';
import { createTxCache } from '../src/tx-cache.js';
import { resolveWebKeyValue, UPSTASH_TOKEN_ENV, UPSTASH_URL_ENV } from '../src/resolve.js';

describe('the rate limit', () => {
  it('permits up to the budget and refuses past it', async () => {
    const limit = createRateLimit({ kv: new MemoryKeyValue(), max: 3, windowMs: 1_000, namespace: 'test' });
    expect(await limit.check('ip')).toBe(false);
    expect(await limit.check('ip')).toBe(false);
    expect(await limit.check('ip')).toBe(false);
    expect(await limit.check('ip')).toBe(true);
  });

  it('counts each key separately', async () => {
    const limit = createRateLimit({ kv: new MemoryKeyValue(), max: 1, windowMs: 1_000, namespace: 'test' });
    expect(await limit.check('a')).toBe(false);
    expect(await limit.check('b')).toBe(false);
    expect(await limit.check('a')).toBe(true);
  });

  it('keeps two limiters apart even when they share a store', async () => {
    // The bug this prevents presents as "the API is randomly refusing me" and
    // is invisible in either module: six limiters with different budgets share
    // one Redis, and two colliding on a key would enforce the tighter of the
    // two on both.
    const kv = new MemoryKeyValue();
    const strict = createRateLimit({ kv, max: 1, windowMs: 1_000, namespace: 'strict' });
    const loose = createRateLimit({ kv, max: 5, windowMs: 1_000, namespace: 'loose' });

    expect(await strict.check('ip')).toBe(false);
    expect(await strict.check('ip')).toBe(true);
    // The loose limiter has seen nothing, despite the same key and the same store.
    expect(await loose.check('ip')).toBe(false);
    expect(await loose.check('ip')).toBe(false);
  });

  it('refuses to be constructed without a namespace', () => {
    expect(() =>
      createRateLimit({ kv: new MemoryKeyValue(), max: 1, windowMs: 1_000, namespace: '' }),
    ).toThrow(/namespace/);
  });

  it('fails open when the store is unreachable, and says so', async () => {
    // The one place in this repository where a fence fails open, asserted so
    // that it is a decision rather than a discovery. A Redis outage must not
    // take down every public endpoint, and what is being protected is a cost
    // ceiling rather than a security boundary.
    const broken: KeyValue = {
      id: 'memory',
      shared: false,
      get: () => Promise.reject(new Error('down')),
      set: () => Promise.reject(new Error('down')),
      del: () => Promise.reject(new Error('down')),
      incrementInWindow: () => Promise.reject(new Error('down')),
    };
    const seen: unknown[] = [];
    const limit = createRateLimit({
      kv: broken,
      max: 1,
      windowMs: 1_000,
      namespace: 'test',
      onError: (error) => seen.push(error),
    });

    expect(await limit.check('ip')).toBe(false);
    // And it is not silent. A limiter that has stopped limiting is
    // indistinguishable from one that is working until somebody floods it.
    expect(seen).toHaveLength(1);
  });
});

describe('the transaction cache', () => {
  it('misses, then hits', async () => {
    const cache = createTxCache<{ hash: string }>({ kv: new MemoryKeyValue() });
    expect(await cache.get('abc')).toBeUndefined();
    await cache.put('abc', { hash: 'abc' });
    expect((await cache.get('abc'))?.hash).toBe('abc');
  });

  it('does not collide with a rate limit key', async () => {
    const kv = new MemoryKeyValue();
    const cache = createTxCache<{ hash: string }>({ kv });
    const limit = createRateLimit({ kv, max: 1, windowMs: 1_000, namespace: 'test' });
    await cache.put('ip', { hash: 'ip' });
    expect(await limit.check('ip')).toBe(false);
    expect((await cache.get('ip'))?.hash).toBe('ip');
  });

  it('reports a broken store rather than swallowing it', async () => {
    const broken: KeyValue = {
      id: 'memory',
      shared: false,
      get: () => Promise.reject(new Error('down')),
      set: () => Promise.reject(new Error('down')),
      del: () => Promise.reject(new Error('down')),
      incrementInWindow: () => Promise.reject(new Error('down')),
    };
    const seen: unknown[] = [];
    const cache = createTxCache<{ hash: string }>({ kv: broken, onError: (error) => seen.push(error) });

    // A cache miss and a broken cache produce the same answer — go and fetch it
    // — but only one is worth waking somebody for.
    expect(await cache.get('abc')).toBeUndefined();
    expect(seen).toHaveLength(1);
  });
});

describe('the fallback is fenced, which is what retires the TODO', () => {
  it('uses the shared store when it is configured', () => {
    const kv = resolveWebKeyValue({
      [UPSTASH_URL_ENV]: 'https://example.upstash.io',
      [UPSTASH_TOKEN_ENV]: 'token',
    } as NodeJS.ProcessEnv);
    expect(kv.id).toBe('upstash');
    expect(kv.shared).toBe(true);
  });

  it('falls back to a process-local store outside production, honestly', () => {
    const kv = resolveWebKeyValue({ NODE_ENV: 'development' } as NodeJS.ProcessEnv);
    expect(kv.id).toBe('memory');
    // The half that matters: it does not claim to be shared.
    expect(kv.shared).toBe(false);
  });

  it('treats a Vercel preview as not-production, because NODE_ENV cannot tell', () => {
    // Vercel sets NODE_ENV=production for preview builds too — they are
    // production *builds*, which is a different claim from production
    // *deployment*. Keying off NODE_ENV would mean every preview refused to
    // serve until Upstash existed, and previews are where this project does
    // most of its testing.
    const kv = resolveWebKeyValue({ NODE_ENV: 'production', VERCEL_ENV: 'preview' } as NodeJS.ProcessEnv);
    expect(kv.id).toBe('memory');
    expect(kv.shared).toBe(false);
  });

  it('refuses on a Vercel production deployment', () => {
    expect(() =>
      resolveWebKeyValue({ NODE_ENV: 'production', VERCEL_ENV: 'production' } as NodeJS.ProcessEnv),
    ).toThrow(/Refusing to fall back/);
  });

  it('refuses to fall back in production', () => {
    // This assertion is the retirement. Reproducing the old default — silently
    // process-local when nothing is configured — would have deleted the comment
    // and kept the problem: the limit would still be per-instance, and there
    // would no longer be a `TODO(roadmap)` saying so.
    expect(() => resolveWebKeyValue({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(
      /Refusing to fall back to a process-local store/,
    );
  });

  it('says why it refused, in terms of what actually goes wrong', () => {
    try {
      resolveWebKeyValue({ NODE_ENV: 'production' } as NodeJS.ProcessEnv);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as Error).message).toContain('per instance rather than in total');
      expect((error as Error).message).toContain('retire the comment rather than the problem');
    }
  });
});
