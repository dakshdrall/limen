/**
 * Applies the migrations, against the direct endpoint, and refuses the pooled one.
 *
 * Deliberately built on `drizzle-orm`'s migrator rather than on `drizzle-kit
 * migrate`, and the distinction is a dependency one. `drizzle-kit` is a
 * devDependency — a developer's tool for *generating* SQL — while applying it
 * is something a deployment does. Making the apply path depend on a dev tool
 * would put the whole of `drizzle-kit`'s dependency tree into a production
 * step, on a repository whose audit gate has already been held hostage once by
 * a transitive dependency nobody imported.
 *
 * Two refusals before anything runs, both in the shape this repository uses for
 * fences rather than warnings:
 *
 *   1. No URL, no run. A migration script that silently does nothing when
 *      misconfigured is how a deploy reports success against an empty schema.
 *   2. A `-pooler` host is refused outright. §7.5.2: transaction-mode pooling
 *      breaks DDL and the session advisory locks a migration tool takes, and a
 *      half-applied schema is the one database failure that retrying cannot
 *      fix.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL_UNPOOLED ?? '';

if (url.length === 0) {
  console.error(
    'migrate: set MIGRATE_DATABASE_URL or DATABASE_URL_UNPOOLED to the DIRECT (unpooled) connection string.',
  );
  process.exit(1);
}

if (url.includes('-pooler')) {
  console.error(
    'migrate: refusing to migrate through a pooled endpoint — the host contains "-pooler".\n' +
      'Transaction-mode pooling breaks DDL and the session advisory locks a migration tool takes.\n' +
      'Use the direct connection string.',
  );
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, max: 1 });

try {
  await migrate(drizzle(pool), {
    migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)),
  });
  console.error('migrate: up to date');
} finally {
  await pool.end();
}
