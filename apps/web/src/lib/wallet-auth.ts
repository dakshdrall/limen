/**
 * Verifying what a wallet signed — one envelope, one encoding, no guessing.
 *
 * This file is deliberately narrow, and the narrowness is a measurement result
 * rather than a preference. `@stellar/freighter-api` is a relay with no signing
 * code in it, so what Freighter actually signs could not be read out of this
 * repository. It was measured with a throwaway probe at `/app/dev/freighter`
 * (recorded in PLAN-V8, and deleted in the same change that added this file),
 * and the answer was exact:
 *
 * ```
 * signedMessage   base64 string, length 88 → 64 signature bytes   (the v4 shape)
 * verified        true, under sep53 and sep53-manual
 * raw-utf8        failed
 * sha256-message  failed
 * hex decode      yields 1 byte — so base64 is unambiguous
 * ```
 *
 * So: SEP-53, base64, and nothing else is accepted. The probe tried four
 * envelopes because the answer was unknown; this tries one because it is known,
 * and widening it later should require a new measurement rather than a guess.
 *
 * ## Why the v3 shape is refused rather than handled
 *
 * `signMessage`'s return type is a union — v3 of the extension answered with a
 * `Buffer`, v4 with a base64 `string`. Only v4 was measured. A `Buffer` arriving
 * here would mean an extension whose envelope this project has never tested, and
 * the tempting move — decode it and try SEP-53 anyway — would be inventing a
 * result for a version nobody ran. It is refused with a message that says what
 * to do, because a person on an old Freighter needs to update it, not to see a
 * signature verification fail for reasons they cannot act on.
 *
 * ## What a verified signature does and does not prove
 *
 * It proves the holder of the private key for this `G…` address signed this
 * challenge. That is authentication, and it is all it is. It says nothing about
 * who owns any smart account — on this deployment the owner is still the
 * browser's disposable ed25519 key, and F4's finding that a wallet cannot be an
 * `External` signer is unchanged by any of this. `auth.ts` keeps the identity
 * and the ownership apart; this file only answers the first question.
 */

import 'server-only';
import { Keypair } from '@stellar/stellar-sdk';

/**
 * An ed25519 signature is 64 bytes, and the measured value was exactly that.
 *
 * Checked before `verifyMessage` rather than left to it, so a wrong-sized input
 * is named as what it is instead of arriving as a generic verification failure.
 */
const SIGNATURE_BYTES = 64;

/** base64 of 64 bytes is 88 characters. A cheap bound before any decoding. */
const MAX_SIGNATURE_LENGTH = 128;

/**
 * Why a wallet signature was not accepted.
 *
 * A closed union rather than free text: the route maps these to one status and
 * one message each, and a new reason should have to be added here — where its
 * meaning is written down — instead of appearing as a new string at a call site.
 */
export type WalletAuthReason =
  | 'bad_address'
  | 'bad_signature_shape'
  | 'legacy_wallet'
  | 'signature_mismatch';

export class WalletAuthError extends Error {
  constructor(
    readonly reason: WalletAuthReason,
    message: string,
  ) {
    super(message);
    this.name = 'WalletAuthError';
  }
}

/**
 * A `G…` address, checked as one.
 *
 * `Keypair.fromPublicKey` validates the strkey — version byte and CRC16 — and
 * throws on anything else. It is called here rather than at the point of
 * verification so that "this is not a Stellar address" and "this key did not
 * sign this" stay different answers; they send a reader to entirely different
 * places, and collapsing them was one of the things the probe was careful about.
 *
 * Returns the address in its canonical form, which is the input: strkey has one
 * spelling per key, so there is no normalisation to do and normalising would
 * only hide a caller sending something else.
 */
export function assertStellarAddress(value: unknown): string {
  const address = typeof value === 'string' ? value.trim() : '';
  if (address.length === 0) {
    throw new WalletAuthError('bad_address', 'No wallet address was supplied.');
  }
  // `G` is the ed25519 public key version byte. Contract (`C…`) and muxed
  // (`M…`) addresses parse as valid strkeys elsewhere in the SDK but cannot
  // hold a private key that signs anything, so they are refused here by name
  // rather than failing later as a signature that did not verify.
  if (!address.startsWith('G')) {
    throw new WalletAuthError(
      'bad_address',
      'A wallet address starts with G. Contract and muxed addresses cannot sign a challenge.',
    );
  }
  try {
    Keypair.fromPublicKey(address);
  } catch {
    throw new WalletAuthError('bad_address', 'That is not a valid Stellar address.');
  }
  return address;
}

/**
 * The base64 signature, as bytes — or a refusal naming which assumption failed.
 *
 * Accepts a `string` only. Everything else, including the v3 `Buffer` and its
 * `postMessage`-serialised form, is refused: see the header.
 */
export function decodeSignature(signedMessage: unknown): Buffer {
  if (signedMessage instanceof Uint8Array || isSerialisedBuffer(signedMessage)) {
    throw new WalletAuthError(
      'legacy_wallet',
      'This Freighter returns the older Buffer signature shape. Update Freighter and sign in again.',
    );
  }

  if (typeof signedMessage !== 'string' || signedMessage.length === 0) {
    throw new WalletAuthError('bad_signature_shape', 'The wallet did not return a signature.');
  }

  if (signedMessage.length > MAX_SIGNATURE_LENGTH) {
    throw new WalletAuthError('bad_signature_shape', 'The signature is longer than any ed25519 signature.');
  }

  // The alphabet is checked rather than inferred, for the reason `decodeField`
  // in `auth-route.ts` gives: `Buffer.from(…, 'base64')` silently drops what it
  // cannot read, so an input that is not base64 at all decodes to something
  // short and surfaces much later as a length complaint about the wrong thing.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signedMessage)) {
    throw new WalletAuthError('bad_signature_shape', 'The signature is not base64.');
  }

  const signature = Buffer.from(signedMessage, 'base64');
  if (signature.length !== SIGNATURE_BYTES) {
    throw new WalletAuthError(
      'bad_signature_shape',
      `An ed25519 signature is ${SIGNATURE_BYTES} bytes; this decoded to ${signature.length}.`,
    );
  }
  return signature;
}

/** Node's `Buffer` after a structured clone or a JSON round trip. */
function isSerialisedBuffer(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'Buffer' &&
    Array.isArray((value as { data?: unknown }).data)
  );
}

/**
 * Did the holder of this address sign this challenge?
 *
 * `verifyMessage` is the SDK's SEP-53 check — it hashes
 * `SHA-256("Stellar Signed Message:\n" ‖ message)` and verifies the ed25519
 * signature over that digest. The probe confirmed Freighter's signature
 * verifies under it, and under a hand-assembled equivalent, and under nothing
 * else.
 *
 * Throws rather than returning false. A caller that gets a boolean has to
 * remember to check it, and the one place this is called is a login.
 */
export function verifyWalletSignature(input: {
  address: string;
  challenge: string;
  signedMessage: unknown;
}): void {
  const address = assertStellarAddress(input.address);
  const signature = decodeSignature(input.signedMessage);

  if (input.challenge.length === 0) {
    throw new WalletAuthError('signature_mismatch', 'No challenge was supplied to verify against.');
  }

  let verified: boolean;
  try {
    verified = Keypair.fromPublicKey(address).verifyMessage(input.challenge, signature);
  } catch {
    // A throw from `verifyMessage` is a malformed signature rather than a
    // mismatched one, but both mean the same thing to a caller here and
    // distinguishing them in the response would be an oracle.
    verified = false;
  }

  if (!verified) {
    throw new WalletAuthError('signature_mismatch', 'That signature does not match this address.');
  }
}
