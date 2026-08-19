/**
 * What this browser remembers.
 *
 * Two things, and deliberately only two:
 *
 *   1. Which smart accounts this browser has been shown. Pointers — addresses,
 *      nothing more.
 *   2. For each installed policy, the derivation provenance: the transaction it
 *      was derived from and the synthesis options used. That is *this
 *      application's* history, and it exists nowhere on chain.
 *
 * What is deliberately NOT here is any claim about chain state. Whether a rule
 * is still installed, what its cap is, and how much of the window is spent are
 * all read from the ledger on every load (`@limen/chain`'s `read.ts`). A cached
 * copy would be a claim about the past rendered as the present: a policy
 * revoked on another device, or expired while the tab was closed, would still
 * show as live. For a permissions tool that is the worst available failure, and
 * it is worth a round trip on every load to not have it.
 *
 * ## There is a server now, and this says what it holds instead
 *
 * This paragraph used to claim four absences: user accounts, passwords, email,
 * and a server. Three of the four stopped being true in V8 M1, in the commit
 * that added `/api/auth` — there are user accounts, there are sessions, and
 * this browser now talks to a Postgres it did not have.
 *
 * (The retired sentence is deliberately not quoted here. `caveats.test.ts`
 * asserts it is absent from this file, and a file that quotes its own retired
 * claim in order to explain it would fail that check — or, worse, would pass a
 * differently-written one and let the claim live on as a comment about itself.)
 *
 * **No passwords** survives, and it survives for the reason it was worth
 * writing: the credential is a passkey, so there is nothing to type, to reuse,
 * or to phish.
 *
 * What remains true of *this module* is narrower and still worth stating: no
 * part of this store is sent anywhere, nothing here is keyed by a secret, and
 * an address is a public identifier rather than a credential.
 *
 * What the server holds instead is `packages/db/src/schema.ts` — a user, a
 * session as a hash of the cookie's token and never the token itself, and
 * pointers to accounts and policies. What it deliberately cannot hold is the
 * box at the top of that file, and **its rule 2 is this module's rule,
 * inherited**: no cached claim about chain state, for exactly the reason given
 * above. That was the valuable half of the discipline here, and it is now a
 * property of both stores rather than a habit of one.
 */

const KEY = 'limen.v1';

/**
 * Bumped when the stored shape changes incompatibly. An unrecognised version is
 * discarded rather than migrated: this store holds pointers and provenance that
 * can be rebuilt by re-deriving, so throwing it away costs a user very little,
 * and a half-migrated record that renders as fact costs them a lot.
 */
const VERSION = 1;

export interface StoredProvenance {
  /** The transaction the policy was derived from. */
  observedTxHash: string;
  /** Ledger the observation was made at — `validFromLedger`, which has no
   *  on-chain counterpart and is therefore only ever local. */
  observedLedger: number;
  headroomBps: number;
  /** The spending limit's rolling window, in ledgers. A span. */
  windowLedgers: number;
  /**
   * The rule's `valid_until`, as an **absolute ledger sequence** — not a span,
   * despite the name, which is kept because records written by earlier builds
   * carry it. `InstallControl` stores `PlannedContextRule.validUntilLedger`
   * here verbatim, and that field is absolute by its own documentation.
   *
   * Anything wanting the *length* of the validity window has to subtract:
   * `validityLedgers - observedLedger`. `ClosingWindow` does exactly that and
   * says so, because reading this as a duration produces a denominator around
   * four million and a bar that never visibly moves.
   */
  validityLedgers: number;
  /** The install transaction, so the UI can link what it is describing. */
  installTxHash: string;
  /** Which on-chain rule this provenance describes. */
  contextRuleId: number;
  /** When this browser recorded it. Display only; never used to compute. */
  recordedAt: string;
}

export interface StoredAccount {
  /** The deployed smart account contract address. */
  contractId: string;
  /** The deploy transaction, for the explorer link. */
  deployTxHash?: string;
  /** Provenance for policies installed through this browser, by rule id. */
  provenance: Record<string, StoredProvenance>;
  /**
   * The transaction `/app/try` observed, so a reload can resume mid-flow.
   *
   * The one thing in that flow the chain cannot answer. Everything else about
   * where a person has got to is read back from the ledger — whether the account
   * exists, whether a boundary is installed, what its cap is, whether it has been
   * revoked — but *which* transaction the flow derived from is a fact about this
   * session and exists nowhere on chain.
   *
   * **A bookmark, not an answer**, and the distinction is the whole reason this
   * is allowed to sit beside a store that documents itself as holding no claim
   * about chain state. On resume the hash goes back through `/api/ingest` and the
   * derivation comes from what the ledger recorded — the same path
   * `/app/policies/new` takes from `?tx=`. This value never reaches a cap.
   *
   * The storage-free alternative was scanning the account's own events for its
   * outgoing transfer, the way `ActivityScreen` does. It was rejected on the
   * retention window: public RPC event history runs a few days, so an account
   * created last week would resume as a read failure.
   */
  observedTxHash?: string;
  addedAt: string;
}

interface StoredShape {
  version: number;
  accounts: Record<string, StoredAccount>;
}

const EMPTY: StoredShape = { version: VERSION, accounts: {} };

/**
 * Reading is total: any failure yields the empty store.
 *
 * Storage can be unavailable (private mode, disabled cookies, a server render),
 * corrupt, or written by a future version. None of those should throw into a
 * render — an empty account list is a designed screen, and a crash is not.
 */
function read(): StoredShape {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return EMPTY;
    const parsed = JSON.parse(raw) as StoredShape;
    if (parsed.version !== VERSION || typeof parsed.accounts !== 'object' || parsed.accounts === null) {
      return EMPTY;
    }
    return parsed;
  } catch {
    return EMPTY;
  }
}

/** Writing is best-effort, and says whether it worked. */
function write(next: StoredShape): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
    notify();
    return true;
  } catch {
    // Quota exceeded, or storage disabled. The caller decides whether to tell
    // the user their browser will not remember this account; it must not be
    // silently presented as saved.
    return false;
  }
}

/* ---------------------------------------------------------------------------
   Subscription.

   This store is external to React — another tab can change it, and so can the
   user clearing site data. So screens read it through `useSyncExternalStore`
   rather than copying it into component state on mount, which is both the
   idiomatic answer and the one that does not go stale when the same page is
   open twice.

   `readRaw` returns the stored *string*. Returning a parsed object would hand
   `useSyncExternalStore` a new reference on every call and spin forever; a
   string is its own stable identity, and callers parse it with the accessors
   above.
--------------------------------------------------------------------------- */

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeToStore(listener: () => void): () => void {
  listeners.add(listener);
  // `storage` fires only for *other* documents, which is why same-tab writes
  // call `notify` directly. Both paths are needed; neither covers the other.
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

/**
 * The stored string, or `''` when there is nothing stored.
 *
 * `null` is reserved for "there is no browser storage here at all", which is
 * only true on the server. An empty store and an unavailable one must not
 * collapse into the same value: the first is a browser with no accounts yet and
 * gets the empty state, the second is a render that cannot know and gets the
 * pending state. Storage throwing — private mode, disabled cookies — counts as
 * empty rather than unknown, matching what `read()` already does with it.
 */
export function readRaw(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

/**
 * The server has no browser storage, so it renders the not-yet-known state.
 *
 * Constant rather than computed: `useSyncExternalStore` compares the server
 * snapshot by identity, and a fresh value each call is a hydration error.
 */
export const SERVER_SNAPSHOT = null;

export function listAccounts(): StoredAccount[] {
  return Object.values(read().accounts).sort((a, b) => a.addedAt.localeCompare(b.addedAt));
}

export function getAccount(contractId: string): StoredAccount | undefined {
  return read().accounts[contractId];
}

/**
 * Remember an account.
 *
 * Idempotent: re-adding one that is already known keeps its original `addedAt`
 * and its provenance, so a reviewer who pastes the same address twice does not
 * lose the derivation history for it.
 */
export function rememberAccount(contractId: string, deployTxHash?: string): boolean {
  const current = read();
  const existing = current.accounts[contractId];
  return write({
    ...current,
    accounts: {
      ...current.accounts,
      [contractId]: {
        contractId,
        deployTxHash: deployTxHash ?? existing?.deployTxHash,
        provenance: existing?.provenance ?? {},
        addedAt: existing?.addedAt ?? new Date().toISOString(),
      },
    },
  });
}

/**
 * Bookmark the transaction the guided flow derived from.
 *
 * Returns `false` for an account this browser does not know, for the same reason
 * {@link rememberProvenance} does: a record with an observed hash and no address
 * is a half-record, and the flow that wrote it would resume onto nothing.
 */
export function rememberObserved(contractId: string, observedTxHash: string): boolean {
  const current = read();
  const account = current.accounts[contractId];
  if (account === undefined) return false;
  return write({
    ...current,
    accounts: { ...current.accounts, [contractId]: { ...account, observedTxHash } },
  });
}

export function forgetAccount(contractId: string): boolean {
  const current = read();
  if (current.accounts[contractId] === undefined) return true;
  const accounts = { ...current.accounts };
  delete accounts[contractId];
  return write({ ...current, accounts });
}

/**
 * Record how a policy was derived.
 *
 * Keyed by context rule id, which is assigned on-chain and read back out of the
 * install transaction. Nothing here is authoritative about whether the rule
 * still exists — that comes from the chain — so provenance for a revoked rule
 * is harmless and is simply never joined to anything.
 */
export function rememberProvenance(contractId: string, provenance: StoredProvenance): boolean {
  const current = read();
  const account = current.accounts[contractId];
  if (account === undefined) {
    // Recording provenance for an account this browser does not know would
    // create a half-record that renders as an account with no address.
    return false;
  }
  return write({
    ...current,
    accounts: {
      ...current.accounts,
      [contractId]: {
        ...account,
        provenance: { ...account.provenance, [String(provenance.contextRuleId)]: provenance },
      },
    },
  });
}

export function getProvenance(contractId: string, contextRuleId: number): StoredProvenance | undefined {
  return read().accounts[contractId]?.provenance[String(contextRuleId)];
}

/**
 * Everything this browser holds, for the "what is stored about me" answer and
 * for clearing it.
 *
 * A tool that keeps local state should be able to show it and delete it without
 * the user opening devtools.
 */
export function exportAll(): StoredShape {
  return read();
}

export function clearAll(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.removeItem(KEY);
    notify();
    return true;
  } catch {
    return false;
  }
}
