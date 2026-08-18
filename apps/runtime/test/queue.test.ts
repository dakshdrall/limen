/**
 * What can be checked about the queue without a Redis, and what cannot.
 *
 * The delivery semantics — that `BLMOVE` is atomic, that a job is never in
 * neither list — are properties of Redis and are not provable against a fake;
 * asserting them here would be writing a mock that agrees with the design.
 * Those live in `queue-redis.test.ts`, which runs against a real Redis when
 * `REDIS_URL` is set and fails rather than skips in CI. PLAN-V8 §7.5 records
 * what that has and has not covered.
 *
 * What *is* checkable here is the part that is this file's own decision rather
 * than Redis's: that a job without an idempotency key is refused at the door.
 * That refusal is the other half of at-least-once delivery, so it is the half
 * worth pinning where no service is needed to pin it.
 */

import { describe, expect, it } from 'vitest';
import { Queue, JOBS_KEY, PROCESSING_KEY } from '../src/queue.js';

describe('the queue refuses what it cannot deliver safely', () => {
  it('needs a connection URL', () => {
    expect(() => new Queue({ url: '' })).toThrow('connection URL');
  });

  it('keeps the two lists distinct', () => {
    // A job moves between them; if they were ever the same key, `BLMOVE` would
    // be a no-op that looks like progress.
    expect(JOBS_KEY).not.toBe(PROCESSING_KEY);
  });
});

describe('the idempotency key has no default, deliberately', () => {
  // Constructed without connecting: ioredis dials lazily, and these cases
  // return before any command is issued.
  const queue = new Queue({ url: 'redis://127.0.0.1:1' });

  it('refuses a job with no idempotency key', async () => {
    // A generated key would be unique per enqueue, which is exactly the wrong
    // grain: redelivery must carry the same key as the first attempt, or
    // at-least-once delivery becomes at-least-once *payment*.
    await expect(queue.enqueue({ kind: 'turn', idempotencyKey: '', payload: null })).rejects.toThrow(
      'idempotencyKey',
    );
  });

  it('says why, rather than only that it refused', async () => {
    await expect(queue.enqueue({ kind: 'turn', idempotencyKey: '', payload: null })).rejects.toThrow('queue.ts');
  });

  it('refuses a job with no kind', async () => {
    await expect(queue.enqueue({ kind: '', idempotencyKey: 'k', payload: null })).rejects.toThrow('kind');
  });
});
