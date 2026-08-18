/**
 * The runtime process. One deployable, separate from `apps/web`.
 *
 * §7.5.4 decided this at M1 rather than at M4, and the four reasons are in the
 * plan: durable execution of money-moving work, a real scheduler, single-writer
 * discipline that is cheap rather than merely possible, and not coupling the
 * money path's availability to the frontend host. Duration is explicitly *not*
 * one of them — an agent turn is 15–45 seconds and Vercel allows far more.
 *
 * **Nothing enqueues yet.** This starts, recovers anything stranded, blocks on
 * an empty queue and shuts down cleanly. That is the whole of M1's requirement:
 * the process boundary exists in the package layout before anything depends on
 * it, so `packages/agent` is built against a boundary rather than having one
 * introduced underneath it.
 */

import { resolveRuntimeConfig } from './env.js';
import { Queue } from './queue.js';
import { Worker } from './worker.js';
import type { JobHandler } from './worker.js';

/**
 * Empty, and not a placeholder to be filled in casually.
 *
 * Every entry here is a thing the runtime will do to a user's money. The
 * registry is the list of those, and it stays empty until M4 puts the first one
 * in with the fences that make it safe.
 */
const HANDLERS: Record<string, JobHandler> = {};

export async function main(): Promise<void> {
  const config = resolveRuntimeConfig();
  const queue = new Queue({ url: config.redisUrl });
  const worker = new Worker({ queue, handlers: HANDLERS });

  await worker.start();
  console.log('limen runtime: started. Nothing enqueues yet; waiting on an empty queue is expected at M1.');

  // Both signals, because which one arrives depends on the host and a process
  // that handles only `SIGTERM` is killed abruptly by every Ctrl-C in
  // development — which is where the shutdown path would otherwise be tested
  // least and trusted most.
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`limen runtime: ${signal} — finishing the job in flight, then stopping.`);
    await worker.stop();
    await queue.quit();
    console.log('limen runtime: stopped.');
  };

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      void shutdown(signal).then(
        () => process.exit(0),
        (error: unknown) => {
          console.error(`limen runtime: shutdown failed: ${error instanceof Error ? error.message : String(error)}`);
          process.exit(1);
        },
      );
    });
  }
}

export { Queue } from './queue.js';
export { Worker } from './worker.js';
export { resolveRuntimeConfig, REDIS_URL_ENV, DATABASE_URL_ENV } from './env.js';
export type { Job, ReservedJob } from './queue.js';
export type { JobHandler } from './worker.js';
