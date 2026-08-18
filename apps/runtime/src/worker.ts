/**
 * The loop. Reserve a job, run its handler, settle it.
 *
 * Nothing enqueues yet — `packages/agent` is M4 — so at M1 this loop runs and
 * finds an empty queue. That is the intended state and not a placeholder:
 * §7.5.4 decides the process boundary *at M1* precisely so that it is a
 * property of the package layout before anything depends on it. Discovering the
 * boundary at M4 would mean moving `packages/agent`'s callers, its queue and
 * its scheduler after they have consumers.
 *
 * ## Handlers are registered, and an unknown kind is refused
 *
 * There is no default branch that logs and drops. A job whose kind nothing
 * handles is a bug in whatever enqueued it, and the two ways to be wrong here
 * are not symmetric: dropping it loses work silently, while retrying it forever
 * spins. It is failed, once, with its kind named — visible, and not spinning.
 *
 * ## Failure does not requeue, at M1
 *
 * A handler that throws marks the job failed and settles it. Retry policy —
 * how many attempts, with what backoff, and which errors are worth retrying at
 * all — is a decision the money path has to make deliberately, and it needs the
 * thing §7.5.4 reason 1 asks for: the ability to tell *"not yet submitted"*
 * from *"submitted, result unknown"*. Nothing here can tell those apart yet,
 * because nothing submits yet. A blind retry of a money-moving job is the one
 * behaviour worse than not retrying, so the loop does the conservative thing
 * and the plan says who fixes it.
 */

import type { Job, Queue, ReservedJob } from './queue.js';

export type JobHandler = (job: Job) => Promise<void>;

export interface WorkerOptions {
  queue: Queue;
  /** By `kind`. A kind with no entry here is refused, not dropped. */
  handlers: Record<string, JobHandler>;
  /** Injectable so tests do not write to the real console. */
  log?: (message: string) => void;
  onError?: (error: unknown, job?: Job) => void;
}

export class Worker {
  readonly #queue: Queue;
  readonly #handlers: Record<string, JobHandler>;
  readonly #log: (message: string) => void;
  readonly #onError: (error: unknown, job?: Job) => void;

  #running = false;
  #stopping = false;
  /** Resolves when the loop has actually left, so shutdown can wait for it. */
  #stopped: Promise<void> = Promise.resolve();

  constructor({ queue, handlers, log = console.log, onError }: WorkerOptions) {
    this.#queue = queue;
    this.#handlers = handlers;
    this.#log = log;
    this.#onError =
      onError ??
      ((error, job) => {
        const what = job === undefined ? 'while waiting for work' : `running ${job.kind}`;
        console.error(`limen runtime: ${what}: ${error instanceof Error ? error.message : String(error)}`);
      });
  }

  /**
   * Start looping. Returns once the loop is running, not once it is done.
   *
   * Recovery happens first and before any reserve, so a job stranded by the
   * previous process is back on the queue before this one starts competing for
   * work — otherwise a busy queue means stranded jobs are recovered last, which
   * is the opposite of the order that matters.
   */
  async start(): Promise<void> {
    if (this.#running) throw new Error('Worker.start: already running.');
    this.#running = true;
    this.#stopping = false;

    const recovered = await this.#queue.recoverStranded();
    if (recovered > 0) {
      // Said out loud. A silent recovery is indistinguishable from a queue that
      // was empty, and the number is the only evidence a previous process died
      // holding work.
      this.#log(`limen runtime: recovered ${recovered} job(s) stranded by a previous process.`);
    }

    this.#stopped = this.#loop();
  }

  async #loop(): Promise<void> {
    while (!this.#stopping) {
      let reserved: ReservedJob | undefined;
      try {
        reserved = await this.#queue.reserve();
      } catch (error) {
        // A reserve failure is the store being unreachable or a job being
        // unparseable. Neither is fixed by hammering it, and neither should
        // stop the worker, so it is reported and the loop waits out one block
        // interval by going round again.
        this.#onError(error);
        continue;
      }
      // The wait elapsed with nothing to do. This is the point the loop checks
      // whether it has been asked to stop, which is why the block has a timeout.
      if (reserved === undefined) continue;

      await this.#run(reserved);
    }
    this.#running = false;
  }

  async #run(reserved: ReservedJob): Promise<void> {
    const { job } = reserved;
    const handler = this.#handlers[job.kind];

    if (handler === undefined) {
      // Named, settled, not retried. See the header on why this is not a
      // silent drop and not a spin.
      this.#onError(
        new Error(
          `no handler registered for job kind '${job.kind}'. Refused rather than dropped; whatever enqueued it is wrong.`,
        ),
        job,
      );
      await this.#queue.settle(reserved);
      return;
    }

    try {
      await handler(job);
    } catch (error) {
      this.#onError(error, job);
    } finally {
      // Settled either way, at M1. See the header: a blind retry of a
      // money-moving job is worse than no retry, and nothing can yet tell
      // "not submitted" from "submitted, result unknown".
      await this.#queue.settle(reserved);
    }
  }

  /**
   * Ask the loop to stop, and wait until it has.
   *
   * Waits rather than signalling and returning, because the whole value of a
   * graceful shutdown is that the job in flight finishes. A `stop` that
   * returned immediately would let the process exit underneath the very handler
   * this design exists to protect.
   */
  async stop(): Promise<void> {
    this.#stopping = true;
    await this.#stopped;
  }

  get running(): boolean {
    return this.#running;
  }
}
