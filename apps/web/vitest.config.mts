import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Node-environment tests for the server-side halves of the app: XDR extraction,
 * the ingest adapter's failure modes, and the demo signer's testnet fence.
 * Nothing here renders a component — these are the paths where being wrong
 * produces a wrong policy rather than a wrong pixel.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `server-only` throws on import unless the `react-server` condition is
      // active, which is how it turns a client import into a build error. Next
      // resolves it to an empty module on the server; these tests run server
      // code, so they resolve it the same way. The fence itself is still under
      // test — see test/demo-signer.test.ts — this only stops the marker from
      // making its own module unimportable.
      'server-only': fileURLToPath(new URL('./test/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
