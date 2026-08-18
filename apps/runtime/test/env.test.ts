/**
 * The refusal that has no fallback, and why it differs from the web app's.
 */

import { describe, expect, it } from 'vitest';
import { resolveRuntimeConfig } from '../src/env.js';

const ok = { REDIS_URL: 'redis://localhost:6379', DATABASE_URL: 'postgres://localhost/limen' };

describe('the runtime refuses to start without its configuration', () => {
  it('resolves when both are set', () => {
    const config = resolveRuntimeConfig(ok as NodeJS.ProcessEnv);
    expect(config.redisUrl).toBe(ok.REDIS_URL);
    expect(config.databaseUrl).toBe(ok.DATABASE_URL);
  });

  it('refuses without Redis, in every environment and not only production', () => {
    // The asymmetry with packages/kv's web resolver is deliberate. A preview
    // web app without Redis is degraded; a runtime without Redis has no queue
    // at all, and every durability property is absent while the shape still
    // looks right.
    expect(() =>
      resolveRuntimeConfig({ DATABASE_URL: ok.DATABASE_URL, NODE_ENV: 'development' } as NodeJS.ProcessEnv),
    ).toThrow('REDIS_URL');
  });

  it('refuses without a database, even though M1 does not query yet', () => {
    // Validating configuration is for failing at startup rather than on the
    // first job that needs it.
    expect(() => resolveRuntimeConfig({ REDIS_URL: ok.REDIS_URL } as NodeJS.ProcessEnv)).toThrow('DATABASE_URL');
  });

  it('names every missing variable at once, not the first', () => {
    // Otherwise a startup is restarted once per missing variable to discover
    // what it wants.
    let message = '';
    try {
      resolveRuntimeConfig({} as NodeJS.ProcessEnv);
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toContain('REDIS_URL');
    expect(message).toContain('DATABASE_URL');
  });

  it('explains why there is no fallback, rather than only that there is none', () => {
    // A refusal a reader cannot act on gets worked around.
    let message = '';
    try {
      resolveRuntimeConfig({} as NodeJS.ProcessEnv);
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toContain('empty on restart');
    expect(message).toContain('apps/runtime/src/env.ts');
  });
});
