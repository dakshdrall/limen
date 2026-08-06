/**
 * Two projects, one run.
 *
 * They differ in exactly one thing: `browser-sdk` resolves
 * `@stellar/stellar-sdk` to the SDK's browser bundle, so `browser-bundle.test.ts`
 * can delete `globalThis.Buffer` and still have an SDK to call. Under the
 * default resolution that file would fail inside the SDK's Node build, for a
 * reason that has nothing to do with this repository's code — hence the split.
 *
 * Two *projects* rather than two `vitest run` invocations, because
 * `scripts/evidence.mjs` counts this package's tests from a single JSON report
 * and a second invocation would overwrite the first's. The landing page states
 * that count; a run shape that quietly reports a fraction of it is precisely
 * the kind of rot `evidence.json` exists to prevent.
 */

import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const BROWSER_SDK = fileURLToPath(new URL('./test/stubs/stellar-sdk-browser.mjs', import.meta.url));

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'chain',
          include: ['test/**/*.test.ts'],
          exclude: ['test/browser-bundle.test.ts'],
        },
      },
      {
        resolve: { alias: { '@stellar/stellar-sdk': BROWSER_SDK } },
        test: {
          name: 'browser-sdk',
          include: ['test/browser-bundle.test.ts'],
        },
      },
    ],
  },
});
