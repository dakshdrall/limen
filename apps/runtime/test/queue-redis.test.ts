/**
 * The delivery semantics, against a real Redis.
 *
 * `queue.test.ts` covers what this file's own decisions are; this covers what
 * Redis actually does, which is the half no fake can establish. The claim in
 * `queue.ts` — that a job is never in neither list, so a worker that dies
 * mid-turn leaves recoverable work — is the whole durability argument of
 * §7.5.4 reason 1, and asserting it against a mock would be writing a fake that
 * agrees with the design.
 *
 * Runs when `REDIS_URL` is set, and **fails rather than skips in CI**, in the
 * same two-sided shape as `packages/kv/test/contract.test.ts` and `@limen/db`'s
 * append-only fence. A suite that silently skipped would let the durability
 * claim go unchecked in exactly the environment built to check it.
 *
 * The suite runs in **its own namespace**, not the default one. That is not
 * tidiness: a worker left running against the same Redis will happily consume
 * the jobs these cases enqueue, and every assertion then fails as though the
 * queue were broken. That happened while this file was being written — two
 * orphaned workers from a shutdown test, blocked on the default keys, eating
 * the fixtures — and it cost an hour of suspecting the wrong code. A suite that
 * owns its keys cannot be stolen from, so a red run here means the queue is
 * actually wrong.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import Redis from 'ioredis';
import { Queue, JOBS_KEY, PROCESSING_KEY } from '../src/queue.js';

/** Unique per run, so even two concurrent runs cannot collide. */
const NAMESPACE = `limen-test-${process.pid}-${Date.now()}`;

const url = process.env.REDIS_URL ?? '';
const inCi = process.env.CI !== undefined && process.env.CI !== '' && process.env.CI !== 'false';

describe('the durability claim is checked against a real service', () => {
  it('has a Redis, or fails in CI for not having one', () => {
    if (url.length === 0 && !inCi) {
      // `process.stderr`, not `console`: vitest's default reporter intercepts
      // the latter and prints nothing from a passing test, and this notice only
      // ever appears on a run that passed.
      process.stderr.write(
        'queue-redis.test.ts: no REDIS_URL — the at-least-once delivery claim in queue.ts was NOT exercised. ' +
          'Run a Redis and set REDIS_URL. This fails rather than skips in CI.\n',
      );
    }
    if (inCi) expect(url.length, 'CI must provide REDIS_URL').toBeGreaterThan(0);
  });
});

const describeRedis = url.length > 0 ? describe : describe.skip;

describeRedis('the queue, against a real Redis', () => {
  const control = new Redis(url, { maxRetriesPerRequest: null });
  const queue = new Queue({ url, blockSeconds: 1, namespace: NAMESPACE });
  const { jobs, processing } = queue.keys;

  it('is not running against the default keys', () => {
    // The guard on the paragraph above. If this suite ever pointed at the real
    // queue, it would both be stealable and would delete production jobs in
    // `beforeEach` — so the isolation is asserted rather than assumed.
    expect(jobs).not.toBe(JOBS_KEY);
    expect(processing).not.toBe(PROCESSING_KEY);
  });

  beforeEach(async () => {
    await control.del(jobs, processing);
  });

  afterAll(async () => {
    await control.del(jobs, processing);
    await control.quit();
    await queue.quit();
  });

  it('round-trips a job: enqueue, reserve, settle', async () => {
    await queue.enqueue({ kind: 'turn', idempotencyKey: 'k1', payload: { a: 1 } });

    const reserved = await queue.reserve();
    expect(reserved?.job.kind).toBe('turn');
    expect(reserved?.job.idempotencyKey).toBe('k1');
    expect(reserved?.job.payload).toEqual({ a: 1 });

    await queue.settle(reserved!);
    expect(await queue.depth()).toEqual({ waiting: 0, processing: 0 });
  });

  it('holds a reserved job in processing until it is settled', async () => {
    // This is the property the whole design rests on. Between reserve and
    // settle the job is *somewhere* — which is what makes a worker dying
    // mid-turn recoverable rather than a silent loss.
    await queue.enqueue({ kind: 'turn', idempotencyKey: 'k1', payload: null });

    const reserved = await queue.reserve();
    expect(await queue.depth()).toEqual({ waiting: 0, processing: 1 });

    await queue.settle(reserved!);
    expect(await queue.depth()).toEqual({ waiting: 0, processing: 0 });
  });

  it('recovers a job whose worker died holding it', async () => {
    // Reserve and then never settle — exactly what a killed process leaves.
    await queue.enqueue({ kind: 'turn', idempotencyKey: 'k1', payload: null });
    await queue.reserve();
    expect(await queue.depth()).toEqual({ waiting: 0, processing: 1 });

    const recovered = await queue.recoverStranded();
    expect(recovered).toBe(1);
    expect(await queue.depth()).toEqual({ waiting: 1, processing: 0 });

    // And it is the same job, not a husk.
    const again = await queue.reserve();
    expect(again?.job.idempotencyKey).toBe('k1');
    await queue.settle(again!);
  });

  it('serves jobs oldest-first', async () => {
    // A queue that is quietly a stack starves the oldest work under load —
    // the jobs a user has already been waiting on.
    await queue.enqueue({ kind: 'turn', idempotencyKey: 'first', payload: null });
    await queue.enqueue({ kind: 'turn', idempotencyKey: 'second', payload: null });
    await queue.enqueue({ kind: 'turn', idempotencyKey: 'third', payload: null });

    const order: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const reserved = await queue.reserve();
      order.push(reserved!.job.idempotencyKey);
      await queue.settle(reserved!);
    }
    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('returns undefined when the wait elapses, rather than hanging', async () => {
    // The moment the loop uses to notice a shutdown signal. If this blocked
    // forever, SIGTERM would wait for a job that may never come.
    const started = Date.now();
    expect(await queue.reserve()).toBeUndefined();
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  });

  it('settles exactly the reserved element, leaving another copy alone', async () => {
    // `LREM` matches by value, so two jobs that serialise identically are a
    // real case — a retry of the same intent is the obvious one. Settling one
    // must not remove both.
    await queue.enqueue({ kind: 'turn', idempotencyKey: 'same', payload: null, enqueuedAt: 'fixed' });
    await queue.enqueue({ kind: 'turn', idempotencyKey: 'same', payload: null, enqueuedAt: 'fixed' });

    const a = await queue.reserve();
    const b = await queue.reserve();
    expect(await queue.depth()).toEqual({ waiting: 0, processing: 2 });

    await queue.settle(a!);
    expect(await queue.depth()).toEqual({ waiting: 0, processing: 1 });
    await queue.settle(b!);
    expect(await queue.depth()).toEqual({ waiting: 0, processing: 0 });
  });

  it('requeues a job without ever letting it be in neither list', async () => {
    await queue.enqueue({ kind: 'turn', idempotencyKey: 'k1', payload: null });
    const reserved = await queue.reserve();

    await queue.requeue(reserved!);
    expect(await queue.depth()).toEqual({ waiting: 1, processing: 0 });
  });
});
