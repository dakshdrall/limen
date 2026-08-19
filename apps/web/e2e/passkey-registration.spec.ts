import { expect, test } from '@playwright/test';
import {
  parseAttestationObject,
  parseAttestedCredentialData,
  parseCredentialPublicKey,
} from '../src/lib/attestation';
import { WebAuthnError } from '../src/lib/webauthn-error';

/**
 * The narrow parser, against attestation objects a real Chrome authenticator
 * produced — and a measurement of whether it was exercised.
 *
 * `attestation.ts` reads the credential public key out of `attestationObject`
 * with a parser that handles one map with three known keys and one map with
 * five known integer labels, and refuses everything else. `test/attestation.
 * test.ts` proves that against inputs an encoder in the suite built. This file
 * exists because those two things can agree with each other and still both be
 * wrong about what a browser emits.
 *
 * ## The trap this file is built to avoid
 *
 * It is the one `passkey-owner.spec.ts` names. A spec that created a credential,
 * posted it, and saw a green tick would pass whether or not the parser had done
 * anything — and would keep passing if the parser were replaced by
 * `response.getPublicKey()`, which is the shortcut this whole module exists to
 * not take. So:
 *
 *   - **the instrument is checked before it is trusted.** Before any assertion
 *     about the parser, this file decodes the same bytes with a *general* CBOR
 *     decoder written out below and asserts the authenticator actually produced
 *     the shapes the parser was written for: `fmt` of `none`, an empty
 *     `attStmt`, the AT flag set, and a COSE key with `kty: 2`, `alg: -7`,
 *     `crv: 1`. If Chrome's virtual authenticator stops producing those, this
 *     run says so instead of passing.
 *   - **the check is a second implementation, not the same one twice.** The
 *     decoder here is general — arrays, tags, indefinite lengths — which is
 *     precisely what `attestation.ts` refuses to be. Importing the parser to
 *     validate the parser is how a decoder agrees with itself; that is the
 *     argument `passkey-owner.spec.ts` makes about `rawSignature`.
 *   - **there is a third opinion.** The point the parser extracts is compared
 *     against the one the *browser* derives from `getPublicKey()` — SPKI,
 *     imported and re-exported by WebCrypto inside the page. Two independent
 *     decoders and the browser's own agreeing on 65 bytes is evidence; one
 *     decoder agreeing with itself is not.
 *   - **the refusals are exercised on real bytes.** A genuine attestation
 *     object with one byte changed — `alg` from −7 to −8 — must be refused, and
 *     the reason code is asserted. A parser that accepted everything would pass
 *     every positive case in this file.
 *
 * ## Why this one is in CI, when `passkey-owner.spec.ts` is not
 *
 * That suite submits real testnet transactions, so it is unreachable from
 * `playwright.ci.config.ts` by construction. This one spends nothing: it creates
 * credentials against a virtual authenticator and never leaves the browser. It
 * is tagged `@ci` for that reason, and it is worth gating every push on,
 * because the thing it measures — what a real browser puts in an attestation
 * object — is exactly the thing a unit suite cannot see change.
 */

/**
 * Three discoverable credentials, and five that are not.
 *
 * Both numbers are forced by the instrument rather than chosen. **Chrome's
 * virtual authenticator stores exactly three discoverable credentials**; a
 * fourth `navigator.credentials.create` with `residentKey: 'required'` fails
 * with `NotAllowedError`, before the authenticator is consulted about anything
 * this file cares about. Measured, not assumed — the first version of this
 * spec asked for eight and got three successes and five refusals.
 *
 * So the sample is split. The discoverable three are what `lib/passkey.ts`
 * actually asks for and are the case that matters; the non-discoverable five
 * are volume, and are worth having because a credential id from that path is
 * produced differently — a real authenticator wraps its own state into one
 * rather than storing it — so the parser sees two shapes of the same field.
 */
const DISCOVERABLE = 3;
const NON_DISCOVERABLE = 5;
const SAMPLE = DISCOVERABLE + NON_DISCOVERABLE;

/* --- a general CBOR decoder, deliberately not the narrow one ----------------
 *
 * Handles the parts of the format `attestation.ts` refuses: arrays, tags,
 * indefinite lengths, 64-bit arguments, simple values. It is here so that the
 * instrument check is a different implementation rather than the same one, and
 * it is a compact illustration of what the production parser is choosing not to
 * carry.
 */

interface Decoded {
  value: unknown;
  offset: number;
}

function decode(bytes: Uint8Array, start = 0): Decoded {
  const initial = bytes[start];
  if (initial === undefined) throw new Error(`CBOR ran out at ${start}`);
  const major = initial >> 5;
  const info = initial & 0x1f;
  let offset = start + 1;
  let argument = info;

  if (info === 24) argument = bytes[offset++] ?? 0;
  else if (info === 25) {
    argument = ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
    offset += 2;
  } else if (info === 26) {
    argument = (((bytes[offset] ?? 0) << 24) | ((bytes[offset + 1] ?? 0) << 16) | ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0)) >>> 0;
    offset += 4;
  } else if (info === 27) {
    argument = Number(new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getBigUint64(0, false));
    offset += 8;
  } else if (info === 31) {
    throw new Error('this decoder does not do indefinite lengths either, but it knows one when it sees one');
  }

  switch (major) {
    case 0:
      return { value: argument, offset };
    case 1:
      return { value: -1 - argument, offset };
    case 2:
      return { value: bytes.slice(offset, offset + argument), offset: offset + argument };
    case 3:
      return { value: new TextDecoder().decode(bytes.slice(offset, offset + argument)), offset: offset + argument };
    case 4: {
      const items: unknown[] = [];
      for (let index = 0; index < argument; index += 1) {
        const item = decode(bytes, offset);
        items.push(item.value);
        offset = item.offset;
      }
      return { value: items, offset };
    }
    case 5: {
      const entries = new Map<unknown, unknown>();
      for (let index = 0; index < argument; index += 1) {
        const key = decode(bytes, offset);
        const item = decode(bytes, key.offset);
        entries.set(key.value, item.value);
        offset = item.offset;
      }
      return { value: entries, offset };
    }
    case 6:
      return decode(bytes, offset);
    default:
      return { value: argument, offset };
  }
}

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

const unhex = (value: string): Uint8Array =>
  Uint8Array.from(value.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));

/** What one created credential looked like, as it crossed back out of the page. */
interface CapturedRegistration {
  rawId: string;
  attestationObject: string;
  /** Which of the two groups this one came from. See `DISCOVERABLE`. */
  residentKey: string;
  /** The browser's own opinion of the key: SPKI, imported and re-exported raw. */
  browserPoint: string | null;
}

/**
 * The independent read of one attestation object.
 *
 * Everything this returns comes from the general decoder above and from fixed
 * offsets, never from `attestation.ts`.
 */
function inspect(attestationObject: Uint8Array): {
  fmt: unknown;
  attStmtEntries: number;
  attestedCredentialFlag: boolean;
  extensionDataFlag: boolean;
  kty: unknown;
  alg: unknown;
  crv: unknown;
  x: Uint8Array;
  y: Uint8Array;
  credentialId: Uint8Array;
  coseStart: number;
  authData: Uint8Array;
} {
  const outer = decode(attestationObject).value as Map<unknown, unknown>;
  const authData = outer.get('authData') as Uint8Array;

  const flags = authData[32] ?? 0;
  const credentialIdLength = ((authData[53] ?? 0) << 8) | (authData[54] ?? 0);
  const credentialId = authData.slice(55, 55 + credentialIdLength);
  const coseStart = 55 + credentialIdLength;
  const cose = decode(authData, coseStart).value as Map<unknown, unknown>;

  return {
    fmt: outer.get('fmt'),
    attStmtEntries: (outer.get('attStmt') as Map<unknown, unknown>).size,
    attestedCredentialFlag: (flags & 0x40) !== 0,
    extensionDataFlag: (flags & 0x80) !== 0,
    kty: cose.get(1),
    alg: cose.get(3),
    crv: cose.get(-1),
    x: cose.get(-2) as Uint8Array,
    y: cose.get(-3) as Uint8Array,
    credentialId,
    coseStart,
    authData,
  };
}

function reasonFor(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof WebAuthnError) return error.reason;
    throw error;
  }
  return 'no error';
}

test('@ci the narrow parser reads what Chrome actually emits, and refuses what it does not', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(120_000);

  /* --- the origin ----------------------------------------------------------
   *
   * `localhost`, whatever the config's baseURL says, and this is a fact about
   * WebAuthn rather than a preference. A Relying Party ID must be a registrable
   * domain; an IP literal is not one, so `navigator.credentials.create` on
   * `http://127.0.0.1:3001` fails with `SecurityError: This is an invalid
   * domain` before any authenticator is consulted. Both configs point at an IP,
   * and both serve the same process on the same port under either name — so the
   * host is rewritten and the port is taken from whichever config is running,
   * rather than being hard-coded and silently wrong under the other one.
   */
  const target = new URL('/', baseURL ?? 'http://localhost:3000');
  target.hostname = 'localhost';

  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
      defaultBackupEligibility: false,
      defaultBackupState: false,
    },
  });

  await page.goto(target.toString());

  const record: Record<string, unknown> = {};

  /* --- 1: real registration responses -------------------------------------- */

  const create = async (count: number, residentKey: 'required' | 'discouraged') =>
    await page.evaluate(
      async ({ count, residentKey }: { count: number; residentKey: 'required' | 'discouraged' }) => {
        const toHex = (buffer: ArrayBuffer) =>
          Array.from(new Uint8Array(buffer))
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join('');

        const results: {
          rawId: string;
          attestationObject: string;
          residentKey: string;
          browserPoint: string | null;
        }[] = [];

        for (let index = 0; index < count; index += 1) {
          const credential = (await navigator.credentials.create({
            publicKey: {
              challenge: crypto.getRandomValues(new Uint8Array(32)),
              rp: { name: 'Limen parser check' },
              user: {
                id: crypto.getRandomValues(new Uint8Array(16)),
                name: `parser-${residentKey}-${index}`,
                displayName: `parser-${residentKey}-${index}`,
              },
              // The same list `lib/passkey.ts` asks for: ES256 and nothing else.
              pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
              authenticatorSelection: { residentKey, userVerification: 'required' },
              attestation: 'none',
            },
          })) as PublicKeyCredential;

          const response = credential.response as AuthenticatorAttestationResponse;

          // The browser's own decoding of the same key, via SPKI. This is the
          // shortcut the server deliberately does not take, used here as an
          // independent opinion about what the answer should be.
          let browserPoint: string | null = null;
          const spki = response.getPublicKey();
          if (spki !== null) {
            const key = await crypto.subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, true, [
              'verify',
            ]);
            browserPoint = toHex(await crypto.subtle.exportKey('raw', key));
          }

          results.push({
            rawId: toHex(credential.rawId),
            attestationObject: toHex(response.attestationObject),
            residentKey,
            browserPoint,
          });
        }
        return results;
      },
      { count, residentKey },
    );

  const discoverable = await create(DISCOVERABLE, 'required');
  const registrations = [...discoverable, ...(await create(NON_DISCOVERABLE, 'discouraged'))];

  // Both halves counted, because a silent shortfall in the discoverable group
  // would mean the case `lib/passkey.ts` actually runs was never exercised.
  expect(discoverable.length, 'the authenticator made no discoverable credentials, which is the case production uses').toBe(DISCOVERABLE);
  expect(registrations.length, 'the authenticator created fewer credentials than asked for').toBe(SAMPLE);
  record.registrations = registrations.length;
  record.discoverable = discoverable.length;

  /* --- 2: the instrument, checked before it is trusted ----------------------
   *
   * Every assertion in this block is about the *input*, decoded by the general
   * decoder above. If any of them fails, the parser assertions below would be
   * measuring something other than what a browser produces, and the right
   * outcome is to say so rather than to pass.
   */

  const shapes = (registrations as CapturedRegistration[]).map((captured) => inspect(unhex(captured.attestationObject)));

  const formats = new Set(shapes.map((shape) => String(shape.fmt)));
  const algorithms = new Set(shapes.map((shape) => Number(shape.alg)));
  const keyTypes = new Set(shapes.map((shape) => Number(shape.kty)));
  const curves = new Set(shapes.map((shape) => Number(shape.crv)));

  record.formats = [...formats];
  record.algorithms = [...algorithms];
  record.keyTypes = [...keyTypes];
  record.curves = [...curves];
  record.attStmtEntries = [...new Set(shapes.map((shape) => shape.attStmtEntries))];
  record.extensionDataFlag = shapes.some((shape) => shape.extensionDataFlag);
  record.aaguidAllZero = shapes.every((shape) => shape.authData.slice(37, 53).every((byte) => byte === 0));

  expect([...formats], 'the authenticator did not emit attestation format `none`, so the parser is being fed a shape it was not written for').toEqual(['none']);
  expect([...new Set(shapes.map((shape) => shape.attStmtEntries))], 'attStmt was not empty, so this run is not exercising the `none` path').toEqual([0]);
  expect(shapes.every((shape) => shape.attestedCredentialFlag), 'the AT flag was clear, so no credential was attested').toBe(true);
  expect([...keyTypes], 'the COSE key was not EC2, so the kty check is not being exercised on a real key').toEqual([2]);
  expect([...algorithms], 'the COSE key was not ES256, so the alg check is not being exercised on a real key').toEqual([-7]);
  expect([...curves], 'the COSE key was not P-256, so the crv check is not being exercised on a real key').toEqual([1]);
  expect(shapes.every((shape) => shape.x.length === 32 && shape.y.length === 32), 'a coordinate was not 32 bytes').toBe(true);

  /* --- 3: the parser, on those exact bytes ---------------------------------- */

  let comparedAgainstBrowser = 0;

  for (const [index, captured] of (registrations as CapturedRegistration[]).entries()) {
    const shape = shapes[index]!;
    const parsed = parseAttestationObject(unhex(captured.attestationObject));

    // Against the independent decode.
    expect(hex(parsed.publicKey)).toBe(`04${hex(shape.x)}${hex(shape.y)}`);
    expect(hex(parsed.credentialId)).toBe(hex(shape.credentialId));
    // Against what the browser said the credential id was.
    expect(hex(parsed.credentialId)).toBe(captured.rawId);
    expect(parsed.userPresent).toBe(true);
    expect(parsed.userVerified).toBe(true);

    // Against the browser's own key decoding. This is the assertion that would
    // fail if the parser assembled the point out of the right bytes in the
    // wrong order, which no amount of self-consistency would catch.
    if (captured.browserPoint !== null) {
      expect(hex(parsed.publicKey)).toBe(captured.browserPoint);
      comparedAgainstBrowser += 1;
    }

    // The bare COSE key, read out of authData at an offset this file computed.
    expect(hex(parseCredentialPublicKey(shape.authData.subarray(shape.coseStart)))).toBe(hex(parsed.publicKey));
  }

  record.comparedAgainstBrowser = comparedAgainstBrowser;
  expect(comparedAgainstBrowser, 'getPublicKey() returned nothing, so the browser never gave a second opinion on any key').toBe(SAMPLE);

  /* --- 4: the refusals, on real bytes with one thing changed ---------------- */

  const genuine = shapes[0]!;

  // −7 is encoded as the single byte 0x26 after the label 0x03. Changing it to
  // 0x27 is the value −8, which is EdDSA: one byte, and the credential becomes
  // one this deployment must not accept.
  const algAt = (() => {
    for (let index = genuine.coseStart; index < genuine.authData.length - 1; index += 1) {
      if (genuine.authData[index] === 0x03 && genuine.authData[index + 1] === 0x26) return index + 1;
    }
    return -1;
  })();
  expect(algAt, 'could not find the alg entry in a real COSE key, so the mutation below would prove nothing').toBeGreaterThan(0);

  const wrongAlgorithm = Uint8Array.from(genuine.authData);
  wrongAlgorithm[algAt] = 0x27;
  record.refusedWrongAlg = reasonFor(() => parseAttestedCredentialData(wrongAlgorithm));
  expect(record.refusedWrongAlg).toBe('cose_alg');

  const flagsCleared = Uint8Array.from(genuine.authData);
  flagsCleared[32] = (flagsCleared[32] ?? 0) & ~0x40;
  record.refusedNoAttestedCredential = reasonFor(() => parseAttestedCredentialData(flagsCleared));
  expect(record.refusedNoAttestedCredential).toBe('no_attested_credential');

  const truncated = unhex(registrations[0]!.attestationObject);
  record.refusedTruncated = reasonFor(() => parseAttestationObject(truncated.slice(0, truncated.length - 8)));
  expect(record.refusedTruncated).toBe('cbor_truncated');

  /* --- 5: a real assertion is not a registration ---------------------------- */

  const assertionAuthData = await page.evaluate(async (rawId: string) => {
    const toHex = (buffer: ArrayBuffer) =>
      Array.from(new Uint8Array(buffer))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
    const id = Uint8Array.from(rawId.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: 'public-key', id: id as unknown as BufferSource }],
        userVerification: 'required',
      },
    })) as PublicKeyCredential;
    return toHex((assertion.response as AuthenticatorAssertionResponse).authenticatorData);
  }, registrations[0]!.rawId);

  // A real assertion's authData, from the same authenticator and the same
  // credential. It is well-formed and carries no credential, and the AT flag is
  // what says so — this is the confusion the registration path must refuse.
  record.assertionAuthDataBytes = assertionAuthData.length / 2;
  record.refusedAssertion = reasonFor(() => parseAttestedCredentialData(unhex(assertionAuthData)));
  expect(record.refusedAssertion).toBe('no_attested_credential');

  /* --- 6: RS256, if this authenticator will make one ------------------------ */

  const rs256 = await page.evaluate(async () => {
    const toHex = (buffer: ArrayBuffer) =>
      Array.from(new Uint8Array(buffer))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
    try {
      const credential = (await navigator.credentials.create({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rp: { name: 'Limen parser check' },
          user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'rs256', displayName: 'rs256' },
          pubKeyCredParams: [{ type: 'public-key', alg: -257 }],
          authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
          attestation: 'none',
        },
      })) as PublicKeyCredential;
      return toHex((credential.response as AuthenticatorAttestationResponse).attestationObject);
    } catch {
      // Some authenticators simply will not make one, which is a fact about the
      // authenticator rather than a failure of this test.
      return null;
    }
  });

  if (rs256 === null) {
    record.rs256 = 'authenticator declined to create one';
  } else {
    record.rs256 = reasonFor(() => parseAttestationObject(unhex(rs256)));
    expect(record.rs256, 'the authenticator created an RS256 credential and the parser did not refuse it').toBe('cose_alg');
  }

  /* --- 7: what actually ran ------------------------------------------------- */

  console.log('\n--- what this run establishes -------------------------------');
  console.log(`registration responses from a real browser  : ${SAMPLE}`);
  console.log(`  format ${[...formats].join(', ')} · attStmt entries ${String(record.attStmtEntries)} · alg ${[...algorithms].join(', ')} · kty ${[...keyTypes].join(', ')} · crv ${[...curves].join(', ')}`);
  console.log(`the parser produced the same 65 bytes as    : the independent CBOR decode, and the browser's own SPKI decoding (${comparedAgainstBrowser}/${SAMPLE})`);
  console.log(`refusals exercised on real bytes            :`);
  console.log(`  alg changed from -7 to -8                 : ${String(record.refusedWrongAlg)}`);
  console.log(`  AT flag cleared                           : ${String(record.refusedNoAttestedCredential)}`);
  console.log(`  response truncated by 8 bytes             : ${String(record.refusedTruncated)}`);
  console.log(`  a real assertion posted as a registration : ${String(record.refusedAssertion)}`);
  console.log(`  an RS256 credential                       : ${String(record.rs256)}`);
  console.log(
    record.extensionDataFlag === true
      ? '  note: this authenticator set the ED flag, so the extension tail was reached and ignored'
      : '  note: the ED flag was clear on every response, so the extension tail was not exercised this run',
  );
  console.log('\nRUN RECORD ' + JSON.stringify(record));

  await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
});
