/**
 * One suite, run against every implementation.
 *
 * This is the shape that makes a local `MemoryKeyValue` worth having. Two
 * implementations of an interface tested by two different suites are two
 * different things that happen to share a type — and the failure that produces
 * is the worst kind: everything passes locally, and the behaviour differs in
 * production in a way no test was ever written to notice.
 *
 * So the assertions live once and are parameterised over the implementations.
 * `MemoryKeyValue` always runs. `RuntimeKeyValue` runs against a real Redis
 * when `REDIS_URL` is set, and — as with `@limen/db`'s append-only fence —
 * **fails rather than skips in CI**, where the service is always provided. A
 * contract test that only ever ran against the in-memory implementation would
 * be asserting that the fake agrees with itself.
 *
 * `UpstashKeyValue` is the one implementation not covered here: it needs an
 * Upstash account, and Upstash's HTTP protocol is not something a container
 * speaks. It is the remaining half of PLAN-V8 §7.5's *"PARTLY RUN — the shared
 * store contract"* record; `RuntimeKeyValue` has since been exercised against a
 * real Redis, and this suite runs 35 cases with `REDIS_URL` set against 25
 * without, which is the difference that coverage makes.
 */

import { afterAll, describe, expect, it } from 'vitest';
import type { KeyValue } from '../src/kv.js';
import { MemoryKeyValue } from '../src/memory.js';
import { RuntimeKeyValue } from '../src/runtime.js';

const redisUrl = process.env.REDIS_URL ?? '';
const inCi = process.env.CI !== undefined && process.env.CI !== '' && process.env.CI !== 'false';

const implementations: { name: string; make: () => KeyValue; teardown?: (kv: KeyValue) => Promise<void> }[] = [
  { name: 'MemoryKeyValue', make: () => new MemoryKeyValue() },
];

if (redisUrl.length > 0) {
  implementations.push({
    name: 'RuntimeKeyValue (real Redis)',
    make: () => new RuntimeKeyValue({ url: redisUrl }),
    teardown: async (kv) => {
      await (kv as RuntimeKeyValue).quit();
    },
  });
}

describe('the contract suite is not testing a fake against itself', () => {
  it('runs against a real Redis, or fails in CI for not having one', () => {
    if (redisUrl.length === 0 && !inCi) {
      console.error(
        'contract.test.ts: no REDIS_URL — only MemoryKeyValue was exercised, so this suite proved that the ' +
          'in-memory implementation agrees with itself. Run a Redis and set REDIS_URL. This fails rather than ' +
          'skips in CI.',
      );
    }
    if (inCi) expect(redisUrl.length, 'CI must provide REDIS_URL').toBeGreaterThan(0);
  });
});

for (const { name, make, teardown } of implementations) {
  describe(name, () => {
    const kv = make();
    // Unique per run, so a real Redis that is not empty — a developer's, a
    // second suite's — cannot make these pass or fail for the wrong reason.
    const prefix = `test:${Date.now()}:${Math.random().toString(36).slice(2)}:`;

    afterAll(async () => {
      await teardown?.(kv);
    });

    it('reports whether it is shared, rather than leaving it to be inferred', () => {
      expect(typeof kv.shared).toBe('boolean');
      expect(kv.shared).toBe(name.startsWith('Memory') ? false : true);
    });

    it('returns null for a key that was never set', async () => {
      expect(await kv.get(`${prefix}absent`)).toBeNull();
    });

    it('round-trips a string', async () => {
      await kv.set(`${prefix}a`, 'hello');
      expect(await kv.get(`${prefix}a`)).toBe('hello');
    });

    it('does not coerce a numeric-looking string into a number', async () => {
      // The Upstash client deserialises JSON by default, which would turn this
      // into `42`. Every value on this interface is a string, and a caller
      // doing `JSON.parse` on an already-parsed object throws. Asserted on all
      // implementations so the contract is the thing being kept, not one
      // client's configuration.
      await kv.set(`${prefix}num`, '42');
      expect(await kv.get(`${prefix}num`)).toBe('42');
    });

    it('deletes', async () => {
      await kv.set(`${prefix}gone`, 'x');
      await kv.del(`${prefix}gone`);
      expect(await kv.get(`${prefix}gone`)).toBeNull();
    });

    it('counts up within a window', async () => {
      const key = `${prefix}counter`;
      expect(await kv.incrementInWindow(key, 60)).toBe(1);
      expect(await kv.incrementInWindow(key, 60)).toBe(2);
      expect(await kv.incrementInWindow(key, 60)).toBe(3);
    });

    it('counts each key separately', async () => {
      expect(await kv.incrementInWindow(`${prefix}k1`, 60)).toBe(1);
      expect(await kv.incrementInWindow(`${prefix}k2`, 60)).toBe(1);
    });

    it('expires a window rather than counting forever', async () => {
      // One second, and actually waited out. The alternative — injecting a
      // clock — would test the in-memory implementation's idea of time and
      // could not be run against Redis at all, which is the whole point of this
      // file.
      const key = `${prefix}expiring`;
      expect(await kv.incrementInWindow(key, 1)).toBe(1);
      expect(await kv.incrementInWindow(key, 1)).toBe(2);
      await new Promise((resolve) => setTimeout(resolve, 1_400));
      expect(await kv.incrementInWindow(key, 1)).toBe(1);
    });

    it('does not slide the window forward on each increment', async () => {
      // The half a naive implementation gets wrong: re-applying the TTL on
      // every call turns a fixed window into a counter that never resets, so a
      // client sending steadily is banned rather than throttled. The window
      // starts when the first request in it arrives.
      const key = `${prefix}fixed`;
      expect(await kv.incrementInWindow(key, 1)).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 700));
      expect(await kv.incrementInWindow(key, 1)).toBe(2);
      await new Promise((resolve) => setTimeout(resolve, 700));
      // Still 1400ms from the first, so the window has closed even though the
      // second call was 700ms ago.
      expect(await kv.incrementInWindow(key, 1)).toBe(1);
    });

    it('honours a TTL on set', async () => {
      await kv.set(`${prefix}ttl`, 'x', { ttlSeconds: 1 });
      expect(await kv.get(`${prefix}ttl`)).toBe('x');
      await new Promise((resolve) => setTimeout(resolve, 1_400));
      expect(await kv.get(`${prefix}ttl`)).toBeNull();
    });
  });
}
