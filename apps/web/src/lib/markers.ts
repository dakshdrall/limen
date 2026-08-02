/**
 * Sentinels shared between the server-side extractor and the client-side UI.
 *
 * This module is deliberately dependency-free. `extract.ts` imports the whole
 * Stellar SDK, so a client component importing a constant from there would
 * either drag the SDK into the browser bundle or depend on the bundler
 * tree-shaking it away — and "it happens to be tree-shaken today" is not a
 * property worth resting a bundle boundary on.
 */

/**
 * Marks an argument whose `ScVal` could not be converted. Arguments are
 * presentational — `synthesize` reads `contractId` and `functionName` and never
 * `args` — so an unreadable one is labelled rather than fatal. The UI renders
 * this marker as unreadable instead of letting it sit in the list looking like
 * a value.
 *
 * TODO(roadmap): argument-level policy (e.g. capping the `to` address of a
 * transfer) would make an unreadable argument load-bearing, and would promote
 * this from a marker to an `ExtractionError`.
 */
export const UNREADABLE_ARG = '<unreadable>';
