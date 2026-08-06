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

import { TESTNET_PASSPHRASE, type SupportedPassphrase } from '@limen/chain/network';

export const NETWORK = 'TESTNET' as const;

export type Network = typeof NETWORK;

/**
 * The passphrase, taken from `@limen/chain` rather than retyped.
 *
 * `@limen/chain/network` is a leaf module with no imports at all, so this costs
 * the client bundle a string and does not drag the Stellar SDK onto a screen
 * that only names the network.
 *
 * Taken rather than restated because the two used to be independent literals
 * that happened to match. A passphrase that disagreed with the one transactions
 * are actually built for would be a header saying TESTNET above a signature the
 * network computes differently — visible only as a rejected transaction, and
 * attributed to almost anything else first.
 *
 * `satisfies` is level 1 of the mainnet gate, applied here: the union has one
 * member, so a value that is not the testnet passphrase does not compile.
 */
export const NETWORK_PASSPHRASE = TESTNET_PASSPHRASE satisfies SupportedPassphrase;

export type NetworkPassphrase = SupportedPassphrase;

// Explorer URLs are built in `lib/explorer.ts`, which already refuses to link a
// transaction that was never on a network. Adding a base URL here would be a
// second place for the same fact to be wrong in.
