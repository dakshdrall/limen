/**
 * The two disposable testnet keys this browser holds.
 *
 * This is the file design rule 3 was narrowed for, so the narrowing is written
 * out here rather than left in a plan:
 *
 * > Limen custodies nothing of yours. No user's secret key reaches a Limen
 * > server, an environment variable, or a log line. Signing is client-side
 * > only. A disposable testnet ed25519 keypair is generated in the page and
 * > kept in browser storage, labelled `TESTNET ONLY · LOCAL KEY` wherever it is
 * > created or used; it is not a wallet, it never leaves the browser, and
 * > clearing site data destroys it.
 *
 * The rule used to end "on the connected-wallet path no key enters the page at
 * all". That clause is gone with the path it described: PLAN-V4's F4
 * measurement found a `Delegated` owner's nested auth requirement undiscoverable
 * from either simulation, so v4 has no connected-wallet owner. This module is
 * not one of two ways to sign — it is the only one.
 *
 * Every clause of that is a constraint on this module:
 *
 * - **Testnet.** `assertTestnet` runs before a key is generated, not only
 *   before one signs. A key that exists for a network this build cannot talk to
 *   is a key with no honest reason to exist.
 * - **Kept in browser storage.** `localStorage`, one entry, versioned. Not a
 *   cookie: a cookie is sent to a server, and the whole claim is that this
 *   never is.
 * - **Labelled.** `LOCAL_KEY_LABEL` is imported here and rendered by
 *   `LocalKeyBadge`, and `test/local-key-label.test.ts` fails the build if any
 *   file that generates, stores, or imports a key stops carrying it.
 * - **Never leaves.** There is no export function, no `secret()` accessor, and
 *   no import field. See `NOT_EXPORTABLE` below.
 * - **Clearing site data destroys it.** Which destroys the account, because the
 *   owner key is the account's only signer. That is stated at creation, not
 *   discovered later.
 *
 * ## What is deliberately absent
 *
 * **No export, no backup, no import.** Offering one would create the exact
 * thing design rule 3 exists to prevent — a user secret in transit through a
 * form — in exchange for protecting an account holding testnet dust that
 * friendbot will replace for free. `getSecret` does not exist and should not be
 * added; the secret is reachable only as a signer, which is the only thing
 * anything here needs it for.
 *
 * **No server involvement of any kind.** Nothing in this module fetches, and
 * nothing that calls it may put a key in a request body. CI proves the second
 * half by grepping the built client bundle for a 56-character `S…` StrKey, which
 * catches a pasted or serialized secret without needing to know its value.
 */

import { Keypair } from '@stellar/stellar-sdk';
import { assertTestnet, toHex, type Ed25519Signer } from '@limen/chain/browser';
import { KEY_ROLES, NOT_EXPORTABLE, type KeyRole } from '@/lib/key-roles';
import { NETWORK_PASSPHRASE } from '@/lib/network';
import { LOCAL_KEY_LABEL } from '@/lib/status-labels';

/**
 * The label, re-exported so a caller that renders it does not have to know it
 * came from the status label set.
 *
 * It is also the reason this line exists at all: `local-key-label.test.ts`
 * requires every file that imports this module to carry `LOCAL_KEY_LABEL`, and
 * a re-export is how a caller satisfies that by naming the constant rather than
 * by retyping the string and letting the two drift.
 *
 * V6 moved the constant from `components/StatusLabel.tsx` to
 * `lib/status-labels.ts`. Only the import path changed; see that module for why
 * the old direction was backwards.
 */
export { LOCAL_KEY_LABEL };

/**
 * Re-exported so a caller that already imports this module does not need a
 * second import for the role it is about to sign with. The definitions live in
 * `key-roles.ts`, which imports nothing, so a component that needs only the
 * name of a role can take them from there and leave the SDK out of its bundle.
 */
export { KEY_ROLES, NOT_EXPORTABLE, type KeyRole };

const STORAGE_KEY = 'limen.keys.v1';

export interface LocalKey {
  role: KeyRole;
  /** `G…`. A public identifier, safe to display, log, and put in a URL. */
  publicKey: string;
  /** The raw 32 bytes the verifier contract stores. */
  rawPublicKey: Uint8Array;
  /**
   * The same 32 bytes as hex — the form a context rule's `External` signer
   * comes back in from `readAllContextRules`.
   *
   * Carried here rather than converted at each comparison, because the two
   * representations of one key are exactly what the ownership checks on
   * `/app/accounts/[id]` and `/app/policies/[id]` got wrong: they compared a
   * `G…` StrKey against `read.ts`'s hex, which can never be equal, so every
   * account this browser created was reported as somebody else's and the whole
   * write flow after deploy was unreachable. Storing both forms makes the
   * mismatch impossible to reintroduce at a call site.
   */
  hexPublicKey: string;
  /** Signs 32-byte digests. The only way the secret is reachable. */
  signer: Ed25519Signer;
  /** Signs a transaction envelope, for fee-source signatures. */
  signEnvelope: <T extends { sign(...keys: Keypair[]): void }>(tx: T) => T;
}

interface StoredKeys {
  version: 1;
  /**
   * Secret seeds, base64. Yes, really — this is the narrowing, and it is the
   * reason the label exists. Testnet only, generated here, never sent anywhere.
   */
  secrets: Partial<Record<KeyRole, string>>;
  createdAt: string;
}

const EMPTY: StoredKeys = { version: 1, secrets: {}, createdAt: '' };

/** Reading is total: any failure is an absent key, never a thrown render. */
function read(): StoredKeys {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return EMPTY;
    const parsed = JSON.parse(raw) as StoredKeys;
    if (parsed.version !== 1 || typeof parsed.secrets !== 'object' || parsed.secrets === null) {
      return EMPTY;
    }
    return parsed;
  } catch {
    return EMPTY;
  }
}

function write(next: StoredKeys): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    notify();
    return true;
  } catch {
    // Private mode, or quota. The caller must not present an unsaved key as
    // saved: an account whose owner key vanishes on reload is unrecoverable.
    return false;
  }
}

function toLocalKey(role: KeyRole, keypair: Keypair): LocalKey {
  return {
    role,
    publicKey: keypair.publicKey(),
    rawPublicKey: new Uint8Array(keypair.rawPublicKey()),
    hexPublicKey: toHex(new Uint8Array(keypair.rawPublicKey())),
    signer: {
      rawPublicKey: () => new Uint8Array(keypair.rawPublicKey()),
      sign: (message) => new Uint8Array(keypair.sign(message as never)),
    },
    signEnvelope: (tx) => {
      tx.sign(keypair);
      return tx;
    },
  };
}

/**
 * The key for a role, or `undefined` if this browser has never made one.
 *
 * Undefined is a real answer and must reach a screen as one. "No key yet" is
 * the state `/app/accounts/new` exists to resolve; rendering it as an error, or
 * quietly generating one to avoid the branch, would make key creation something
 * that happened to a person rather than something they did.
 */
export function getLocalKey(role: KeyRole): LocalKey | undefined {
  const secret = read().secrets[role];
  if (secret === undefined) return undefined;
  try {
    return toLocalKey(role, Keypair.fromSecret(secret));
  } catch {
    return undefined;
  }
}

/**
 * Generate the key for a role, or return the one that already exists.
 *
 * Idempotent on purpose. Overwriting an existing owner key would strand the
 * account it owns with no warning and no way back, so this never replaces one;
 * `clearLocalKeys` is the only thing that destroys a key, and it says so.
 */
export function createLocalKey(role: KeyRole): LocalKey | undefined {
  // Level 2 of the mainnet gate, at the earliest point it can be applied. A
  // key generated for a network this build refuses to sign for is a key with
  // no purpose and a misleading label.
  assertTestnet(NETWORK_PASSPHRASE);

  const existing = getLocalKey(role);
  if (existing !== undefined) return existing;

  const keypair = Keypair.random();
  const current = read();
  const saved = write({
    version: 1,
    secrets: { ...current.secrets, [role]: keypair.secret() },
    createdAt: current.createdAt === '' ? new Date().toISOString() : current.createdAt,
  });

  // A key that could not be stored is not a key this browser has. Returning it
  // anyway would let a screen deploy an account owned by a key that disappears
  // on reload — the unrecoverable case, reached silently.
  return saved ? toLocalKey(role, keypair) : undefined;
}

/**
 * Both keys, generated if needed, with the distinctness the demonstration
 * depends on guaranteed by construction rather than checked afterwards.
 *
 * `assertDistinctSigners` still runs at every install and every agent
 * submission — this is not a substitute for it. Two independent generations of
 * a 32-byte key colliding is not a real risk; a future refactor that stores one
 * key under both roles is, and that is what the assertion catches.
 */
export function createLocalKeys(): { owner: LocalKey; agent: LocalKey } | undefined {
  const owner = createLocalKey('OWNER');
  const agent = createLocalKey('AGENT');
  if (owner === undefined || agent === undefined) return undefined;
  return { owner, agent };
}

/**
 * Destroy both keys.
 *
 * The same thing clearing site data does, offered explicitly so a person can do
 * it deliberately. Any screen calling this must say what it costs first: the
 * owner key is the account's only signer, so this abandons the account.
 */
export function clearLocalKeys(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do. Storage that cannot be written to holds nothing to clear.
  }
  notify();
}

/* ---------------------------------------------------------------------------
   Subscription, in the same shape as `store.ts` and for the same reason: this
   is state outside React that another tab can change.
--------------------------------------------------------------------------- */

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeToLocalKeys(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

/**
 * The public keys this browser holds, as a stable string, for
 * `useSyncExternalStore`.
 *
 * Public keys only. The snapshot is a value React holds, compares, and may pass
 * through a devtools boundary; there is no version of this that should contain
 * a secret.
 *
 * Each role contributes `ROLE:G…:hex`. Both public forms travel together for
 * the reason `hexPublicKey` exists: a screen comparing this browser's key
 * against one read off a context rule needs the hex, and a screen showing it to
 * a person needs the `G…`. Deriving one from the other at the call site is what
 * was wrong before, and it was wrong silently.
 */
export function readLocalKeySnapshot(): string | null {
  if (typeof window === 'undefined') return null;
  return KEY_ROLES.map((role) => {
    const key = getLocalKey(role);
    return `${role}:${key?.publicKey ?? ''}:${key?.hexPublicKey ?? ''}`;
  }).join('|');
}

/** The server has no browser storage, so it renders the not-yet-known state. */
export const SERVER_KEY_SNAPSHOT = null;
