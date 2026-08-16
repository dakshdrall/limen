/**
 * The runtime's access path: a bounded pool against Neon's pooled endpoint.
 *
 * §7.5.2's second row. `apps/runtime` is one long-lived process — a known,
 * small number of them — holding a bounded pool, which is the case a connection
 * pool is actually for. It gets full interactive transaction support, and
 * **every multi-statement money-path operation lives here** rather than in the
 * web app, which is the division the whole two-path decision rests on.
 *
 * ## The pool is bounded, and the number is not arbitrary
 *
 * Neon's pooled endpoint fronts a Postgres with a finite backend count. A
 * default `pg.Pool` has `max: 10` per process, which is fine for one process
 * and is not a decision. This one is explicit and small because the failure it
 * prevents is the one §7.5 names: a worker that cannot get a connection should
 * queue, visibly, rather than a fleet of workers quietly exhausting the pooler
 * and turning every query into a timeout that reads as an infrastructure error.
 *
 * ## Every query goes through the hazard guard
 *
 * See `forbidden.ts`. Transaction-mode pooling breaks session advisory locks,
 * `LISTEN`/`NOTIFY` and named prepared statements, and all three work fine
 * against a local Postgres — so the guard is here, on the path that actually
 * talks to the pooler, and not only in a test that reads source.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { assertPoolable } from './forbidden.js';
import * as schema from './schema.js';

/**
 * `numeric` must arrive as a string.
 *
 * `node-postgres` lets a type parser be registered globally, and the one that
 * would be reached for here is `pg.types.setTypeParser(1700, parseFloat)` —
 * which is how an amount silently becomes a double. Registering the identity
 * parser makes the correct behaviour explicit and, more usefully, makes an
 * attempt to register the lossy one a visible conflict rather than a silent
 * win. `amount.ts` then does the `BigInt` parse, which throws on a fraction
 * instead of rounding it.
 */
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value: string) => value);

/**
 * `int8` too, for the same reason and one step earlier.
 *
 * No amount column is `int8` — they are all `numeric(39, 0)`, because i128 does
 * not fit in 64 bits — but a ledger sequence or a count could be, and
 * `node-postgres` returns `int8` as a string by default precisely because
 * parsing it to a `number` loses precision above 2^53. Pinning it here means
 * that default cannot be changed underneath this package by a dependency
 * calling `setTypeParser` first.
 */
pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => value);

export interface RuntimeDbOptions {
  /** Neon's **pooled** connection string — the one with `-pooler` in the host. */
  connectionString: string;
  /** Bounded on purpose. See the header. */
  max?: number;
  /** Milliseconds a caller waits for a connection before failing loudly. */
  connectionTimeoutMillis?: number;
}

/**
 * Builds the runtime's database handle.
 *
 * Not a module-level singleton. A singleton constructed at import time reads
 * the environment as a side effect of somebody importing a type, which is the
 * shape that makes a process fail at startup for reasons unrelated to what it
 * was starting. The runtime constructs one, once, where it can report the
 * failure.
 */
export function createRuntimeDb({
  connectionString,
  max = 8,
  connectionTimeoutMillis = 5_000,
}: RuntimeDbOptions) {
  if (connectionString.length === 0) {
    throw new Error('createRuntimeDb: connectionString is empty. The runtime cannot start without a database.');
  }

  const pool = new pg.Pool({ connectionString, max, connectionTimeoutMillis });

  // The runtime half of the pooler fence. `pg.Pool` routes every text query
  // through `query`, including the ones Drizzle builds, so this sees the
  // statement as it will actually be sent — after any interpolation, which is
  // exactly what a source scan cannot do.
  const query = pool.query.bind(pool);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pg's overloads are not expressible here; the guard reads one field.
  pool.query = ((config: any, ...rest: any[]) => {
    const text = typeof config === 'string' ? config : typeof config?.text === 'string' ? config.text : '';
    if (text.length > 0) assertPoolable(text);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- forwarding pg's own arguments untouched.
    return query(config, ...rest);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

  return { db: drizzle(pool, { schema }), pool };
}

export type RuntimeDb = ReturnType<typeof createRuntimeDb>['db'];
