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
 * No user accounts, no passwords, no email, no server. An address is a public
 * identifier, not a credential, so nothing secret is keyed by it either.
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
  windowLedgers: number;
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
    return true;
  } catch {
    // Quota exceeded, or storage disabled. The caller decides whether to tell
    // the user their browser will not remember this account; it must not be
    // silently presented as saved.
    return false;
  }
}

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
    return true;
  } catch {
    return false;
  }
}
