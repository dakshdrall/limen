/**
 * The web app's access path: `neon-http`, which has no connection to exhaust.
 *
 * §7.5.2's first row, and the reason it is a different driver rather than a
 * differently-tuned pool. Vercel autoscales to 30,000 concurrent executions and
 * lists 1,024 file descriptors shared across them, naming database connections
 * as consumers. A plain `pg` client from a serverless function opens one
 * connection per instance against a Postgres that accepts a few hundred, and
 * the arithmetic does not work at any pool size.
 *
 * `neon-http` sends each query as an HTTP request. **There is no connection to
 * exhaust**, so the 30,000-instance case has no pool to run out of. That is the
 * whole argument; everything below is what it costs.
 *
 * ## The constraint this buys, stated because it is load-bearing elsewhere
 *
 * `neon-http` supports single non-interactive queries and **not** interactive
 * transactions — multi-statement work with conditional logic between statements
 * needs the WebSocket driver or the pooled endpoint. `db.transaction(...)` is
 * therefore not available on this handle, and that is by design rather than by
 * omission.
 *
 * It is acceptable because of how the work divides: the web app reads and
 * writes single rows, and **every multi-statement money-path operation lives in
 * `apps/runtime`**, which is on `node-postgres` with full transaction support.
 *
 * **If a web route turns out to need an interactive transaction, it moves to
 * the runtime API — the driver does not change.** That is the right pressure
 * anyway: a money-path write reaching the database from a Vercel function is
 * something this architecture should resist, and the driver making it awkward
 * is the architecture holding rather than an obstacle to route around.
 *
 * ## What is measured and what is assumed
 *
 * That `neon-http` cannot do interactive transactions is documented by Neon.
 * *How that surfaces in Drizzle's API* — whether `db.transaction()` is absent,
 * throws, or silently runs statements unwrapped — is the part §7.5.2 says is
 * worth ten minutes against a real instance rather than being assumed. That
 * measurement has **not been run**: there is no Neon instance in this
 * environment, and a local Postgres cannot exercise this driver. It is recorded
 * as UNRUN in PLAN-V8 §7.5.2 with what would settle it, rather than being
 * quietly treated as checked. The silent case is the one that matters, because
 * statements that run unwrapped when the caller believes they are atomic is the
 * failure this whole division of work exists to prevent.
 */

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema.js';

/**
 * Builds the web app's database handle.
 *
 * Takes the connection string rather than reading `process.env` so that a route
 * importing a type does not read the environment, and so a test can construct
 * one without one.
 */
export function createWebDb(connectionString: string) {
  if (connectionString.length === 0) {
    throw new Error('createWebDb: connectionString is empty.');
  }
  return drizzle(neon(connectionString), { schema });
}

export type WebDb = ReturnType<typeof createWebDb>;
