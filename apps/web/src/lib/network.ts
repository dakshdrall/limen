/**
 * Which network this build talks to.
 *
 * One constant, read both by the chrome that displays it and by anything that
 * builds a transaction. They cannot disagree, because there is nothing for
 * them to disagree about — a network indicator that is a hardcoded string in a
 * header component is decoration, and the one thing it must never be is wrong.
 *
 * There is no mainnet value. `TODO(roadmap)`: mainnet arrives by adding one
 * here and auditing every call site the type change breaks, which is the point
 * of making it a union rather than a string.
 */

export const NETWORK = 'TESTNET' as const;

export type Network = typeof NETWORK;

export const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015' as const;

// Explorer URLs are built in `lib/explorer.ts`, which already refuses to link a
// transaction that was never on a network. Adding a base URL here would be a
// second place for the same fact to be wrong in.
