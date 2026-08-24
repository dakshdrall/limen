/**
 * Registration and login, as two functions over interfaces.
 *
 * The routes above this file are adapters: they decode base64url, call one of
 * these, and turn the result into a response and a cookie. Everything that can
 * be wrong about authentication is decided here, where a test can drive it.
 *
 * That split is the same one `session.ts` makes and for the same reason it
 * gives: `apps/web` reaches Postgres over `neon-http`, which a local Postgres
 * cannot stand in for, so the binding to Drizzle is kept as thin as it can be
 * and everything above it is provable against a fake. `UserStore` exists for
 * that reason and for no other.
 *
 * ## The order of operations, which is the security argument
 *
 * Both ceremonies do the same four things in the same order, and the order is
 * not incidental:
 *
 *   1. **Read** the challenge out of `clientDataJSON`. Untrusted — it names a
 *      key, nothing more. `readChallenge` says why that is safe.
 *   2. **Spend** it. `consumeChallenge` returns true only for a value this
 *      server issued, *for this purpose*, unspent and unexpired. This happens
 *      before any verification, so a caller grinding at the verifier burns a
 *      challenge per attempt instead of getting unlimited tries at one.
 *   3. **Verify** against the spent challenge, plus origin, `rpIdHash`, UP and
 *      UV — `webauthn.ts` checks 1 to 6.
 *   4. **Issue** a session, and only then.
 *
 * Reversing 2 and 3 is the tempting version, because it avoids spending a
 * challenge on a request that turns out to be malformed. It is also how a
 * challenge becomes reusable: two requests racing both verify before either
 * spends, and a captured assertion is replayable for as long as the challenge
 * lives.
 *
 * ## Registration is not authentication, and this file does not pretend it is
 *
 * With `attestation: 'none'` there is no signature over the registration
 * response, so registering proves that some caller ran a ceremony against this
 * origin with a challenge we issued — not that they hold the credential.
 * `attestation.ts`'s header sets that out in full. What follows from it here is
 * one concrete rule: **a registration creates a user and nothing else**. It
 * never adopts an existing one, never attaches a credential to an account that
 * already has one, and never widens anything. A credential id that is already
 * registered is refused rather than re-pointed, because "re-point an existing
 * account at a key the caller just supplied" is precisely the operation an
 * unauthenticated ceremony must not be able to perform.
 */

import 'server-only';
import type { ChallengePurpose, WebAuthnPurpose } from './challenge';
import { verifyWalletSignature, assertStellarAddress } from './wallet-auth';
import { issueSession, readSession, type SessionRecord, type SessionStore } from './session';
import {
  equalBytes,
  readChallenge,
  verifyAssertion,
  verifyRegistration,
  WebAuthnError,
  type Expectation,
} from './webauthn';

/**
 * A user, as this path needs one.
 *
 * `authMethod` is not here: these two functions only ever handle passkeys, and
 * a field that is always `'passkey'` is one somebody eventually branches on.
 * The column exists on the table because `browser_key` users are a real thing
 * the schema anticipates; the store sets it.
 */
export type PasskeyUser = {
  authMethod: 'passkey';
  id: string;
  displayName: string | null;
  credentialId: Uint8Array;
  /** 65-byte uncompressed SEC1, as written by `verifyRegistration`. */
  publicKey: Uint8Array;
  stellarAddress: null;
};

/**
 * Someone who signed in with a wallet.
 *
 * No `credentialId` and no `publicKey`, and those absences are the point. A
 * wallet user has no passkey, so there is no 65-byte SEC1 point to install as
 * an `External` signer and nothing here that could be mistaken for one. Their
 * smart account is owned by the browser's disposable ed25519 key exactly as a
 * passkey user's is — `stellarAddress` is how they log in, not what owns
 * anything.
 */
export type WalletUser = {
  authMethod: 'wallet';
  id: string;
  displayName: string | null;
  credentialId: null;
  publicKey: null;
  /** The `G…` this user proved possession of. */
  stellarAddress: string;
};

/**
 * A user, as this path needs one — a discriminated union rather than a record
 * with four nullable fields.
 *
 * The union is doing real work. `publicUser` has to answer *"what is this
 * user's public key"* and for a wallet user the honest answer is that there
 * isn't one; with optional fields that becomes a `?? null` at the call site and
 * the type stops recording which users legitimately have no key. With a
 * discriminant, a caller that wants `publicKey` has to say which kind of user it
 * is talking about, and the compiler asks the question.
 *
 * `authMethod` is therefore *here* now, where the pre-wallet version of this
 * file deliberately left it out. That comment said a field which is always
 * `'passkey'` is one somebody eventually branches on — correct then, and the
 * reason it is safe now is that it is no longer always `'passkey'`. The
 * `browser_key` value in the database enum still has no user of its own.
 */
export type UserRecord = PasskeyUser | WalletUser;

export interface UserStore {
  findByCredentialId(credentialId: Uint8Array): Promise<UserRecord | undefined>;
  findById(id: string): Promise<UserRecord | undefined>;
  findByStellarAddress(address: string): Promise<UserRecord | undefined>;
  createPasskeyUser(input: {
    credentialId: Uint8Array;
    publicKey: Uint8Array;
    displayName: string | null;
  }): Promise<UserRecord>;
  /**
   * Create the user for an address that has just proved possession of its key.
   *
   * Called only after `verifyWalletSignature` has passed, which is why there is
   * no separate "register" ceremony for wallets the way there is for passkeys.
   * A passkey registration proves nothing — `attestation: 'none'` means there is
   * no signature over the registration response — so it has to be kept from
   * adopting existing accounts. A wallet signature *is* proof, so first sign-in
   * and every later sign-in are the same ceremony, and the only difference is
   * whether a row already exists.
   */
  createWalletUser(input: { stellarAddress: string; displayName: string | null }): Promise<UserRecord>;
}

/**
 * What both ceremonies need, passed in rather than imported.
 *
 * `expectation` is a function rather than a value because it is built from the
 * challenge, and `consume` is injected for the same reason `SessionStore` is:
 * the challenge store is Redis in production and a test should not need one.
 */
export interface AuthDeps {
  users: UserStore;
  sessions: SessionStore;
  consume(purpose: ChallengePurpose, challenge: string): Promise<boolean>;
  /**
   * Narrowed to the WebAuthn purposes deliberately — see `WebAuthnPurpose`.
   * A wallet challenge has no origin and no `rpIdHash` to expect, and typing
   * this on the full union would let `'wallet'` through to a function that
   * would answer with `webauthn.get`.
   */
  expectation(purpose: WebAuthnPurpose, challenge: string): Expectation;
}

export interface AuthResult {
  user: UserRecord;
  /** The session token, to be put in a cookie and never stored anywhere. */
  token: string;
  session: SessionRecord;
}

/** See `cleanDisplayName`. */
const MAX_DISPLAY_NAME = 64;

/**
 * A display name is decoration, and is treated as such.
 *
 * Trimmed, length-capped, and control characters removed — not because a name
 * is dangerous in a database, but because this string arrives from an
 * unauthenticated endpoint and is rendered, and a value like that should be
 * bounded where it enters rather than at each of the places it is shown. Empty
 * becomes null so there is one representation of "no name" instead of two.
 */
export function cleanDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, MAX_DISPLAY_NAME);
  return cleaned.length === 0 ? null : cleaned;
}

export interface RegistrationRequest {
  clientDataJSON: Uint8Array;
  attestationObject: Uint8Array;
  /** `rawId`, as the client reported it. Checked against `authData`, not trusted. */
  credentialId: Uint8Array;
  displayName: string | null;
  /** For the session's address hash. Never stored raw — see `session.ts`. */
  address?: string;
}

export async function registerPasskey(deps: AuthDeps, request: RegistrationRequest): Promise<AuthResult> {
  const challenge = await spend(deps, 'register', request.clientDataJSON);

  const credential = await verifyRegistration(
    { clientDataJSON: request.clientDataJSON, attestationObject: request.attestationObject },
    deps.expectation('register', challenge),
  );

  // The id the client will present at login must be the id inside the attested
  // structure. They are the same value in every honest ceremony; a mismatch
  // would mean the row is keyed by one credential and holds another's key, and
  // every login for it would then fail for a reason nobody could find.
  if (!equalBytes(credential.credentialId, request.credentialId)) {
    throw new WebAuthnError(
      'credential_id_mismatch',
      'The credential id in the request body is not the one inside authData.',
    );
  }

  // See the header: registration creates, and never adopts. This is also the
  // only sensible answer for someone re-registering a passkey they already
  // have — they have an account, and the way into it is to log in.
  const existing = await deps.users.findByCredentialId(credential.credentialId);
  if (existing !== undefined) {
    throw new WebAuthnError(
      'credential_registered',
      'That credential is already registered. Log in with it rather than registering it again.',
    );
  }

  const user = await deps.users.createPasskeyUser({
    credentialId: credential.credentialId,
    publicKey: credential.publicKey,
    displayName: request.displayName,
  });

  const { token, record } = await issueSession(deps.sessions, { userId: user.id, address: request.address });
  return { user, token, session: record };
}

export interface LoginRequest {
  clientDataJSON: Uint8Array;
  authenticatorData: Uint8Array;
  signature: Uint8Array;
  credentialId: Uint8Array;
  address?: string;
}

export async function loginWithPasskey(deps: AuthDeps, request: LoginRequest): Promise<AuthResult> {
  const challenge = await spend(deps, 'login', request.clientDataJSON);

  const user = await deps.users.findByCredentialId(request.credentialId);
  if (user === undefined || user.authMethod !== 'passkey') {
    // Deliberately the same answer as a bad signature. Distinguishing them
    // would answer "is this passkey registered here", which is a question
    // about a person, asked by whoever is holding the credential id.
    //
    // `authMethod !== 'passkey'` is folded into the same refusal rather than
    // being an impossible-case throw. A wallet user cannot be found by
    // credential id — the column is null and the lookup is an equality on it —
    // so this is unreachable today. It is written as a refusal because the
    // alternative is a non-null assertion on `publicKey`, and if some later
    // change *did* make it reachable, a failed login is the safe outcome and a
    // crash is not.
    throw new WebAuthnError('login_failed', 'That passkey did not log in.');
  }

  await verifyAssertion(
    {
      clientDataJSON: request.clientDataJSON,
      authenticatorData: request.authenticatorData,
      signature: request.signature,
      publicKey: user.publicKey,
    },
    deps.expectation('login', challenge),
  );

  const { token, record } = await issueSession(deps.sessions, { userId: user.id, address: request.address });
  return { user, token, session: record };
}

export interface WalletLoginRequest {
  /** The `G…` the wallet reported as `signerAddress`. */
  address: string;
  /** `signedMessage`, exactly as the extension returned it. Not pre-decoded. */
  signedMessage: unknown;
  /** The challenge this server issued, echoed back by the client. */
  challenge: string;
  /**
   * The client IP, for the session's address hash. Never stored raw — see
   * `session.ts`. Named `ip` rather than `address` because `address` already
   * means the wallet's `G…` in this request, and two meanings for one word in
   * one object is how the wrong one gets hashed into `created_ip_hash`.
   */
  ip?: string;
}

/**
 * Wallet sign-in: a signature over a challenge becomes a session.
 *
 * The same four steps in the same order as the passkey ceremonies — read the
 * challenge, spend it, verify against it, then issue — and the order carries the
 * identical argument. Spending before verifying means a caller grinding at the
 * verifier burns a challenge per attempt rather than getting unlimited tries at
 * one, and it is what stops a captured signature being replayable for as long as
 * the challenge lives.
 *
 * Step 1 differs in one way worth naming. A WebAuthn assertion carries the
 * challenge *inside* `clientDataJSON`, so `readChallenge` extracts it from
 * signed material. SEP-53 signs the bare message, so the challenge arrives as
 * its own field and is untrusted until spent. That is not a weakening: the
 * challenge is a key into a store this server wrote, `consumeChallenge` returns
 * true only for a value it issued for this purpose and has not yet spent, and
 * the signature is then verified over *that same string*. A caller who sends a
 * challenge they did not receive gets a miss at step 2; one who sends a real
 * challenge with a signature over something else fails at step 3.
 *
 * ## First sign-in creates, and that is safe here in a way registration is not
 *
 * `registerPasskey` is forbidden from adopting an existing account, because
 * `attestation: 'none'` means a registration proves nothing about who is
 * calling. A wallet signature is proof. So this looks the address up and creates
 * the user if there is none, and both paths are reached only *after*
 * `verifyWalletSignature` has passed — never before it.
 */
export async function loginWithWallet(deps: AuthDeps, request: WalletLoginRequest): Promise<AuthResult> {
  // Validated before the challenge is spent: a malformed address is a caller
  // bug, and burning a challenge on it would make a stuck client stay stuck.
  const address = assertStellarAddress(request.address);

  if (!(await deps.consume('wallet', request.challenge))) {
    throw new WebAuthnError(
      'challenge_unknown',
      'That challenge was not issued for this ceremony, or has already been used.',
    );
  }

  // Throws `WalletAuthError` on any failure. Nothing below runs unless the
  // holder of this address signed this exact challenge.
  verifyWalletSignature({
    address,
    challenge: request.challenge,
    signedMessage: request.signedMessage,
  });

  const existing = await deps.users.findByStellarAddress(address);
  const user =
    existing ?? (await deps.users.createWalletUser({ stellarAddress: address, displayName: null }));

  const { token, record } = await issueSession(deps.sessions, { userId: user.id, address: request.ip });
  return { user, token, session: record };
}

/** Steps 1 and 2 of the header's four, shared so they cannot drift apart. */
async function spend(deps: AuthDeps, purpose: ChallengePurpose, clientDataJSON: Uint8Array): Promise<string> {
  const challenge = readChallenge(clientDataJSON);
  if (challenge.length === 0) {
    throw new WebAuthnError('challenge_unreadable', 'The response does not name a challenge.');
  }
  if (!(await deps.consume(purpose, challenge))) {
    // Expired, already spent, issued for the other ceremony, or never issued:
    // one answer for all four, for the reason `challenge.ts` gives.
    throw new WebAuthnError(
      'challenge_unknown',
      'That challenge was not issued for this ceremony, or has already been used.',
    );
  }
  return challenge;
}

/** Whoever the cookie names, if the session is still live. */
export async function currentUser(
  deps: Pick<AuthDeps, 'users' | 'sessions'>,
  token: string | undefined,
  now: Date = new Date(),
): Promise<UserRecord | undefined> {
  const session = await readSession(deps.sessions, token, now);
  if (session === undefined) return undefined;
  return await deps.users.findById(session.userId);
}
