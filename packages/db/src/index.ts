/**
 * @limen/db — one schema, two access paths, and a third that only migrations use.
 *
 * The paths are deliberately not interchangeable and are not re-exported from a
 * single `db` symbol. §7.5.2 chooses a driver per runtime shape, and a shared
 * export would let a Vercel function acquire a pooled connection — the exact
 * thing the split exists to prevent — by importing the wrong name.
 *
 *   `@limen/db/web`      `neon-http`, for `apps/web`. No connection to exhaust.
 *   `@limen/db/runtime`  bounded `pg.Pool`, for `apps/runtime`. Transactions.
 *   `drizzle-kit`        the direct, unpooled endpoint. Migrations only.
 *
 * The third is a CLI rather than an export because it must never be reachable
 * from application code: transaction-mode poolers break DDL and the session
 * advisory locks migration tools take, and running migrations through the
 * pooler is a well-known way to get a half-applied schema.
 *
 * This module exports the schema, the amount type and the pooler fence — the
 * things both paths share — and nothing that opens a connection.
 */

export * from './schema.js';
export { amount } from './amount.js';
export { assertPoolable, PoolerHazardError, POOLER_HAZARDS } from './forbidden.js';
