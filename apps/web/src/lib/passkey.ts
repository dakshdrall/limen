/**
 * The passkey that can own an account, and the one that cannot do anything else.
 *
 * PLAN-V7 §5.4. `lib/local-key.ts` exists because design rule 3 had to be
 * narrowed — a user secret in browser storage, justified by being disposable,
 * testnet-only, and labelled. **This module needs no such narrowing.** A
 * passkey's private key lives in the authenticator and is not reachable by this
 * application, by this browser's storage, or by any code path here. What is
 * stored below is a credential id and a public key, neither of which is a
 * secret.
 *
 * That is the entire gain, and it is worth stating exactly because it is
 * narrower than it sounds:
 *
 * - **What it fixes.** Clearing site data no longer strands the account. The
 *   owner signer is the passkey, and the passkey is not in site data.
 * - **What it does not fix.** A passkey cannot pay a Stellar transaction fee
 *   and cannot be handed to an agent. So a passkey-owned account still has two
 *   local ed25519 keys in this browser doing exactly those jobs, both still
 *   carrying `TESTNET ONLY · LOCAL KEY`, and clearing site data still destroys
 *   both. The agent key going is the part that matters: this browser loses its
 *   ability to act as the agent.
 *
 * Every screen that creates or uses a passkey says both halves. A passkey
 * account that let a reader infer their agent key was safe too would be this
 * project's own version of a caveat that stopped applying.
 *
 * ## What the verifier requires, and where it was measured
 *
 * Not guessed. `deployments/testnet.json`'s `webauthnRun` block records a
 * script run against the deployed contract, and PLAN-V7 §5.2.1 lists what came
 * out of reading `OpenZeppelin/stellar-contracts` at `a9c42169`:
 *
 * - `key_data` is a **65-byte uncompressed SEC1 point**, optionally followed by
 *   a credential id which the contract's `canonicalize_key` strips. Both are
 *   stored here, in that order, so an account can be resumed from what the
 *   chain holds rather than only from what this browser remembers.
 * - `sig_data` is an **XDR-encoded `WebAuthnSigData`** carried in one `Bytes`,
 *   never struct arguments, with `signature` a raw 64-byte `r‖s`.
 * - The signature must be **low-S**. The host rejects high-S beneath the
 *   contract, with no contract error code to decode — measured on a ledger.
 * - `clientDataJSON` is parsed for exactly `type` and `challenge`. Origin is
 *   **not** validated by the contract, and neither is `rpIdHash`.
 * - The authenticator flags must have **UP and UV both set**, which is why
 *   `userVerification` is `required` below rather than `preferred`. An
 *   authenticator that does not verify the user produces an assertion this
 *   contract refuses, and asking for it up front turns that into a prompt
 *   rather than a failed transaction.
 *
 * ## Two encodings that differ from the script that proved this
 *
 * The §5.1 script used WebCrypto, which emits IEEE-P1363 `r‖s` directly. A real
 * WebAuthn assertion emits **ASN.1 DER**, so `rawSignature` below unpacks it.
 * And the public key arrives as SPKI rather than a raw point, so it goes
 * through `crypto.subtle` to come back as the 65 bytes the contract wants —
 * imported rather than sliced, so a key in an unexpected format fails here
 * instead of at `__check_auth`.
 */

import {
  assertTestnet,
  concatBytes,
  scvBytes,
  structMap,
  toHex,
  type Ed25519Signer,
} from '@limen/chain/browser';
import { NETWORK_PASSPHRASE } from '@/lib/network';
import { PASSKEY_LABEL } from '@limen/shared/status-labels';

/**
 * The label, re-exported for the same reason `local-key.ts` re-exports its own:
 * `test/local-key-label.test.ts` requires every file that creates or uses a
 * passkey to name this constant, and a re-export is how a caller satisfies that
 * by naming it rather than by retyping the string and letting the two drift.
 */
export { PASSKEY_LABEL };

const STORAGE_KEY = 'limen.passkey.v1';

/**
 * The relying-party id.
 *
 * `undefined` means "this origin", which is what a passkey should be scoped to
 * and what works on localhost and on the deployed host without either being
 * named here. The contract validates neither this nor the origin — see the
 * header — so nothing on chain depends on the value. It is a browser-side
 * scoping decision only.
 */
const RP_NAME = 'Limen';

/** What is kept in browser storage. None of it is a secret. */
interface StoredPasskey {
  version: 1;
  /** base64url, as `allowCredentials` wants it back. */
  credentialId: string;
  /** Hex of the 65-byte uncompressed point. */
  publicKeyHex: string;
  createdAt: string;
}

export interface Passkey {
  /**
   * `key_data` for `Signer::External`: the 65-byte point followed by the
   * credential id, which is the layout the verifier documents and strips.
   */
  keyData: Uint8Array;
  /** Hex of the 65 key bytes alone. Display only. */
  hexPublicKey: string;
  /**
   * Hex of the whole `key_data`, which is what a context rule reports back.
   *
   * Two forms carried rather than one derived at the call site, for the reason
   * `local-key.ts` documents at length: comparing the wrong two representations
   * of one key is what made every account this browser created render as
   * somebody else's. The contract stores `key_data` verbatim —
   * `canonicalize_key` is used for duplicate detection, not for storage — so
   * the credential id is part of what comes back and an ownership check against
   * the 65 bytes alone would silently never match.
   */
  hexKeyData: string;
  credentialId: string;
  /** Produces `WebAuthnSigData` bytes over a digest. Prompts the authenticator. */
  signer: Ed25519Signer;
}

/** Whether this browser can do WebAuthn at all. Rendered, not assumed. */
export function passkeysAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential === 'function' &&
    typeof navigator !== 'undefined' &&
    navigator.credentials !== undefined
  );
}

/* --- base64url, both directions ------------------------------------------ */

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/* --- storage. Public material only, so no label obligation attaches to it -- */

function read(): StoredPasskey | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return undefined;
    const parsed = JSON.parse(raw) as StoredPasskey;
    if (parsed.version !== 1 || typeof parsed.credentialId !== 'string') return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function write(next: StoredPasskey): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    notify();
    return true;
  } catch {
    return false;
  }
}

/**
 * Forget the credential id, which is not the same as destroying the passkey.
 *
 * The passkey itself lives in the authenticator and this application cannot
 * delete it — only the user can, from their device. Any screen offering this
 * must say so rather than implying a deletion it cannot perform.
 */
export function forgetPasskey(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage that cannot be written to holds nothing to clear */
  }
  notify();
}

/* --- signature and key shape --------------------------------------------- */

/** The order of the P-256 curve, for the low-S normalisation the host demands. */
const P256_ORDER = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

function bigIntFrom(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

function bytesFrom(value: bigint, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let rest = value;
  for (let index = length - 1; index >= 0; index -= 1) {
    out[index] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return out;
}

/**
 * DER `SEQUENCE { INTEGER r, INTEGER s }` to the raw 64 bytes, low-S normalised.
 *
 * WebAuthn assertions carry DER; the verifier wants `r‖s`. DER integers are
 * signed, so a high bit forces a leading zero byte that must come off, and a
 * short integer must be left-padded back to 32. Both directions are handled by
 * going through a bigint rather than by slicing, because slicing is where this
 * conversion is usually got wrong.
 */
function rawSignature(der: Uint8Array): Uint8Array {
  if (der[0] !== 0x30) throw new Error('the authenticator returned a signature that is not DER');
  let offset = 2;
  if (der[1] !== undefined && der[1] > 0x80) offset = 3; // long-form length
  const readInteger = (): bigint => {
    if (der[offset] !== 0x02) throw new Error('malformed DER signature: expected an INTEGER');
    const length = der[offset + 1] ?? 0;
    const value = bigIntFrom(der.slice(offset + 2, offset + 2 + length));
    offset += 2 + length;
    return value;
  };
  const r = readInteger();
  const s = readInteger();
  const low = s > P256_ORDER / 2n ? P256_ORDER - s : s;
  return concatBytes(bytesFrom(r, 32), bytesFrom(low, 32));
}

/**
 * SPKI to the 65-byte uncompressed point, by importing rather than slicing.
 *
 * `exportKey('raw')` on a P-256 key is defined to produce exactly the
 * uncompressed SEC1 encoding the contract wants. Going through the import also
 * means a credential that is somehow not P-256 fails here, with a sentence,
 * rather than at `__check_auth` with `ExternalVerificationFailed`.
 */
async function uncompressedPoint(spki: ArrayBuffer): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'spki',
    spki,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify'],
  );
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
  if (raw.length !== 65 || raw[0] !== 0x04) {
    throw new Error(`expected a 65-byte uncompressed key, got ${raw.length} bytes`);
  }
  return raw;
}

/* --- creating one --------------------------------------------------------- */

/**
 * Create a passkey and remember its public half.
 *
 * `residentKey: 'required'` so the credential is discoverable — a passkey the
 * user has to be told the id of is a password with extra steps. `ES256` only:
 * the verifier is secp256r1 and nothing else will verify, so offering RS256 as
 * a fallback would produce a credential that cannot sign for this account.
 */
export async function createPasskey(label: string): Promise<Passkey> {
  // The same gate `local-key.ts` applies at the same point, and for the same
  // reason: a credential created to own an account on a network this build
  // refuses to sign for has no honest reason to exist.
  assertTestnet(NETWORK_PASSPHRASE);

  if (!passkeysAvailable()) throw new Error('This browser does not support passkeys.');

  const userId = crypto.getRandomValues(new Uint8Array(16));
  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: RP_NAME },
      user: { id: userId, name: label, displayName: label },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required',
      },
      timeout: 120_000,
      attestation: 'none',
    },
  })) as PublicKeyCredential | null;

  if (credential === null) throw new Error('No passkey was created.');

  const response = credential.response as AuthenticatorAttestationResponse;
  const spki = response.getPublicKey();
  if (spki === null) throw new Error('The authenticator returned no public key.');

  const point = await uncompressedPoint(spki);
  const credentialId = toBase64Url(new Uint8Array(credential.rawId));

  const stored: StoredPasskey = {
    version: 1,
    credentialId,
    publicKeyHex: toHex(point),
    createdAt: new Date().toISOString(),
  };
  if (!write(stored)) {
    throw new Error(
      'This browser refused to store the passkey’s public details — private mode, or a full quota. The passkey itself may still exist on your device; nothing was created here.',
    );
  }

  return toPasskey(stored, point);
}

/** The passkey this browser knows about, or `undefined`. */
export function getPasskey(): Passkey | undefined {
  const stored = read();
  if (stored === undefined) return undefined;
  const point = hexToBytes(stored.publicKeyHex);
  if (point.length !== 65) return undefined;
  return toPasskey(stored, point);
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(Math.floor(hex.length / 2));
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

function toPasskey(stored: StoredPasskey, point: Uint8Array): Passkey {
  const credentialIdBytes = fromBase64Url(stored.credentialId);
  const keyData = concatBytes(point, credentialIdBytes);
  return {
    keyData,
    hexPublicKey: toHex(point),
    hexKeyData: toHex(keyData),
    credentialId: stored.credentialId,
    signer: {
      rawPublicKey: () => concatBytes(point, credentialIdBytes),
      sign: (digest) => assert(digest, credentialIdBytes),
    },
  };
}

/**
 * One assertion over `digest`, encoded the way the verifier reads it.
 *
 * `digest` is the account's `auth_digest` — `signAs` computes it and hands it
 * here, and `storage.rs::authenticate` is what settles that the verifier is
 * given the digest rather than the host's `signature_payload`. Passing it as
 * the WebAuthn challenge is what makes `clientDataJSON.challenge` the base64url
 * of it, which is the equality the contract checks.
 *
 * This prompts the authenticator, so it is asynchronous — which is why
 * `Ed25519Signer.sign` may return a promise. Before V7 §5 it could not, and no
 * passkey could have signed through this path at all.
 */
async function assert(digest: Uint8Array, credentialId: Uint8Array): Promise<Uint8Array> {
  const credential = (await navigator.credentials.get({
    publicKey: {
      challenge: digest as unknown as BufferSource,
      allowCredentials: [{ type: 'public-key', id: credentialId as unknown as BufferSource }],
      userVerification: 'required',
      timeout: 120_000,
    },
  })) as PublicKeyCredential | null;

  if (credential === null) throw new Error('The passkey did not sign.');
  const response = credential.response as AuthenticatorAssertionResponse;

  const sigData = structMap([
    ['authenticator_data', scvBytes(new Uint8Array(response.authenticatorData))],
    ['client_data', scvBytes(new Uint8Array(response.clientDataJSON))],
    ['signature', scvBytes(rawSignature(new Uint8Array(response.signature)))],
  ]);

  return new Uint8Array(sigData.toXDR());
}

/* --- subscription, in the shape `local-key.ts` and `store.ts` use --------- */

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeToPasskey(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

/** Public material only, for `useSyncExternalStore`. */
export function readPasskeySnapshot(): string | null {
  if (typeof window === 'undefined') return null;
  const stored = read();
  return stored === undefined ? '' : `${stored.credentialId}:${stored.publicKeyHex}`;
}

export const SERVER_PASSKEY_SNAPSHOT = null;
