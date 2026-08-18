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
 * ## What is not verified here
 *
 * That Upstash's HTTP `INCR` is atomic in the way this depends on. It is
 * documented as executing server-side like any Redis command — an HTTP
 * transport does not make a Redis command non-atomic — and the rate limiter's
 * whole correctness rests on it. Unlike the `neon-http` transaction question in
 * §7.5.2, there is no plausible silent-wrong-answer mode here: an `INCR` either
 * returns a monotonically increasing number or it does not, and
 * `test/contract.test.ts` runs the same assertions against every
 * implementation, so a real instance can be checked against the identical suite
 * the moment one exists.
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
    this.#redis = new Redis({ url, token });
  }

  async get(key: string): Promise<string | null> {
    // Upstash deserialises JSON by default, which would turn a stored string
    // that happens to look like a number into a number. Everything on this
    // interface is a string; `<string | null>` keeps the client from guessing.
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
