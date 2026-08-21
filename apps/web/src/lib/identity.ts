/**
 * Who the server says you are, and the three ceremonies that change the answer.
 *
 * PLAN-V8 §7.3. `/api/auth` has existed since the previous commit and **nothing
 * called it** — five routes, a verifier, a challenge store and a session table,
 * reachable only by `curl`. This module is the client half, and it is
 * deliberately the *only* client half: every `fetch` to `/api/auth` in this
 * application is written once, here.
 *
 * ## It holds no ceremony of its own
 *
 * Every WebAuthn call below goes through `passkey.ts` — `createCredential` and
 * `assertCredential` — rather than through a `navigator.credentials` call
 * written here. That module's header explains why the options are not
 * preferences: `residentKey`, the ES256-only parameter list and
 * `userVerification: 'required'` are each load-bearing for something outside
 * this file, and a second copy of them would produce a credential that
 * registers cleanly and then cannot own an account. This module supplies the
 * challenge and posts the result; it does not decide what a credential is.
 *
 * ## The challenge comes from the server, and that is the whole difference
 *
 * `createPasskey` mints its own challenge, because on the owner path nothing is
 * being proved to Limen. Here the opposite is true and it is the entire point:
 * `auth.ts` spends the challenge before it verifies anything, so a response
 * naming a challenge this server did not issue is refused before a signature is
 * checked. A client-side challenge on this path would be a login that proves a
 * credential signed *something*.
 *
 * ## Three states, and a fourth that renders nothing
 *
 * `unknown` is the honest server-render answer and the first client frame —
 * reading a cookie is a request-time API and this component tree is static.
 * `unavailable` is what a 503 from `/api/auth/session` means: this deployment
 * has no `DATABASE_URL`, so there is no session to have. It is a separate state
 * rather than being folded into `signed-out` because the two want opposite
 * chrome — signed-out gets an offer to sign in, and offering a control that
 * cannot work is the specific thing this application does not do. `README`'s
 * *no credentials are required* stays true: an unconfigured build renders no
 * auth chrome at all, exactly as it did before this file existed.
 */

import { assertTestnet } from '@limen/chain/browser';
import { NETWORK_PASSPHRASE } from '@/lib/network';
import {
  PASSKEY_LABEL,
  assertCredential,
  createCredential,
  fromBase64Url,
  rememberCredential,
  toBase64Url,
} from '@/lib/passkey';

/**
 * Named for the reason `use-passkey.ts` re-exports the same constant:
 * `test/local-key-label.test.ts` requires every module that imports the passkey
 * module to name this, so the obligation travels with the import rather than
 * being satisfied by a file not resembling a detector. It is not decorative
 * here — `SessionControl` renders it, because the credential this module
 * registers is the same testnet passkey that label is about.
 */
export { PASSKEY_LABEL };

/** What the three routes return, as `publicUser` projects it. */
export interface Identity {
  id: string;
  displayName: string | null;
  /** base64url. Public, and the id the authenticator answers to. */
  credentialId: string;
  /** base64url of the 65-byte uncompressed SEC1 point. See `publicUser`. */
  publicKey: string;
}

export type IdentityState =
  | { readonly status: 'unknown' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'signed-out' }
  | { readonly status: 'signed-in'; readonly user: Identity };

/**
 * Module constants, so `useSyncExternalStore` sees a stable reference.
 *
 * A snapshot getter that built a fresh object each call re-renders forever —
 * React compares by identity and every comparison would differ. The same
 * constraint `readPasskeySnapshot` satisfies by returning a string.
 */
const UNKNOWN: IdentityState = { status: 'unknown' };
const UNAVAILABLE: IdentityState = { status: 'unavailable' };
const SIGNED_OUT: IdentityState = { status: 'signed-out' };

/** The server has no cookie to read, so it has nothing to say. */
export const SERVER_IDENTITY = UNKNOWN;

let current: IdentityState = UNKNOWN;

const listeners = new Set<() => void>();

function publish(next: IdentityState): void {
  current = next;
  for (const listener of listeners) listener();
}

export function readIdentitySnapshot(): IdentityState {
  return current;
}

/**
 * Subscribe, and ask the server once.
 *
 * The first read is kicked from here rather than from a `useEffect` in the
 * component, so that the answer is a property of the store being observed at
 * all rather than of which component mounted first. A second consumer appearing
 * later — a screen that wants to know whether to offer something — gets the
 * cached answer and issues no second request.
 */
export function subscribeToIdentity(listener: () => void): () => void {
  listeners.add(listener);
  if (current.status === 'unknown') void refreshIdentity();
  return () => {
    listeners.delete(listener);
  };
}

/* --- talking to the routes ------------------------------------------------ */

interface RouteFailure {
  error?: string;
  message?: string;
}

/**
 * A refusal, as a sentence a person can act on.
 *
 * The route's own `message` is the fallback rather than the first choice, and
 * the ordering is deliberate. `auth-route.ts` writes those messages for whoever
 * is reading a response body — they name `authData`, `clientDataJSON` and
 * ceremonies — and pasting one into a header is how an application tells
 * somebody that their `credential_id_mismatch`. The reasons below are the ones
 * a person can do something about, and each sentence says what that is.
 */
function sentenceFor(status: number, body: RouteFailure): string {
  switch (body.error) {
    case 'credential_registered':
      return 'That passkey is already registered here. Sign in with it instead.';
    case 'login_failed':
      return 'That passkey is not registered here. Register it first — a passkey has to be created for this site before it can sign in to it.';
    case 'challenge_unknown':
    case 'challenge_unreadable':
      return 'That took too long, or the attempt was already used. Try again.';
    case 'origin_mismatch':
    case 'cross_origin':
      return 'The browser reported an origin this deployment does not serve, so the assertion was refused.';
    case 'user_not_verified':
    case 'user_not_present':
      return 'Your device did not verify you, and a credential without that cannot own an account. Try again and complete the biometric or PIN prompt.';
    case 'rate_limited':
      return 'Too many attempts from here. Wait a few minutes.';
    case 'unavailable':
      return 'Accounts are not configured on this deployment, so there is nothing to sign in to.';
    default:
      return body.message ?? `That did not go through (${String(status)}).`;
  }
}

class RouteError extends Error {
  constructor(
    readonly reason: string,
    message: string,
  ) {
    super(message);
  }
}

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    // The routes set the session cookie; nothing here should be served from a
    // cache, and `no-store` says so rather than relying on the response header
    // being honoured by every hop.
    cache: 'no-store',
  });

  // 204, which is what logout returns and what has no body to parse.
  const parsed: unknown =
    response.status === 204 ? {} : await response.json().catch(() => ({}) as unknown);
  const payload = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as RouteFailure &
    Record<string, unknown>;

  if (!response.ok) {
    throw new RouteError(payload.error ?? 'unknown', sentenceFor(response.status, payload));
  }
  return payload;
}

/** One challenge, minted server-side, as the bytes WebAuthn wants. */
async function mint(purpose: 'register' | 'login'): Promise<Uint8Array> {
  const issued = await post('/api/auth/challenge', { purpose });
  const challenge = issued.challenge;
  if (typeof challenge !== 'string' || challenge.length === 0) {
    throw new RouteError('no_challenge', 'The server issued no challenge.');
  }
  // Decoded to bytes and handed to the authenticator, which base64urls it back
  // into `clientDataJSON.challenge` — the same string the server stored, which
  // is the equality `consumeChallenge` and `verifyAssertion` both turn on.
  return fromBase64Url(challenge);
}

function identityFrom(payload: Record<string, unknown>): Identity {
  const user = payload.user;
  if (typeof user !== 'object' || user === null) {
    throw new RouteError('no_user', 'The server accepted the ceremony and returned no user.');
  }
  return user as unknown as Identity;
}

/* --- the three ceremonies -------------------------------------------------- */

/**
 * Register: a new passkey becomes a user, and a cookie comes back.
 *
 * `assertTestnet` for the reason `createPasskey` applies it — §7.3 makes this
 * credential the account owner as well as the identity, so a build that refuses
 * to sign for its network has no business creating one.
 *
 * The attestation object is posted rather than `getPublicKey()`, which is the
 * decision PLAN-V8 records at length: the server parses the key out of what the
 * authenticator produced, so the root of trust for `users.passkey_public_key`
 * is not a value this page computed. `createCredential` returns both, and this
 * function sends the one the server will parse and keeps the one this browser
 * will sign with.
 */
export async function registerIdentity(label: string): Promise<Identity> {
  assertTestnet(NETWORK_PASSPHRASE);

  const credential = await createCredential(label, await mint('register'));
  const user = identityFrom(
    await post('/api/auth/register', {
      clientDataJSON: toBase64Url(credential.clientDataJSON),
      attestationObject: toBase64Url(credential.attestationObject),
      credentialId: credential.credentialId,
      displayName: label,
    }),
  );

  rememberCredential(user.credentialId, credential.point);
  publish({ status: 'signed-in', user });
  return user;
}

/**
 * Sign in: an assertion becomes a session.
 *
 * No `allowCredentials`, which is what `residentKey: 'required'` bought at
 * registration and is not only a convenience: a login route that first told the
 * browser which credential ids are registered would be answering *is this
 * passkey registered here* to anybody who asked, which is the question
 * `loginWithPasskey` returns one answer for on purpose.
 *
 * The signature is posted as the DER the authenticator emitted. The chain path
 * normalises it to low-S and this one must not — `webauthn.ts` says why at
 * length, and `AssertedCredential.signature` is untouched precisely so the two
 * consumers make that choice themselves.
 */
export async function signIn(): Promise<Identity> {
  const asserted = await assertCredential(await mint('login'));
  const user = identityFrom(
    await post('/api/auth/login', {
      clientDataJSON: toBase64Url(asserted.clientDataJSON),
      authenticatorData: toBase64Url(asserted.authenticatorData),
      signature: toBase64Url(asserted.signature),
      credentialId: asserted.credentialId,
    }),
  );

  // The half of "clearing site data no longer strands the account" that this
  // application, rather than the chain, is responsible for: a browser that
  // holds nothing adopts the credential it just proved possession of. A browser
  // that already holds one keeps it — see `rememberCredential`.
  rememberCredential(user.credentialId, fromBase64Url(user.publicKey));
  publish({ status: 'signed-in', user });
  return user;
}

/**
 * Sign out: the row goes, then the cookie, then this store.
 *
 * **The passkey record is deliberately not cleared.** Signing out ends a
 * session; it does not renounce a credential that may be written into a
 * `Signer::External` on a deployed account. `forgetPasskey` is the separate,
 * explicit act, and it is on the screen that can also say what it does not do —
 * the passkey lives in the authenticator and this application cannot delete it.
 */
export async function signOut(): Promise<void> {
  await post('/api/auth/logout', {});
  publish(SIGNED_OUT);
}

/* --- reading the cookie ---------------------------------------------------- */

let inFlight: Promise<IdentityState> | undefined;

/**
 * Ask `/api/auth/session` who the cookie names.
 *
 * De-duplicated, because `subscribeToIdentity` calls it and two components
 * mounting in one frame would otherwise issue two requests to answer one
 * question.
 *
 * A failure is `unavailable` rather than `signed-out`. The distinction is the
 * whole reason the state exists: "there is no session" and "this deployment
 * cannot tell you" want different chrome, and collapsing them puts a sign-in
 * button on a build with no database behind it.
 */
export async function refreshIdentity(): Promise<IdentityState> {
  if (inFlight !== undefined) return await inFlight;

  inFlight = (async (): Promise<IdentityState> => {
    try {
      const response = await fetch('/api/auth/session', { cache: 'no-store' });
      if (!response.ok) return UNAVAILABLE;
      const payload = (await response.json()) as { user?: Identity | null };
      return payload.user == null ? SIGNED_OUT : { status: 'signed-in', user: payload.user };
    } catch {
      // Offline, or a route that is not there at all. Not signed out.
      return UNAVAILABLE;
    }
  })();

  try {
    const next = await inFlight;
    publish(next);
    return next;
  } finally {
    inFlight = undefined;
  }
}

/**
 * Whether a thrown value is a refusal this module already put a sentence on.
 *
 * Exported so a component can render `error.message` for a route refusal and
 * its own wording for everything else — a `NotAllowedError` from a dismissed
 * biometric prompt is not a failure and must not read as one.
 */
export function isRouteRefusal(error: unknown): error is RouteError {
  return error instanceof RouteError;
}
