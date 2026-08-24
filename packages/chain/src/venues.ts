/**
 * The swap venues Limen knows how to install a rule for.
 *
 * One address, in one place, and the reason is the failure it prevents. A venue
 * rule is *installed for* a contract and a swap is *submitted to* one. If those
 * two values ever disagreed, Limen would install a context rule authorizing one
 * router and then trade through another — an account showing an installed
 * boundary that binds nothing it actually does. That is not a drift somebody
 * notices in review; both halves keep working and only the guarantee is gone.
 *
 * So this lives in `@limen/chain`, which both the runtime's `swap_tokens` and
 * the web app's configure route read. It is the one duplication this repository
 * does not make — `dev-probe.ts` records the opposite decision for a four-line
 * predicate whose divergence fails safe, and the distinction is the direction
 * of the failure.
 *
 * ## Read from source, and confirmed twice
 *
 * `soroswap/core`'s `public/testnet.contracts.json` and Soroswap's own live
 * `GET /api/testnet/router` agree on this address, and it was probed on testnet
 * before being written down. PLAN-V8 C0 records the run.
 *
 * `TODO(roadmap)`: mainnet has a different router, and it arrives here by
 * adding a second constant and auditing every call site the type change breaks
 * — the same shape `network.ts` uses for the passphrase.
 */

/** Soroswap's router on Stellar testnet. */
export const SOROSWAP_TESTNET_ROUTER = 'CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD';

/**
 * The function a swap goes through.
 *
 * Named here beside the address because the venue rule authorizes *every*
 * function on that contract — see `lower.ts` — so this constant is what the
 * product actually calls, not what the rule permits. Keeping them adjacent is a
 * reminder that the two are not the same set.
 */
export const SOROSWAP_SWAP_FN = 'swap_exact_tokens_for_tokens';

/** The router's read-only quote, used for price checks. Costs no fee. */
export const SOROSWAP_QUOTE_FN = 'router_get_amounts_out';
