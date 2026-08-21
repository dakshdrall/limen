/**
 * The ten minutes PLAN-V8 §7.5.2 has been waiting on: how `neon-http`'s
 * transaction limitation surfaces in Drizzle's API, measured rather than
 * assumed.
 *
 * Neon documents that the HTTP driver supports single non-interactive queries
 * and not interactive transactions. What is *not* documented is what
 * `db.transaction()` does about it, and §7.5.2 lists three possibilities that
 * are not equally survivable:
 *
 *   1. absent from the type — a compile error, and no further fence needed;
 *   2. present and throws at runtime — recoverable, but it has to be *proved*
 *      to throw rather than assumed to;
 *   3. **present and silently runs the statements unwrapped** — a caller
 *      believing three writes are atomic when they are three independent
 *      writes, which nothing in the types or the suite would show.
 *
 * Case 3 is the reason this exists. It cannot be distinguished from case 1 by
 * reading types, it cannot be inferred from Neon's documentation, which
 * describes the driver rather than the ORM wrapper, and it cannot be reproduced
 * against the local Postgres the rest of `@limen/db`'s suite runs on, because
 * `neon-http` speaks Neon's HTTP protocol and a container does not.
 *
 * ## How the question is actually put
 *
 * Two statements inside one `transaction`, the second of which must fail: a
 * second insert of a primary key the first just wrote. Then the table is read
 * back **through a different driver** — `node-postgres` against the direct
 * endpoint — because reading it back through the driver under test would be
 * asking the suspect to describe the scene.
 *
 *   - no row survives, and the call threw  → case 2 if nothing ran at all,
 *     case 1-equivalent in effect if it rolled back;
 *   - **the first row survives**            → case 3, and `createWebDb` grows a
 *     fence in the shape of `assertPoolable`.
 *
 * `db.batch()` is measured in the same run and is not a footnote. It routes
 * through the HTTP driver's own `transaction()` — a *non-interactive* batch,
 * which is exactly the thing Neon says it does support — so whether it is
 * atomic decides what a web route that genuinely needs two writes to stand or
 * fall together is supposed to do. §7.5.2's rule is that such a route moves to
 * `apps/runtime`; knowing whether there is an atomic primitive here at all is
 * what makes that a choice rather than a guess.
 *
 *     DATABASE_URL=… DATABASE_URL_UNPOOLED=… node scripts/measure-web-transaction.mjs
 *
 * It creates one scratch table, writes at most four rows to it, and drops it.
 * It touches nothing the schema defines.
 */

import { sql } from 'drizzle-orm';
import pg from 'pg';
import { createWebDb } from '../dist/web.js';

const httpUrl = process.env.DATABASE_URL ?? '';
const directUrl = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL_UNPOOLED ?? '';

if (httpUrl.length === 0 || directUrl.length === 0) {
  console.error(
    'measure-web-transaction: set DATABASE_URL (the endpoint apps/web uses over neon-http) and\n' +
      'DATABASE_URL_UNPOOLED (the direct endpoint, read back through node-postgres as an independent\n' +
      'witness). Both come from the same Neon project.',
  );
  process.exit(1);
}

const TABLE = '_limen_txn_probe';

const witness = new pg.Pool({ connectionString: directUrl, max: 1 });
const db = createWebDb(httpUrl);

/** Rows, as the *other* driver sees them. */
async function rows() {
  const { rows: found } = await witness.query(`select id from ${TABLE} order by id`);
  return found.map((row) => Number(row.id));
}

const record = {};

try {
  await witness.query(`drop table if exists ${TABLE}`);
  await witness.query(`create table ${TABLE} (id integer primary key, note text not null)`);

  /* --- 1: is it there at all? --------------------------------------------- */

  record.transactionIsAFunction = typeof db.transaction === 'function';
  record.batchIsAFunction = typeof db.batch === 'function';

  /* --- 2: what does it do with two statements, the second of which fails? -- */

  if (record.transactionIsAFunction) {
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql.raw(`insert into ${TABLE} (id, note) values (1, 'first')`));
        // The same primary key again. Postgres refuses this, so a real
        // transaction takes the first insert down with it.
        await tx.execute(sql.raw(`insert into ${TABLE} (id, note) values (1, 'second')`));
      });
      record.transactionThrew = false;
      record.transactionError = null;
    } catch (error) {
      record.transactionThrew = true;
      record.transactionError = error instanceof Error ? error.message : String(error);
    }

    const after = await rows();
    record.rowsAfterTransaction = after;
    record.transactionCase =
      after.includes(1) === false
        ? record.transactionThrew === true
          ? 'refused or rolled back — no statement survived'
          : 'no rows and no error, which is not a shape this measurement anticipated'
        : 'SILENTLY UNWRAPPED — the first statement survived the failure of the second';
  }

  /* --- 3: and the batch, which is the non-interactive one Neon does support */

  await witness.query(`delete from ${TABLE}`);

  if (record.batchIsAFunction) {
    try {
      await db.batch([
        db.execute(sql.raw(`insert into ${TABLE} (id, note) values (2, 'first')`)),
        db.execute(sql.raw(`insert into ${TABLE} (id, note) values (2, 'second')`)),
      ]);
      record.batchThrew = false;
      record.batchError = null;
    } catch (error) {
      record.batchThrew = true;
      record.batchError = error instanceof Error ? error.message : String(error);
    }

    const after = await rows();
    record.rowsAfterBatch = after;
    record.batchIsAtomic = after.includes(2) === false;
  }

  /* --- 4: and the ordinary case still works, so a failure above is real ---- */

  await witness.query(`delete from ${TABLE}`);
  await db.execute(sql.raw(`insert into ${TABLE} (id, note) values (3, 'plain')`));
  record.singleStatementRows = await rows();
  record.singleStatementWorks = record.singleStatementRows.includes(3);
} finally {
  await witness.query(`drop table if exists ${TABLE}`).catch(() => {});
  await witness.end();
}

console.error('\n--- neon-http, as Drizzle exposes it -------------------------');
console.error(`db.transaction is a function : ${String(record.transactionIsAFunction)}`);
if (record.transactionIsAFunction) {
  console.error(`  it threw                   : ${String(record.transactionThrew)}`);
  console.error(`  the message                : ${String(record.transactionError)}`);
  console.error(`  rows left behind           : ${JSON.stringify(record.rowsAfterTransaction)}`);
  console.error(`  verdict                    : ${String(record.transactionCase)}`);
}
console.error(`db.batch is a function       : ${String(record.batchIsAFunction)}`);
if (record.batchIsAFunction) {
  console.error(`  it threw                   : ${String(record.batchThrew)}`);
  console.error(`  rows left behind           : ${JSON.stringify(record.rowsAfterBatch)}`);
  console.error(`  atomic                     : ${String(record.batchIsAtomic)}`);
}
console.error(`a single statement works     : ${String(record.singleStatementWorks)}`);
console.error('\nRUN RECORD ' + JSON.stringify(record));
