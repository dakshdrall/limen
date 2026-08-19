/**
 * The credential public key, read out of a registration response by a parser
 * that refuses everything it was not written for.
 *
 * ## Why the server parses this at all
 *
 * `navigator.credentials.create` hands the page two views of the same
 * credential: `response.getPublicKey()`, which the *browser* decodes into SPKI,
 * and `response.attestationObject`, which is what the *authenticator* produced.
 * The client could post either. Posting the first is smaller, simpler, and
 * works — and it makes the root of trust for every later login a value the
 * client computed.
 *
 * That is the seam this module exists to remove. §7.3's argument for
 * server-side verification is that the on-chain verifier checks neither `origin`
 * nor `rpIdHash`, so the login path cannot inherit the contract's idea of what
 * an assertion proves. The same argument applies one step earlier: a signature
 * check is worth exactly as much as the key it is checked against, and a key the
 * client chose the encoding of is a key the client chose. Nobody has to exploit
 * that for it to cost something — it is a boundary anyone touching auth has to
 * re-reason about, and that reasoning is subtle enough to eventually be got
 * wrong.
 *
 * So the bytes the server stores are the bytes inside `authData`, extracted
 * here, and `passkeyPublicKey` is written from this function's output and from
 * nowhere else.
 *
 * ## What `attestation: 'none'` does and does not prove, stated plainly
 *
 * `passkey.ts` asks for `attestation: 'none'`, so `attStmt` is empty and
 * **`authData` carries no signature over itself**. This function therefore
 * proves that the registration response is internally well-formed and that the
 * credential is an ES256 key on P-256. It does not prove the key lives in
 * genuine hardware, and it cannot: that is what an attestation statement is for,
 * and this deployment deliberately does not ask for one — attestation is a
 * privacy cost paid to a relying party that intends to make policy from device
 * models, and Limen does not.
 *
 * What a registration establishes is therefore *"this ceremony named this
 * credential"*, and possession is proved at login, by a signature over a
 * challenge this server issued, against this key. That is the whole security
 * argument and it does not lean on attestation anywhere. Stating it here is the
 * point: the gap is a decision, not an oversight, and the next person to read
 * `verifyRegistration` should not have to work it out from the absence of code.
 *
 * ## Why this is not a CBOR library
 *
 * A general CBOR decoder handles tags, indefinite lengths, floats, arrays,
 * 64-bit lengths, streaming and semantic types, and every one of those is a
 * branch this application will never take with an input an attacker controls.
 * The parser below reads one map with three known keys, then one map with five
 * known integer labels, and refuses on the first byte that is not what it was
 * expecting — including encodings that are merely *unusual* rather than
 * malformed, such as a length written in more bytes than it needs.
 *
 * That strictness is the safety property, not a limitation to work around. Every
 * shape it refuses is a shape this application has no use for, and refusing at
 * the parser is refusing before any of it reaches a key, a database column or a
 * signer. The three-line rule it follows:
 *
 *   - **exactly** `alg: -7` (ES256), `kty: 2` (EC2), `crv: 1` (P-256);
 *   - exactly the keys expected, each exactly once, with nothing left over;
 *   - canonical CTAP2 encoding, so one value has one representation.
 *
 * An RS256 credential, an Ed25519 credential, a compressed point, an
 * indefinite-length string and a map with a spare key are all rejected by the
 * same rule, and none of them can reach the code that would have to decide what
 * to do with them.
 */

import { WebAuthnError } from './webauthn-error';

/* --- the flags byte, at `authData[32]` ------------------------------------ */

const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
/** Attested credential data is present. Set on registration, never on login. */
const FLAG_ATTESTED_CREDENTIAL = 0x40;
/** Authenticator extension outputs follow the credential key. */
const FLAG_EXTENSION_DATA = 0x80;

/** `rpIdHash` ‖ flags ‖ signCount, before anything optional. */
const AUTH_DATA_HEADER = 37;

/** WebAuthn §6.5.2. A longer one is not a credential id this can have issued. */
const MAX_CREDENTIAL_ID = 1023;

/* --- COSE_Key labels, RFC 8152 §7.1 and §13.1.1 --------------------------- */

const COSE_KTY = 1;
const COSE_ALG = 3;
const COSE_CRV = -1;
const COSE_X = -2;
const COSE_Y = -3;

const KTY_EC2 = 2;
const ALG_ES256 = -7;
const CRV_P256 = 1;

/** P-256 coordinates are fixed width. A short one is not a small number here. */
const COORDINATE_BYTES = 32;

/**
 * Just enough CBOR, and deliberately not one branch more.
 *
 * Every method names what it was reading, so a refusal says which field was
 * wrong rather than only which byte. The offset is private: a caller that could
 * seek could read a length from one place and bytes from another, which is the
 * shape most parser bugs of this kind actually have.
 */
class NarrowCbor {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get atEnd(): boolean {
    return this.offset >= this.bytes.length;
  }

  /**
   * How far the reader has got.
   *
   * Read-only, and that is the whole distinction: a caller can ask where the
   * item it just read ended — which is how `readCredentialPublicKey` reports
   * where the extension data starts — without being able to move the reader
   * somewhere else.
   */
  get consumed(): number {
    return this.offset;
  }

  private take(count: number, what: string): Uint8Array {
    // `>` and not `>=`: a zero-length string at the very end is legal.
    if (count < 0 || this.offset + count > this.bytes.length) {
      throw new WebAuthnError(
        'cbor_truncated',
        `Ran off the end of the CBOR while reading ${what}: wanted ${count} bytes at offset ${this.offset} of ${this.bytes.length}.`,
      );
    }
    const slice = this.bytes.subarray(this.offset, this.offset + count);
    this.offset += count;
    return slice;
  }

  /**
   * The initial byte and its argument, with non-canonical encodings refused.
   *
   * CTAP2 requires canonical CBOR: the shortest form that fits. Accepting a
   * longer form would mean two byte sequences decode to the same map key, so a
   * "keys must be unique" check could be walked past by writing one of them the
   * long way. It costs three comparisons to make each value have one spelling.
   */
  private head(what: string): { major: number; argument: number } {
    const initial = this.take(1, `the ${what} header`)[0] ?? 0;
    const major = initial >> 5;
    const info = initial & 0x1f;

    if (info < 24) return { major, argument: info };

    if (info === 24) {
      const argument = this.take(1, `the ${what} length`)[0] ?? 0;
      if (argument < 24) {
        throw new WebAuthnError('cbor_not_canonical', `${what} encodes ${argument} in one byte too many.`);
      }
      return { major, argument };
    }

    if (info === 25) {
      const raw = this.take(2, `the ${what} length`);
      const argument = ((raw[0] ?? 0) << 8) | (raw[1] ?? 0);
      if (argument <= 0xff) {
        throw new WebAuthnError('cbor_not_canonical', `${what} encodes ${argument} in two bytes when one would do.`);
      }
      return { major, argument };
    }

    if (info === 26) {
      const raw = this.take(4, `the ${what} length`);
      const argument = (((raw[0] ?? 0) << 24) | ((raw[1] ?? 0) << 16) | ((raw[2] ?? 0) << 8) | (raw[3] ?? 0)) >>> 0;
      if (argument <= 0xffff) {
        throw new WebAuthnError('cbor_not_canonical', `${what} encodes ${argument} in four bytes when two would do.`);
      }
      return { major, argument };
    }

    // 27 is a 64-bit argument; 28 to 30 are reserved; 31 is indefinite length.
    // Nothing in a registration response is four gigabytes, nothing here is
    // streamed, and a reserved value is by definition not something this was
    // written for.
    throw new WebAuthnError(
      'cbor_unsupported_head',
      `${what} uses additional information ${info}, which is a 64-bit length, a reserved value or an indefinite-length item. None of the three appears in a registration response this parser was written for.`,
    );
  }

  private expect(major: number, what: string, describe: string): number {
    const head = this.head(what);
    if (head.major !== major) {
      throw new WebAuthnError(
        'cbor_wrong_type',
        `Expected ${describe} for ${what}, got CBOR major type ${head.major}.`,
      );
    }
    return head.argument;
  }

  unsigned(what: string): number {
    return this.expect(0, what, 'an unsigned integer');
  }

  /** Unsigned or negative. Negative labels are how COSE names `crv`, `x` and `y`. */
  integer(what: string): number {
    const head = this.head(what);
    if (head.major === 0) return head.argument;
    if (head.major === 1) return -1 - head.argument;
    throw new WebAuthnError('cbor_wrong_type', `Expected an integer for ${what}, got CBOR major type ${head.major}.`);
  }

  byteString(what: string): Uint8Array {
    return this.take(this.expect(2, what, 'a byte string'), what);
  }

  textString(what: string): string {
    // `fatal` so invalid UTF-8 is a refusal rather than a run of replacement
    // characters that then fails a string comparison for a misleading reason.
    return new TextDecoder('utf-8', { fatal: true }).decode(this.take(this.expect(3, what, 'a text string'), what));
  }

  /** The number of key/value pairs. */
  mapEntries(what: string): number {
    return this.expect(5, what, 'a map');
  }
}

/**
 * A registration response, reduced to the six things this application uses.
 *
 * `signCount` is here for the same reason `VerifiedAssertion` carries it: it is
 * recorded and not enforced, and `webauthn.ts`'s header says why.
 */
export interface AttestedCredential {
  rpIdHash: Uint8Array;
  userPresent: boolean;
  userVerified: boolean;
  signCount: number;
  /** The authenticator model's identifier. All zeroes when it declines to say. */
  aaguid: Uint8Array;
  credentialId: Uint8Array;
  /** 65-byte uncompressed SEC1, `0x04 ‖ x ‖ y` — what the contract stores. */
  publicKey: Uint8Array;
}

/**
 * `attestationObject` → the credential inside it.
 *
 * Exactly three keys, in any order, each once: `fmt`, `attStmt`, `authData`.
 * Order is not required because CTAP2's canonical ordering is a property of the
 * encoder rather than of the meaning, and pinning it would refuse a correct
 * response from a differently-ordered encoder for no gain. The key *set* is
 * required, because a fourth key means this is a structure the parser was not
 * written for and guessing which one is exactly what it must not do.
 */
export function parseAttestationObject(bytes: Uint8Array): AttestedCredential {
  const cbor = new NarrowCbor(bytes);

  const entries = cbor.mapEntries('the attestation object');
  if (entries !== 3) {
    throw new WebAuthnError(
      'attestation_shape',
      `The attestation object has ${entries} entries, expected exactly 3 (fmt, attStmt, authData).`,
    );
  }

  let format: string | undefined;
  let authData: Uint8Array | undefined;
  let statementSeen = false;

  for (let index = 0; index < entries; index += 1) {
    const key = cbor.textString('an attestation object key');
    if (key === 'fmt') {
      if (format !== undefined) throw duplicate('fmt');
      format = cbor.textString('fmt');
    } else if (key === 'attStmt') {
      if (statementSeen) throw duplicate('attStmt');
      statementSeen = true;
      // Read as a map and required to be empty, which is both the check and the
      // reason no attestation statement parser exists in this repository. See
      // the refusal below.
      const statement = cbor.mapEntries('attStmt');
      if (statement !== 0) {
        throw new WebAuthnError(
          'attestation_statement_present',
          `attStmt has ${statement} entries. This deployment requests attestation 'none', for which the statement is empty, and parsing an attestation statement — certificate chains, signatures over authData, per-format quirks — is a large amount of code that exists to answer a question this deployment does not ask.`,
        );
      }
    } else if (key === 'authData') {
      if (authData !== undefined) throw duplicate('authData');
      authData = cbor.byteString('authData');
    } else {
      throw new WebAuthnError(
        'attestation_unknown_key',
        `The attestation object has an unexpected key '${key}'. Only fmt, attStmt and authData are expected.`,
      );
    }
  }

  if (!cbor.atEnd) {
    // Bytes after a complete map. Whatever they are, this response is not the
    // one the parser finished reading, and quietly ignoring the tail is how a
    // parser and a validator end up disagreeing about what they were handed.
    throw new WebAuthnError('attestation_trailing_bytes', 'There are bytes after the end of the attestation object.');
  }

  if (format !== 'none') {
    throw new WebAuthnError(
      'attestation_format',
      `Attestation format is '${String(format)}', and only 'none' is accepted. passkey.ts requests attestation 'none'; a response in any other format did not come from the ceremony this application asks for.`,
    );
  }
  if (authData === undefined || !statementSeen) {
    throw new WebAuthnError('attestation_shape', 'The attestation object is missing one of fmt, attStmt and authData.');
  }

  return parseAttestedCredentialData(authData);
}

function duplicate(key: string): WebAuthnError {
  return new WebAuthnError('attestation_duplicate_key', `The attestation object repeats the key '${key}'.`);
}

/**
 * `authData`, in its registration form.
 *
 * Fixed layout, which is the reason this needs no parser at all up to the
 * credential key: 32 bytes of `rpIdHash`, one flags byte, four bytes of
 * counter, then — because the AT flag is set — 16 bytes of AAGUID, a two-byte
 * big-endian credential id length, the credential id, and the COSE key.
 *
 * `webauthn.ts` has `parseAuthenticatorData` for the assertion form, which stops
 * at byte 37. The two are deliberately not merged: the assertion path must not
 * grow a code path that reads attested credential data, because an assertion
 * that carried some would be an authenticator doing something the login path has
 * no business acting on.
 */
export function parseAttestedCredentialData(authData: Uint8Array): AttestedCredential {
  if (authData.length < AUTH_DATA_HEADER) {
    throw new WebAuthnError(
      'authenticator_data_short',
      `authData is ${authData.length} bytes, shorter than its fixed ${AUTH_DATA_HEADER}-byte header.`,
    );
  }

  const flags = authData[32] ?? 0;
  if ((flags & FLAG_ATTESTED_CREDENTIAL) === 0) {
    throw new WebAuthnError(
      'no_attested_credential',
      'authData does not have the AT flag set, so it carries no credential. An assertion response was posted to the registration path.',
    );
  }

  const view = new DataView(authData.buffer, authData.byteOffset, authData.byteLength);
  const signCount = view.getUint32(33, false);

  // 16 AAGUID + 2 length. Checked before either is read rather than after.
  if (authData.length < AUTH_DATA_HEADER + 18) {
    throw new WebAuthnError(
      'attested_credential_short',
      'authData claims attested credential data but is too short to hold an AAGUID and a credential id length.',
    );
  }

  const aaguid = authData.slice(AUTH_DATA_HEADER, AUTH_DATA_HEADER + 16);
  const credentialIdLength = view.getUint16(AUTH_DATA_HEADER + 16, false);
  if (credentialIdLength === 0 || credentialIdLength > MAX_CREDENTIAL_ID) {
    throw new WebAuthnError(
      'credential_id_length',
      `The credential id claims to be ${credentialIdLength} bytes; WebAuthn bounds it at 1 to ${MAX_CREDENTIAL_ID}.`,
    );
  }

  const credentialIdStart = AUTH_DATA_HEADER + 18;
  const credentialIdEnd = credentialIdStart + credentialIdLength;
  if (credentialIdEnd > authData.length) {
    throw new WebAuthnError(
      'credential_id_length',
      `The credential id claims ${credentialIdLength} bytes and authData has ${authData.length - credentialIdStart} left.`,
    );
  }

  const credentialId = authData.slice(credentialIdStart, credentialIdEnd);
  const keyBytes = authData.subarray(credentialIdEnd);
  const { publicKey, consumed } = readCredentialPublicKey(keyBytes);

  // Anything after the credential key is authenticator extension output, and
  // the ED flag is what says whether there is meant to be any.
  //
  // The asymmetry here is deliberate. With ED clear, a non-empty tail is a
  // response that disagrees with its own flags and is refused. With ED set, the
  // tail is left unread: the credential key precedes the extensions, so
  // *ignoring* them costs no parsing at all, while *validating* them would mean
  // a CBOR walker for arbitrary extension maps — more code, in the one place
  // this module exists to have less of it. This application requests no
  // authenticator extension, so the tail is never something it needs to see;
  // refusing it outright would break registration on an authenticator that
  // volunteers one, which some do.
  const tail = keyBytes.length - consumed;
  if ((flags & FLAG_EXTENSION_DATA) === 0 && tail !== 0) {
    throw new WebAuthnError(
      'authenticator_data_trailing_bytes',
      `authData has ${tail} bytes after the credential public key with the ED flag clear, so nothing claims them.`,
    );
  }

  return {
    rpIdHash: authData.slice(0, 32),
    userPresent: (flags & FLAG_USER_PRESENT) !== 0,
    userVerified: (flags & FLAG_USER_VERIFIED) !== 0,
    signCount,
    aaguid,
    credentialId,
    publicKey,
  };
}

/**
 * One COSE_Key, and the three constants that make it the only kind accepted.
 *
 * Exported for the tests and for `e2e/passkey-registration.spec.ts`, which
 * checks the shape a real authenticator emits against what this refuses.
 */
export function parseCredentialPublicKey(bytes: Uint8Array): Uint8Array {
  const { publicKey, consumed } = readCredentialPublicKey(bytes);
  if (consumed !== bytes.length) {
    throw new WebAuthnError(
      'cose_trailing_bytes',
      `There are ${bytes.length - consumed} bytes after the end of the COSE key.`,
    );
  }
  return publicKey;
}

/**
 * The map, read once, with each label required to appear exactly once.
 *
 * A COSE_Key for ES256 has exactly five entries. Requiring the count up front
 * means a map carrying a sixth — a key id, a set of key operations, anything an
 * encoder decided to add — is refused before its contents are read, rather than
 * being read and then ignored.
 */
function readCredentialPublicKey(bytes: Uint8Array): { publicKey: Uint8Array; consumed: number } {
  const cbor = new NarrowCbor(bytes);

  const entries = cbor.mapEntries('the credential public key');
  if (entries !== 5) {
    throw new WebAuthnError(
      'cose_shape',
      `The credential public key has ${entries} entries, expected exactly 5 (kty, alg, crv, x, y).`,
    );
  }

  let x: Uint8Array | undefined;
  let y: Uint8Array | undefined;
  const seen = new Set<number>();

  for (let index = 0; index < entries; index += 1) {
    const label = cbor.integer('a COSE key label');
    if (seen.has(label)) {
      throw new WebAuthnError('cose_duplicate_label', `The credential public key repeats label ${label}.`);
    }
    seen.add(label);

    switch (label) {
      case COSE_KTY: {
        const kty = cbor.unsigned('kty');
        // EC2 and nothing else. An OKP key (Ed25519) would decode happily as a
        // map of the same shape and produce 32 bytes that are not a P-256
        // point, so this is the check that stops a key of the wrong *kind*
        // rather than of the wrong size.
        if (kty !== KTY_EC2) {
          throw new WebAuthnError('cose_kty', `kty is ${kty}, and only ${KTY_EC2} (EC2) is accepted.`);
        }
        break;
      }
      case COSE_ALG: {
        const alg = cbor.integer('alg');
        // `passkey.ts` offers ES256 alone in `pubKeyCredParams`, because the
        // on-chain verifier is secp256r1 and a credential of any other algorithm
        // could log in and then be unable to own an account. Refusing here is
        // what keeps those two lists from drifting apart.
        if (alg !== ALG_ES256) {
          throw new WebAuthnError(
            'cose_alg',
            `alg is ${alg}, and only ${ALG_ES256} (ES256) is accepted. The on-chain verifier is secp256r1; a credential of another algorithm could log in and then be unable to own an account.`,
          );
        }
        break;
      }
      case COSE_CRV: {
        const crv = cbor.unsigned('crv');
        if (crv !== CRV_P256) {
          throw new WebAuthnError('cose_crv', `crv is ${crv}, and only ${CRV_P256} (P-256) is accepted.`);
        }
        break;
      }
      case COSE_X:
        x = coordinate(cbor.byteString('x'), 'x');
        break;
      case COSE_Y:
        y = coordinate(cbor.byteString('y'), 'y');
        break;
      default:
        throw new WebAuthnError(
          'cose_unknown_label',
          `The credential public key has an unexpected label ${label}. Only kty, alg, crv, x and y are expected.`,
        );
    }
  }

  if (x === undefined || y === undefined) {
    throw new WebAuthnError('cose_shape', 'The credential public key is missing x or y.');
  }

  // Uncompressed SEC1. Assembled here rather than by the caller so there is one
  // place that decides what "the public key" means for the rest of the app —
  // `users.passkey_public_key` says 65-byte uncompressed because this is where
  // that shape is made.
  const publicKey = new Uint8Array(1 + COORDINATE_BYTES * 2);
  publicKey[0] = 0x04;
  publicKey.set(x, 1);
  publicKey.set(y, 1 + COORDINATE_BYTES);

  return { publicKey, consumed: cbor.consumed };
}

function coordinate(value: Uint8Array, name: string): Uint8Array {
  // Fixed width, and not "at most 32". A short coordinate is a small number
  // written the short way, and left-padding it here would accept a key the
  // authenticator did not emit — the two would then hash and compare
  // differently everywhere else.
  if (value.length !== COORDINATE_BYTES) {
    throw new WebAuthnError(
      'cose_coordinate_length',
      `The ${name} coordinate is ${value.length} bytes; P-256 coordinates are exactly ${COORDINATE_BYTES}.`,
    );
  }
  return value;
}
