/**
 * Server-side WebAuthn verification: the origin and challenge checks the chain
 * does not do.
 *
 * §7.3, and it is required rather than defence in depth. §1.10 records what was
 * read out of the deployed verifier and confirmed on a ledger: the contract
 * parses `clientDataJSON` for exactly `type` and `challenge`, and validates
 * **neither `origin` nor `rpIdHash`**. So a valid assertion is evidence that
 * *this credential signed these bytes* — and evidence of nothing about which
 * site asked for it.
 *
 * That is fine for the contract's purpose, where the challenge is a transaction
 * digest and the account is the thing being protected. It is not fine for a
 * login. If Limen accepted an assertion the way the contract does, any site a
 * user visits could collect an assertion for their credential and replay it
 * here as a login. **The login path must not inherit that gap**, which is the
 * sentence this module exists to satisfy.
 *
 * ## What is checked here, and why each one
 *
 * 1. **`type`** is `webauthn.get` for an assertion, `webauthn.create` for a
 *    registration. A registration response replayed as a login is a real
 *    confusion attack, and the field exists precisely to make the two
 *    non-interchangeable.
 * 2. **`challenge`** matches one this server issued, is single-use, and has not
 *    expired. Without this an assertion is a bearer token that never expires.
 * 3. **`origin`** is exactly one this deployment expects. This is the check the
 *    contract does not do and the reason this file exists.
 * 4. **`rpIdHash`** equals SHA-256 of the relying-party id. Origin is what the
 *    *browser* claims in `clientDataJSON`; `rpIdHash` is what the
 *    *authenticator* bound the credential to, and it is inside the signed
 *    authenticator data. Checking only origin trusts the half an attacker
 *    controls if they can produce `clientDataJSON` at all.
 * 5. **UP and UV flags**, both set. `passkey.ts` already requires
 *    `userVerification: 'required'` so the on-chain verifier will accept the
 *    assertion; requiring it here too means the two paths cannot disagree about
 *    what a credential is worth.
 * 6. **The signature**, over `authenticatorData ‖ SHA-256(clientDataJSON)`,
 *    against the stored P-256 public key. Everything above is a claim in a
 *    document until this line proves the document was not edited.
 *
 * ## Low-S is *not* enforced here, deliberately
 *
 * `passkey.ts` documents that the host rejects a high-S signature beneath the
 * contract, so the chain path must normalise. This path must not: WebCrypto's
 * ECDSA verify accepts both, and rejecting high-S at login would refuse a
 * perfectly valid assertion from an authenticator that happens to emit one —
 * turning an interoperability quirk of *Stellar's* host into a login failure.
 * The two paths want different things from the same signature, and this is the
 * one place they diverge on purpose.
 *
 * ## Counters are read and not enforced, and this is a decision
 *
 * The signature counter is meant to detect a cloned authenticator. Most
 * platform passkeys — iCloud Keychain, Google Password Manager — sync by design
 * and return a counter of zero forever, so enforcing monotonicity would lock
 * out the authenticators most users actually have, to detect cloning of the
 * ones that cannot be cloned. It is returned for recording rather than acted
 * on, and this comment is here so that the absence reads as a decision.
 */

import 'server-only';
import { createHash, webcrypto } from 'node:crypto';

/** What a caller must prove it expected, rather than what this module assumes. */
export interface Expectation {
  /** Every origin this deployment serves. Exact string match, never a prefix. */
  origins: readonly string[];
  /** The relying-party id — a registrable domain, never an origin. */
  rpId: string;
  /** The challenge this server issued, base64url, already proven single-use. */
  challenge: string;
  type: 'webauthn.create' | 'webauthn.get';
}

export interface VerifiedAssertion {
  /** Read, recorded, not enforced. See the header. */
  signCount: number;
  userPresent: boolean;
  userVerified: boolean;
}

export class WebAuthnError extends Error {
  readonly reason: string;
  constructor(reason: string, message: string) {
    super(message);
    this.name = 'WebAuthnError';
    this.reason = reason;
  }
}

export function base64UrlToBytes(value: string): Uint8Array {
  // Padding restored rather than assumed: `Buffer.from(x, 'base64url')` is
  // lenient about it, and a stricter runtime is not.
  const normalised = value.replace(/-/g, '+').replace(/_/g, '/');
  return new Uint8Array(Buffer.from(normalised, 'base64'));
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Constant-time equality.
 *
 * The challenge comparison is the one that matters: a byte-at-a-time compare
 * that returns early leaks how much of a guess was right, and a challenge is
 * exactly the kind of value an attacker gets unlimited attempts at.
 */
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return difference === 0;
}

function equalStrings(a: string, b: string): boolean {
  return equalBytes(new TextEncoder().encode(a), new TextEncoder().encode(b));
}

interface ClientData {
  type: string;
  challenge: string;
  origin: string;
  crossOrigin?: boolean;
}

/**
 * `authenticatorData`, which is where the authenticator's own claims live.
 *
 * Fixed layout: 32 bytes of `rpIdHash`, one flags byte, four bytes of counter,
 * then optional attested credential data this path does not read.
 */
export interface AuthenticatorData {
  rpIdHash: Uint8Array;
  userPresent: boolean;
  userVerified: boolean;
  signCount: number;
}

export function parseAuthenticatorData(bytes: Uint8Array): AuthenticatorData {
  if (bytes.length < 37) {
    throw new WebAuthnError('authenticator_data_short', 'authenticatorData is shorter than its fixed 37-byte header.');
  }
  const flags = bytes[32] ?? 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    rpIdHash: bytes.slice(0, 32),
    userPresent: (flags & 0x01) !== 0,
    userVerified: (flags & 0x04) !== 0,
    signCount: view.getUint32(33, false),
  };
}

function parseClientData(bytes: Uint8Array, expected: Expectation): ClientData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new WebAuthnError('client_data_not_json', 'clientDataJSON is not JSON.');
  }
  const data = parsed as Partial<ClientData>;
  if (typeof data.type !== 'string' || typeof data.challenge !== 'string' || typeof data.origin !== 'string') {
    throw new WebAuthnError('client_data_incomplete', 'clientDataJSON is missing type, challenge or origin.');
  }

  // Check 1. A `webauthn.create` response replayed into the login path is a
  // real confusion attack, not a hypothetical one.
  if (!equalStrings(data.type, expected.type)) {
    throw new WebAuthnError(
      'type_mismatch',
      `clientDataJSON type is '${data.type}', expected '${expected.type}'. A registration response is not a login.`,
    );
  }

  // Check 2. Single-use and expiry are the caller's job — this proves the
  // assertion is *about* the challenge that was issued.
  if (!equalStrings(data.challenge, expected.challenge)) {
    throw new WebAuthnError('challenge_mismatch', 'The assertion answers a different challenge than the one issued.');
  }

  // Check 3. The one the contract does not do. Exact match against a closed
  // list — never `startsWith`, which would accept `https://limen.app.evil.com`.
  if (!expected.origins.some((origin) => equalStrings(data.origin as string, origin))) {
    throw new WebAuthnError(
      'origin_mismatch',
      `Assertion origin '${data.origin}' is not one this deployment serves. The on-chain verifier does not check this; the login path must.`,
    );
  }

  if (data.crossOrigin === true) {
    // An assertion produced inside an iframe on another site. The credential is
    // genuine and the signature verifies; what is missing is any evidence the
    // user meant to log in *here*.
    throw new WebAuthnError('cross_origin', 'Assertion was produced cross-origin.');
  }

  return data as ClientData;
}

export interface VerifyInput {
  /** Raw bytes, already base64url-decoded by the route. */
  clientDataJSON: Uint8Array;
  authenticatorData: Uint8Array;
  /** ASN.1 DER, as a real WebAuthn assertion emits. */
  signature: Uint8Array;
  /** 65-byte uncompressed SEC1 — the same bytes the chain stores. */
  publicKey: Uint8Array;
}

/**
 * The whole check, in the order that fails cheapest first.
 *
 * Ordering is deliberate: the parsing and comparison checks cost nothing, and
 * the signature verification is the expensive one. A caller hammering this with
 * garbage should be refused before it can make this server do elliptic-curve
 * maths.
 */
export async function verifyAssertion(
  { clientDataJSON, authenticatorData, signature, publicKey }: VerifyInput,
  expected: Expectation,
): Promise<VerifiedAssertion> {
  parseClientData(clientDataJSON, expected);

  const auth = parseAuthenticatorData(authenticatorData);

  // Check 4. Origin is what the browser says; this is what the authenticator
  // bound the credential to, and it is inside the signed bytes.
  const expectedRpIdHash = new Uint8Array(createHash('sha256').update(expected.rpId).digest());
  if (!equalBytes(auth.rpIdHash, expectedRpIdHash)) {
    throw new WebAuthnError(
      'rp_id_mismatch',
      `authenticatorData is bound to a different relying party than '${expected.rpId}'.`,
    );
  }

  // Check 5. Both, and for the reason `passkey.ts` gives: the on-chain verifier
  // refuses an assertion without them, so accepting one here would mean a
  // credential that can log in but cannot own an account.
  if (!auth.userPresent) throw new WebAuthnError('user_not_present', 'Authenticator did not assert user presence.');
  if (!auth.userVerified) {
    throw new WebAuthnError(
      'user_not_verified',
      'Authenticator did not verify the user. passkey.ts asks for userVerification=required, and the on-chain verifier refuses an assertion without UV.',
    );
  }

  // Check 6. Everything above is a claim in a document until this line.
  const signedData = new Uint8Array(authenticatorData.length + 32);
  signedData.set(authenticatorData, 0);
  signedData.set(new Uint8Array(createHash('sha256').update(clientDataJSON).digest()), authenticatorData.length);

  const key = await webcrypto.subtle.importKey(
    'raw',
    publicKey,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  // DER in, P-1363 out. `passkey.ts` unpacks the same encoding for the chain
  // path; the difference is that this one must not normalise S. See the header.
  const raw = derToRawSignature(signature);
  const valid = await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, raw, signedData);
  if (!valid) throw new WebAuthnError('bad_signature', 'Assertion signature does not verify against the stored key.');

  return { signCount: auth.signCount, userPresent: auth.userPresent, userVerified: auth.userVerified };
}

/**
 * ASN.1 DER `SEQUENCE { INTEGER r, INTEGER s }` to the fixed 64-byte `r‖s`
 * WebCrypto wants.
 *
 * Parsed rather than sliced at fixed offsets. DER integers are variable length —
 * a leading zero appears whenever the high bit would otherwise read as a sign,
 * and a short value is simply shorter — so fixed offsets work on most
 * signatures and fail on a predictable minority.
 */
export function derToRawSignature(der: Uint8Array): Uint8Array {
  if (der[0] !== 0x30) throw new WebAuthnError('signature_not_der', 'Signature is not a DER SEQUENCE.');

  let offset = 2;
  // Long-form length, which appears once a signature exceeds 127 bytes.
  if ((der[1] ?? 0) & 0x80) offset = 2 + ((der[1] ?? 0) & 0x7f);

  const readInteger = (): Uint8Array => {
    if (der[offset] !== 0x02) throw new WebAuthnError('signature_not_der', 'Expected a DER INTEGER in the signature.');
    const length = der[offset + 1] ?? 0;
    const value = der.slice(offset + 2, offset + 2 + length);
    offset += 2 + length;
    return value;
  };

  const pad = (value: Uint8Array): Uint8Array => {
    // Strip DER's sign byte, then left-pad to the curve's fixed width.
    const stripped = value[0] === 0 ? value.slice(1) : value;
    if (stripped.length > 32) throw new WebAuthnError('signature_not_der', 'Signature component exceeds 32 bytes.');
    const out = new Uint8Array(32);
    out.set(stripped, 32 - stripped.length);
    return out;
  };

  const r = pad(readInteger());
  const s = pad(readInteger());
  const raw = new Uint8Array(64);
  raw.set(r, 0);
  raw.set(s, 32);
  return raw;
}
