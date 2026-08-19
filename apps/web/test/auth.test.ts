/**
 * Registration and login, driven end to end against fakes.
 *
 * Every case runs a whole ceremony with a real key and a real signature, then
 * changes one thing — the same shape as `webauthn.test.ts`, one layer up. What
 * is proved here is not that a signature verifies, which that suite already
 * settles, but the things only the orchestration can get wrong: the order the
 * challenge is spent in, what happens on a second registration of the same
 * credential, and whether a user who does not exist is distinguishable from one
 * whose signature did not check.
 *
 * The stores are fakes for the reason `session.ts` gives: `neon-http` cannot be
 * stood up locally, so the Drizzle binding is kept thin — `stores.ts` — and
 * everything above it is proved against an in-memory double.
 */

import { describe, expect, it } from 'vitest';
import {
  cleanDisplayName,
  currentUser,
  loginWithPasskey,
  registerPasskey,
  type AuthDeps,
  type UserRecord,
  type UserStore,
} from '../src/lib/auth';
import { hashToken, type SessionRecord, type SessionStore } from '../src/lib/session';
import { WebAuthnError, bytesToBase64Url, type Expectation } from '../src/lib/webauthn';
import type { ChallengePurpose } from '../src/lib/challenge';
import {
  assertionAuthData,
  attestationObject,
  clientDataJSON,
  makeCredential,
  registrationAuthData,
  sign,
  type TestCredential,
} from './helpers/webauthn';

const RP_ID = 'limen.app';
const ORIGIN = 'https://limen.app';

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

class FakeUsers implements UserStore {
  rows = new Map<string, UserRecord>();
  #next = 0;

  findByCredentialId(credentialId: Uint8Array) {
    return Promise.resolve(this.rows.get(hex(credentialId)));
  }

  findById(id: string) {
    return Promise.resolve([...this.rows.values()].find((row) => row.id === id));
  }

  createPasskeyUser(input: { credentialId: Uint8Array; publicKey: Uint8Array; displayName: string | null }) {
    this.#next += 1;
    const record: UserRecord = {
      id: `u${this.#next}`,
      displayName: input.displayName,
      credentialId: input.credentialId,
      publicKey: input.publicKey,
    };
    this.rows.set(hex(input.credentialId), record);
    return Promise.resolve(record);
  }
}

class FakeSessions implements SessionStore {
  rows = new Map<string, SessionRecord>();
  #next = 0;

  create(session: { userId: string; tokenHash: string; expiresAt: Date; createdIpHash: string | null }) {
    this.#next += 1;
    const record: SessionRecord = { id: `s${this.#next}`, userId: session.userId, expiresAt: session.expiresAt };
    this.rows.set(session.tokenHash, record);
    this.createdIpHashes.push(session.createdIpHash);
    return Promise.resolve(record);
  }

  createdIpHashes: (string | null)[] = [];

  findValid(tokenHash: string, now: Date) {
    const row = this.rows.get(tokenHash);
    if (row === undefined || row.expiresAt.getTime() <= now.getTime()) return Promise.resolve(undefined);
    return Promise.resolve(row);
  }

  deleteByTokenHash(tokenHash: string) {
    this.rows.delete(tokenHash);
    return Promise.resolve();
  }

  deleteAllForUser(userId: string) {
    for (const [hash, row] of this.rows) if (row.userId === userId) this.rows.delete(hash);
    return Promise.resolve();
  }
}

/** The challenge store, as a set of unspent values. Spending is deletion. */
class FakeChallenges {
  issued = new Set<string>();
  spent: string[] = [];

  issue(purpose: ChallengePurpose, challenge: string): string {
    this.issued.add(`${purpose}:${challenge}`);
    return challenge;
  }

  consume = (purpose: ChallengePurpose, challenge: string): Promise<boolean> => {
    this.spent.push(`${purpose}:${challenge}`);
    return Promise.resolve(this.issued.delete(`${purpose}:${challenge}`));
  };
}

interface Harness extends AuthDeps {
  users: FakeUsers;
  sessions: FakeSessions;
  challenges: FakeChallenges;
}

function harness(origins: readonly string[] = [ORIGIN]): Harness {
  const users = new FakeUsers();
  const sessions = new FakeSessions();
  const challenges = new FakeChallenges();
  return {
    users,
    sessions,
    challenges,
    consume: challenges.consume,
    expectation: (purpose: ChallengePurpose, challenge: string): Expectation => ({
      origins,
      rpId: RP_ID,
      challenge,
      type: purpose === 'register' ? 'webauthn.create' : 'webauthn.get',
    }),
  };
}

const challengeValue = (seed: number): string => bytesToBase64Url(new Uint8Array(32).fill(seed));

async function registration(
  credential: TestCredential,
  { challenge, origin = ORIGIN, rpId = RP_ID, type = 'webauthn.create', flags }: {
    challenge: string;
    origin?: string;
    rpId?: string;
    type?: string;
    flags?: number;
  },
) {
  const client = clientDataJSON({ type, challenge, origin });
  return {
    clientDataJSON: client,
    attestationObject: attestationObject(registrationAuthData(credential, { rpId, flags })),
    credentialId: credential.credentialId,
    displayName: null,
  };
}

async function login(
  credential: TestCredential,
  { challenge, origin = ORIGIN, rpId = RP_ID, type = 'webauthn.get' }: {
    challenge: string;
    origin?: string;
    rpId?: string;
    type?: string;
  },
) {
  const client = clientDataJSON({ type, challenge, origin });
  const auth = assertionAuthData({ rpId });
  return {
    clientDataJSON: client,
    authenticatorData: auth,
    signature: await sign(credential, auth, client),
    credentialId: credential.credentialId,
  };
}

/** The reason code, so a case cannot pass because something else went wrong. */
async function reasonFor(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof WebAuthnError) return error.reason;
    throw error;
  }
  return 'no error';
}

/* --- the baseline, which makes every rejection below mean something -------- */

describe('a genuine registration', () => {
  it('creates a user whose stored key came out of authData', async () => {
    const deps = harness();
    const credential = await makeCredential();
    const challenge = deps.challenges.issue('register', challengeValue(1));

    const result = await registerPasskey(deps, await registration(credential, { challenge }));

    // The whole point of parsing server-side: these bytes are the ones inside
    // the attestation object, not a field the caller computed. They match the
    // key only because the parser read the same point the authenticator emitted.
    expect(hex(result.user.publicKey)).toBe(hex(credential.publicKey));
    expect(hex(result.user.credentialId)).toBe(hex(credential.credentialId));
    expect(deps.users.rows.size).toBe(1);
  });

  it('issues a session whose token is not what the store holds', async () => {
    const deps = harness();
    const credential = await makeCredential();
    const challenge = deps.challenges.issue('register', challengeValue(2));

    const result = await registerPasskey(deps, await registration(credential, { challenge }));

    expect(deps.sessions.rows.has(result.token)).toBe(false);
    expect(deps.sessions.rows.has(hashToken(result.token))).toBe(true);
  });

  it('records a hashed address when one is given', async () => {
    const deps = harness();
    const credential = await makeCredential();
    const challenge = deps.challenges.issue('register', challengeValue(3));

    await registerPasskey(deps, { ...(await registration(credential, { challenge })), address: '203.0.113.9' });

    const [recorded] = deps.sessions.createdIpHashes;
    expect(recorded).not.toBe('203.0.113.9');
    expect(recorded).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('a genuine login', () => {
  it('finds the user by credential id and verifies against the stored key', async () => {
    const deps = harness();
    const credential = await makeCredential();
    await registerPasskey(deps, await registration(credential, { challenge: deps.challenges.issue('register', challengeValue(4)) }));

    const result = await loginWithPasskey(deps, await login(credential, { challenge: deps.challenges.issue('login', challengeValue(5)) }));

    expect(result.user.id).toBe('u1');
    expect(deps.sessions.rows.size).toBe(2);
  });

  it('is what `currentUser` then reads back from the cookie', async () => {
    const deps = harness();
    const credential = await makeCredential();
    const registered = await registerPasskey(deps, await registration(credential, { challenge: deps.challenges.issue('register', challengeValue(6)) }));

    const found = await currentUser(deps, registered.token);
    expect(found?.id).toBe(registered.user.id);
  });

  it('reads nobody from a token that was never issued', async () => {
    const deps = harness();
    expect(await currentUser(deps, 'not-a-token')).toBeUndefined();
  });
});

/* --- the challenge, and the order it is spent in --------------------------- */

describe('the challenge is spent before anything is verified', () => {
  it('spends it even when the ceremony then fails', async () => {
    // The property that makes grinding expensive: a caller retrying against the
    // verifier burns a challenge per attempt rather than getting unlimited
    // tries at one.
    const deps = harness();
    const credential = await makeCredential();
    const challenge = deps.challenges.issue('login', challengeValue(7));
    await registerPasskey(deps, await registration(credential, { challenge: deps.challenges.issue('register', challengeValue(8)) }));

    const attempt = await login(credential, { challenge });
    attempt.signature = Uint8Array.from(attempt.signature);
    attempt.signature[attempt.signature.length - 1] ^= 0xff;

    expect(await reasonFor(() => loginWithPasskey(deps, attempt))).toBe('bad_signature');
    expect(deps.challenges.issued.has(`login:${challenge}`)).toBe(false);
  });

  it('refuses a second use of the same challenge', async () => {
    const deps = harness();
    const credential = await makeCredential();
    await registerPasskey(deps, await registration(credential, { challenge: deps.challenges.issue('register', challengeValue(9)) }));

    const challenge = deps.challenges.issue('login', challengeValue(10));
    const replayed = await login(credential, { challenge });

    await loginWithPasskey(deps, replayed);
    expect(await reasonFor(() => loginWithPasskey(deps, replayed))).toBe('challenge_unknown');
  });

  it('refuses a registration challenge presented at login', async () => {
    // Two ceremonies, two namespaces. `clientDataJSON.type` is the browser's
    // claim about which one this is; the purpose on the stored challenge is the
    // server's, and this is the half a lying browser cannot reach.
    const deps = harness();
    const credential = await makeCredential();
    await registerPasskey(deps, await registration(credential, { challenge: deps.challenges.issue('register', challengeValue(11)) }));

    const challenge = deps.challenges.issue('register', challengeValue(12));
    expect(await reasonFor(async () => loginWithPasskey(deps, await login(credential, { challenge })))).toBe('challenge_unknown');
  });

  it('refuses a challenge nobody issued', async () => {
    const deps = harness();
    const credential = await makeCredential();
    expect(await reasonFor(async () => registerPasskey(deps, await registration(credential, { challenge: challengeValue(13) })))).toBe('challenge_unknown');
    expect(deps.users.rows.size).toBe(0);
  });

  it('refuses a response that names no challenge at all', async () => {
    const deps = harness();
    const credential = await makeCredential();
    const request = await registration(credential, { challenge: challengeValue(14) });
    request.clientDataJSON = new TextEncoder().encode('{}');
    expect(await reasonFor(() => registerPasskey(deps, request))).toBe('challenge_unreadable');
    // Nothing was spent, because there was nothing to name.
    expect(deps.challenges.spent).toEqual([]);
  });
});

/* --- what registration must not be able to do ------------------------------ */

describe('registration creates and never adopts', () => {
  it('refuses a credential that is already registered', async () => {
    const deps = harness();
    const credential = await makeCredential();
    await registerPasskey(deps, await registration(credential, { challenge: deps.challenges.issue('register', challengeValue(15)) }));

    const again = await registration(credential, { challenge: deps.challenges.issue('register', challengeValue(16)) });
    expect(await reasonFor(() => registerPasskey(deps, again))).toBe('credential_registered');
    expect(deps.users.rows.size).toBe(1);
  });

  it('refuses a body whose credential id is not the one inside authData', async () => {
    // The attack this closes: register with somebody else's credential id in
    // the body and this account's key in authData, and every login for their id
    // would check against a key the attacker holds.
    const deps = harness();
    const credential = await makeCredential();
    const request = await registration(credential, { challenge: deps.challenges.issue('register', challengeValue(17)) });
    request.credentialId = new Uint8Array(20).fill(0xee);

    expect(await reasonFor(() => registerPasskey(deps, request))).toBe('credential_id_mismatch');
    expect(deps.users.rows.size).toBe(0);
  });

  it('refuses a login assertion posted to the registration path', async () => {
    const deps = harness();
    const credential = await makeCredential();
    const challenge = deps.challenges.issue('register', challengeValue(18));
    const request = await registration(credential, { challenge, type: 'webauthn.get' });

    expect(await reasonFor(() => registerPasskey(deps, request))).toBe('type_mismatch');
  });

  it('refuses a registration from an origin this deployment does not serve', async () => {
    const deps = harness();
    const credential = await makeCredential();
    const challenge = deps.challenges.issue('register', challengeValue(19));

    expect(
      await reasonFor(async () => registerPasskey(deps, await registration(credential, { challenge, origin: 'https://limen.app.evil.com' }))),
    ).toBe('origin_mismatch');
  });

  it('refuses a registration bound to another relying party', async () => {
    const deps = harness();
    const credential = await makeCredential();
    const challenge = deps.challenges.issue('register', challengeValue(20));

    expect(await reasonFor(async () => registerPasskey(deps, await registration(credential, { challenge, rpId: 'evil.com' })))).toBe('rp_id_mismatch');
  });

  it('refuses a credential registered without user verification', async () => {
    // UP | AT, no UV. Such a credential could log in and could never own an
    // account, because the deployed verifier requires the bit.
    const deps = harness();
    const credential = await makeCredential();
    const challenge = deps.challenges.issue('register', challengeValue(21));

    expect(await reasonFor(async () => registerPasskey(deps, await registration(credential, { challenge, flags: 0x41 })))).toBe('user_not_verified');
  });
});

/* --- what login must not reveal -------------------------------------------- */

describe('login says the same thing about an unknown credential and a bad signature', () => {
  it('answers `login_failed` for a credential nobody registered', async () => {
    const deps = harness();
    const credential = await makeCredential();
    const challenge = deps.challenges.issue('login', challengeValue(22));

    expect(await reasonFor(async () => loginWithPasskey(deps, await login(credential, { challenge })))).toBe('login_failed');
  });

  it('does not let one credential log in as another', async () => {
    // Register two, then present the first's credential id with the second's
    // signature. The lookup succeeds and the verification is what refuses.
    const deps = harness();
    const first = await makeCredential(new Uint8Array(20).fill(0x11));
    const second = await makeCredential(new Uint8Array(20).fill(0x22));
    await registerPasskey(deps, await registration(first, { challenge: deps.challenges.issue('register', challengeValue(23)) }));
    await registerPasskey(deps, await registration(second, { challenge: deps.challenges.issue('register', challengeValue(24)) }));

    const attempt = await login(second, { challenge: deps.challenges.issue('login', challengeValue(25)) });
    attempt.credentialId = first.credentialId;

    expect(await reasonFor(() => loginWithPasskey(deps, attempt))).toBe('bad_signature');
  });

  it('refuses an assertion from an origin this deployment does not serve', async () => {
    const deps = harness();
    const credential = await makeCredential();
    await registerPasskey(deps, await registration(credential, { challenge: deps.challenges.issue('register', challengeValue(26)) }));

    const challenge = deps.challenges.issue('login', challengeValue(27));
    expect(await reasonFor(async () => loginWithPasskey(deps, await login(credential, { challenge, origin: 'https://evil.com' })))).toBe('origin_mismatch');
  });

  it('accepts an assertion from a second configured origin', async () => {
    // The list is a list, and this is what stops `origins` quietly meaning
    // "the first one".
    const deps = harness([ORIGIN, 'https://preview.limen.app']);
    const credential = await makeCredential();
    await registerPasskey(deps, await registration(credential, { challenge: deps.challenges.issue('register', challengeValue(28)) }));

    const challenge = deps.challenges.issue('login', challengeValue(29));
    const result = await loginWithPasskey(deps, await login(credential, { challenge, origin: 'https://preview.limen.app' }));
    expect(result.user.id).toBe('u1');
  });
});

describe('the display name', () => {
  it('is null when absent, blank, or not a string', () => {
    expect(cleanDisplayName(undefined)).toBeNull();
    expect(cleanDisplayName('   ')).toBeNull();
    expect(cleanDisplayName(42)).toBeNull();
  });

  it('strips control characters and caps the length', () => {
    expect(cleanDisplayName('a\u0007bc')).toBe('abc');
    expect(cleanDisplayName('x'.repeat(200))?.length).toBe(64);
  });

  it('keeps an ordinary name unchanged', () => {
    expect(cleanDisplayName('  Ada Lovelace ')).toBe('Ada Lovelace');
  });
});
