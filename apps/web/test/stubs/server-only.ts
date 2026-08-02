/**
 * Stands in for the `server-only` marker package under vitest.
 *
 * The real package throws on import unless the bundler activates the
 * `react-server` condition — that throw is exactly how it converts an
 * accidental client import into a build error. Next resolves it to an empty
 * module when building the server graph. These tests exercise server code, so
 * they resolve it the same way.
 *
 * This stub does not weaken the fence: the build still fails if a Client
 * Component imports `demo-signer.ts`, and CI still greps the client bundle to
 * prove it did not.
 */

export {};
