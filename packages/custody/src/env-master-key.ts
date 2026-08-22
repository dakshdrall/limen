/**
 * The master key in an environment variable, and the fence that keeps it off
 * mainnet.
 *
 * AES-256-GCM. The data key is the plaintext, the master key is the key, and
 * the wrapped form is `nonce || ciphertext || tag` — GCM's tag is what makes an
 * unwrap of a corrupted or substituted value fail rather than return plausible
 * bytes, which for a key is the difference between a loud failure and signing
 * with garbage.
 *
 * ## The refusal is the point of this module
 *
 * §7.5.3 condition 3: the env-var implementation **refuses to construct when
 * `NODE_ENV=production` and the network is not testnet** — the same shape as
 * `demo-signer.ts`'s hard throw and `assertTestnet`, which is a fence rather
 * than a warning. It refuses at *construction*, not at first use: a process
 * that is going to be unable to hold keys safely should fail to start, not fail
 * on the first request that needs one, hours later, in front of somebody.
 *
 * Note which way round the condition is. It is not "refuse in production" —
 * production against testnet is exactly what this deployment is, and refusing
 * it would make the fence something to work around. It is "refuse in production
 * against a network that is not testnet", which is the sentence that is
 * actually true: on mainnet this key handling would not be acceptable, and it
 * is one of the reasons there is no mainnet.
 *
 * ## Why the master key is not validated for entropy
 *
 * It is checked for length and for being decodable, and no further. A check
 * that tried to judge whether 32 bytes were "random enough" would fail on a
 * legitimately random key often enough to be disabled, and would pass on
 * anything an attacker chose. Length is the property that has a right answer.
 */

import { timingSafeEqual } from 'node:crypto';
import { TESTNET_PASSPHRASE } from '@limen/chain/network';
import { GCM_KEY_BYTES, gcmOpen, gcmSeal } from './aes-gcm.js';
import { WrongKeyProviderError, type KeyProvider, type WrappedKey } from './key-provider.js';

/**
 * The 32 bytes of the master key.
 *
 * The nonce and tag sizes moved to `aes-gcm.ts` along with the two operations
 * that use them. The wire format did not change: `nonce ‖ ciphertext ‖ tag`,
 * with the provider id as associated data, exactly as rows already in
 * `agent_keys` were written.
 */
const KEY_BYTES = GCM_KEY_BYTES;

export interface EnvMasterKeyOptions {
  /** The master key, base64. 32 bytes decoded. */
  masterKeyBase64: string;
  /**
   * Which key this is, recorded on every row it wraps.
   *
   * Defaulted rather than required, and the default names the *kind* of
   * provider rather than an instance, because that is what a reader of an
   * `agent_keys` row most needs to know after a swap: not which env var, but
   * that this row predates the KMS.
   */
  id?: string;
  /** `process.env.NODE_ENV`, passed rather than read. See `provider.ts`. */
  nodeEnv: string | undefined;
  /** The network passphrase this deployment builds against. */
  networkPassphrase: string;
}

export class EnvMasterKeyProvider implements KeyProvider {
  readonly id: string;
  readonly #masterKey: Buffer;

  constructor({ masterKeyBase64, id = 'env-master-v1', nodeEnv, networkPassphrase }: EnvMasterKeyOptions) {
    // The fence, first, before anything reads a key. A constructor that
    // validated the key and then checked the network would have already loaded
    // the master key into the process it is refusing to run in.
    if (nodeEnv === 'production' && networkPassphrase !== TESTNET_PASSPHRASE) {
      throw new Error(
        'EnvMasterKeyProvider refuses to construct: NODE_ENV=production with a network that is not Stellar testnet. ' +
          'A master key held in the server environment is not protected against a host compromise, which is acceptable ' +
          'for testnet and is not acceptable for real funds. A real KMS is a documented mainnet precondition — ' +
          'see PLAN-V8 §7.5.3. This is a fence, not a configuration option.',
      );
    }

    const key = Buffer.from(masterKeyBase64, 'base64');
    if (key.length !== KEY_BYTES) {
      throw new Error(
        `EnvMasterKeyProvider needs a ${KEY_BYTES}-byte master key, base64-encoded; got ${key.length} bytes. ` +
          `Generate one with: node -e "console.log(require('crypto').randomBytes(${KEY_BYTES}).toString('base64'))"`,
      );
    }

    this.id = id;
    this.#masterKey = key;
  }

  // `async` on both, and not as a style choice.
  //
  // These were written returning `Promise.resolve(...)` from a synchronous
  // body, which type-checks and is wrong: every validation failure below threw
  // *synchronously* out of a method whose signature promises a rejection. A
  // caller writing `provider.unwrapDataKey(w).catch(report)` — the natural
  // shape, and the one `KmsKeyProvider` will require since it is genuinely
  // async — would have taken an uncaught exception instead of a handled
  // rejection. The test suite found it; the type system could not.
  async wrapDataKey(plaintext: Uint8Array): Promise<WrappedKey> {
    // The provider id is authenticated but not encrypted: it is not a secret,
    // and binding it here means a wrapped key whose `keyId` was edited in the
    // database fails to unwrap rather than being unwrapped by the wrong key.
    const bytes = gcmSeal({ key: this.#masterKey, aad: this.id, plaintext });
    return { bytes, keyId: this.id };
  }

  async unwrapDataKey(wrapped: WrappedKey): Promise<Uint8Array> {
    // Constant-time, because `keyId` arrives from a database row and comparing
    // it with `!==` leaks its length and prefix through timing. Cheap here, and
    // the habit is what matters: this is the module where the habit should be
    // strongest.
    const expected = Buffer.from(this.id, 'utf8');
    const actual = Buffer.from(wrapped.keyId, 'utf8');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new WrongKeyProviderError(this.id, wrapped.keyId);
    }

    // Throws on a bad tag. Deliberately not caught and re-thrown with detail:
    // an attacker probing this should learn that it failed and nothing else.
    return gcmOpen({
      key: this.#masterKey,
      aad: this.id,
      sealed: wrapped.bytes,
      who: 'EnvMasterKeyProvider: wrapped key',
    });
  }
}
