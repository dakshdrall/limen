/**
 * The origin and challenge checks the chain does not do.
 *
 * Every case here builds a **real** assertion — a real P-256 key, a real
 * ECDSA signature over `authenticatorData ‖ SHA-256(clientDataJSON)` — and then
 * changes exactly one thing. That shape matters: a suite that fed the verifier
 * handmade bytes would prove it rejects nonsense, which is not the question.
 * The question is whether it rejects an assertion that is genuine in every
 * respect except the one being tested, because that is what an attacker has.
 *
 * The baseline case is what makes the rest non-vacuous. If `verifies a genuine
 * assertion` ever fails, every rejection below could be passing for the wrong
 * reason.
 */

import { createHash, webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  base64UrlToBytes,
  bytesToBase64Url,
  derToRawSignature,
  parseAuthenticatorData,
  verifyAssertion,
  WebAuthnError,
  type Expectation,
} from '../src/lib/webauthn';

const RP_ID = 'limen.app';
const ORIGIN = 'https://limen.app';
const CHALLENGE = bytesToBase64Url(new Uint8Array(32).fill(7));

let publicKey: Uint8Array;
let privateKey: webcrypto.CryptoKey;

beforeAll(async () => {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  privateKey = pair.privateKey;
  // Raw export is the 65-byte uncompressed SEC1 point — the same form the
  // contract stores, which is the point of `passkeyPublicKey` being bytea.
  publicKey = new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey));
});

function clientData(overrides: Record<string, unknown> = {}): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({ type: 'webauthn.get', challenge: CHALLENGE, origin: ORIGIN, ...overrides }),
  );
}

/** 32 bytes rpIdHash, one flags byte, four bytes counter. UP|UV by default. */
function authenticatorData({ rpId = RP_ID, flags = 0x05, signCount = 0 } = {}): Uint8Array {
  const bytes = new Uint8Array(37);
  bytes.set(new Uint8Array(createHash('sha256').update(rpId).digest()), 0);
  bytes[32] = flags;
  new DataView(bytes.buffer).setUint32(33, signCount, false);
  return bytes;
}

/** Signs for real, then re-encodes P-1363 as the DER a browser actually emits. */
async function sign(auth: Uint8Array, client: Uint8Array): Promise<Uint8Array> {
  const signed = new Uint8Array(auth.length + 32);
  signed.set(auth, 0);
  signed.set(new Uint8Array(createHash('sha256').update(client).digest()), auth.length);
  const raw = new Uint8Array(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, signed));
  return rawToDer(raw);
}

function rawToDer(raw: Uint8Array): Uint8Array {
  const encode = (value: Uint8Array): number[] => {
    let start = 0;
    while (start < value.length - 1 && value[start] === 0) start += 1;
    const trimmed = Array.from(value.slice(start));
    // DER's sign byte: a leading high bit would otherwise read as negative.
    if ((trimmed[0] ?? 0) & 0x80) trimmed.unshift(0);
    return [0x02, trimmed.length, ...trimmed];
  };
  const body = [...encode(raw.slice(0, 32)), ...encode(raw.slice(32))];
  return new Uint8Array([0x30, body.length, ...body]);
}

const expectation = (overrides: Partial<Expectation> = {}): Expectation => ({
  origins: [ORIGIN],
  rpId: RP_ID,
  challenge: CHALLENGE,
  type: 'webauthn.get',
  ...overrides,
});

async function build(
  { client = clientData(), auth = authenticatorData() } = {},
): Promise<{ clientDataJSON: Uint8Array; authenticatorData: Uint8Array; signature: Uint8Array; publicKey: Uint8Array }> {
  return {
    clientDataJSON: client,
    authenticatorData: auth,
    signature: await sign(auth, client),
    publicKey,
  };
}

/** The reason code, so a case cannot pass because something else went wrong. */
async function reasonFor(input: Awaited<ReturnType<typeof build>>, expected = expectation()): Promise<string> {
  try {
    await verifyAssertion(input, expected);
  } catch (error) {
    if (error instanceof WebAuthnError) return error.reason;
    throw error;
  }
  return 'no error';
}

describe('a genuine assertion', () => {
  it('verifies', async () => {
    // The case that makes every rejection below meaningful.
    const result = await verifyAssertion(await build(), expectation());
    expect(result.userPresent).toBe(true);
    expect(result.userVerified).toBe(true);
  });

  it('reports the signature counter without enforcing it', async () => {
    // Synced platform passkeys return zero forever. Enforcing monotonicity
    // would lock out the authenticators most people have, to detect cloning of
    // the ones that cannot be cloned.
    const result = await verifyAssertion(await build({ auth: authenticatorData({ signCount: 41 }) }), expectation());
    expect(result.signCount).toBe(41);
  });
});

describe('the origin check — the one the contract does not do', () => {
  it('refuses an assertion from another origin', async () => {
    // The whole reason this module exists. §1.10: the on-chain verifier does
    // not validate origin, so an assertion collected by any site the user
    // visits would otherwise replay here as a login.
    const client = clientData({ origin: 'https://evil.example' });
    expect(await reasonFor(await build({ client }))).toBe('origin_mismatch');
  });

  it('refuses a lookalike that merely starts with the real origin', async () => {
    // Exact match, never `startsWith`. This is the case that punishes the
    // obvious implementation.
    const client = clientData({ origin: 'https://limen.app.evil.example' });
    expect(await reasonFor(await build({ client }))).toBe('origin_mismatch');
  });

  it('accepts any origin on the expected list, so previews can log in', async () => {
    const preview = 'https://limen-git-m1.vercel.app';
    const client = clientData({ origin: preview });
    const result = await verifyAssertion(
      await build({ client }),
      expectation({ origins: [ORIGIN, preview] }),
    );
    expect(result.userVerified).toBe(true);
  });

  it('refuses an assertion produced cross-origin', async () => {
    // Genuine credential, valid signature, and no evidence the user meant to
    // log in here.
    const client = clientData({ crossOrigin: true });
    expect(await reasonFor(await build({ client }))).toBe('cross_origin');
  });
});

describe('the challenge check', () => {
  it('refuses an assertion answering a different challenge', async () => {
    const client = clientData({ challenge: bytesToBase64Url(new Uint8Array(32).fill(9)) });
    expect(await reasonFor(await build({ client }))).toBe('challenge_mismatch');
  });

  it('refuses a registration response replayed as a login', async () => {
    // Ceremony confusion. The field exists to make the two non-interchangeable,
    // and it only helps if somebody checks it.
    const client = clientData({ type: 'webauthn.create' });
    expect(await reasonFor(await build({ client }))).toBe('type_mismatch');
  });
});

describe('the authenticator’s own claims', () => {
  it('refuses a credential bound to a different relying party', async () => {
    // Origin is what the *browser* says. This is what the authenticator signed,
    // so checking only origin trusts the half an attacker controls.
    const auth = authenticatorData({ rpId: 'evil.example' });
    expect(await reasonFor(await build({ auth }))).toBe('rp_id_mismatch');
  });

  it('refuses an assertion without user presence', async () => {
    expect(await reasonFor(await build({ auth: authenticatorData({ flags: 0x04 }) }))).toBe('user_not_present');
  });

  it('refuses an assertion without user verification', async () => {
    // The on-chain verifier refuses these too, so accepting one here would mean
    // a credential that can log in but cannot own an account.
    expect(await reasonFor(await build({ auth: authenticatorData({ flags: 0x01 }) }))).toBe('user_not_verified');
  });

  it('refuses authenticatorData shorter than its fixed header', async () => {
    const input = await build();
    input.authenticatorData = new Uint8Array(20);
    expect(await reasonFor(input)).toBe('authenticator_data_short');
  });
});

describe('the signature', () => {
  it('refuses an assertion signed by a different key', async () => {
    // Everything else is a claim in a document until this check.
    const other = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const input = await build();
    input.publicKey = new Uint8Array(await webcrypto.subtle.exportKey('raw', other.publicKey));
    expect(await reasonFor(input)).toBe('bad_signature');
  });

  it('refuses when authenticatorData was edited after signing', async () => {
    // Proves the flags and counter are inside the signature rather than beside
    // it — otherwise UP/UV could simply be turned on by the caller.
    const input = await build({ auth: authenticatorData({ flags: 0x01 }) });
    input.authenticatorData = authenticatorData({ flags: 0x05 });
    expect(await reasonFor(input)).toBe('bad_signature');
  });

  it('refuses when clientDataJSON was edited after signing', async () => {
    const input = await build();
    input.clientDataJSON = clientData({ origin: ORIGIN, extra: 'appended' });
    expect(await reasonFor(input)).toBe('bad_signature');
  });
});

describe('DER decoding, which fixed offsets get wrong', () => {
  it('handles a component with a leading sign byte', async () => {
    // The predictable minority: a high bit in the first byte means DER prepends
    // a zero, and a fixed-offset slice silently reads the wrong 32 bytes.
    const raw = new Uint8Array(64);
    raw.fill(0x80, 0, 32);
    raw.fill(0x01, 32);
    const der = rawToDer(raw);
    expect(der.length).toBeGreaterThan(70);
    expect(derToRawSignature(der)).toEqual(raw);
  });

  it('handles a short component by left-padding it', async () => {
    const raw = new Uint8Array(64);
    raw[31] = 0x05;
    raw[63] = 0x07;
    expect(derToRawSignature(rawToDer(raw))).toEqual(raw);
  });

  it('refuses something that is not a DER sequence', () => {
    expect(() => derToRawSignature(new Uint8Array([0x02, 0x01, 0x00]))).toThrow(WebAuthnError);
  });
});

describe('base64url round-trips', () => {
  it('survives bytes that need padding', () => {
    for (const length of [1, 2, 3, 31, 32, 65]) {
      const bytes = new Uint8Array(length).map((_, i) => (i * 37) % 256);
      expect(base64UrlToBytes(bytesToBase64Url(bytes))).toEqual(bytes);
    }
  });

  it('emits no characters that need URL escaping', () => {
    const bytes = new Uint8Array(64).map((_, i) => i * 4);
    const encoded = bytesToBase64Url(bytes);
    expect(encoded).not.toMatch(/[+/=]/);
  });
});

describe('parseAuthenticatorData', () => {
  it('reads flags and counter from their fixed offsets', () => {
    const parsed = parseAuthenticatorData(authenticatorData({ flags: 0x05, signCount: 70000 }));
    expect(parsed.userPresent).toBe(true);
    expect(parsed.userVerified).toBe(true);
    // Big-endian, and above 2^16 so a byte-order mistake shows.
    expect(parsed.signCount).toBe(70000);
  });
});
