/**
 * The two types `turn.ts` needs from `worker.ts`, without importing the loop.
 *
 * `worker.ts` owns the loop; `queue.ts` owns the job. A handler needs neither —
 * it needs the shape of what it is handed. Re-exporting them from one small
 * module keeps `turn.ts` from importing a class it never constructs, which is
 * what would make a handler test start a queue.
 */

export type { Job } from './queue.js';
export type { JobHandler } from './worker.js';
