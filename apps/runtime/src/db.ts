/**
 * The runtime's one database handle.
 *
 * The mirror of `apps/web/src/lib/db.ts`, pointed at the other access path:
 * `@limen/db/runtime` builds a bounded `pg.Pool` against the pooled endpoint,
 * which is the case a pool is actually for — a small number of long-lived
 * processes, with interactive transactions available. §7.5.2's division is that
 * **every multi-statement money-path operation lives on this side**, so this is
 * the handle those statements run on.
 *
 * Constructed once, on demand, and never at import time. `env.ts` already
 * refuses to start without `DATABASE_URL`, so the lazy construction here is not
 * about tolerating a missing variable — it is so that importing this module
 * from a test does not open a pool to Neon.
 */

import { createRuntimeDb, type RuntimeDb } from '@limen/db/runtime';

let handle: { db: RuntimeDb; close: () => Promise<void> } | undefined;

export function runtimeDb(connectionString: string): RuntimeDb {
  if (handle === undefined) {
    const { db, pool } = createRuntimeDb({ connectionString });
    handle = { db, close: () => pool.end() };
  }
  return handle.db;
}

/** Closes the pool, so a shutdown does not leave connections held on the pooler. */
export async function closeRuntimeDb(): Promise<void> {
  const open = handle;
  handle = undefined;
  await open?.close();
}
