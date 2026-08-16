/**
 * Migrations run against the **direct, unpooled** endpoint. Always.
 *
 * §7.5.2's third row. Transaction-mode pooling breaks DDL and the session-level
 * advisory locks a migration tool takes to stop two deploys applying the same
 * migration at once. Running migrations through the pooler is a well-known way
 * to get a half-applied schema, which is the one database failure that cannot
 * be fixed by retrying.
 *
 * So this reads `DATABASE_URL_UNPOOLED` and never `DATABASE_URL`, and the
 * variable names are chosen to match Neon's own so that nobody has to translate
 * between the dashboard and this file. `MIGRATE_DATABASE_URL` overrides both,
 * for the local Postgres this repository's tests run against.
 *
 * SQL migrations, not a push. `drizzle-kit push` diffs against a live database
 * and applies the difference, which is convenient and leaves nothing to read.
 * §7.5.1 chose Drizzle partly because **migrations are readable SQL files a
 * reviewer can check by reading**, which is the standard every other artefact
 * here is held to — a `push` workflow would have discarded the reason.
 */

import { defineConfig } from 'drizzle-kit';

const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL_UNPOOLED ?? '';

if (url.length === 0) {
  throw new Error(
    'drizzle-kit needs MIGRATE_DATABASE_URL or DATABASE_URL_UNPOOLED — the DIRECT endpoint, not the pooled one. ' +
      'Migrations through a transaction-mode pooler can half-apply. See packages/db/drizzle.config.ts.',
  );
}

if (url.includes('-pooler')) {
  throw new Error(
    'Refusing to run migrations against a pooled endpoint: the host contains "-pooler". ' +
      'Use the direct connection string. See packages/db/drizzle.config.ts.',
  );
}

export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
