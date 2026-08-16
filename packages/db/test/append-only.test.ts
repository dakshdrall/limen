/**
 * The audit trail is append-only, proved by being refused.
 *
 * This is the one fence in this package that cannot be proved by reading. A
 * `GRANT` statement in a migration is a claim about SQL that was typed; the
 * property is about access that was refused, and the only way to see a refusal
 * is to connect as the role the grant constrains and try.
 *
 * ## What this proves, and the assumption it makes visible
 *
 * Postgres gives a table's **owner** every privilege on it regardless of
 * grants. So "append-only" is true only if the application does not connect as
 * the owner — a deployment fact, not a schema fact. This test makes that
 * assumption explicit by constructing exactly the situation the deployment must
 * create: a login role that owns nothing and is a member of `limen_app`.
 *
 * If the application is ever pointed at the database as the owner, this test
 * still passes and the property is still false. That cannot be closed from
 * inside the schema, so it is stated here and in `0001`'s header rather than
 * left to be assumed.
 *
 * ## Why this does not skip quietly when there is no database
 *
 * A test that skips when a service is absent passes forever on a machine that
 * never has one, which is the vacuous-fence failure this repository keeps
 * closing. So: absent a database it skips **locally** with a printed notice,
 * and **fails in CI**, where the service is always provided. The CI run is the
 * one that gates a merge, and it is the one that cannot be allowed to go green
 * without having tried.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL ?? process.env.MIGRATE_DATABASE_URL ?? '';
const inCi = process.env.CI !== undefined && process.env.CI !== '' && process.env.CI !== 'false';

/**
 * A throwaway login role, created per run and dropped after.
 *
 * Not a fixture role created by a migration: the migration deliberately creates
 * `limen_app` as NOLOGIN so that no credential lives in a committed file. This
 * is the deployment's half of that arrangement, performed for the length of one
 * test.
 */
const ROLE = 'limen_test_app';
const PASSWORD = 'limen_test_app';

let owner: pg.Pool | undefined;
let app: pg.Pool | undefined;

beforeAll(async () => {
  if (url.length === 0) return;

  owner = new pg.Pool({ connectionString: url, max: 2 });
  await owner.query(`DROP ROLE IF EXISTS ${ROLE}`);
  await owner.query(`CREATE ROLE ${ROLE} LOGIN PASSWORD '${PASSWORD}'`);
  await owner.query(`GRANT limen_app TO ${ROLE}`);
  // Connect on the database itself; membership carries the table privileges.
  const dbName = new URL(url).pathname.slice(1);
  await owner.query(`GRANT CONNECT ON DATABASE "${dbName}" TO ${ROLE}`);

  const asApp = new URL(url);
  asApp.username = ROLE;
  asApp.password = PASSWORD;
  app = new pg.Pool({ connectionString: asApp.toString(), max: 2 });
});

afterAll(async () => {
  await app?.end();
  if (owner !== undefined) {
    await owner.query(`REASSIGN OWNED BY ${ROLE} TO CURRENT_USER`).catch(() => undefined);
    await owner.query(`DROP OWNED BY ${ROLE}`).catch(() => undefined);
    await owner.query(`DROP ROLE IF EXISTS ${ROLE}`).catch(() => undefined);
    await owner.end();
  }
});

describe('audit_events is append-only for the application role', () => {
  it('has a database to prove it against', () => {
    if (url.length === 0 && !inCi) {
      // Local, no database. Say so loudly rather than reporting a pass that
      // means nothing.
      console.error(
        'append-only.test.ts: no TEST_DATABASE_URL — the append-only grant was NOT exercised. ' +
          'Run a Postgres and set TEST_DATABASE_URL to prove it. This fails rather than skips in CI.',
      );
    }
    // In CI this is the assertion that refuses to let an unproven fence pass.
    if (inCi) expect(url.length, 'CI must provide TEST_DATABASE_URL').toBeGreaterThan(0);
  });

  it.runIf(url.length > 0)('is not connected as the owner, or this proves nothing', async () => {
    const { rows } = await app!.query<{ current_user: string; is_owner: boolean }>(
      `SELECT current_user, pg_catalog.pg_get_userbyid(relowner) = current_user AS is_owner
         FROM pg_class WHERE relname = 'audit_events'`,
    );
    expect(rows[0]?.current_user).toBe(ROLE);
    expect(rows[0]?.is_owner, 'connected as the table owner; every grant below is moot').toBe(false);
  });

  it.runIf(url.length > 0)('can append', async () => {
    await expect(
      app!.query(`INSERT INTO audit_events (actor, action) VALUES ('system', 'append-only test')`),
    ).resolves.toBeDefined();
  });

  it.runIf(url.length > 0)('can read', async () => {
    const { rows } = await app!.query(`SELECT count(*)::int AS n FROM audit_events`);
    expect(rows[0]).toBeDefined();
  });

  it.runIf(url.length > 0)('cannot rewrite history', async () => {
    await expect(app!.query(`UPDATE audit_events SET action = 'rewritten'`)).rejects.toThrow(
      /permission denied/i,
    );
  });

  it.runIf(url.length > 0)('cannot delete history', async () => {
    await expect(app!.query(`DELETE FROM audit_events`)).rejects.toThrow(/permission denied/i);
  });

  it.runIf(url.length > 0)('can still update a table that is not the audit trail', async () => {
    // The other direction, and the one that makes the refusals above mean
    // something. If the role simply had no privileges anywhere, every assertion
    // above would pass for the wrong reason.
    await expect(app!.query(`UPDATE agents SET name = name WHERE false`)).resolves.toBeDefined();
  });
});
