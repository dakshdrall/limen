/**
 * Maturity, stated plainly, in the same words everywhere.
 *
 * The set is closed on purpose. A screen cannot invent a label, and a label
 * cannot drift in wording between two screens — which is the failure mode that
 * turns a precise statement of limits into vague reassurance. Adding one means
 * adding it here, where every existing use is visible.
 *
 * These are not decoration. A project that states its own limits precisely
 * reads as more trustworthy than one that stays quiet, and for a permissions
 * tool that is the entire impression that matters. PLAN-V6 keeps them ahead of
 * the argument rather than under it: the labels appear before the scene that
 * makes the claim they qualify.
 *
 * ## Why this is in `lib/` and not beside the component that renders it
 *
 * Through V5 these constants lived in `components/StatusLabel.tsx`, and
 * `lib/local-key.ts` imported `LOCAL_KEY_LABEL` from there — a module in the
 * data layer reaching up into the rendering layer for a string. That inversion
 * was invisible while both existed, and became a type error the moment the V6
 * rebuild deleted the component: the safety rule that every key-handling file
 * must name its label was resting on a component file continuing to exist.
 *
 * The vocabulary is content, not markup. It lives here, dependency-free like
 * `markers.ts` and for the same reason, and the component that renders it is a
 * consumer. That is the direction the dependency should always have run.
 */

export const STATUS_LABELS = {
  'OPEN SOURCE': 'The source for everything on this page is public.',
  MIT: 'Licensed MIT.',
  'TESTNET ONLY': 'Stellar testnet. No real funds are involved anywhere in this application.',
  'IN DEVELOPMENT': 'Actively changing. Interfaces and data may not survive the next deploy.',
  'NOT AUDITED':
    'No third party has reviewed this code. The OpenZeppelin contracts it installs are audited; the code that decides what to install is not.',
  'COMPOSITION ONLY':
    'Every installed policy is a configuration of an existing audited OpenZeppelin primitive. No Rust is generated, and none is written by hand.',
  // The second sentence used to read "There is no code path here that can move
  // your funds." It stopped being true the moment a screen could generate a
  // signing key: that key exists precisely so it can move testnet funds, and on
  // the screens that use it the old wording would have been reassurance rather
  // than a limit. What survives is the claim that holds on every screen — Limen
  // holds nothing, and the key is yours and stays in your browser.
  'NO CUSTODY':
    'No key of yours reaches a Limen server, an environment variable, or a log line. Any key that can move funds here was generated in your browser, stays in it, and is destroyed when you clear site data.',
  'ON-CHAIN':
    'Read from the ledger at the stated sequence number. Not restored from browser storage, and not this application’s opinion.',
  'COMPUTED LOCALLY':
    'Derived in your browser by this repository’s own code. Nothing on chain asserts it, and no network enforced it.',
  'TESTNET ONLY · LOCAL KEY':
    'An ed25519 key generated in this browser and kept in this browser. Stellar testnet only, disposable by construction: it is not a wallet, it never reaches a Limen server, and clearing site data destroys it.',
} as const;

export type StatusLabelName = keyof typeof STATUS_LABELS;

/**
 * The local key's label, as an importable name.
 *
 * It is in the closed set above before anything renders it, on purpose. The
 * browser-generated ed25519 keypair is a deliberate narrowing of design rule 3
 * — a user secret in browser storage, where the rule used to forbid one — and
 * the entire justification for the narrowing is that the person holding the key
 * is told what it is at the moment it is created and everywhere it is used. A
 * key that appears quietly in `localStorage` is a different feature.
 *
 * Exported as a constant so the point of creation and every use site name the
 * same string rather than retyping it. `test/local-key-label.test.ts` fails the
 * build if a key is generated or stored anywhere in `src/` that does not carry
 * it. This is a `loud` label wherever a key is about to be created: it is one
 * of the two things on this page a person must read before they act.
 */
export const LOCAL_KEY_LABEL = 'TESTNET ONLY · LOCAL KEY' satisfies StatusLabelName;
