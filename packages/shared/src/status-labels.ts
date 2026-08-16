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
 * ## Why this is not beside the component that renders it
 *
 * Through V5 these constants lived in `components/StatusLabel.tsx`, and
 * `lib/local-key.ts` imported `LOCAL_KEY_LABEL` from there — a module in the
 * data layer reaching up into the rendering layer for a string. That inversion
 * was invisible while both existed, and became a type error the moment the V6
 * rebuild deleted the component: the safety rule that every key-handling file
 * must name its label was resting on a component file continuing to exist.
 *
 * The vocabulary is content, not markup. It is dependency-free like `markers.ts`
 * and for the same reason, and the component that renders it is a consumer. That
 * is the direction the dependency should always have run.
 *
 * ## Why it is not in `apps/web` either
 *
 * V6 moved it to `apps/web/src/lib/`; V8 M1 moved it here, to
 * `packages/shared`. The second move is the first one repeated a level up. A
 * closed set exists so that no surface can invent a member or drift a label's
 * wording, and `apps/web` is about to stop being the only surface: the agent
 * runtime and the Telegram adapter both state limits to a person. A set that
 * lives inside one of the things it constrains is closed by convention rather
 * than by construction.
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
  // ── `NO CUSTODY` was here, and was retired in V8 M1. ──────────────────────
  //
  // Its history, kept because it is the second time this label narrowed and the
  // shape of the narrowing is the same both times.
  //
  // It first read "There is no code path here that can move your funds", and
  // that stopped being true the moment a screen could generate a signing key:
  // the key exists precisely so it can move testnet funds. It was narrowed to a
  // claim about *custody* rather than capability — Limen holds nothing, and the
  // key is yours and stays in your browser.
  //
  // PLAN-V8 §3 breaks the second half of that outright. An agent that answers a
  // message while no browser is open signs with a key generated on a Limen
  // server and kept there, so "any key that can move funds here was generated
  // in your browser" becomes false — not softened, false.
  //
  // One label cannot carry two opposite facts, and narrowing the text while
  // keeping the name `NO CUSTODY` would be exactly the softening this project
  // has refused everywhere else: the name is the part a reader remembers. So it
  // is retired and replaced by two, one for each fact.
  //
  // `caveats.test.ts` pins the retirement in both directions — the old string
  // is gone, and both replacements are present — so it cannot come back by
  // someone restoring a familiar-looking constant.
  'NO OWNER CUSTODY':
    'The key that owns your account — a passkey, or a key generated in your browser — never reaches a Limen server. Limen cannot move your funds outside the boundary you installed, and cannot remove that boundary.',
  // The other half, and the loud one. Not rendered anywhere yet, deliberately:
  // see `AGENT_KEY_LABEL` below for why a label lands in this set before the
  // fact it describes, and `caveats.test.ts` for the assertion that keeps it
  // unrendered until M3 rather than until somebody notices.
  'LIMEN HOLDS THE AGENT KEY':
    'Your agent signs with a key Limen stores and can use while your browser is closed. That key can do exactly what the context rule you installed permits — one token contract, transfer only, up to your cap, until your expiry — and the account enforces that, not Limen. It cannot revoke itself; you can revoke it.',
  'ON-CHAIN':
    'Read from the ledger at the stated sequence number. Not restored from browser storage, and not this application’s opinion.',
  'COMPUTED LOCALLY':
    'Derived in your browser by this repository’s own code. Nothing on chain asserts it, and no network enforced it.',
  'TESTNET ONLY · LOCAL KEY':
    'An ed25519 key generated in this browser and kept in this browser. Stellar testnet only, disposable by construction: it is not a wallet, it never reaches a Limen server, and clearing site data destroys it.',
  // Added in V7 §5.4, and worded around the one thing a passkey here does NOT
  // do. It owns the account and it survives clearing site data, which is the
  // whole gain. It cannot pay a Stellar fee and it cannot be handed to an
  // agent, so a passkey account still has local keys doing both of those jobs —
  // and a label that let a reader infer otherwise would be this project's own
  // version of a caveat that stopped applying.
  'TESTNET ONLY · PASSKEY':
    'A passkey held by your device or password manager, never by this browser and never by Limen. It survives clearing site data, which the local keys do not. Stellar testnet only: it can own an account here, and it cannot pay a fee or act as the agent.',
  // Added in V8 M1, for a key that does not exist yet. PLAN-V8 B4 is explicit
  // that this is the correct order rather than an oversight: the tripwire in
  // `local-key-label.test.ts` requires every file that generates or stores a
  // key to name its label, so the label has to be in the closed set *before*
  // `packages/custody` can be written, or the first server keygen lands with
  // nothing to name.
  //
  // The wording's whole job is to not be mistaken for the local key's label.
  // Forcing a server-held key to render `LOCAL_KEY_LABEL` would make
  // the tripwire the source of a false statement — the fence producing the lie
  // — which is why there are two labels and why carrying the wrong one is a
  // failure rather than a near miss.
  'TESTNET ONLY · AGENT KEY (LIMEN-HELD)':
    'An ed25519 key generated on a Limen server and kept there, encrypted. Stellar testnet only. It is not in your browser and you never see it: it exists so your agent can act while your browser is closed, and what it may do is decided by the context rule installed on your account rather than by Limen.',
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

/**
 * The passkey's label, as an importable name, for the same reasons.
 *
 * A passkey is not the narrowing of design rule 3 that `LOCAL_KEY_LABEL` exists
 * to justify — no secret of the user's is in browser storage, and none is in
 * this application's reach at any point. So this label is not a warning; it is
 * the answer to *which* of the two owner paths this account took, which is a
 * thing a person must be able to see rather than infer.
 *
 * It carries its own obligation, and `test/local-key-label.test.ts` enforces it:
 * a file that creates or uses a passkey must name this constant, exactly as a
 * file that touches a local key must name `LOCAL_KEY_LABEL`. That rule is
 * written against the passkey's own API rather than inherited, because the
 * local-key detectors do not match `navigator.credentials` and a tripwire
 * satisfied by not resembling anything is not a tripwire.
 */
export const PASSKEY_LABEL = 'TESTNET ONLY · PASSKEY' satisfies StatusLabelName;

/**
 * The agent key's label, as an importable name. Nothing carries it yet.
 *
 * This is the third key, and the one PLAN-V8 §3 introduces: generated on a
 * Limen server, held there encrypted, used to sign while no browser is open.
 * It is the narrowing of design rule 3 that v8 takes, in the same way
 * `LOCAL_KEY_LABEL` was the narrowing v4 took — and it is a larger one, because
 * the key is not the user's and is not in their reach.
 *
 * **It exists here before anything can render it, and that is the point.** The
 * tripwire requires every file that generates or stores a key to name its
 * label; a label added *after* the first server keygen would mean the first
 * server keygen had nothing to name and no fence to fail. B4 records the same
 * ordering argument from the other side: the tripwire's scan roots were a
 * hand-maintained list that would have let `packages/custody` land outside every
 * fence in this repository with nothing going red. Both halves of that failure
 * — the unscanned directory and the missing label — are closed before the
 * directory exists.
 *
 * The partition is the load-bearing part. A browser key must carry
 * `LOCAL_KEY_LABEL` and a server-held key must carry this one, and **carrying
 * the wrong one is a failure rather than a near miss**: a server-held key
 * rendering `LOCAL_KEY_LABEL` would be the safety mechanism producing a false
 * statement about where a key lives, which is worse than no label at all. `local-key-label.test.ts` asserts neither label can satisfy the other's
 * obligation, in both directions, against synthetic samples — so the rule is
 * proved able to fire before there is anything for it to fire on.
 */
export const AGENT_KEY_LABEL = 'TESTNET ONLY · AGENT KEY (LIMEN-HELD)' satisfies StatusLabelName;
