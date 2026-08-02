import { describe, expect, it } from 'vitest';
import type { ObservedTransaction } from '@limen/core';
import { clientIp, createRateLimit } from '@/lib/rate-limit';
import { clearCache, getCached, putCached } from '@/lib/tx-cache';

describe('fixed-window rate limit', () => {
  it('permits up to max and refuses past it', () => {
    const limit = createRateLimit({ max: 3, windowMs: 1_000 });
    expect(limit.check('a', 0)).toBe(false);
    expect(limit.check('a', 0)).toBe(false);
    expect(limit.check('a', 0)).toBe(false);
    expect(limit.check('a', 0)).toBe(true);
  });

  it('meters each key independently', () => {
    const limit = createRateLimit({ max: 1, windowMs: 1_000 });
    expect(limit.check('a', 0)).toBe(false);
    expect(limit.check('b', 0)).toBe(false);
    expect(limit.check('a', 0)).toBe(true);
  });

  it('resets once the window has passed', () => {
    const limit = createRateLimit({ max: 1, windowMs: 1_000 });
    expect(limit.check('a', 0)).toBe(false);
    expect(limit.check('a', 500)).toBe(true);
    expect(limit.check('a', 1_001)).toBe(false);
  });
});

describe('client ip', () => {
  const withHeaders = (headers: Record<string, string>) =>
    new Request('http://localhost/', { headers });

  it('takes the first hop of x-forwarded-for', () => {
    expect(clientIp(withHeaders({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }))).toBe('203.0.113.9');
  });

  it('falls back to x-real-ip, then to a constant', () => {
    expect(clientIp(withHeaders({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4');
    expect(clientIp(withHeaders({}))).toBe('unknown');
  });
});

describe('transaction cache', () => {
  const tx = (hash: string): ObservedTransaction => ({
    hash,
    network: 'testnet',
    ledger: 1,
    source: 'G'.repeat(56),
    invocations: [{ contractId: 'C'.repeat(56), functionName: 'transfer', args: [] }],
    attribution: 'exact',
    movements: [],
  });

  it('returns what was put in, and undefined otherwise', () => {
    clearCache();
    expect(getCached('missing')).toBeUndefined();
    putCached('abc', tx('abc'));
    expect(getCached('abc')?.hash).toBe('abc');
  });

  it('evicts least-recently-used entries once full', () => {
    clearCache();
    // 256 is the cap; insert past it and prove the oldest untouched entry goes.
    for (let i = 0; i < 256; i++) putCached(`h${i}`, tx(`h${i}`));
    // Touch the oldest so it is no longer least-recently-used.
    expect(getCached('h0')).toBeDefined();
    putCached('overflow', tx('overflow'));

    expect(getCached('h0')).toBeDefined();
    expect(getCached('h1')).toBeUndefined();
    expect(getCached('overflow')).toBeDefined();
  });
});
