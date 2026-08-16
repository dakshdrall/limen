/**
 * The redactor. Everything an error report carries in free text goes through
 * here before it is sent, on both sides of the wire.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE TWO RULES, AND WHY THERE ARE TWO                                     │
 * │                                                                          │
 * │ 1. The report is an ALLOWLIST. `report.ts` names every field that may    │
 * │    leave this browser; a field nobody added cannot leak, which is a      │
 * │    property of the shape rather than of a filter.                        │
 * │ 2. Three of those fields are free text — a message, a stack, a path —    │
 * │    and free text is where an address arrives without anyone adding a     │
 * │    field for it. This module is what those three go through.             │
 * │                                                                          │
 * │ Neither rule subsumes the other. An allowlist alone ships                │
 * │ `/app/accounts/CDLZ…` because the path is a field somebody legitimately  │
 * │ added; a redactor alone leaves the next field's author to remember.      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ## What must never appear in a report
 *
 * The brief is exact and this module is its implementation: no addresses, no
 * hashes tied to a person, no key material ever. Concretely, in this
 * application that is:
 *
 *   - **StrKeys.** `G…` account, `C…` contract, `M…` muxed — and `S…`, which is
 *     a secret seed and the one value in this repository whose disclosure is
 *     not recoverable. `local-key.ts` has no export path and CI greps the client
 *     bundle for a 56-character `S…`, so a seed should be unable to reach a
 *     string here at all. It is matched anyway: this is the last place a value
 *     passes before it leaves the browser, and a fence that assumes the fences
 *     upstream held is not a fence.
 *   - **Long hex.** A transaction hash is 64 hex characters; a passkey's public
 *     key and a local key's raw bytes are hex of the same order. All three
 *     identify a person's account to anyone holding the string, which is what
 *     "tied to a person" means here — so the rule is on the shape, not on which
 *     of the three it is, and the report is no worse for not knowing.
 *   - **Email addresses.** The waitlist takes one and never logs it. An
 *     exception thrown while a submission is in flight can carry it into a
 *     message, which is the path that discipline does not cover.
 *
 * ## What must survive, or the report is not worth sending
 *
 * A redactor that removes everything is trivially correct and useless, so the
 * cases it must NOT fire on are pinned as hard as the cases it must:
 *
 *   - `Minified React error #418` — the whole reason this exists.
 *   - `page-8a2f3c9d.js:1:2345` — a chunk hash is 8 hex characters and is how
 *     you find the file. The hex rule starts at 32, well clear of it.
 *   - Component and function names in a stack, which are what a stack is for.
 *
 * ## Order is load-bearing
 *
 * `S…` runs inside the StrKey rule rather than after it, because a rule that ran
 * second would find nothing left to match. The hex rule runs after StrKeys for
 * the same reason in reverse: base32 and hex overlap on `[A-F2-7]`, and a
 * 56-character StrKey composed only of those would otherwise be reported as a
 * key when it is an address. Both end up redacted either way — the ordering
 * decides which word the report uses, not whether the value survives.
 *
 * This module imports nothing. It runs in the browser, in the route handler,
 * and in a Node test, and adding a dependency to it would put a third party
 * between a value and the decision to remove it.
 */

/**
 * What a redaction leaves behind.
 *
 * Bracketed and named rather than blanked to `***`, because the reader of a
 * report needs to know that a value *was there* and what kind it was: "the
 * boundary read failed for `[address]`" is a debuggable sentence and "the
 * boundary read failed for" is not. The spelling matches Next's own dynamic
 * segments, so a redacted path reads as the route it is.
 */
export const REDACTED = {
  address: '[address]',
  key: '[key]',
  email: '[email]',
} as const;

/**
 * A Stellar StrKey in any of its shapes.
 *
 * Base32 over `A-Z2-7`, 56 characters for the common types and 69 for muxed.
 * The version byte is the leading letter: `G` account, `C` contract, `M` muxed,
 * `S` secret seed, and `T`/`X`/`P`/`B` for the pre-auth, hash, payload and
 * claimable-balance types this application does not construct but could be
 * handed by an SDK error message.
 *
 * `\b` at both ends so a StrKey inside a URL path or a JSON string still
 * matches — the separators there are `/` and `"`, both word boundaries.
 */
const STRKEY = /\b[GCMSTXPB][A-Z2-7]{55}(?:[A-Z2-7]{13})?\b/g;

/**
 * A hex run long enough to be an identifier rather than an offset.
 *
 * 32 is the floor because that is 16 bytes — below it are the things a report
 * needs: chunk hashes, line and column numbers, a ledger sequence, a status
 * code. Above it are the things it must not carry: a 64-character transaction
 * hash, a 64-character raw public key in hex, a passkey credential id.
 *
 * Case-insensitive: `toHex` in `@limen/chain` emits lowercase and the SDK's
 * error strings are not consistent about it.
 */
const LONG_HEX = /\b[0-9a-fA-F]{32,}\b/g;

/**
 * Deliberately the same loose shape `api/waitlist/route.ts` validates with.
 *
 * Neither is deciding whether an address is deliverable. Matching what that
 * route accepts is the point: an address it let through is an address that can
 * reach an error message from there, so the two agreeing is what makes this
 * cover that path rather than most of it.
 *
 * ## Every quantifier here is bounded, and that is not tidiness
 *
 * This was written first as `[^\s@…]+@[^\s@…]+\.…`, which is the obvious
 * spelling and is quadratic. On a subject with no `@` in it the engine runs the
 * leading `+` to the end of the string, fails, and does it again from the next
 * character: 20,000 characters took 492ms, 50,000 took longer than the test
 * runner was willing to wait.
 *
 * That is not a hypothetical input. `report.ts` caps `message` at 1,000
 * characters and `stack` at 2,000 — **after** redacting, because truncating
 * first could cut an address in half and leave an identifying prefix behind. So
 * the redactor is the thing that sees the untruncated value, and a 50,000-
 * character stack from a render loop is the ordinary case for it. A scrubber
 * that hangs on a large error is a scrubber that is not there for the largest
 * errors.
 *
 * The bounds come from the addresses themselves rather than from a guess: RFC
 * 5321 caps a local part at 64 characters and a whole address at 254, and no
 * public suffix is close to 24. Each is a ceiling on the work per starting
 * position, which is what makes the scan linear in the length of the subject.
 */
const EMAIL = /[^\s@<>()[\]{}"']{1,64}@[^\s@<>()[\]{}"']{1,190}\.[^\s@<>()[\]{}"',;:]{2,24}/g;

/**
 * Removes every value of a kind this application must not report.
 *
 * Total and order-independent from the caller's side: it is safe to run twice,
 * which is exactly what happens — the browser redacts before sending and the
 * route redacts again on arrival, because a request body is attacker-controlled
 * and "the client already did it" is not a property the server can check.
 */
export function redact(text: string): string {
  return text
    .replace(STRKEY, REDACTED.address)
    .replace(LONG_HEX, REDACTED.key)
    .replace(EMAIL, REDACTED.email);
}

/**
 * A URL reduced to the part that says which screen failed.
 *
 * The path is the one allowlisted field that carries an address by design —
 * `/app/accounts/C…` and `/app/policies/C…-1` both have one in the path, and
 * they are the two screens most likely to be in front of a reviewer when
 * something breaks. So the path is not merely redacted, it is rebuilt:
 *
 *   - the query string and the fragment are dropped **entirely**, not redacted.
 *     Nothing in this application needs them to identify a screen, and they are
 *     where a value arrives that no rule here anticipated. Dropping is the only
 *     treatment that is correct for a parameter nobody has thought of yet.
 *   - the origin is dropped. There is one deployment and its hostname is not
 *     news; keeping it would put a preview URL into a report for nothing.
 *   - what remains goes through `redact`, so a segment that is an address
 *     becomes `[address]` and the route still reads as the route.
 *
 * Accepts a full URL or a bare path, because the two callers have different
 * things to hand: the boundary reads `location.pathname` and the route handler
 * is given whatever the client sent, which it does not trust to be either.
 */
export function redactPath(input: string): string {
  // `URL` needs a base for a bare path, and the base is discarded with the
  // origin a line later. `example.invalid` is reserved by RFC 2606 and cannot
  // resolve, so a mistake that let this leak somewhere would fail loudly rather
  // than quietly address a real host.
  //
  // With a base supplied, almost nothing throws — `%%%` parses to `/%%%`. What
  // does is an input that looks like it declares its own origin and then has
  // none: `//`, `////`, `http://`. Those are reachable, because this route
  // handler is public and is handed whatever a body contained.
  let path: string;
  try {
    path = new URL(input, 'https://example.invalid').pathname;
  } catch {
    // Not parseable as either. Report the shape and nothing else.
    return '[unparseable]';
  }
  return redact(path);
}
