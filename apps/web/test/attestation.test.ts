/**
 * The parser, against inputs built by an encoder written separately from it.
 *
 * The shape here is the one `webauthn.test.ts` uses and for the same reason: a
 * baseline that is genuine in every respect, then one thing changed per case.
 * A suite of handmade nonsense would prove the parser rejects nonsense, which
 * is not the question — the question is whether it rejects a registration
 * response that is correct everywhere except the place being tested.
 *
 * The CBOR encoder below is written out here rather than imported, because
 * `attestation.ts` contains a decoder and the two must not be able to agree
 * with each other about a wrong encoding. It is the argument
 * `passkey-owner.spec.ts` makes about not importing `rawSignature` to classify
 * signatures, applied to a format instead of a signature.
 *
 * `e2e/passkey-registration.spec.ts` is the other half of this file: it runs
 * the same parser against attestation objects that a real Chrome authenticator
 * produced, which is what makes the encoder here a stand-in rather than the
 * only evidence.
 */

import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  parseAttestationObject,
  parseAttestedCredentialData,
  parseCredentialPublicKey,
  type AttestedCredential,
} from '../src/lib/attestation';
import { WebAuthnError } from '../src/lib/webauthn-error';

/* --- a CBOR encoder, deliberately not the decoder's -------------------------
 *
 * Canonical by default, because that is what a CTAP2 authenticator emits and
 * what the parser requires. `head` takes an explicit width so a case can emit
 * the long form on purpose.
 */

function head(major: number, argument: number, width?: 0 | 1 | 2 | 4): number[] {
  const chosen = width ?? (argument < 24 ? 0 : argument <= 0xff ? 1 : argument <= 0xffff ? 2 : 4);
  if (chosen === 0) return [(major << 5) | argument];
  if (chosen === 1) return [(major << 5) | 24, argument & 0xff];
  if (chosen === 2) return [(major << 5) | 25, (argument >> 8) & 0xff, argument & 0xff];
  return [(major << 5) | 26, (argument >>> 24) & 0xff, (argument >> 16) & 0xff, (argument >> 8) & 0xff, argument & 0xff];
}

const uint = (value: number, width?: 0 | 1 | 2 | 4): number[] => head(0, value, width);
/** `negative(7)` is the value -7: CBOR stores -1-n, so the argument is n-1. */
const negative = (value: number): number[] => head(1, value - 1);
const bytes = (value: Uint8Array): number[] => [...head(2, value.length), ...value];
const text = (value: string): number[] => {
  const encoded = new TextEncoder().encode(value);
  return [...head(3, encoded.length), ...encoded];
};
const map = (entries: number): number[] => head(5, entries);

const bin = (values: number[]): Uint8Array => Uint8Array.from(values);

/* --- the baseline ---------------------------------------------------------- */

const RP_ID_HASH = new Uint8Array(32).fill(0xa1);
const AAGUID = new Uint8Array(16).fill(0xb2);
const CREDENTIAL_ID = new Uint8Array(20).fill(0xc3);

/** UP | UV | AT — what a registration with `userVerification: 'required'` sets. */
const FLAGS = 0x45;

let x: Uint8Array;
let y: Uint8Array;

beforeAll(async () => {
  // A real P-256 point, so the bytes this suite feeds the parser are bytes a
  // key could actually have. It costs one keygen and means `x` and `y` are not
  // secretly special (all zeroes, say) in a way a coordinate check could pass
  // for the wrong reason.
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const raw = new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey));
  x = raw.slice(1, 33);
  y = raw.slice(33, 65);
});

interface CoseOverrides {
  kty?: number[];
  alg?: number[];
  crv?: number[];
  xValue?: Uint8Array;
  yValue?: Uint8Array;
  extra?: number[];
  entries?: number;
}

function coseKey(overrides: CoseOverrides = {}): number[] {
  const entries = overrides.entries ?? (overrides.extra === undefined ? 5 : 6);
  return [
    ...map(entries),
    ...uint(1),
    ...(overrides.kty ?? uint(2)),
    ...uint(3),
    ...(overrides.alg ?? negative(7)),
    ...negative(1),
    ...(overrides.crv ?? uint(1)),
    ...negative(2),
    ...bytes(overrides.xValue ?? x),
    ...negative(3),
    ...bytes(overrides.yValue ?? y),
    ...(overrides.extra ?? []),
  ];
}

interface AuthDataOverrides {
  flags?: number;
  signCount?: number;
  credentialId?: Uint8Array;
  /** What the two-byte length field claims, when that is the thing under test. */
  claimedLength?: number;
  cose?: number[];
  trailing?: number[];
}

function authData(overrides: AuthDataOverrides = {}): Uint8Array {
  const credentialId = overrides.credentialId ?? CREDENTIAL_ID;
  const length = overrides.claimedLength ?? credentialId.length;
  const count = overrides.signCount ?? 7;
  return bin([
    ...RP_ID_HASH,
    overrides.flags ?? FLAGS,
    (count >>> 24) & 0xff,
    (count >> 16) & 0xff,
    (count >> 8) & 0xff,
    count & 0xff,
    ...AAGUID,
    (length >> 8) & 0xff,
    length & 0xff,
    ...credentialId,
    ...(overrides.cose ?? coseKey()),
    ...(overrides.trailing ?? []),
  ]);
}

interface AttestationOverrides {
  fmt?: number[];
  attStmt?: number[];
  data?: Uint8Array;
  entries?: number;
  extra?: number[];
  trailing?: number[];
}

function attestationObject(overrides: AttestationOverrides = {}): Uint8Array {
  return bin([
    ...map(overrides.entries ?? (overrides.extra === undefined ? 3 : 4)),
    ...text('fmt'),
    ...(overrides.fmt ?? text('none')),
    ...text('attStmt'),
    ...(overrides.attStmt ?? map(0)),
    ...text('authData'),
    ...bytes(overrides.data ?? authData()),
    ...(overrides.extra ?? []),
    ...(overrides.trailing ?? []),
  ]);
}

/** The reason code, so a case cannot pass because something else went wrong. */
function reasonFor(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof WebAuthnError) return error.reason;
    throw error;
  }
  return 'no error';
}

/* --- the baseline case, which makes every rejection below mean something ---- */

describe('a genuine registration response', () => {
  let parsed: AttestedCredential;

  beforeAll(() => {
    parsed = parseAttestationObject(attestationObject());
  });

  it('yields the 65-byte uncompressed point the contract stores', () => {
    expect(parsed.publicKey.length).toBe(65);
    expect(parsed.publicKey[0]).toBe(0x04);
    expect([...parsed.publicKey.slice(1, 33)]).toEqual([...x]);
    expect([...parsed.publicKey.slice(33)]).toEqual([...y]);
  });

  it('yields the credential id and the AAGUID', () => {
    expect([...parsed.credentialId]).toEqual([...CREDENTIAL_ID]);
    expect([...parsed.aaguid]).toEqual([...AAGUID]);
  });

  it('reads the flags and the counter out of the fixed header', () => {
    expect(parsed.userPresent).toBe(true);
    expect(parsed.userVerified).toBe(true);
    expect(parsed.signCount).toBe(7);
    expect([...parsed.rpIdHash]).toEqual([...RP_ID_HASH]);
  });

  it('copies the credential id rather than aliasing the input', () => {
    // `subarray` would make these bytes a window onto the caller's buffer, so a
    // caller that reused or zeroed it would change a value already returned.
    const source = attestationObject();
    const first = parseAttestationObject(source);
    source.fill(0);
    expect([...first.credentialId]).toEqual([...CREDENTIAL_ID]);
  });
});

/* --- the three constants the whole design rests on ------------------------- */

describe('the algorithm, key type and curve are exact', () => {
  it('refuses RS256, which is the one a browser would otherwise happily create', () => {
    // The realistic case: `pubKeyCredParams` gains an RS256 entry as a
    // "fallback" and a credential appears that can log in and can never own an
    // account, because the on-chain verifier is secp256r1.
    expect(reasonFor(() => parseAttestationObject(attestationObject({ data: authData({ cose: coseKey({ alg: negative(257) }) }) })))).toBe('cose_alg');
  });

  it('refuses ES384 and ES512, which differ from ES256 by one integer', () => {
    for (const alg of [35, 36]) {
      expect(reasonFor(() => parseAttestationObject(attestationObject({ data: authData({ cose: coseKey({ alg: negative(alg) }) }) })))).toBe('cose_alg');
    }
  });

  it('refuses an OKP key, whose x is also 32 bytes', () => {
    // The case that makes `kty` worth checking separately from the coordinate
    // lengths: an Ed25519 key has a 32-byte x and would otherwise pass every
    // size check on the way to producing 65 bytes that are not a P-256 point.
    expect(reasonFor(() => parseAttestationObject(attestationObject({ data: authData({ cose: coseKey({ kty: uint(1) }) }) })))).toBe('cose_kty');
  });

  it('refuses P-384, which is EC2 and ES-something and still wrong', () => {
    expect(reasonFor(() => parseAttestationObject(attestationObject({ data: authData({ cose: coseKey({ crv: uint(2) }) }) })))).toBe('cose_crv');
  });
});

describe('the COSE map is exactly five known labels', () => {
  it('refuses a sixth entry, whatever it is', () => {
    expect(reasonFor(() => parseAttestationObject(attestationObject({ data: authData({ cose: coseKey({ extra: [...uint(2), ...bytes(new Uint8Array([1]))] }) }) })))).toBe('cose_shape');
  });

  it('refuses a map that claims five entries and uses one of them twice', () => {
    const repeated = [
      ...map(5),
      ...uint(1),
      ...uint(2),
      ...uint(1),
      ...uint(2),
      ...negative(1),
      ...uint(1),
      ...negative(2),
      ...bytes(x),
      ...negative(3),
      ...bytes(y),
    ];
    expect(reasonFor(() => parseAttestationObject(attestationObject({ data: authData({ cose: repeated }) })))).toBe('cose_duplicate_label');
  });

  it('refuses a four-entry map that is missing y', () => {
    const missing = [...map(4), ...uint(1), ...uint(2), ...uint(3), ...negative(7), ...negative(1), ...uint(1), ...negative(2), ...bytes(x)];
    expect(reasonFor(() => parseAttestationObject(attestationObject({ data: authData({ cose: missing }) })))).toBe('cose_shape');
  });

  it('refuses an unknown label in a five-entry map', () => {
    const unknown = [
      ...map(5),
      ...uint(1),
      ...uint(2),
      ...uint(3),
      ...negative(7),
      ...negative(1),
      ...uint(1),
      ...negative(2),
      ...bytes(x),
      ...uint(2),
      ...bytes(new Uint8Array([9])),
    ];
    expect(reasonFor(() => parseAttestationObject(attestationObject({ data: authData({ cose: unknown }) })))).toBe('cose_unknown_label');
  });
});

describe('coordinates are exactly 32 bytes', () => {
  it('refuses a short x rather than left-padding it', () => {
    // Padding would be the helpful thing to do and it would be wrong: the
    // padded key is not the key the authenticator emitted, and every later
    // comparison — the database, the signer install, the contract — would be
    // against a different value.
    expect(reasonFor(() => parseAttestationObject(attestationObject({ data: authData({ cose: coseKey({ xValue: x.slice(1) }) }) })))).toBe('cose_coordinate_length');
  });

  it('refuses a long y', () => {
    expect(reasonFor(() => parseAttestationObject(attestationObject({ data: authData({ cose: coseKey({ yValue: new Uint8Array(33) }) }) })))).toBe('cose_coordinate_length');
  });
});

/* --- the format's generality, refused ------------------------------------- */

describe('the CBOR subset', () => {
  it('refuses an indefinite-length map', () => {
    // 0xbf opens a map that ends at a break byte. A general decoder handles it;
    // nothing a CTAP2 authenticator emits uses it.
    expect(reasonFor(() => parseAttestationObject(bin([0xbf, ...text('fmt'), ...text('none'), 0xff])))).toBe('cbor_unsupported_head');
  });

  it('refuses a 64-bit length, which is the branch that needs BigInt', () => {
    expect(reasonFor(() => parseAttestationObject(bin([0x5b, 0, 0, 0, 0, 0, 0, 0, 1, 0])))).toBe('cbor_unsupported_head');
  });

  it('refuses a length written in more bytes than it needs', () => {
    // Canonical CBOR has one spelling per value. Two spellings of the same map
    // key is how a "each key appears once" check gets walked past.
    expect(reasonFor(() => parseAttestationObject(attestationObject({ data: authData({ cose: coseKey({ kty: uint(2, 1) }) }) })))).toBe('cbor_not_canonical');
  });

  it('refuses an array where a map is expected', () => {
    expect(reasonFor(() => parseAttestationObject(bin([0x83, 1, 2, 3])))).toBe('cbor_wrong_type');
  });

  it('refuses a tagged item', () => {
    expect(reasonFor(() => parseAttestationObject(bin([0xc0, ...map(3)])))).toBe('cbor_wrong_type');
  });

  it('refuses a truncated response rather than reading past the end', () => {
    const complete = attestationObject();
    expect(reasonFor(() => parseAttestationObject(complete.slice(0, complete.length - 4)))).toBe('cbor_truncated');
  });

  it('refuses a byte string whose length runs past the buffer', () => {
    // authData's length says 255 and three bytes follow it.
    expect(reasonFor(() => parseAttestationObject(bin([...map(3), ...text('authData'), 0x58, 0xff, 1, 2, 3])))).toBe('cbor_truncated');
  });
});

/* --- the attestation object's own shape ------------------------------------ */

describe('the attestation object', () => {
  it('refuses a format other than none, without trying to parse the statement', () => {
    // 'packed' is the format a real security key emits, and supporting it means
    // certificate chains and per-format signature rules. Refusing is the whole
    // reason this file is 400 lines rather than 4,000.
    expect(reasonFor(() => parseAttestationObject(attestationObject({ fmt: text('packed') })))).toBe('attestation_format');
  });

  it('refuses a non-empty attStmt even when the format says none', () => {
    const statement = [...map(1), ...text('alg'), ...negative(7)];
    expect(reasonFor(() => parseAttestationObject(attestationObject({ attStmt: statement })))).toBe('attestation_statement_present');
  });

  it('refuses a fourth key', () => {
    expect(reasonFor(() => parseAttestationObject(attestationObject({ extra: [...text('epAtt'), 0xf5] })))).toBe('attestation_shape');
  });

  it('names the unexpected key when the count is right and the keys are not', () => {
    const wrong = bin([...map(3), ...text('fmt'), ...text('none'), ...text('attStmt'), ...map(0), ...text('authdata'), ...bytes(authData())]);
    expect(reasonFor(() => parseAttestationObject(wrong))).toBe('attestation_unknown_key');
  });

  it('refuses a repeated key', () => {
    const repeated = bin([...map(3), ...text('fmt'), ...text('none'), ...text('fmt'), ...text('none'), ...text('authData'), ...bytes(authData())]);
    expect(reasonFor(() => parseAttestationObject(repeated))).toBe('attestation_duplicate_key');
  });

  it('refuses bytes after the end of the map', () => {
    expect(reasonFor(() => parseAttestationObject(attestationObject({ trailing: [0x00] })))).toBe('attestation_trailing_bytes');
  });
});

/* --- authData ------------------------------------------------------------- */

describe('authenticator data', () => {
  it('refuses an assertion posted to the registration path', () => {
    // An assertion's authData is 37 bytes with AT clear. It is a well-formed
    // structure that carries no credential, and the flag is what says so.
    const assertion = bin([...RP_ID_HASH, 0x05, 0, 0, 0, 1]);
    expect(reasonFor(() => parseAttestedCredentialData(assertion))).toBe('no_attested_credential');
  });

  it('refuses anything shorter than the fixed header', () => {
    expect(reasonFor(() => parseAttestedCredentialData(new Uint8Array(36)))).toBe('authenticator_data_short');
  });

  it('refuses a header that claims a credential and stops before the AAGUID', () => {
    expect(reasonFor(() => parseAttestedCredentialData(bin([...RP_ID_HASH, FLAGS, 0, 0, 0, 1, 1, 2, 3])))).toBe('attested_credential_short');
  });

  it('refuses a zero-length credential id', () => {
    expect(reasonFor(() => parseAttestationObject(attestationObject({ data: authData({ credentialId: new Uint8Array(0) }) })))).toBe('credential_id_length');
  });

  it('refuses a credential id longer than WebAuthn allows', () => {
    expect(reasonFor(() => parseAttestationObject(attestationObject({ data: authData({ credentialId: new Uint8Array(1024).fill(1) }) })))).toBe('credential_id_length');
  });

  it('refuses a length field that overruns the buffer', () => {
    // The claimed length is 900 and the actual id is 20 bytes, so the key would
    // be read from somewhere past the end. This is the check that stops a
    // length field from choosing where the parser reads.
    expect(reasonFor(() => parseAttestationObject(attestationObject({ data: authData({ claimedLength: 900 }) })))).toBe('credential_id_length');
  });

  it('refuses bytes after the credential key when the ED flag is clear', () => {
    expect(reasonFor(() => parseAttestationObject(attestationObject({ data: authData({ trailing: [0, 0] }) })))).toBe('authenticator_data_trailing_bytes');
  });

  it('ignores extension output when the ED flag is set', () => {
    // Deliberately permitted: the credential key precedes the extensions, so
    // ignoring them costs no parsing, and an authenticator that volunteers one
    // should not be a registration that fails. See the comment in
    // `parseAttestedCredentialData`.
    const withExtensions = attestationObject({
      data: authData({ flags: FLAGS | 0x80, trailing: [...map(1), ...text('credProtect'), ...uint(2)] }),
    });
    expect(parseAttestationObject(withExtensions).publicKey.length).toBe(65);
  });
});

describe('parseCredentialPublicKey on its own', () => {
  it('reads a bare COSE key', () => {
    expect(parseCredentialPublicKey(bin(coseKey())).length).toBe(65);
  });

  it('refuses trailing bytes, because a bare key has nothing after it', () => {
    expect(reasonFor(() => parseCredentialPublicKey(bin([...coseKey(), 0x00])))).toBe('cose_trailing_bytes');
  });
});
