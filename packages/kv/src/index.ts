/**
 * @limen/kv — shared state, and the two `TODO(roadmap)`s it retires.
 *
 * Exports the interface, the algorithms built on it, the process-local
 * implementation and the web resolver. The two clients that open a connection
 * are on subpaths — `@limen/kv/web` and `@limen/kv/runtime` — and are
 * deliberately not re-exported here, for the reason `@limen/db` gives: a single
 * import surface would let a serverless function acquire a held TCP connection
 * by importing the wrong name, which is the one thing the split exists to
 * prevent.
 */

export type { KeyValue } from './kv.js';
export { MemoryKeyValue, type MemoryKeyValueOptions } from './memory.js';
export { createRateLimit, type RateLimit, type RateLimitOptions } from './rate-limit.js';
export { createTxCache, type TxCache, type TxCacheOptions } from './tx-cache.js';
export {
  resolveWebKeyValue,
  isProductionDeployment,
  UPSTASH_URL_ENV,
  UPSTASH_TOKEN_ENV,
} from './resolve.js';
