/**
 * What the runtime needs before it will start, and the refusals that say so.
 *
 * The mirror of `packages/kv/src/resolve.ts`, pointed the other way. The web
 * app may fall back to a process-local store outside production, because a
 * preview that cannot serve is worse than a preview whose rate limits are
 * per-instance. **The runtime has no equivalent fallback at all**, and the
 * asymmetry is deliberate: a queue in a process's memory is not a queue. It has
 * one consumer, it is empty on restart, and every durability property §7.5.4
 * reason 1 asks for is absent while the shape still looks right. There is no
 * version of this process worth running without Redis, so it refuses in every
 * environment rather than only in production.
 *
 * `resolveWebKeyValue` deliberately lives elsewhere and is not called here: the
 * runtime needs the TCP client, and a single resolver that returned either is
 * the shared export §7.5.2's two-path split exists to prevent.
 */

export const REDIS_URL_ENV = 'REDIS_URL';
export const DATABASE_URL_ENV = 'DATABASE_URL';

export interface RuntimeConfig {
  redisUrl: string;
  /**
   * Neon's **pooled** endpoint, for `createRuntimeDb`.
   *
   * Read and validated here even though M1's worker does not query yet, because
   * the point of validating configuration is to fail at startup rather than on
   * the first request that needs it — and a runtime that starts happily without
   * a database and dies at the first job has learned nothing from having a
   * config module.
   */
  databaseUrl: string;
}

export function resolveRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const missing: string[] = [];
  const redisUrl = env[REDIS_URL_ENV] ?? '';
  const databaseUrl = env[DATABASE_URL_ENV] ?? '';

  if (redisUrl.length === 0) missing.push(REDIS_URL_ENV);
  if (databaseUrl.length === 0) missing.push(DATABASE_URL_ENV);

  if (missing.length > 0) {
    // All of them, not the first. A startup that fails once per missing
    // variable is a startup somebody restarts four times to discover what it
    // wants.
    throw new Error(
      `apps/runtime cannot start: ${missing.join(', ')} not set. ` +
        'Unlike the web app, this process has no process-local fallback and is not meant to have one — ' +
        'a queue held in one process\'s memory has a single consumer and is empty on restart, which is ' +
        'every durability property of a queue absent while the shape still looks correct. ' +
        'See apps/runtime/src/env.ts.',
    );
  }

  return { redisUrl, databaseUrl };
}
