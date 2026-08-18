/**
 * The loop, proved without a Redis.
 *
 * `Queue` needs a server; `Worker` needs a queue. Testing the loop against a
 * fake queue is what makes the loop's behaviour — refusal, settlement, recovery
 * order, graceful stop — checkable at M1, when there is no Redis in this
 * environment at all. The fake implements the same four methods the loop calls
 * and records what it was asked to do, so an assertion here is about the
 * worker's decisions rather than about Redis's semantics. Those are covered
 * against a real service in `queue-redis.test.ts`, and the state of that
 * coverage is recorded in PLAN-V8 §7.5.
 */

import { describe, expect, it } from 'vitest';
import { Worker } from '../src/worker.js';
import type { Job, ReservedJob } from '../src/queue.js';

function job(kind: string, key = 'k1'): Job {
  return { kind, idempotencyKey: key, payload: null, enqueuedAt: new Date().toISOString() };
}

/** Hands out a fixed script of jobs, then blocks by returning `undefined`. */
class FakeQueue {
  settled: ReservedJob[] = [];
  recoveredCount = 0;
  #script: (ReservedJob | undefined)[];

  constructor(jobs: Job[], recovered = 0) {
    this.recoveredCount = recovered;
    this.#script = jobs.map((j) => ({ job: j, raw: JSON.stringify(j) }));
  }

  recoverStranded(): Promise<number> {
    return Promise.resolve(this.recoveredCount);
  }

  reserve(): Promise<ReservedJob | undefined> {
    return Promise.resolve(this.#script.shift());
  }

  settle(reserved: ReservedJob): Promise<void> {
    this.settled.push(reserved);
    return Promise.resolve();
  }
}

/** Lets the loop turn a few times without depending on a timer. */
const drain = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

function build(jobs: Job[], handlers: Record<string, (j: Job) => Promise<void>>, recovered = 0) {
  const queue = new FakeQueue(jobs, recovered);
  const errors: { error: unknown; job?: Job }[] = [];
  const logs: string[] = [];
  const worker = new Worker({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the fake implements exactly what the loop calls.
    queue: queue as any,
    handlers,
    log: (message) => logs.push(message),
    onError: (error, j) => errors.push({ error, job: j }),
  });
  return { queue, worker, errors, logs };
}

describe('the worker loop', () => {
  it('runs a handler for a job it knows, and settles it', async () => {
    const seen: string[] = [];
    const { queue, worker } = build([job('turn')], {
      turn: async (j) => {
        seen.push(j.kind);
      },
    });

    await worker.start();
    await drain();
    await worker.stop();

    expect(seen).toEqual(['turn']);
    expect(queue.settled).toHaveLength(1);
  });

  it('refuses a kind nothing handles, rather than dropping it silently', async () => {
    // The two ways to be wrong are not symmetric: a silent drop loses work, and
    // an endless retry spins. This is neither, and it names the kind.
    const { queue, worker, errors } = build([job('nonesuch')], {});

    await worker.start();
    await drain();
    await worker.stop();

    expect(errors).toHaveLength(1);
    expect((errors[0]?.error as Error).message).toContain("'nonesuch'");
    expect(errors[0]?.job?.kind).toBe('nonesuch');
    // Settled, so it does not come back forever.
    expect(queue.settled).toHaveLength(1);
  });

  it('settles a job whose handler threw, and reports it', async () => {
    const { queue, worker, errors } = build([job('turn')], {
      turn: () => Promise.reject(new Error('handler exploded')),
    });

    await worker.start();
    await drain();
    await worker.stop();

    expect((errors[0]?.error as Error).message).toBe('handler exploded');
    expect(queue.settled).toHaveLength(1);
  });

  it('keeps going after a handler throws', async () => {
    // A worker that dies on the first bad job is a worker one poisoned payload
    // can stop.
    const seen: string[] = [];
    const { worker } = build([job('bad'), job('good')], {
      bad: () => Promise.reject(new Error('no')),
      good: async (j) => {
        seen.push(j.kind);
      },
    });

    await worker.start();
    await drain();
    await worker.stop();

    expect(seen).toEqual(['good']);
  });

  it('recovers stranded jobs before it reserves anything', async () => {
    // Order matters: recovering last means a busy queue recovers dead work
    // never, which is the opposite of what the sweep is for.
    const { worker, logs } = build([], {}, 3);

    await worker.start();
    await worker.stop();

    expect(logs.join('\n')).toContain('recovered 3 job(s)');
  });

  it('says nothing when there was nothing to recover', async () => {
    // Otherwise every ordinary start logs a line about durability, and the one
    // start that mattered reads like all the others.
    const { worker, logs } = build([], {}, 0);

    await worker.start();
    await worker.stop();

    expect(logs.join('\n')).not.toContain('recovered');
  });

  it('stops, and waiting for it means the loop has actually left', async () => {
    const { worker } = build([], {});

    await worker.start();
    await worker.stop();

    expect(worker.running).toBe(false);
  });

  it('refuses to start twice', async () => {
    const { worker } = build([], {});
    await worker.start();
    await expect(worker.start()).rejects.toThrow('already running');
    await worker.stop();
  });
});
