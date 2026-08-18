/**
 * The runtime's access path: a TCP client, because the queue has to block.
 *
 * `apps/runtime` is one long-lived process, so a held connection is the case a
 * TCP client is actually for — and it is not a preference here, it is a
 * requirement. `BLPOP` *is* a held connection: the whole operation is "wait on
 * this socket until something arrives". An HTTP client cannot express it, and
 * the alternative — polling on a timer — would be the wrong shape for the one
 * component in the system whose job is to wait.
 *
 * §7.5.4's reasons 1 and 3 both land here. Durable execution needs a queue with
 * at-least-once delivery, and single-writer discipline needs a lock; both are
 * Redis rather than Postgres because §7.5.2 forbids the Postgres mechanisms
 * that would otherwise be reached for (session advisory locks, `LISTEN`/
 * `NOTIFY`) — a transaction-mode pooler breaks them, and
 * `packages/db/src/forbidden.ts` refuses them outright.
 */

import Redis from 'ioredis';
import type { KeyValue } from './kv.js';

export interface RuntimeKeyValueOptions {
  url: string;
  /**
   * Bounded, like the database pool and for the same reason: a worker that
   * cannot get a connection should queue visibly rather than the process
   * quietly opening more until the server refuses.
   */
  maxRetriesPerRequest?: number;
}

export class RuntimeKeyValue implements KeyValue {
  readonly id = 'redis' as const;
  readonly shared = true;

  readonly redis: Redis;

  constructor({ url, maxRetriesPerRequest = 3 }: RuntimeKeyValueOptions) {
    if (url.length === 0) throw new Error('RuntimeKeyValue needs a connection URL.');
    this.redis = new Redis(url, { maxRetriesPerRequest });
  }

  async get(key: string): Promise<string | null> {
    return await this.redis.get(key);
  }

  async set(key: string, value: string, options?: { ttlSeconds?: number }): Promise<void> {
    if (options?.ttlSeconds === undefined) {
      await this.redis.set(key, value);
      return;
    }
    await this.redis.set(key, value, 'EX', options.ttlSeconds);
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async incrementInWindow(key: string, ttlSeconds: number): Promise<number> {
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, ttlSeconds);
    return count;
  }

  async quit(): Promise<void> {
    await this.redis.quit();
  }
}
