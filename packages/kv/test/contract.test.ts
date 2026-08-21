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
 * `UpstashKeyValue` runs the same way, against a real Upstash when
 * `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are both set. It is
 * the implementation `apps/web` actually uses in production — the other two are
 * a fake and the runtime's — so leaving it uncovered meant the only
 * implementation serving real traffic was the only one no assertion had
 * touched. Unlike the Redis arm it does **not** fail in CI for being absent: a
 * GitHub runner can be given a Redis container and cannot be given an Upstash
 * account, so requiring it would make the gate depend on a credential that
 * cannot exist there.
 *
 * The count is the coverage. `npm test -w @limen/kv` runs 26 cases with
 * nothing configured, 37 with `REDIS_URL`, and 48 with Upstash as well — the
 * two eleven-case differences are the two real services. The suite also names
 * the implementations it exercised on stderr, so the coverage of a given run
 * can be read rather than derived from the total.
 *
 * The first run against a real Upstash refused, and that is the case for having
 * written this: the client deserialises what it reads, so `'42'` came back as
 * `42` and a stored document came back as an object — which `createTxCache`
 * handed to `JSON.parse`, making every production cache hit an error and a
 * miss. `packages/kv/src/web.ts` now constructs the client with
 * `automaticDeserialization: false`, and the two cases below hold it there.
 */

import { afterAll, describe, expect, it } from 'vitest';
import type { KeyValue } from '../src/kv.js';
import { MemoryKeyValue } from '../src/memory.js';
import { createTxCache } from '../src/tx-cache.js';
import { RuntimeKeyValue } from '../src/runtime.js';
import { UpstashKeyValue } from '../src/web.js';

const redisUrl = process.env.REDIS_URL ?? '';
const upstashUrl = process.env.UPSTASH_REDIS_REST_URL ?? '';
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN ?? '';
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

if (upstashUrl.length > 0 && upstashToken.length > 0) {
  // No teardown: the REST client holds no connection to close, which is the
  // property `apps/web` picked it for.
  implementations.push({
    name: 'UpstashKeyValue (real Upstash)',
    make: () => new UpstashKeyValue({ url: upstashUrl, token: upstashToken }),
  });
}

describe('the contract suite is not testing a fake against itself', () => {
  it('runs against a real Redis, or fails in CI for not having one', () => {
    // Named rather than counted. A reader working out the coverage from the
    // case total has to know how many cases one implementation contributes;
    // this says it outright, which is what a run record should be able to quote.
    //
    // `process.stderr` rather than `console.error`, here and below, and it is
    // not a style choice: vitest's default reporter intercepts `console` and
    // prints nothing from a test that passed. Both of these notices exist to be
    // read on a run where everything passed — one says what was covered, the
    // other says that almost nothing was — so routing them through the
    // intercepted channel was the same as not writing them.
    process.stderr.write(
      `contract.test.ts: exercising ${implementations.map(({ name }) => name).join(', ')}\n`,
    );
    if (redisUrl.length === 0 && !inCi) {
      process.stderr.write(
        'contract.test.ts: no REDIS_URL — only MemoryKeyValue was exercised, so this suite proved that the ' +
          'in-memory implementation agrees with itself. Run a Redis and set REDIS_URL. This fails rather than ' +
          'skips in CI.\n',
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

    it('round-trips a JSON document, through the cache that actually stores one', async () => {
      // The numeric case above catches a client that parses what it reads; this
      // one measures what that cost. `createTxCache` writes `JSON.stringify` and
      // reads `JSON.parse`, so a store that hands back an already-parsed object
      // turns every cache **hit** into a thrown error, an `onError` report and a
      // returned miss — a cache that is not merely cold but silently unable to
      // hit, which is what a real Upstash did until `web.ts` turned
      // deserialization off. Asserted through the consumer rather than around
      // it, because the interface's `string` was never the part that lied.
      const document = JSON.stringify({ hash: 'abc', ops: [{ amount: '4.0000000' }] });
      await kv.set(`${prefix}doc`, document);
      expect(await kv.get(`${prefix}doc`)).toBe(document);

      const errors: unknown[] = [];
      const cache = createTxCache<{ hash: string }>({ kv, onError: (error) => errors.push(error) });
      await cache.put(`${prefix}hit`, { hash: 'abc' });
      expect(await cache.get(`${prefix}hit`)).toEqual({ hash: 'abc' });
      expect(errors).toEqual([]);
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
