/**
 * The web app's access path: Upstash over HTTP, with no connection to exhaust.
 *
 * The parallel to `@limen/db/web` is exact and deliberate. Vercel autoscales to
 * tens of thousands of concurrent executions; a TCP Redis client from a
 * serverless function opens one connection per instance against a Redis that
 * accepts a bounded number, and the arithmetic does not work at any pool size.
 * Each command here is an HTTP request instead.
 *
 * ## The constraint this buys
 *
 * No blocking commands. `BLPOP`, `SUBSCRIBE` and `WAIT` all need a held
 * connection, and none of them are on the `KeyValue` interface — so a route
 * cannot reach for one and discover at runtime that HTTP will not do it. The
 * queue lives in `apps/runtime`, on the TCP client, which is where the thing
 * whose job is to wait belongs.
 *
 * ## What the first run against a real Upstash found
 *
 * `INCR` was the property this file expected to be waiting on, and it was not
 * the one that broke. It is atomic, as documented — the contract suite's
 * counter cases pass against a real instance. **The read path was wrong**, and
 * it was wrong in the shape §7.5.2 claimed this store did not have: silently,
 * with the types agreeing.
 *
 * The client JSON-parses every response by default. A stored `'42'` came back
 * as the number `42`; a stored JSON document came back as an object, which
 * `createTxCache` then handed to `JSON.parse`, so **every transaction-cache hit
 * in production was a thrown error reported to `onError` and returned as a
 * miss**. Writes were never involved: the client's serializer passes strings
 * through verbatim, so only the read side guessed. Hence
 * `automaticDeserialization: false` below, and the note on the constructor.
 */

import { Redis } from '@upstash/redis';
import type { KeyValue } from './kv.js';

export interface UpstashOptions {
  url: string;
  token: string;
}

export class UpstashKeyValue implements KeyValue {
  readonly id = 'upstash' as const;
  readonly shared = true;

  readonly #redis: Redis;

  constructor({ url, token }: UpstashOptions) {
    if (url.length === 0 || token.length === 0) {
      throw new Error('UpstashKeyValue needs both a URL and a token.');
    }
    // Deserialization off, and this is a measurement rather than a preference.
    // With it on, `get` returns whatever `JSON.parse` makes of the stored bytes
    // — a number for `'42'`, an object for a document — while the signature
    // still says `string | null`. The type parameter on `get<string>` below
    // looks like it settles that and does not: it is an assertion, not a
    // configuration. Off, every value comes back as the bytes that were
    // written, and `incr`, `expire` and `del` are unaffected because their
    // results are already JSON numbers.
    this.#redis = new Redis({ url, token, automaticDeserialization: false });
  }

  async get(key: string): Promise<string | null> {
    // Raw, because the constructor turned deserialization off. Everything on
    // this interface is a string, and this is the only place that was ever in a
    // position to break that.
    return await this.#redis.get<string>(key);
  }

  async set(key: string, value: string, options?: { ttlSeconds?: number }): Promise<void> {
    if (options?.ttlSeconds === undefined) {
      await this.#redis.set(key, value);
      return;
    }
    await this.#redis.set(key, value, { ex: options.ttlSeconds });
  }

  async del(key: string): Promise<void> {
    await this.#redis.del(key);
  }

  async incrementInWindow(key: string, ttlSeconds: number): Promise<number> {
    const count = await this.#redis.incr(key);
    // Only on creation. `EXPIRE` on every increment would slide the window
    // forward with each request, so a client sending steadily would never
    // reset — a fixed window quietly becoming a ban.
    if (count === 1) await this.#redis.expire(key, ttlSeconds);
    return count;
  }
}
