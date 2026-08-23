/**
 * The runtime process. One deployable, separate from `apps/web`.
 *
 * §7.5.4 decided this at M1 rather than at M4, and the four reasons are in the
 * plan: durable execution of money-moving work, a real scheduler, single-writer
 * discipline that is cheap rather than merely possible, and not coupling the
 * money path's availability to the frontend host. Duration is explicitly *not*
 * one of them — an agent turn is 15–45 seconds and Vercel allows far more.
 *
 * **What changed at M4.** M1 started this process, recovered anything stranded,
 * blocked on an empty queue and shut down cleanly — deliberately, so that the
 * process boundary existed in the package layout before anything depended on
 * it. It now has something to do: an HTTP surface that accepts a tool call and
 * a handler that runs one.
 *
 * The order below is not incidental. The key provider is resolved **before**
 * the server listens, so a deployment that cannot open an agent key refuses to
 * start rather than accepting turns it will fail at the moment it would have
 * paid someone.
 */

import { resolveRuntimeConfig } from './env.js';
import { createRuntimeDb } from '@limen/db/runtime';
import { createRateLimit } from '@limen/kv';
import { RuntimeKeyValue } from '@limen/kv/runtime';
import { resolveCaller } from './auth.js';
import { keyProvider } from './key-provider.js';
import { drizzleRuntimeStore } from './store.js';
import { createHttpServer } from './http.js';
import { Queue } from './queue.js';
import { TURN_JOB_KIND, turnHandler } from './turn.js';
import { Worker } from './worker.js';

export async function main(): Promise<void> {
  const config = resolveRuntimeConfig();

  // First, and before anything listens. `key-provider.ts` explains why the
  // runtime resolves eagerly where the web app resolves lazily.
  const provider = keyProvider();

  const { db, pool } = createRuntimeDb({ connectionString: config.databaseUrl });
  const store = drizzleRuntimeStore(db);
  const queue = new Queue({ url: config.redisUrl });
  const kv = new RuntimeKeyValue({ url: config.redisUrl });

  // Every entry in this registry is a thing the runtime will do to a user's
  // money. It stayed empty from M1 until the fences that make a payment safe
  // existed. The unit registered is a whole *turn* rather than a single tool,
  // because the turn is what has to be idempotent — `turn.ts` says why a
  // redelivered one is not simply re-run.
  const worker = new Worker({
    queue,
    handlers: { [TURN_JOB_KIND]: turnHandler({ store, provider, rpcUrl: config.rpcUrl }) },
  });

  const server = createHttpServer({
    resolveCaller: (token) => resolveCaller(db, token),
    store,
    queue,
    // Per user, and generous: a person driving a chat sends a few turns a
    // minute, and the budget exists to bound a broken client rather than to
    // ration ordinary use. It is not a security boundary and does not pretend
    // to be one — `__check_auth` is.
    limit: createRateLimit({ kv, max: 60, windowMs: 10 * 60 * 1000, namespace: 'runtime-turns' }),
  });

  await worker.start();
  await new Promise<void>((resolve) => server.listen(config.port, resolve));
  console.log(`limen runtime: started. HTTP on :${config.port}, RPC ${config.rpcUrl}.`);

  // Both signals, because which one arrives depends on the host and a process
  // that handles only `SIGTERM` is killed abruptly by every Ctrl-C in
  // development — which is where the shutdown path would otherwise be tested
  // least and trusted most.
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`limen runtime: ${signal} — finishing the job in flight, then stopping.`);
    // The listener first: no new turns while the worker is draining, so the
    // count of things that can still be in flight only goes down.
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await worker.stop();
    await queue.quit();
    await kv.redis.quit();
    await pool.end();
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
export { createHttpServer } from './http.js';
export { drizzleRuntimeStore } from './store.js';
export { TURN_JOB_KIND, turnHandler } from './turn.js';
export { TOOLS, invokeTool } from './tools/index.js';
export { decide, readBoundary, signerFor } from './policy/gate.js';
export {
  resolveRuntimeConfig,
  REDIS_URL_ENV,
  DATABASE_URL_ENV,
  RPC_URL_ENV,
  PORT_ENV,
} from './env.js';
export type { Job, ReservedJob } from './queue.js';
export type { JobHandler } from './worker.js';
export type { AgentForTurn, RuntimeStore, TurnRecord, TurnRequest } from './store.js';
export type { ToolResult } from './tools/types.js';
