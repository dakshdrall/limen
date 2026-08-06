/**
 * Signing an OpenZeppelin smart-account auth entry, and the two guards that sit
 * on every write path.
 *
 * Lifted from `scripts/testnet.mjs`, where it worked and could only be used by
 * a Node script holding secrets from the environment. Nothing here reads an
 * environment variable, touches a filesystem, or knows where a key came from:
 * it takes something that can sign 32 bytes. That is what lets the browser's
 * `localStorage` keypair and a Node script's `Keypair.fromSecret` use the same
 * code, and it is why the signature below is `Ed25519Signer` rather than
 * `Keypair`.
 */

import { authorizeEntry, xdr } from '@stellar/stellar-sdk';
import { authDigest, authPayload, externalSigner } from './authpayload.js';
import { toHex } from './bytes.js';
import { TESTNET_PASSPHRASE, type SupportedPassphrase } from './network.js';

/**
 * Whatever holds an ed25519 key, reduced to what signing actually needs.
 *
 * `Keypair` satisfies this structurally. So does a key held in `localStorage`,
 * and so would a WebCrypto `CryptoKey` behind a two-line adapter — without any
 * of them being named here. The narrower this interface is, the fewer places
 * the browser path and the script path can drift apart.
 */
export interface Ed25519Signer {
  /** The raw 32-byte public key, as the verifier contract stores it. */
  rawPublicKey(): Uint8Array;
  /** Detached ed25519 signature over `message`. */
  sign(message: Uint8Array): Uint8Array;
}

/**
 * Level 2 of the mainnet gate: a runtime throw for a passphrase the type
 * checker never saw.
 *
 * The type union in `network.ts` covers every caller TypeScript compiles. It
 * covers nothing that arrives as a string at runtime — a JSON config, an env
 * var, a JavaScript caller, a value pulled off a URL. This is the fence for
 * those, and `test/sign.test.ts` calls it with the mainnet passphrase and
 * asserts it throws, because a fence that has never been shown firing is a
 * comment.
 */
export function assertTestnet(passphrase: SupportedPassphrase): asserts passphrase is SupportedPassphrase {
  if (passphrase !== TESTNET_PASSPHRASE) {
    throw new Error(
      `refusing to sign for network passphrase ${JSON.stringify(passphrase)}: @limen/chain builds transactions for Stellar testnet and nothing else`,
    );
  }
}

/**
 * The owner and the agent are two keys, or nothing below means anything.
 *
 * A demonstration in which the bounded key and the key that installed the bound
 * is the same key demonstrates nothing at all: every refusal it shows could be
 * explained by the account simply declining to sign. Enforced here rather than
 * intended in a comment, and called on every install and every agent
 * submission — which `test/sign.test.ts` checks by scanning source, in the same
 * idiom as the local-key label tripwire.
 */
export function assertDistinctSigners(owner: Uint8Array, agent: Uint8Array): void {
  if (owner.length === agent.length && owner.every((byte, i) => byte === agent[i])) {
    throw new Error(
      `owner and agent are the same key (${toHex(owner)}); a boundary the bounded party could have installed itself proves nothing`,
    );
  }
}

export interface SignAuthEntryOptions {
  signer: Ed25519Signer;
  /** The ed25519 verifier contract this signer is registered against. */
  verifier: string;
  /**
   * The rule ids this signature selects, bound into the digest.
   *
   * Not decoration: `authDigest` hashes them in, so a signature collected under
   * a strict rule cannot be replayed against a weaker one.
   */
  contextRuleIds: number[];
  /** Ledger past which the signed entry is no longer valid. */
  expirationLedger: number;
  passphrase: SupportedPassphrase;
}

/**
 * Sign a smart-account auth entry.
 *
 * The signature is over `authDigest`, never over the host payload, and it goes
 * in verbatim as `signatureScVal` because `__check_auth` expects an
 * `AuthPayload` rather than the built-in ed25519 signature vector.
 */
export function signAs({
  signer,
  verifier,
  contextRuleIds,
  expirationLedger,
  passphrase,
}: SignAuthEntryOptions): (entry: xdr.SorobanAuthorizationEntry) => Promise<xdr.SorobanAuthorizationEntry> {
  assertTestnet(passphrase);
  const raw = signer.rawPublicKey();

  return (entry) =>
    authorizeEntry(
      entry,
      async (_preimage, payload) => ({
        signatureScVal: authPayload(
          [
            {
              signer: externalSigner(verifier, raw),
              signature: signer.sign(authDigest(new Uint8Array(payload), contextRuleIds)),
            },
          ],
          contextRuleIds,
        ),
      }),
      expirationLedger,
      passphrase,
    );
}
