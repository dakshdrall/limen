import { expect, test, type Page } from '@playwright/test';

/**
 * A real WebAuthn assertion, from a real browser, accepted by the deployed
 * verifier — and a measurement of whether the code written for it actually ran.
 *
 * PLAN-V7 §5.2.2 recorded a `browserGap`, and this file exists to close it or to
 * narrow it honestly. The §5.1 script proved the *contract* side with a
 * synthetic authenticator: a WebCrypto P-256 key emitting IEEE-P1363 `r‖s`,
 * normalised to low-S before it was ever sent. A browser assertion is not that.
 * It arrives as **ASN.1 DER**, and its `s` is whatever the authenticator chose.
 *
 * So `lib/passkey.ts` grew two pieces of code that the script never exercised:
 * `rawSignature` unpacks DER into `r‖s`, and normalises `s` to the low form the
 * Soroban host demands. Both were written for a difference nobody had observed.
 *
 * ## The trap this file is built to avoid
 *
 * A virtual authenticator that happened to emit P1363, or that always chose a
 * low `s`, would let this spec pass green **without touching either piece of
 * code it was written for** — the hollow gate again, in a new place. A green run
 * would then mean less than it looked like, which is the failure mode this
 * repository keeps naming.
 *
 * So the assertions are recorded and classified rather than assumed:
 *
 *   - every assertion the page made is captured by wrapping
 *     `navigator.credentials.get` in an init script. That is test-side
 *     instrumentation; no production code knows this file exists.
 *   - each captured signature is classified DER-or-not and high-S-or-not by
 *     arithmetic written out again here rather than by importing
 *     `rawSignature`. Reusing the function under test to check the function
 *     under test is how a decoder agrees with itself.
 *   - the run **reports which of the two paths it exercised**, and the report is
 *     the deliverable. If no high-S assertion occurred, this spec says the
 *     normalisation was not exercised rather than implying it was.
 *
 * A free characterisation sample runs first — assertions made directly against
 * the authenticator, costing nothing and submitting nothing — so that "no
 * high-S in this run" can be told apart from "this authenticator never emits
 * high-S". Those two mean very different things for how much is still unproven.
 *
 * ## Why it is out of CI
 *
 * Same reason as `account-lifecycle.spec.ts`: it submits real testnet
 * transactions. `playwright.ci.config.ts` selects on `@ci`, which is for suites
 * that spend nothing, so this file is unreachable from that config by
 * construction rather than by being remembered. It runs on demand:
 *
 *     npm run e2e -w @limen/web -- passkey-owner
 */

/**
 * `localhost`, not `127.0.0.1`, and this is a fact about WebAuthn rather than a
 * preference about URLs.
 *
 * A Relying Party ID must be a registrable domain. An IP literal is not one, so
 * `navigator.credentials.create` on `http://127.0.0.1:3000` fails with
 * `SecurityError: This is an invalid domain` before any authenticator is
 * consulted — which is what happened on the first run of this file. The rest of
 * the on-demand suite uses the IP and is unaffected, because nothing else in it
 * touches WebAuthn.
 *
 * Worth knowing beyond this spec: the passkey owner path cannot work anywhere
 * the application is reached by IP address. `localhost` and a real domain are
 * the two origins where it functions at all.
 */
test.use({ baseURL: 'http://localhost:3000' });

/** Four submissions, each waiting on a ledger close, plus two prompts. */
const RUN_TIMEOUT = 900_000;
const SUBMIT_TIMEOUT = 240_000;

const TX_HASH = /^[0-9a-f]{64}$/;

/** The order of the P-256 curve. `s` above half of it is the high form. */
const P256_ORDER = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const HALF_ORDER = P256_ORDER / 2n;

/** How many free assertions to sample before spending anything. */
const CHARACTERISATION_SAMPLE = 16;

interface CapturedAssertion {
  signature: string;
  clientData: string;
}

interface Classified {
  der: boolean;
  /** Null when the signature is not DER and `s` therefore cannot be located. */
  highS: boolean | null;
  length: number;
}

/**
 * Classify one signature, written out here on purpose.
 *
 * `lib/passkey.ts` has a function that does this. Importing it would make this
 * spec agree with the code it is checking about what DER is — the same argument
 * `verify-browser-run.mjs` makes about not reusing `contractErrorCodes`.
 */
function classify(hex: string): Classified {
  const bytes = Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
  if (bytes[0] !== 0x30) return { der: false, highS: null, length: bytes.length };

  let offset = 2;
  if ((bytes[1] ?? 0) > 0x80) offset = 3;

  const readInteger = (): bigint | null => {
    if (bytes[offset] !== 0x02) return null;
    const length = bytes[offset + 1] ?? 0;
    let value = 0n;
    for (const byte of bytes.slice(offset + 2, offset + 2 + length)) value = (value << 8n) | BigInt(byte);
    offset += 2 + length;
    return value;
  };

  if (readInteger() === null) return { der: false, highS: null, length: bytes.length };
  const s = readInteger();
  if (s === null) return { der: false, highS: null, length: bytes.length };

  return { der: true, highS: s > HALF_ORDER, length: bytes.length };
}

/** Read everything the page's `navigator.credentials.get` produced. */
async function captured(page: Page): Promise<CapturedAssertion[]> {
  return page.evaluate(
    () => (window as unknown as { __limenAssertions: CapturedAssertion[] }).__limenAssertions ?? [],
  );
}

/**
 * Wait for a `WriteResult` to stop running and require it to have landed.
 *
 * The same three states `account-lifecycle.spec.ts` reads, and read the same
 * way — off the rendered eyebrow, because that is what a person sees and the
 * claim under test is what the screen tells them.
 */
async function landed(page: Page, what: string): Promise<string> {
  // `what` is the `WriteResult`'s own sentence, not a caption. The two live in
  // different panels and only the `WriteResult` carries the hash — matching the
  // caption is how the first version of this file looked for a link in a box
  // that never has one.
  const scope = page.locator('div.panel').filter({ hasText: what }).last();

  await expect
    .poll(async () => ((await scope.count()) === 0 ? '' : await scope.innerText()), {
      timeout: SUBMIT_TIMEOUT,
      message: `"${what}" never settled`,
    })
    .toContain('on ledger');

  const text = await scope.innerText();
  expect(text.includes('on ledger — failed there'), `"${what}" reached a ledger and failed there`).toBe(
    false,
  );

  const link = scope.locator('a[href*="/explorer/testnet/tx/"]').last();
  await expect(link, `"${what}" landed without a hash to link`).toBeVisible();
  const hash = ((await link.getAttribute('title')) ?? '').trim();
  expect(hash, `"${what}" produced a malformed hash`).toMatch(TX_HASH);
  return hash;
}

test('a real passkey assertion owns an account and signs for it on testnet', async ({ page, context }) => {
  test.setTimeout(RUN_TIMEOUT);

  page.on('console', (message) => {
    if (message.type() === 'error') console.log(`  [browser console] ${message.text()}`);
  });

  /* --- the authenticator ---------------------------------------------------
   *
   * `hasUserVerification` and `isUserVerified` are not conveniences. The
   * deployed verifier requires the User Verified bit in `authenticatorData`
   * (PLAN-V7 §5.2.1), so an authenticator without them produces assertions this
   * contract refuses — and the refusal would look like an encoding bug.
   *
   * `defaultBackupEligibility` and `defaultBackupState` are both false because
   * the contract rejects BE=0 with BS=1 and accepts the pair being clear.
   */
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

  // Test-side only. The page is not modified and does not know this exists.
  await page.addInitScript(() => {
    const store: CapturedAssertion[] = [];
    (window as unknown as { __limenAssertions: CapturedAssertion[] }).__limenAssertions = store;

    const hex = (buffer: ArrayBuffer) =>
      Array.from(new Uint8Array(buffer))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');

    const original = navigator.credentials.get.bind(navigator.credentials);
    navigator.credentials.get = async (options?: CredentialRequestOptions) => {
      const credential = await original(options);
      try {
        const response = (credential as PublicKeyCredential | null)
          ?.response as AuthenticatorAssertionResponse | undefined;
        if (response?.signature !== undefined) {
          store.push({
            signature: hex(response.signature),
            clientData: new TextDecoder().decode(response.clientDataJSON),
          });
        }
      } catch {
        /* a recording that fails must never change what the page does */
      }
      return credential;
    };
  });

  const record: Record<string, unknown> = {};

  /* --- 1: characterise the authenticator, for free -------------------------
   *
   * Before anything is spent. This answers "can this authenticator produce a
   * high-S signature at all?", which is what makes a later "no high-S in this
   * run" interpretable rather than ambiguous.
   */
  await page.goto('/app/try');
  await expect(page.getByRole('heading', { level: 1, name: /Try it end to end/i })).toBeVisible();

  const sample = await page.evaluate(async (count: number) => {
    const hex = (buffer: ArrayBuffer) =>
      Array.from(new Uint8Array(buffer))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');

    const created = (await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: 'Limen characterisation' },
        user: {
          id: crypto.getRandomValues(new Uint8Array(16)),
          name: 'characterisation',
          displayName: 'characterisation',
        },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        attestation: 'none',
      },
    })) as PublicKeyCredential;

    const signatures: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const assertion = (await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          allowCredentials: [{ type: 'public-key', id: created.rawId }],
          userVerification: 'required',
        },
      })) as PublicKeyCredential;
      signatures.push(hex((assertion.response as AuthenticatorAssertionResponse).signature));
    }
    return signatures;
  }, CHARACTERISATION_SAMPLE);

  const sampleClasses = sample.map(classify);
  const sampleDer = sampleClasses.filter((c) => c.der).length;
  const sampleHigh = sampleClasses.filter((c) => c.highS === true).length;

  record.sampleSize = sample.length;
  record.sampleDer = sampleDer;
  record.sampleHighS = sampleHigh;

  console.log(
    `\ncharacterisation: ${sample.length} assertions — ${sampleDer} DER, ${sampleHigh} high-S\n`,
  );

  // The instrument itself, checked before it is trusted. If this authenticator
  // does not emit DER, this whole spec is measuring something other than what a
  // browser produces, and the right response is to say so rather than to pass.
  expect(
    sampleDer,
    'the virtual authenticator did not emit DER signatures, so it is not a stand-in for a real one',
  ).toBe(sample.length);

  // Clear what the characterisation left behind, so the flow below starts from
  // a browser that holds no passkey and no keys.
  await page.evaluate(() => {
    (window as unknown as { __limenAssertions: CapturedAssertion[] }).__limenAssertions.length = 0;
    localStorage.clear();
  });

  /* --- 2: the real flow, through the real screens -------------------------- */

  await page.reload();
  await expect(page.getByText('what owns the account')).toBeVisible({ timeout: 60_000 });

  await page.getByRole('button', { name: 'A passkey' }).click();
  await expect(page.getByText('TESTNET ONLY · PASSKEY').first()).toBeVisible();

  // Both halves of §5.4's caveat, on the screen where the account is created.
  await expect(page.getByText(/Clearing site data no longer strands your account/)).toBeVisible();
  await expect(page.getByText(/still destroys the agent key/)).toBeVisible();

  await page.getByRole('button', { name: 'Create a passkey' }).click();
  await expect(page.getByText('owner signer')).toBeVisible({ timeout: 60_000 });

  // Nothing has been asked of the authenticator for a signature yet: creating a
  // credential is not an assertion, and the account does not exist.
  expect((await captured(page)).length, 'a signature was requested before there was anything to sign').toBe(0);

  await page.getByRole('button', { name: /Set everything up/ }).click();
  record.deployTx = await landed(page, 'Creating the smart account');
  record.seedTx = await landed(page, 'Funding the smart account');

  // The deploy is envelope-signed only — the account authorizes nothing at
  // creation — so still no assertion. This is the check that the next one means
  // something.
  expect(
    (await captured(page)).length,
    'the deploy asked the passkey to sign, which it should not need to',
  ).toBe(0);

  /* --- 3: the first thing the passkey actually signs ----------------------- */

  await page.getByRole('button', { name: 'Make the transaction' }).click();
  record.observedTx = await landed(page, 'authorized by its owner under the Default rule');

  const afterObserve = await captured(page);
  expect(afterObserve.length, 'the observed transfer did not go through the passkey').toBeGreaterThan(0);

  // The challenge is the account's `auth_digest`, base64url — the equality the
  // contract checks. Read off the assertion the page actually made.
  const clientData = JSON.parse(afterObserve[0]!.clientData) as { type: string; challenge: string };
  expect(clientData.type).toBe('webauthn.get');
  expect(clientData.challenge, 'the challenge was not a 43-character base64url digest').toMatch(
    /^[A-Za-z0-9_-]{43}$/,
  );

  /* --- 4: a second owner signature, for a second chance at high-S ---------- */

  await expect(page.getByRole('button', { name: 'Install this boundary' })).toBeVisible({
    timeout: SUBMIT_TIMEOUT,
  });
  await page.getByRole('button', { name: 'Install this boundary' }).click();
  record.installTx = await landed(page, 'Installing the boundary');

  /* --- 5: what actually ran ------------------------------------------------ */

  const assertions = await captured(page);
  const classes = assertions.map((assertion) => classify(assertion.signature));
  const der = classes.filter((c) => c.der).length;
  const high = classes.filter((c) => c.highS === true).length;

  record.assertions = assertions.length;
  record.assertionsDer = der;
  record.assertionsHighS = high;

  // Every assertion the app sent was DER, and every one of them was accepted on
  // a ledger. That is the DER unpacking exercised: a signature passed through
  // unconverted would have failed `secp256r1_verify`.
  expect(der, 'an assertion reached the contract without being DER').toBe(assertions.length);

  const normalisationExercised = high > 0;
  record.normalisationExercised = normalisationExercised;
  record.authenticatorEmitsHighS = sampleHigh > 0;

  console.log('\n--- what this run establishes -------------------------------');
  console.log(`a real browser assertion owned an account and signed for it : YES`);
  console.log(`  deploy   ${String(record.deployTx)}`);
  console.log(`  observed ${String(record.observedTx)}`);
  console.log(`  install  ${String(record.installTx)}`);
  console.log(
    `DER unpacking exercised : YES — ${der} of ${assertions.length} assertions were DER and all were accepted`,
  );
  console.log(
    normalisationExercised
      ? `low-S normalisation exercised : YES — ${high} of ${assertions.length} assertions were high-S and landed after normalisation`
      : `low-S normalisation exercised : NO — none of the ${assertions.length} assertions this run were high-S.\n` +
          `  The authenticator does emit them (${sampleHigh} of ${sample.length} in the free sample), so the path is\n` +
          `  reachable and simply was not hit. The gap is narrowed, not closed: this run did not prove the\n` +
          `  normalisation correct, only that it did not break the signatures that did not need it.`,
  );
  console.log('\nRUN RECORD ' + JSON.stringify(record));

  // Deliberately not an assertion. Whether a high-S signature turned up is the
  // authenticator's choice, not a property of this code, and failing the run for
  // it would make a correct implementation red at random. What must not happen
  // is the result being *reported* as proof it was not — hence the record above
  // and `normalisationExercised` in it.
  expect(
    sampleHigh,
    'the authenticator never emitted a high-S signature, so no run of this spec can exercise the normalisation — the sample is the only evidence that path is reachable at all',
  ).toBeGreaterThan(0);

  await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
});
