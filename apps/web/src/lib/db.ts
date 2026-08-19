/**
 * The web app's one database handle.
 *
 * `@limen/db/web` builds it — `neon-http`, for the reasons §7.5.2 gives and
 * that module's header sets out. This file supplies the connection string and
 * nothing else, and exists so that exactly one module in `apps/web` reads
 * `DATABASE_URL`. The same shape `KeyProvider` uses: a single construction
 * site, so a second access path cannot appear by somebody importing `neon`
 * directly.
 *
 * ## Lazy, because the build must not read the environment
 *
 * `rate-limit.ts` and `challenge.ts` are lazy for this reason and so is this.
 * A module-scope `createWebDb(process.env.DATABASE_URL)` runs at import time,
 * which on Next means at build time, and a build machine has no database. The
 * failure would be a build error on a page that merely imports a type.
 *
 * ## There is no fallback, and that is the difference from `@limen/kv`
 *
 * `resolveWebKeyValue` falls back to an in-memory store outside production,
 * because a process-local rate limit is a *worse* version of the real thing but
 * still a version of it. There is no in-memory version of Postgres that would
 * make a session survive the next request, so the honest behaviour for an
 * unconfigured deployment is to refuse at the point of use and name the
 * variable. A route that needs the database says so; every route that does not
 * is unaffected, which is why the refusal lives here rather than at startup.
 */

import 'server-only';
import { createWebDb, type WebDb } from '@limen/db/web';

export const DATABASE_URL_ENV = 'DATABASE_URL';

let handle: WebDb | undefined;

export function webDb(env: NodeJS.ProcessEnv = process.env): WebDb {
  if (handle !== undefined) return handle;

  const connectionString = (env[DATABASE_URL_ENV] ?? '').trim();
  if (connectionString.length === 0) {
    throw new Error(
      `${DATABASE_URL_ENV} is not set, and this request needs the database. ` +
        'Sessions and users live in Postgres as of PLAN-V8 M1; there is no in-memory stand-in, because a ' +
        'session that does not survive the next request is not a session. See apps/web/src/lib/db.ts.',
    );
  }

  handle = createWebDb(connectionString);
  return handle;
}
