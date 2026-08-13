import { defineConfig, devices } from '@playwright/test';

/**
 * The browser checks that are cheap enough to gate every push.
 *
 * `playwright.config.ts` is the on-demand suite. It exists to drive
 * `account-lifecycle.spec.ts`, which submits a real transaction to Stellar
 * testnet on every run, and everything about it is shaped by that: one worker,
 * no retries, a cold server per invocation. Those properties are load-bearing
 * for the claim that suite makes, and nothing here should be allowed to erode
 * them.
 *
 * So this is a second config rather than a second project in the first one.
 * That is forced, not stylistic: Playwright's `webServer` is a property of
 * `TestConfig`, never of `TestProject`, so a project cannot own a server. The
 * only ways to give these tests a server of their own are a second config file
 * or a second entry in a shared `webServer` array — and the array is shared, so
 * every on-demand run would pay to boot the CI server and every CI run would
 * boot the testnet suite's. Two files, two servers, no shared surface.
 *
 *     npm run e2e:ci -w @limen/web
 *
 * ## What it selects, and how
 *
 * By tag, not by title and not by filename. `@ci` is written at the two
 * describes in `viewports.spec.ts` that qualify, so the selection is a mark in
 * the source that a reader sees next to the suite it governs. A `grep` on
 * prose titles would be the same check spelled as a coincidence — renaming a
 * describe would silently drop it out of CI, which is precisely the way this
 * repo keeps losing coverage.
 *
 * A tag that matches nothing is not a quiet pass: Playwright exits non-zero
 * with "no tests found" when a filter selects an empty set. Deleting the tag
 * turns the job red rather than green-and-empty.
 *
 * ## Why this server is deliberately unconfigured
 *
 * `env` below pins `SOROBAN_RPC_URL` and the simulation source to empty on
 * purpose, and that is the most consequential line in the file.
 *
 * A GitHub runner has no `.env.local`, so CI would get an unconfigured server
 * whether or not this said so. A developer machine has one, so without these
 * lines the same command would read the live chain locally and not in CI — and
 * the difference would show up as a check that passes for one of them and not
 * the other, diagnosed as flake. Pinning the environment here makes a local run
 * of this config reproduce the CI run exactly, which is the only way the job is
 * debuggable from a laptop.
 *
 * The cost is real and is stated where it is enforced, in
 * `TABLES_EXPECTED_ANYWHERE` in `viewports.spec.ts`: an unconfigured server
 * cannot render the account detail screen's table, so the column check does not
 * cover that screen here. It covers it in the on-demand suite, where the RPC is
 * configured. The alternative — pointing CI at the public testnet RPC — buys
 * that one screen at the price of a per-push gate that goes red when a public
 * endpoint has a bad afternoon, and a gate that fails for reasons unrelated to
 * the diff is one people learn to ignore.
 */
export default defineConfig({
  testDir: './e2e',

  // Only the suites marked cheap. Everything else in `testDir` — above all
  // `account-lifecycle.spec.ts` — is unreachable from this config by
  // construction, not by remembering to exclude it.
  grep: /@ci/,

  // Generous because the routes are visited in series inside a single test, not
  // because any one of them is slow. Both suites also set their own.
  timeout: 180_000,
  expect: { timeout: 30_000 },

  // One worker. These tests are read-only and would parallelise correctly, but
  // the machine is a shared runner and the thing being measured is layout under
  // a fixed viewport — contention that changes paint timing is a source of
  // difference that has nothing to do with the diff.
  workers: 1,

  // No retries, for the reason the on-demand config has none, minus the money.
  // A layout assertion that passes on the second attempt did not flake; it
  // found a race in the page, and retrying is how that becomes invisible.
  retries: 0,

  // A stray `test.only` in a gate would skip everything else and report green.
  forbidOnly: true,

  reporter: process.env.CI === undefined ? [['list']] : [['list'], ['github']],

  use: {
    baseURL: 'http://127.0.0.1:3001',
    trace: 'retain-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    // 3001, where the on-demand config uses 3000. They are never run together,
    // but a port collision between two configs in one repo is a confusing way
    // to discover that, and `reuseExistingServer: false` turns it into a hang
    // rather than a message.
    command: 'npx next start --port 3001',
    url: 'http://127.0.0.1:3001/app/simulator',
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      // See the note above: this is what makes a local run and a CI run the
      // same run. Empty rather than absent because `next start` would otherwise
      // fill these from `.env.local`, and the route handlers treat empty and
      // unset identically (`rpcUrl === undefined || rpcUrl.length === 0`).
      SOROBAN_RPC_URL: '',
      LIMEN_SIMULATION_SOURCE: '',
      LIMEN_DEMO_DESTINATION: '',
      // Not read by anything these suites reach — they submit nothing — but a
      // server started by a gate should not hold a signing key at all.
      LIMEN_DEMO_SECRET: '',
    },
  },
});
