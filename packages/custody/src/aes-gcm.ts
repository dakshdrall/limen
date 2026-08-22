/**
 * AES-256-GCM, once, for both halves of the envelope.
 *
 * Envelope encryption has two encryptions in it and they are the same
 * operation: a master key encrypts a data key, and a data key encrypts a seed.
 * Writing that twice would be two places for a nonce to be reused, for a tag to
 * be dropped, or for the associated data to be forgotten — and the second
 * writing is the one nobody reviews as carefully, because it looks like the
 * first one which was already reviewed.
 *
 * So it is here once and both callers name it. `env-master-key.ts` was the
 * original site and its wire format is what this preserves exactly:
 *
 *     nonce (12) ‖ ciphertext ‖ tag (16)
 *
 * That layout is not an implementation detail that may drift. Rows written by
 * the M1 provider are in `agent_keys` and must still open after this file
 * exists, so the bytes are a compatibility surface and the round-trip test
 * against a fixed vector is what says so.
 *
 * ## Why the AAD is required rather than optional
 *
 * GCM authenticates associated data without encrypting it, which is what binds
 * a ciphertext to the context it belongs in. Both callers have such a context
 * and they are different: the master key binds the provider id, so a row whose
 * `kms_key_id` was edited fails to open rather than being opened by the wrong
 * key; the data key binds the agent id, so a sealed seed moved from one agent's
 * row to another's fails to open rather than signing for the wrong account.
 *
 * The second of those is the one worth the parameter being required. A sealed
 * seed with no AAD is portable between rows, and an attacker with write access
 * to one column could move an agent's key onto an agent whose boundary is
 * wider. Making the argument mandatory means neither caller can reach the
 * unbound form by leaving something out.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** AES-256-GCM: 32-byte key, 12-byte nonce, 16-byte tag. */
export const GCM_KEY_BYTES = 32;
export const GCM_NONCE_BYTES = 12;
export const GCM_TAG_BYTES = 16;

/** The shortest a well-formed value can be: a nonce, a tag, and no plaintext. */
export const GCM_OVERHEAD_BYTES = GCM_NONCE_BYTES + GCM_TAG_BYTES;

function assertKey(key: Uint8Array, who: string): void {
  if (key.length !== GCM_KEY_BYTES) {
    throw new Error(`${who}: AES-256-GCM needs a ${GCM_KEY_BYTES}-byte key; got ${key.length}.`);
  }
}

/**
 * Encrypt, returning `nonce ‖ ciphertext ‖ tag`.
 *
 * A fresh nonce per call, from `randomBytes`. Never a counter and never derived
 * from the plaintext: GCM's security collapses entirely on nonce reuse under
 * the same key, and a counter is exactly the thing that repeats after a process
 * restarts or a row is re-sealed.
 */
export function gcmSeal({
  key,
  aad,
  plaintext,
}: {
  key: Uint8Array;
  /** Authenticated, not encrypted. Binds the ciphertext to where it belongs. */
  aad: string;
  plaintext: Uint8Array;
}): Uint8Array {
  assertKey(key, 'gcmSeal');
  const nonce = randomBytes(GCM_NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return new Uint8Array(Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]));
}

/**
 * Decrypt, or throw.
 *
 * Throws on a bad tag, a wrong key, a wrong AAD, or a truncated value, and
 * deliberately does not distinguish them in the message. An attacker probing
 * this should learn that it failed and nothing else — the caller knows which
 * context it passed and can say something useful; this function cannot say
 * anything useful without also saying it to whoever is probing.
 */
export function gcmOpen({
  key,
  aad,
  sealed,
  who,
}: {
  key: Uint8Array;
  aad: string;
  sealed: Uint8Array;
  /** Named in the length error, so a caller's failure says which value was short. */
  who: string;
}): Uint8Array {
  assertKey(key, who);
  const bytes = Buffer.from(sealed);
  if (bytes.length < GCM_OVERHEAD_BYTES) {
    throw new Error(`${who}: sealed value is too short to contain a nonce and a tag.`);
  }

  const nonce = bytes.subarray(0, GCM_NONCE_BYTES);
  const tag = bytes.subarray(bytes.length - GCM_TAG_BYTES);
  const ciphertext = bytes.subarray(GCM_NONCE_BYTES, bytes.length - GCM_TAG_BYTES);

  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  return new Uint8Array(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
}

/** A fresh 32-byte symmetric key. The data key of an envelope. */
export function randomGcmKey(): Uint8Array {
  return new Uint8Array(randomBytes(GCM_KEY_BYTES));
}

/**
 * Overwrite key material that is no longer needed.
 *
 * Best-effort and honestly so: V8's GC may already have copied the buffer, and
 * this cannot reach those copies. What it does buy is real and narrow — the
 * seed is not sitting in a long-lived buffer for the rest of the process's
 * life, so a heap dump taken later does not contain it. That is worth the two
 * lines; believing it makes the seed unrecoverable is not.
 */
export function wipe(bytes: Uint8Array): void {
  bytes.fill(0);
}
