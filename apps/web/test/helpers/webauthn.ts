/**
 * Real WebAuthn responses, built from a real key, for the suites that need a
 * whole ceremony rather than one field of one.
 *
 * `auth.test.ts` drives registration and login end to end and needs both halves
 * to be genuine — a real P-256 key, a real ECDSA signature, a real attestation
 * object — so that a case which changes one thing is changing one thing.
 *
 * **`attestation.test.ts` deliberately does not import this.** That suite tests
 * the parser, and its encoder is written out inline so that a bug shared
 * between an encoder and a decoder cannot hide by being in both. Here the
 * encoder is a fixture rather than the thing under test, and sharing it is
 * correct.
 */

import { createHash, webcrypto } from 'node:crypto';

/* --- CBOR, canonical, only the four types a registration response uses ----- */

function head(major: number, argument: number): number[] {
  if (argument < 24) return [(major << 5) | argument];
  if (argument <= 0xff) return [(major << 5) | 24, argument];
  if (argument <= 0xffff) return [(major << 5) | 25, (argument >> 8) & 0xff, argument & 0xff];
  return [(major << 5) | 26, (argument >>> 24) & 0xff, (argument >> 16) & 0xff, (argument >> 8) & 0xff, argument & 0xff];
}

const uint = (value: number): number[] => head(0, value);
/** `negative(7)` is -7: CBOR stores -1-n, so the argument is n-1. */
const negative = (value: number): number[] => head(1, value - 1);
const byteString = (value: Uint8Array): number[] => [...head(2, value.length), ...value];
const textString = (value: string): number[] => {
  const encoded = new TextEncoder().encode(value);
  return [...head(3, encoded.length), ...encoded];
};

export interface TestCredential {
  privateKey: webcrypto.CryptoKey;
  /** 65-byte uncompressed SEC1 — what `parseAttestationObject` should produce. */
  publicKey: Uint8Array;
  credentialId: Uint8Array;
  x: Uint8Array;
  y: Uint8Array;
}

export async function makeCredential(credentialId = new Uint8Array(20).fill(0xc3)): Promise<TestCredential> {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const raw = new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey));
  return {
    privateKey: pair.privateKey,
    publicKey: raw,
    credentialId,
    x: raw.slice(1, 33),
    y: raw.slice(33, 65),
  };
}

export function clientDataJSON(fields: { type: string; challenge: string; origin: string; crossOrigin?: boolean }): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(fields));
}

/** UP | UV | AT. `0x45` is what a registration with UV required produces. */
const REGISTRATION_FLAGS = 0x45;
/** UP | UV, with no attested credential data. */
const ASSERTION_FLAGS = 0x05;

function rpIdHash(rpId: string): Uint8Array {
  return new Uint8Array(createHash('sha256').update(rpId).digest());
}

export function registrationAuthData(
  credential: TestCredential,
  { rpId, flags = REGISTRATION_FLAGS, signCount = 0 }: { rpId: string; flags?: number; signCount?: number },
): Uint8Array {
  const cose = [
    ...head(5, 5),
    ...uint(1),
    ...uint(2),
    ...uint(3),
    ...negative(7),
    ...negative(1),
    ...uint(1),
    ...negative(2),
    ...byteString(credential.x),
    ...negative(3),
    ...byteString(credential.y),
  ];
  return Uint8Array.from([
    ...rpIdHash(rpId),
    flags,
    (signCount >>> 24) & 0xff,
    (signCount >> 16) & 0xff,
    (signCount >> 8) & 0xff,
    signCount & 0xff,
    ...new Uint8Array(16).fill(0xb2),
    (credential.credentialId.length >> 8) & 0xff,
    credential.credentialId.length & 0xff,
    ...credential.credentialId,
    ...cose,
  ]);
}

export function attestationObject(authData: Uint8Array, format = 'none'): Uint8Array {
  return Uint8Array.from([
    ...head(5, 3),
    ...textString('fmt'),
    ...textString(format),
    ...textString('attStmt'),
    ...head(5, 0),
    ...textString('authData'),
    ...byteString(authData),
  ]);
}

export function assertionAuthData({
  rpId,
  flags = ASSERTION_FLAGS,
  signCount = 1,
}: {
  rpId: string;
  flags?: number;
  signCount?: number;
}): Uint8Array {
  return Uint8Array.from([
    ...rpIdHash(rpId),
    flags,
    (signCount >>> 24) & 0xff,
    (signCount >> 16) & 0xff,
    (signCount >> 8) & 0xff,
    signCount & 0xff,
  ]);
}

/**
 * A real signature over `authenticatorData ‖ SHA-256(clientDataJSON)`, in the
 * ASN.1 DER a browser actually emits rather than the P-1363 WebCrypto returns.
 */
export async function sign(
  credential: TestCredential,
  authData: Uint8Array,
  client: Uint8Array,
): Promise<Uint8Array> {
  const signed = new Uint8Array(authData.length + 32);
  signed.set(authData, 0);
  signed.set(new Uint8Array(createHash('sha256').update(client).digest()), authData.length);
  const raw = new Uint8Array(
    await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, credential.privateKey, signed),
  );
  return rawToDer(raw);
}

function rawToDer(raw: Uint8Array): Uint8Array {
  const encode = (value: Uint8Array): number[] => {
    let start = 0;
    while (start < value.length - 1 && value[start] === 0) start += 1;
    const trimmed = Array.from(value.slice(start));
    if ((trimmed[0] ?? 0) & 0x80) trimmed.unshift(0);
    return [0x02, trimmed.length, ...trimmed];
  };
  const body = [...encode(raw.slice(0, 32)), ...encode(raw.slice(32))];
  return Uint8Array.from([0x30, body.length, ...body]);
}
