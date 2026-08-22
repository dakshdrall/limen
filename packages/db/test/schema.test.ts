/**
 * What the schema cannot hold, asserted against the SQL that actually runs.
 *
 * These read `migrations/0000_foundations.sql` and the snapshot beside it, not
 * `schema.ts`. The distinction is the point: `schema.ts` is what somebody
 * intended and the migration is what the database will be. A property proved
 * against the TypeScript would survive a hand-edited migration, and hand-edited
 * migrations are exactly what this package invites — `0001` is one.
 *
 * No database is needed to run any of this, which is deliberate. These are the
 * checks that must never be skipped, so they must never depend on a service
 * being up. `append-only.test.ts` is the one fence here that genuinely cannot
 * be proved without a connection, and it says so.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url));

const files = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith('.sql'))
  .sort();

/** Every migration concatenated: a property must hold across all of them. */
const sql = files.map((name) => readFileSync(`${MIGRATIONS}${name}`, 'utf8')).join('\n');

/** Comments stripped, so a paragraph explaining a prohibition cannot violate it. */
const ddl = sql.replace(/^\s*--.*$/gm, '');

interface Column {
  name: string;
  type: string;
  table: string;
}

/**
 * Every column as of the **latest** snapshot, read out of drizzle-kit's own.
 *
 * The snapshot rather than a SQL parse: it is generated from the same run that
 * wrote the SQL, it is committed beside it, and parsing `CREATE TABLE` bodies
 * by regex is the kind of thing that quietly stops matching when a type gains a
 * modifier — a fence that fails by not matching anything is the failure mode
 * this repository has already been bitten by once.
 *
 * **The latest, not the first, and that distinction was a real hole.** This read
 * `meta/0000_snapshot.json` by name when it was written, which made every
 * assertion below a statement about the schema as it was on the day the package
 * landed. A migration `0002` adding a `secret_key` column would have applied
 * cleanly and every fence here would have stayed green — the fence describing
 * the past while the database moved on, which is the same shape as the caveat
 * that outlived the file it cited. Sorting and taking the last means a new
 * migration is covered by the fence the moment `drizzle-kit generate` writes its
 * snapshot.
 *
 * The hand-written migrations are covered by the raw-DDL scan below rather than
 * by this, since they have no snapshot of their own: `0001` grants privileges
 * and adds no columns, but the next one might.
 */
function latestSnapshot(): string {
  const snapshots = readdirSync(`${MIGRATIONS}meta`)
    .filter((name) => /^\d{4}_snapshot\.json$/.test(name))
    .sort();
  const last = snapshots.at(-1);
  if (last === undefined) throw new Error('no drizzle snapshot found; the schema fences would assert nothing');
  return `${MIGRATIONS}meta/${last}`;
}

function columns(): Column[] {
  const snapshot = JSON.parse(readFileSync(latestSnapshot(), 'utf8')) as {
    tables: Record<string, { name: string; columns: Record<string, { name: string; type: string }> }>;
  };
  return Object.values(snapshot.tables).flatMap((table) =>
    Object.values(table.columns).map((column) => ({
      name: column.name,
      type: column.type,
      table: table.name,
    })),
  );
}

const ALL = columns();

describe('the fences are not reading an empty file', () => {
  it('found the migrations', () => {
    expect(files.length).toBeGreaterThan(0);
    expect(files[0]).toBe('0000_foundations.sql');
  });

  it('found every table', () => {
    // 14 tables, matching Part V exactly. A snapshot that parsed to nothing
    // would make every assertion below a claim about an empty array.
    const tables = new Set(ALL.map((column) => column.table));
    expect(tables.size).toBe(14);
    for (const table of ['users', 'sessions', 'agents', 'agent_keys', 'audit_events', 'transactions']) {
      expect(tables, `${table} is missing from the snapshot`).toContain(table);
    }
  });
});

describe('no plaintext secret column exists, under any name', () => {
  /**
   * The §3 promise, as a property of the schema rather than of a review.
   *
   * PLAN-V8 M2 lists this as a schema test and the table it guards lands here
   * at M1, so the fence lands with the table rather than one milestone after
   * it. The whole point of envelope encryption is that the seed exists in
   * plaintext only inside the signer process for the duration of one signature;
   * a column able to hold it is a place it could come to rest.
   *
   * The names are the ones somebody would actually reach for. This cannot be
   * exhaustive and does not pretend to be — a column called `blob` would pass —
   * so it is paired with the structural half below: `agent_keys` has a known,
   * closed set of columns, and gaining any is a red build.
   */
  const FORBIDDEN = [
    'secret',
    'seed',
    'private_key',
    'privatekey',
    'plaintext',
    'mnemonic',
    'passphrase',
    'password',
    'signing_key',
    'raw_key',
  ];

  it('has no column named for a secret in any table', () => {
    const offenders = ALL.filter((column) =>
      FORBIDDEN.some((word) => column.name.toLowerCase().includes(word)),
    ).map((column) => `${column.table}.${column.name}`);

    // If this fails: a key, a password or a seed has a column to live in. The
    // fix is envelope encryption and a `ciphertext` column, never a rename.
    expect(offenders).toEqual([]);
  });

  it('has no such column added by a hand-written migration either', () => {
    // The snapshot only describes migrations drizzle-kit generated. `0001` is
    // hand-written and there will be more of them — this package invites them,
    // because grants and policies are not expressible in a schema DSL. So the
    // raw DDL is scanned too, comments stripped, across every migration.
    //
    // Cruder than the snapshot read and deliberately so: it looks for the word
    // in an `ADD COLUMN` or a `CREATE TABLE` body rather than parsing either.
    const offenders = FORBIDDEN.filter((word) =>
      new RegExp(`(?:ADD COLUMN|"|,|\\()\\s*"?[a-z_]*${word}[a-z_]*"?\\s+(?:text|bytea|varchar|jsonb)`, 'i').test(
        ddl,
      ),
    );
    expect(offenders).toEqual([]);
  });

  it('keeps agent_keys to exactly the columns that hold no plaintext', () => {
    // The structural half. Names can be invented; this closes the set.
    const agentKeys = ALL.filter((column) => column.table === 'agent_keys')
      .map((column) => column.name)
      .sort();
    expect(agentKeys).toEqual([
      'agent_id',
      // The public half, added by `0003`. It is the one column here that is not
      // ciphertext, and admitting it was a deliberate hand edit to this list
      // rather than something a migration did quietly — which is exactly what
      // closing the set is for. A `G…` address is not key material: the rule
      // this assertion enforces is that no column can hold the *private* half,
      // and that is unchanged. See `schema.ts` on why it is not derived from
      // the sealed seed instead.
      'agent_public_key',
      'algorithm',
      'ciphertext',
      'created_at',
      'id',
      'kms_key_id',
      'rotated_at',
      'wrapped_data_key',
    ]);
  });

  it('records kms_key_id from the first migration, not a later one', () => {
    // §7.5.3 condition 3. The env-var master ships at M2 and a real KMS is a
    // mainnet precondition, so rows written before the swap have to stay
    // attributable to the provider that wrapped them. A column added later
    // cannot say anything about the rows that already exist — which is the one
    // thing it would be needed for.
    const first = readFileSync(`${MIGRATIONS}0000_foundations.sql`, 'utf8');
    expect(first).toContain('"kms_key_id"');
    // And not nullable: a row that does not say which provider wrapped it is
    // exactly the unattributable row this exists to prevent.
    expect(/"kms_key_id" text NOT NULL/.test(first)).toBe(true);
  });
});

describe('design rule 5 crosses the database boundary intact', () => {
  it('has no floating-point column anywhere', () => {
    // Not "no float near an amount" — no float at all. A `double precision`
    // column is exact only to 2^53, and the rule is on the shape rather than on
    // whether the author believed this particular value was an amount.
    const floats = ALL.filter((column) => /double precision|^real$|^float/i.test(column.type)).map(
      (column) => `${column.table}.${column.name} (${column.type})`,
    );
    expect(floats).toEqual([]);
  });

  it('stores every amount as numeric(39, 0), which covers i128', () => {
    // `_ledger` is excluded because a ledger sequence is a counter, not a
    // value: `fee_balance_ledger` says *when* the balance beside it was read.
    // It is `integer` on purpose, and the exclusion is by suffix rather than by
    // name so a second cached pair cannot quietly avoid this rule.
    const amounts = ALL.filter(
      (column) => /amount|balance/.test(column.name) && !column.name.endsWith('_ledger'),
    );
    expect(amounts.length).toBeGreaterThan(0);
    for (const column of amounts) {
      expect(column.type, `${column.table}.${column.name}`).toBe('numeric(39, 0)');
    }
  });

  it('does not store an amount as int8, which is too narrow for i128', () => {
    const narrow = ALL.filter(
      (column) => /amount|balance/.test(column.name) && /bigint|int8/i.test(column.type),
    ).map((column) => `${column.table}.${column.name}`);
    expect(narrow).toEqual([]);
  });
});

describe('nothing caches a claim about chain state', () => {
  /**
   * `lib/store.ts`'s rule, inherited by the server.
   *
   * A cached copy is a claim about the past rendered as the present: a policy
   * revoked on another device, or expired while the process was asleep, would
   * still read as live. Every boundary looks perfectly obeyed if you are
   * reading yesterday's copy of it.
   */
  it('has no column claiming a cap, a remaining spend, or that a rule is live', () => {
    const cached = ALL.filter((column) =>
      /^(?:current_|remaining_|installed_)|_remaining$|^is_live|_is_live$|^live_/.test(column.name),
    ).map((column) => `${column.table}.${column.name}`);
    expect(cached).toEqual([]);
  });

  it('names every denormalised chain value *_last_seen, and stores its ledger', () => {
    // The escape hatch, and the thing that makes it safe: a `*_last_seen`
    // column is findable by grep and obliges the render to state the ledger it
    // was read at. A cached value with no ledger beside it cannot be rendered
    // honestly, so the pairing is asserted rather than remembered.
    const lastSeen = ALL.filter((column) => column.name.endsWith('_last_seen'));
    expect(lastSeen.length).toBeGreaterThan(0);
    for (const column of lastSeen) {
      const ledger = column.name.replace(/_last_seen$/, '_ledger');
      const beside = ALL.some((other) => other.table === column.table && other.name === ledger);
      expect(beside, `${column.table}.${column.name} has no ${ledger} beside it`).toBe(true);
    }
  });
});

describe('the two identifiers this schema refuses to hold', () => {
  it('stores no Telegram username', () => {
    // Brief §20: it is not identity, and it is user-changeable. A column for it
    // is an invitation to resolve an account by one.
    const usernames = ALL.filter((column) => /username/i.test(column.name)).map(
      (column) => `${column.table}.${column.name}`,
    );
    expect(usernames).toEqual([]);
  });

  it('stores a session IP only as a hash', () => {
    const ipColumns = ALL.filter((column) => /(^|_)ip(_|$)/i.test(column.name));
    expect(ipColumns.length).toBeGreaterThan(0);
    for (const column of ipColumns) {
      expect(column.name, `${column.table}.${column.name} is a raw IP`).toMatch(/_hash$/);
    }
  });
});

describe('mainnet cannot arrive by accident', () => {
  it('keeps network a one-member enum', () => {
    // The level-1 gate, same shape `@limen/core`'s types use. Adding 'mainnet'
    // is a deliberate, greppable, one-line act rather than a config value.
    expect(ddl).toContain(`CREATE TYPE "public"."network" AS ENUM('testnet')`);
    expect(ddl).not.toContain("'mainnet'");
  });
});
