/**
 * The queue the worker blocks on, and the reason it is not `BLPOP`.
 *
 * §7.5.4 reason 1: durable execution of money-moving work. *"An agent turn that
 * dies after submission and before recording has spent funds with no record."*
 * That sentence is a requirement on this file, and it rules out the obvious
 * implementation.
 *
 * ## Why not `BLPOP`
 *
 * `BLPOP` removes the job from Redis and hands it to the worker in one step. If
 * the process dies between those two facts — a deploy, an OOM kill, a lost
 * network — the job is gone. That is **at-most-once** delivery, and the plan
 * asks for at-least-once, because the failure being designed against is
 * precisely a worker dying mid-turn.
 *
 * So a job moves between two lists rather than out of one:
 *
 *   `limen:jobs`  ──BLMOVE──▶  `limen:jobs:processing`  ──LREM──▶  gone
 *
 * `BLMOVE` is atomic: the job is never in neither list, and never in only the
 * worker's memory. A worker that dies mid-turn leaves its job in `processing`,
 * where `recoverStranded` can find it and put it back — which is what makes
 * redelivery possible at all.
 *
 * **At-least-once means duplicates are a certainty, not a risk**, and this is
 * the half that is easy to forget: recovery can requeue a job that in fact
 * completed, because "the worker died" and "the worker died after submitting"
 * look identical from outside. The idempotency key below is not a nicety
 * layered on top; it is the other half of this design, and a turn that submits
 * without checking one can pay a contractor twice.
 *
 * ## Direction, so the queue is FIFO
 *
 * `enqueue` pushes at the head (`LPUSH`) and the worker takes from the tail
 * (`BLMOVE … RIGHT LEFT`), so jobs are served oldest-first. The alternative
 * reads the same in a diff and quietly makes the queue a stack, which under
 * load starves the oldest work — the jobs a user has already been waiting on.
 *
 * ## The blocking connection is its own
 *
 * A connection parked in `BLMOVE` cannot carry other commands; that is what
 * blocking means. Sharing one with the rest of the process would mean every
 * unrelated `GET` waited behind the queue being empty. So this owns a second
 * connection, and `maxRetriesPerRequest: null` is set on it because ioredis's
 * retry counter is designed for commands that return promptly and will abort a
 * legitimately-blocked one.
 */

import Redis from 'ioredis';

/** The default namespace. See `QueueOptions.namespace`. */
export const DEFAULT_NAMESPACE = 'limen';

/** The list a job waits on. */
export const jobsKey = (namespace: string): string => `${namespace}:jobs`;
/** Where a job sits while a worker owns it. Not a queue; a record of custody. */
export const processingKey = (namespace: string): string => `${namespace}:jobs:processing`;

/** The default keys, kept as names because most callers never change them. */
export const JOBS_KEY = jobsKey(DEFAULT_NAMESPACE);
export const PROCESSING_KEY = processingKey(DEFAULT_NAMESPACE);

export interface Job {
  /**
   * What this job is. Checked against a registered handler before anything
   * runs — an unknown kind is refused rather than logged and dropped.
   */
  kind: string;
  /**
   * The key that makes redelivery safe.
   *
   * Required, with no default. A generated one would be unique per *enqueue*,
   * which is exactly the wrong grain: the point is that the same intent
   * enqueued or redelivered twice carries the same key, so the second attempt
   * can find the first attempt's outcome instead of repeating its effect.
   */
  idempotencyKey: string;
  /** Opaque to the queue. The handler for `kind` knows its shape. */
  payload: unknown;
  /** When it was enqueued, for measuring queue latency rather than guessing. */
  enqueuedAt: string;
}

export interface ReservedJob {
  job: Job;
  /**
   * The exact bytes in `processing`, kept so `settle` can remove *this*
   * element. `LREM` matches by value, and a re-serialised job is not
   * byte-identical to the one that was stored — a different key order is
   * enough. Keeping the original string is what makes the removal exact.
   */
  raw: string;
}

export interface QueueOptions {
  url: string;
  /**
   * Which set of keys this queue owns.
   *
   * Defaulted rather than required — unlike the rate limiter's, where six
   * limiters genuinely share one store and a collision silently tightens a
   * budget. There is one queue, so the default is the honest common case.
   *
   * It exists because two *processes* sharing a Redis is the real hazard here,
   * and it is not hypothetical: a worker left running against the same
   * instance will consume jobs a test enqueues, and the test then fails as
   * though the queue were broken. That is a confusing hour, and it happened
   * while this file was being written. A test that owns its own namespace
   * cannot be stolen from, and two environments pointed at one Redis stay
   * separate for the same reason.
   */
  namespace?: string;
  /**
   * How long a blocking read waits before returning empty.
   *
   * Not zero, which would block forever. The loop has to come up for air to
   * notice a shutdown signal, so this is the longest a `SIGTERM` can wait for
   * an idle worker to notice it. Five seconds is comfortably inside the ten a
   * container runtime typically allows before `SIGKILL`.
   */
  blockSeconds?: number;
}

export class Queue {
  readonly #redis: Redis;
  readonly #blockSeconds: number;
  readonly #jobs: string;
  readonly #processing: string;

  constructor({ url, blockSeconds = 5, namespace = DEFAULT_NAMESPACE }: QueueOptions) {
    if (url.length === 0) throw new Error('Queue: needs a Redis connection URL.');
    if (namespace.length === 0) throw new Error('Queue: namespace must not be empty.');
    this.#redis = new Redis(url, {
      // See the header: the retry counter aborts commands that are slow, and a
      // blocking read is slow on purpose.
      maxRetriesPerRequest: null,
    });
    this.#blockSeconds = blockSeconds;
    this.#jobs = jobsKey(namespace);
    this.#processing = processingKey(namespace);
  }

  /** The keys this instance owns. Read by the health check and by tests. */
  get keys(): { jobs: string; processing: string } {
    return { jobs: this.#jobs, processing: this.#processing };
  }

  async enqueue(job: Omit<Job, 'enqueuedAt'> & { enqueuedAt?: string }): Promise<void> {
    if (job.kind.length === 0) throw new Error('Queue.enqueue: a job needs a kind.');
    if (job.idempotencyKey.length === 0) {
      // Refused rather than generated. See the field's comment: a key invented
      // here would be unique per enqueue and would make redelivery unsafe while
      // looking like it had been handled.
      throw new Error('Queue.enqueue: a job needs an idempotencyKey. See queue.ts on why it has no default.');
    }
    const complete: Job = { ...job, enqueuedAt: job.enqueuedAt ?? new Date().toISOString() };
    await this.#redis.lpush(this.#jobs, JSON.stringify(complete));
  }

  /**
   * Take the next job, moving it into `processing` in the same atomic step.
   *
   * Returns `undefined` when the wait elapsed with the queue empty — an
   * ordinary outcome, not an error, and the moment the loop uses to check
   * whether it has been asked to stop.
   */
  async reserve(): Promise<ReservedJob | undefined> {
    const raw = await this.#redis.blmove(
      this.#jobs,
      this.#processing,
      'RIGHT',
      'LEFT',
      this.#blockSeconds,
    );
    if (raw === null) return undefined;

    let job: Job;
    try {
      job = JSON.parse(raw) as Job;
    } catch {
      // Unparseable. It must not go back on the queue — it would fail the same
      // way forever and block nothing else usefully — and it must not vanish
      // silently either. Left in `processing`, where it is visible, and named.
      throw new Error(
        `Queue.reserve: a job in ${this.#jobs} is not JSON. Left in ${this.#processing} for inspection rather than requeued.`,
      );
    }
    return { job, raw };
  }

  /** Done with it. Removes exactly the reserved element; see `ReservedJob.raw`. */
  async settle({ raw }: ReservedJob): Promise<void> {
    await this.#redis.lrem(this.#processing, 1, raw);
  }

  /**
   * Put a reserved job back at the head of the queue, to be tried again.
   *
   * Deliberately not a `settle` that also re-enqueues: those are two commands,
   * and a crash between them either loses the job or duplicates it. Removing
   * from `processing` and pushing back are ordered so that a crash in between
   * leaves the job in `processing` — recoverable — rather than nowhere.
   */
  async requeue(reserved: ReservedJob): Promise<void> {
    await this.#redis.lpush(this.#jobs, reserved.raw);
    await this.#redis.lrem(this.#processing, 1, reserved.raw);
  }

  /**
   * Return everything stranded in `processing` to the queue.
   *
   * Called at startup. A job here is one whose worker died holding it, and
   * without this it sits there forever — the durability of `BLMOVE` is only
   * worth having if something eventually looks.
   *
   * **This is where duplicates come from**, and it is the intended behaviour: a
   * job that had in fact completed is redelivered, and the idempotency key is
   * what makes that safe. Recording it here rather than in a commit message
   * because a later reader deciding this sweep looks over-eager needs to know
   * what it is paired with.
   *
   * At M1 it is unconditional, which is correct while there is exactly one
   * worker and nothing enqueues. With several workers it must become
   * age-based — a job in `processing` may belong to a *live* worker, and
   * returning that one to the queue would duplicate live work rather than
   * recover dead work. Fixed in the milestone that runs more than one.
   */
  async recoverStranded(): Promise<number> {
    let recovered = 0;
    for (;;) {
      const raw = await this.#redis.rpoplpush(this.#processing, this.#jobs);
      if (raw === null) return recovered;
      recovered += 1;
    }
  }

  /** Queue depth, for the health check. Not used to make decisions. */
  async depth(): Promise<{ waiting: number; processing: number }> {
    const [waiting, processing] = await Promise.all([
      this.#redis.llen(this.#jobs),
      this.#redis.llen(this.#processing),
    ]);
    return { waiting, processing };
  }

  async quit(): Promise<void> {
    await this.#redis.quit();
  }
}
