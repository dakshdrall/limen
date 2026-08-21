/**
 * Every route refuses when the limiter says *over*, and none of them negate it.
 *
 * A source-level fence, in the shape `packages/custody`'s single-construction
 * -site test uses, and for the same reason: what is being pinned is a property
 * of the call sites rather than of any module's behaviour, and importing a Next
 * route handler to assert it would need the request context the handler runs
 * in.
 *
 * ## What went wrong, which is why this exists
 *
 * `RateLimit.check` returns **true when the call is over the budget** — its
 * only sensible polarity, since a limiter that returned "ok" would have to
 * decide what ok means on a store outage. All three auth routes shipped as
 * `if (!(await limit.check(address))) return 429`, which is the same sentence
 * backwards:
 *
 *   - every request **inside** the budget was refused, so the passkey ceremony
 *     could not complete at all against a working store;
 *   - every request **beyond** it was admitted, so the limit inverted into a
 *     floor;
 *   - and `check`'s deliberate fail-**open** on a store error — documented in
 *     `packages/kv/src/rate-limit.ts` as the one place in this repository where
 *     a fence fails open on purpose — became a fail-closed, taking every public
 *     endpoint down with the store.
 *
 * Nothing caught it. The unit suites drive `registerPasskey` and
 * `loginWithPasskey` beneath the routes, and the routes themselves had never
 * been called by a browser — the *"UNRUN at M1"* record in PLAN-V8 §M1 said so
 * in as many words. The M1 close-out run put a browser in front of them and the
 * first click came back `rate_limited`.
 *
 * ## Two-sided, like every other grep fence here
 *
 * A negation-free file set proves nothing if the set is empty or if the routes
 * stopped calling a limiter, so the count is asserted first. The positive half
 * is what makes the negative half mean something.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = fileURLToPath(new URL('../src/app/api', import.meta.url));

function routeFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return entry === 'route.ts' ? [path] : [];
  });
}

/** Every `…check(…)` call, with the file and line, ignoring comment lines. */
const callSites = routeFiles(API).flatMap((path) =>
  readFileSync(path, 'utf8')
    .split('\n')
    .map((line, index) => ({ path: path.slice(API.length + 1), line: index + 1, text: line }))
    .filter(({ text }) => /\.check\(/.test(text) && !/^\s*(\/\/|\*|\/\*)/.test(text)),
);

describe('the rate limiter is read in the direction it answers in', () => {
  it('is checked by the routes at all, or the rule below is vacuous', () => {
    expect(callSites.length, 'no route calls a rate limiter — this fence would pass by not looking').toBeGreaterThanOrEqual(
      10,
    );
    // The three that were wrong, named, so a rename cannot quietly drop them
    // out of the set the way a moved file would.
    for (const route of ['auth/challenge/route.ts', 'auth/register/route.ts', 'auth/login/route.ts']) {
      expect(
        callSites.some(({ path }) => path === route),
        `${route} no longer rate-limits anything`,
      ).toBe(true);
    }
  });

  it('is never negated: `check` means over-budget, and over-budget is the refusal', () => {
    const negated = callSites.filter(({ text }) => /!\s*\(?\s*await\s+[\w.]*\.?check\(/.test(text));
    expect(
      negated.map(({ path, line }) => `${path}:${line}`),
      'a negated check refuses everything inside the budget and admits everything beyond it',
    ).toEqual([]);
  });

  it('answers a checked limit with a refusal, on the branch the check opens', () => {
    for (const { path, line } of callSites) {
      const body = readFileSync(join(API, path), 'utf8').split('\n');
      // The refusal is on the same line or in the short block that opens on
      // it. Either spelling counts: most routes name the code, and
      // `report/route.ts` deliberately answers a bodiless 429 on the grounds
      // that a caller over its budget is owed nothing.
      const opened = body.slice(line - 1, line + 4).join('\n');
      expect(opened, `${path}:${line} checks a limit and refuses nothing`).toMatch(/rate_limited|429/);
    }
  });
});
