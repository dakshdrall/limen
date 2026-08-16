/**
 * The three things a transaction-mode pooler breaks, kept out by construction.
 *
 * This is the fence the local environment makes necessary. Postgres in a
 * container accepts session advisory locks, `LISTEN`/`NOTIFY` and named
 * prepared statements; PgBouncer in transaction mode does not. So all three
 * work on a developer's machine, work in CI, and fail in production as an
 * intermittent — which on a money path is the worst available shape, because
 * two agents building on one sequence number produce a failure that looks
 * exactly like a refusal.
 *
 * Two halves, catching different things, as `forbidden.ts` sets out:
 *
 *   - the **source scan** here catches somebody writing one, at review time;
 *   - **`assertPoolable`** catches a statement assembled at runtime, or one
 *     arriving from a dependency rather than from this repository.
 *
 * Both are proved able to fire against synthetic samples before being trusted
 * to have found nothing — the same argument `local-key-label.test.ts` makes for
 * its detectors, and for the same reason: a scan that matches nothing is
 * indistinguishable from one with nothing to match.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { POOLER_HAZARDS, PoolerHazardError, assertPoolable } from '../src/forbidden.js';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * Every workspace, discovered rather than listed — the B4 lesson, applied to a
 * different fence.
 *
 * A hand-maintained root list catches a hazard written in a directory somebody
 * thought of and says nothing about one written in a directory somebody added
 * later. `packages/policy`, `packages/custody` and `apps/telegram` do not exist
 * yet and will be scanned on the day they do, by nobody doing anything.
 */
function discoverRoots(): { name: string; dir: string }[] {
  const found: { name: string; dir: string }[] = [];
  for (const group of ['apps', 'packages']) {
    const groupDir = join(REPO_ROOT, group);
    if (!existsSync(groupDir)) continue;
    for (const workspace of readdirSync(groupDir, { withFileTypes: true })) {
      if (!workspace.isDirectory()) continue;
      const dir = join(groupDir, workspace.name, 'src');
      if (!existsSync(dir)) continue;
      found.push({ name: `${group}/${workspace.name}/src`, dir });
    }
  }
  return found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

const ROOTS = discoverRoots();

/**
 * Comments stripped, for both directions of the same reason the tripwire strips
 * them: `forbidden.ts` explains at length what `pg_advisory_lock` is and must
 * not be accused of calling it.
 */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

interface Source {
  path: string;
  text: string;
}

function sources(): Source[] {
  return ROOTS.flatMap(({ name, dir }) =>
    readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .filter((rel) => rel.endsWith('.ts') || rel.endsWith('.tsx'))
      .map((rel) => ({ path: `${name}/${rel}`, text: code(readFileSync(join(dir, rel), 'utf8')) })),
  );
}

/**
 * The one file that names these patterns as data rather than using them.
 *
 * Excluded by path, and it is the only exclusion. `forbidden.ts` holds the
 * regexes themselves, so it necessarily contains text matching them — the same
 * shape as the label set containing its own labels.
 */
const DEFINITION = 'packages/db/src/forbidden.ts';

describe('the scan covers every workspace', () => {
  it('discovered a non-empty set including the ones that exist today', () => {
    const names = ROOTS.map(({ name }) => name);
    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain('apps/web/src');
    expect(names).toContain('packages/chain/src');
    expect(names).toContain('packages/db/src');
    expect(names).toContain('packages/shared/src');
  });

  it('is reading files, not an empty directory', () => {
    expect(sources().length).toBeGreaterThan(20);
  });
});

describe('nothing in the tree uses what the pooler breaks', () => {
  for (const hazard of POOLER_HAZARDS) {
    it(`has no ${hazard.name}`, () => {
      const offenders = sources()
        .filter(({ path }) => path !== DEFINITION)
        .filter(({ text }) => hazard.pattern.test(text))
        .map(({ path }) => path);

      // If this fails: the pattern will work against a local Postgres and fail
      // intermittently against Neon's pooled endpoint. Use ${hazard.instead}.
      // Deleting this test is not the fix.
      expect(offenders, `use ${hazard.instead}`).toEqual([]);
    });
  }

  it('excludes exactly one file, and that file really is there', () => {
    // So the exclusion cannot be quietly covering an empty scan.
    expect(sources().map(({ path }) => path)).toContain(DEFINITION);
  });
});

describe('the detectors fire, which is why their silence means something', () => {
  it('catches a session advisory lock in the shapes one gets written', () => {
    for (const sample of [
      "await db.execute(sql`SELECT pg_advisory_lock(${key})`)",
      'SELECT pg_try_advisory_lock(1, 2)',
      'select pg_advisory_unlock_all()',
      'SELECT pg_advisory_lock_shared(7)',
    ]) {
      expect(POOLER_HAZARDS[0]!.pattern.test(sample), sample).toBe(true);
    }
  });

  it('permits the transaction-scoped locks, which the pooler cannot strand', () => {
    // A fence that forbids correct code loses its authority for the cases that
    // matter, and banning the whole family would push somebody toward a worse
    // workaround. `_xact_` locks are released at commit.
    for (const sample of [
      'SELECT pg_try_advisory_xact_lock(1)',
      'SELECT pg_advisory_xact_lock(1, 2)',
    ]) {
      expect(POOLER_HAZARDS[0]!.pattern.test(sample), sample).toBe(false);
    }
  });

  it('catches LISTEN and NOTIFY without firing on the English words', () => {
    expect(POOLER_HAZARDS[1]!.pattern.test('LISTEN job_ready')).toBe(true);
    expect(POOLER_HAZARDS[1]!.pattern.test("await client.query('NOTIFY jobs')")).toBe(true);
    expect(POOLER_HAZARDS[1]!.pattern.test('UNLISTEN "jobs"')).toBe(true);
    // The other direction: a fence that fired on prose would be turned off.
    expect(POOLER_HAZARDS[1]!.pattern.test('we notify the user when it lands')).toBe(false);
    expect(POOLER_HAZARDS[1]!.pattern.test('const listeners = new Set()')).toBe(false);
  });

  it('catches a named prepared statement', () => {
    expect(POOLER_HAZARDS[2]!.pattern.test('PREPARE find_agent AS SELECT 1')).toBe(true);
    expect(POOLER_HAZARDS[2]!.pattern.test('const prepared = query.prepare()')).toBe(false);
  });
});

describe('assertPoolable refuses rather than warns', () => {
  it('throws on each hazard, naming what to use instead', () => {
    expect(() => assertPoolable('SELECT pg_advisory_lock(1)')).toThrow(PoolerHazardError);
    expect(() => assertPoolable('LISTEN jobs')).toThrow(PoolerHazardError);
    expect(() => assertPoolable('PREPARE p AS SELECT 1')).toThrow(PoolerHazardError);
  });

  it('says what broke and what to use, because a bare refusal has to be researched', () => {
    try {
      assertPoolable('SELECT pg_advisory_lock(1)');
      expect.unreachable('should have thrown');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('transaction-mode pooler');
      expect(message).toContain('Redis');
      expect(message).toContain('appear to work against a local Postgres');
    }
  });

  it('lets ordinary queries through', () => {
    for (const sample of [
      'SELECT * FROM agents WHERE user_id = $1',
      'INSERT INTO audit_events (actor, action) VALUES ($1, $2)',
      'BEGIN',
      'COMMIT',
      'SELECT pg_try_advisory_xact_lock($1)',
    ]) {
      expect(() => assertPoolable(sample), sample).not.toThrow();
    }
  });
});
