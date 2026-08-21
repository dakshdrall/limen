import { expect, request as playwrightRequest, test } from '@playwright/test';

/**
 * The whole ceremony, through the real UI, against a real Neon and a real
 * shared store.
 *
 * This is the suite PLAN-V8 §7.5.2 and the *"UNRUN at M1: no auth route has run
 * against a real database"* record are both waiting on. Everything below the
 * routes is proved against fakes — `auth.test.ts` drives `registerPasskey` and
 * `loginWithPasskey` over in-memory stores, `session.test.ts` drives the token
 * and expiry rules, `passkey-registration.spec.ts` drives the parser against a
 * real browser. **`stores.ts` is executed by none of them**, because `apps/web`
 * reaches Postgres over Neon's HTTP protocol and no container speaks it.
 *
 * So this file is deliberately not another unit of the same kind. It is the one
 * thing those cannot be: a browser creating a real credential, a route writing
 * a real row through `neon-http`, a challenge spent in a real Redis, and a
 * cookie coming back that a *second* request can be checked against.
 *
 * ## What it is written to catch, rather than to demonstrate
 *
 * A spec that registered, saw a name in the header and stopped would pass
 * against a `stores.ts` that wrote nothing, because the register response is
 * built from the value it just handed the store. Every assertion here is
 * therefore across a boundary the first request cannot fake:
 *
 *   - **the session survives a second request.** A reload re-reads the cookie
 *     and looks the session up by token hash. That is `findValid`, with the
 *     expiry filter in the query, against a row written by a previous HTTP
 *     request.
 *   - **sign-out deletes the row, not only the cookie.** The cookie is captured
 *     before signing out and replayed afterwards from an independent HTTP
 *     client. `logout/route.ts` claims the row goes first precisely so that a
 *     leaked token stops working everywhere; this is what makes that a
 *     measurement.
 *   - **signing in finds the row registration wrote.** `findByCredentialId`,
 *     comparing `bytea` to `bytea`, in a different request from the insert.
 *     `stores.ts`'s header warns that two spellings of one credential id are
 *     two rows; the same user id coming back is what says they are not.
 *   - **the key the server parsed equals the key the browser derived.** Site
 *     data is cleared before signing in, so the credential this browser adopts
 *     comes back from `users.passkey_public_key` — which was written by
 *     `parseAttestationObject` from CBOR — and is compared against the hex this
 *     browser derived from SPKI before it was cleared. Two independent decoders
 *     agreeing *through a database round trip*.
 *   - **a challenge is spent.** The exact body that just logged in is replayed
 *     and must be refused. That is `consumeChallenge` against the real store,
 *     which is the half of `@limen/kv`'s contract no fake can establish.
 *   - **registration creates and never adopts.** A second credential produces a
 *     second user id.
 *
 * ## Why it is not in `playwright.ci.config.ts`
 *
 * It needs credentials a GitHub runner does not have, and it writes rows. Same
 * reasoning as `account-lifecycle.spec.ts`, minus the money: on demand, not per
 * push. It spends nothing on chain and touches no RPC.
 *
 *     npx playwright test e2e/auth-ceremony.spec.ts   # from apps/web
 *
 * ## `localhost`, not `127.0.0.1`, and it is load-bearing
 *
 * The relying-party id is the origin's registrable domain, so a credential
 * created on `http://127.0.0.1:3000` is bound to `127.0.0.1` and
 * `resolveRelyingParty` defaults to `localhost`. The `rpIdHash` check in
 * `webauthn.ts` — check 4, the one that is inside the signed bytes — would
 * refuse every assertion, correctly, and the run would read as a broken login.
 * The base URL is therefore stated here rather than inherited from the config.
 */

const ORIGIN = 'http://localhost:3000';

/** Both halves of the configuration this suite exists to exercise. */
const REQUIRED = ['DATABASE_URL'] as const;

test.describe('@auth the passkey ceremony against real infrastructure', () => {
  test('registers, holds a session across requests, signs out, and signs back in', async ({
    page,
    context,
  }) => {
    // Fail rather than skip. A suite whose whole purpose is to be run against
    // real services, quietly passing because they were absent, is the exact
    // shape of coverage this repository keeps losing — `contract.test.ts` makes
    // the same refusal in the same words.
    const missing = REQUIRED.filter((name) => (process.env[name] ?? '').length === 0);
    expect(
      missing,
      `set ${missing.join(', ')} before running this suite — it exists to exercise the Drizzle binding ` +
        'in stores.ts, which nothing else in this repository can reach.',
    ).toEqual([]);

    const record: Record<string, unknown> = {};

    /* --- a real browser credential, in software ---------------------------- */

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

    /**
     * The body of the last successful login, kept for the replay.
     *
     * Recorded off the wire rather than rebuilt, so the replay is byte-identical
     * to a request the server has already accepted. A hand-built one would prove
     * that a *different* body is refused, which is not the claim.
     */
    let lastLoginBody: string | undefined;
    page.on('request', (request) => {
      if (request.url().endsWith('/api/auth/login') && request.method() === 'POST') {
        lastLoginBody = request.postData() ?? undefined;
      }
    });

    await page.goto(ORIGIN);

    const registerButton = page.getByRole('button', { name: 'Register' });
    const signInButton = page.getByRole('button', { name: 'Sign in' });
    const signOutButton = page.getByRole('button', { name: 'Sign out' });

    /* --- 1: the control is offered at all ---------------------------------- */

    // Which is itself a reading of the database. `SessionControl` renders
    // nothing when `/api/auth/session` fails, so a Neon that will not answer
    // shows up here as an absent button rather than as a later mystery.
    await expect(registerButton, 'the header offered no auth controls — /api/auth/session did not answer').toBeVisible();
    await expect(signInButton).toBeVisible();
    record.controlOfferedBeforeAnySession = true;

    /* --- 2: register --------------------------------------------------------- */

    await registerButton.click();
    await expect(signOutButton).toBeVisible();

    const first = await readSession(page);
    expect(first.user).not.toBeNull();
    record.registeredUserId = typeof first.user?.id === 'string' ? 'a uuid' : 'not a string';
    expect(first.user?.credentialId).toEqual(expect.any(String));

    // The 65-byte point, as base64url. 65 bytes is 87 base64url characters.
    const publicKey = first.user?.publicKey ?? '';
    record.publicKeyBytes = Math.floor((publicKey.length * 3) / 4);
    expect(record.publicKeyBytes, 'the stored key is not a 65-byte uncompressed point').toBe(65);

    // What this browser derived from SPKI, before anything is cleared.
    const derivedByBrowser = await storedPasskey(page);
    expect(derivedByBrowser?.credentialId, 'registration did not adopt the credential').toBe(
      first.user?.credentialId,
    );
    record.adoptedOnRegister = true;

    /* --- 3: the session survives a second request -------------------------- */

    await page.reload();
    await expect(signOutButton, 'the session did not survive a reload — findValid returned nothing').toBeVisible();
    const afterReload = await readSession(page);
    expect(afterReload.user?.id).toBe(first.user?.id);
    record.sessionSurvivedAReload = true;

    /* --- 4: sign out, and prove the row went rather than the cookie -------- */

    const cookies = await context.cookies(ORIGIN);
    const token = cookies.find((cookie) => cookie.name === 'limen_session')?.value ?? '';
    expect(token.length, 'no session cookie was set').toBeGreaterThan(0);
    record.cookieName = 'limen_session';

    await signOutButton.click();
    await expect(registerButton).toBeVisible();

    // An independent HTTP client, carrying the cookie this browser no longer
    // has. If logout had only cleared the cookie, this would still name a user.
    const replay = await playwrightRequest.newContext({
      baseURL: ORIGIN,
      extraHTTPHeaders: { cookie: `limen_session=${token}` },
    });
    const replayed = (await (await replay.get('/api/auth/session')).json()) as { user: unknown };
    expect(replayed.user, 'the session token still works after logout — the row was not deleted').toBeNull();
    record.tokenDeadAfterLogout = true;

    /* --- 5: sign in on a browser that has been cleared --------------------- */

    // The passkey is in the authenticator, not in site data. Clearing this is
    // what makes the next step a test of the *server's* copy of the key.
    await page.evaluate(() => {
      window.localStorage.clear();
    });
    await page.reload();

    await signInButton.click();
    await expect(signOutButton, 'signing in did not produce a session').toBeVisible();

    const second = await readSession(page);
    expect(second.user?.id, 'signing in produced a different user than registration wrote').toBe(
      first.user?.id,
    );
    record.signedInToTheSameUser = true;

    const adopted = await storedPasskey(page);
    expect(adopted?.credentialId).toBe(first.user?.credentialId);
    // The measurement worth the most in this file: the key the *server* parsed
    // out of CBOR, round-tripped through Postgres, equals the key this *browser*
    // derived from SPKI two ceremonies ago.
    expect(
      adopted?.publicKeyHex,
      'the key the server parsed from the attestation is not the key the browser derived from SPKI',
    ).toBe(derivedByBrowser?.publicKeyHex);
    record.serverKeyMatchesBrowserKey = true;
    record.adoptedOnSignIn = true;

    /* --- 6: a challenge is spent once -------------------------------------- */

    expect(lastLoginBody, 'no login body was captured').toBeTruthy();
    const replayedLogin = await replay.post('/api/auth/login', {
      headers: { 'content-type': 'application/json' },
      data: lastLoginBody ?? '',
    });
    const refusal = (await replayedLogin.json()) as { error?: string };
    expect(replayedLogin.status()).toBe(401);
    record.replayedLoginStatus = replayedLogin.status();
    record.replayedLoginReason = refusal.error;
    expect(refusal.error, 'a replayed assertion was not refused by the challenge store').toBe(
      'challenge_unknown',
    );

    /* --- 7: registration creates, and never adopts ------------------------- */

    await signOutButton.click();
    await expect(registerButton).toBeVisible();
    await registerButton.click();
    await expect(signOutButton).toBeVisible();

    const third = await readSession(page);
    expect(third.user?.id, 'a second registration returned the first user').not.toBe(first.user?.id);
    expect(third.user?.credentialId).not.toBe(first.user?.credentialId);
    record.secondRegistrationIsANewUser = true;

    await replay.dispose();
    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });

    /* --- what this run establishes ----------------------------------------- */

    console.log('\n--- what this run establishes -------------------------------');
    console.log('the header offered the ceremony            : /api/auth/session answered from Neon');
    console.log('a registration wrote a row                 : createPasskeyUser, through neon-http');
    console.log('the session survived a second request      : findValid, expiry filtered in the query');
    console.log('logout deleted the row, not just the cookie: replayed token names nobody');
    console.log('signing in found the row registration wrote: findByCredentialId, bytea to bytea');
    console.log("the server's key equals the browser's      : CBOR-parsed point == SPKI-derived point");
    console.log('a challenge was spent exactly once         : the replayed body was refused');
    console.log('registration created and never adopted     : a second credential is a second user');
    console.log('\nRUN RECORD ' + JSON.stringify(record));
  });
});

/** What `/api/auth/session` says, read from inside the page so the cookie travels. */
async function readSession(page: import('@playwright/test').Page): Promise<{
  user: { id?: string; displayName?: string | null; credentialId?: string; publicKey?: string } | null;
}> {
  return await page.evaluate(async () => {
    const response = await fetch('/api/auth/session', { cache: 'no-store' });
    return (await response.json()) as { user: null };
  });
}

/** What `passkey.ts` has in browser storage, which is public material only. */
async function storedPasskey(
  page: import('@playwright/test').Page,
): Promise<{ credentialId: string; publicKeyHex: string } | undefined> {
  return await page.evaluate(() => {
    const raw = window.localStorage.getItem('limen.passkey.v1');
    return raw === null ? undefined : (JSON.parse(raw) as { credentialId: string; publicKeyHex: string });
  });
}
