import { defineConfig, devices } from '@playwright/test';

/**
 * The browser half of the verification.
 *
 * PLAN-V2 §6.3 asks for the simulator's stepper to complete end to end against real
 * testnet, twice, from a clean browser profile. The server half of that was
 * already evidenced by calling the routes with curl; what curl cannot reach is
 * the client — in particular the `sessionStorage` rehydration at
 * `SimulatorStepper.tsx`, which is the actual warm-state surface item 3 is
 * aimed at.
 *
 * This suite is deliberately NOT part of `npm test` and NOT in the default CI
 * job. It submits a real transaction to Stellar testnet on every run, and
 * `/api/demo/perform` allows one of those per address per five minutes. A check
 * that spends money and rate-limits itself cannot be a per-push gate without
 * becoming flaky, and a flaky gate is one people learn to ignore. It runs on
 * demand: `npm run e2e -w @limen/web`.
 *
 * Two properties this file is responsible for, both load-bearing:
 *
 *   - `reuseExistingServer: false` — every invocation starts its own `next
 *     start`. So a second run is a cold process: empty rate-limit windows,
 *     empty transaction cache. "Nothing depended on warm state" is a claim
 *     about the server too, not only the browser.
 *   - one worker, no retries — a retry would silently perform a second testnet
 *     transaction and turn a real failure into a green run.
 */
export default defineConfig({
  testDir: './e2e',
  // Beat 1 submits and then polls for confirmation (15 attempts, 1s apart)
  // before the page moves at all.
  timeout: 180_000,
  expect: { timeout: 60_000 },
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3000',
    // Playwright gives each test a fresh context by default, which is what
    // "clean browser profile" means here: no cookies, no localStorage, and —
    // the one that matters — no sessionStorage.
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // The production artifact, not `next dev`. This is the same output the
    // demo-signer bundle fence in CI greps.
    command: 'npx next start --port 3000',
    url: 'http://127.0.0.1:3000/app/simulator',
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
