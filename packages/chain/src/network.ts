/**
 * The one network this package will build a transaction for.
 *
 * A leaf module on purpose: it imports nothing, so a screen that only needs to
 * name the network can import it without pulling the Stellar SDK into the
 * bundle. `@limen/chain/network` is the subpath that exists for exactly that.
 *
 * This is level 1 of the three-level mainnet gate in PLAN-V4 §4. The union has
 * one member, so a caller that passes anything else does not compile — the
 * mainnet passphrase is not a value this package's types admit. Level 2 is
 * `assertTestnet` in `sign.ts`, which throws when a value arrives from
 * somewhere the type checker did not see (JSON, an env var, a JS caller).
 * Level 3 is the CI grep proving the mainnet string is absent from the built
 * client bundle.
 *
 * Mainnet arrives by adding a member here and auditing every call site the
 * widened union breaks. That is the point of the union: the compiler produces
 * the audit list rather than a person trying to remember it.
 */

export const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015' as const;

export type SupportedPassphrase = typeof TESTNET_PASSPHRASE;

/**
 * Public testnet infrastructure, addressed directly.
 *
 * Deliberately not `SOROBAN_RPC_URL`, which stays server-side because it may be
 * a keyed endpoint. See PLAN-V4 §6: the browser gets a public endpoint, and no
 * Limen server sits in the write path.
 */
export const DEFAULT_TESTNET_RPC_URL = 'https://soroban-testnet.stellar.org';

export const FRIENDBOT_URL = 'https://friendbot.stellar.org';
