/**
 * Wallet sign-in, checked against the envelope that was actually measured.
 *
 * Every signature in this file is made with `Keypair.signMessage`, which is
 * SEP-53 — the same envelope the `/app/dev/freighter` probe found Freighter
 * using, verified under both `sep53` and `sep53-manual` and under nothing else.
 * So these are not signatures shaped like a wallet's; they are the same
 * construction, produced locally so the expected answer is known in advance.
 *
 * The tests are in three groups, and the third is the one that matters:
 *
 *   1. the verifier accepts what Freighter sends and refuses everything else,
 *   2. the ceremony spends a challenge exactly once,
 *   3. **nothing is created before the signature is checked** — a failed
 *      sign-in must leave no user and no session behind, because a wallet
 *      address is an identity and creating one on an unverified claim would
 *      hand it to whoever asked for it.
 */

import { describe, expect, it } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { loginWithWallet, type AuthDeps, type UserRecord, type UserStore } from '@/lib/auth';
import { hashToken, type SessionRecord, type SessionStore } from '@/lib/session';
import { WalletAuthError, assertStellarAddress, decodeSignature, verifyWalletSignature } from '@/lib/wallet-auth';
import { WebAuthnError, type Expectation } from '@/lib/webauthn';
import type { ChallengePurpose } from '@/lib/challenge';

const CHALLENGE = 'sJ3nQfE2b1kYq7pR0xTvUwZ8aLmNcHgD4eF6iJkLmNo';

/** The v4 shape: base64, as a string. What the probe measured. */
function signBase64(kp: Keypair, message: string): string {
  return kp.signMessage(message).toString('base64');
}

class FakeUsers implements UserStore {
  wallets = new Map<string, UserRecord>();
  created: string[] = [];
  #next = 0;

  findByCredentialId() {
    return Promise.resolve(undefined);
  }

  findById(id: string) {
    return Promise.resolve([...this.wallets.values()].find((row) => row.id === id));
  }

  findByStellarAddress(address: string) {
    return Promise.resolve(this.wallets.get(address));
  }

  createPasskeyUser(): Promise<UserRecord> {
    throw new Error('not used in this suite');
  }

  createWalletUser(input: { stellarAddress: string; displayName: string | null }) {
    this.created.push(input.stellarAddress);
    const existing = this.wallets.get(input.stellarAddress);
    if (existing !== undefined) return Promise.resolve(existing);
    this.#next += 1;
    const record: UserRecord = {
      authMethod: 'wallet',
      id: `u${this.#next}`,
      displayName: input.displayName,
      credentialId: null,
      publicKey: null,
      stellarAddress: input.stellarAddress,
    };
    this.wallets.set(input.stellarAddress, record);
    return Promise.resolve(record);
  }
}

class FakeSessions implements SessionStore {
  rows = new Map<string, SessionRecord>();
  createdIpHashes: (string | null)[] = [];
  #next = 0;

  create(session: { userId: string; tokenHash: string; expiresAt: Date; createdIpHash: string | null }) {
    this.#next += 1;
    const record: SessionRecord = { id: `s${this.#next}`, userId: session.userId, expiresAt: session.expiresAt };
    this.rows.set(session.tokenHash, record);
    this.createdIpHashes.push(session.createdIpHash);
    return Promise.resolve(record);
  }

  findValid(tokenHash: string) {
    return Promise.resolve(this.rows.get(tokenHash));
  }

  deleteByTokenHash(tokenHash: string) {
    this.rows.delete(tokenHash);
    return Promise.resolve();
  }

  deleteAllForUser() {
    return Promise.resolve();
  }
}

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

function harness(): Harness {
  const users = new FakeUsers();
  const sessions = new FakeSessions();
  const challenges = new FakeChallenges();
  return {
    users,
    sessions,
    challenges,
    consume: challenges.consume,
    expectation: (): Expectation => {
      // A wallet ceremony has no origin and no rpIdHash to expect. If this is
      // ever reached, `loginWithWallet` has grown a WebAuthn code path.
      throw new Error('wallet sign-in must not build a WebAuthn expectation');
    },
  };
}

describe('the verifier accepts SEP-53 and refuses every other envelope', () => {
  it('accepts a genuine signature over the challenge', () => {
    const kp = Keypair.random();
    expect(() =>
      verifyWalletSignature({
        address: kp.publicKey(),
        challenge: CHALLENGE,
        signedMessage: signBase64(kp, CHALLENGE),
      }),
    ).not.toThrow();
  });

  it('refuses a signature made by a different key', () => {
    const signer = Keypair.random();
    const stranger = Keypair.random();
    expect(() =>
      verifyWalletSignature({
        address: stranger.publicKey(),
        challenge: CHALLENGE,
        signedMessage: signBase64(signer, CHALLENGE),
      }),
    ).toThrow(WalletAuthError);
  });

  it('refuses a signature over a different challenge', () => {
    // The replay this prevents: a signature the holder made for some other
    // purpose is not a signature for this login.
    const kp = Keypair.random();
    expect(() =>
      verifyWalletSignature({
        address: kp.publicKey(),
        challenge: CHALLENGE,
        signedMessage: signBase64(kp, 'a-different-challenge'),
      }),
    ).toThrow(/does not match/);
  });

  it('refuses the raw-UTF8 envelope, which the probe measured as NOT what Freighter uses', () => {
    // `sign` over the bare bytes, no SEP-53 prefix and no hash. The probe tried
    // this envelope explicitly and it failed there too. Pinned so that a future
    // "let's also accept…" has to argue with a test.
    const kp = Keypair.random();
    const raw = kp.sign(Buffer.from(CHALLENGE, 'utf8')).toString('base64');
    expect(() =>
      verifyWalletSignature({ address: kp.publicKey(), challenge: CHALLENGE, signedMessage: raw }),
    ).toThrow(WalletAuthError);
  });
});

describe('it refuses the v3 wallet by name rather than guessing at it', () => {
  const kp = Keypair.random();

  it('names a Buffer signature as a legacy wallet', () => {
    // Only v4 was measured. Decoding this and trying SEP-53 anyway would be
    // inventing a result for a version nobody ran.
    const legacy = { type: 'Buffer', data: [...kp.signMessage(CHALLENGE)] };
    try {
      decodeSignature(legacy);
      expect.unreachable('a serialised Buffer must not be accepted');
    } catch (error) {
      expect((error as WalletAuthError).reason).toBe('legacy_wallet');
    }
  });

  it('names a Uint8Array signature as a legacy wallet too', () => {
    try {
      decodeSignature(new Uint8Array(kp.signMessage(CHALLENGE)));
      expect.unreachable('a Uint8Array must not be accepted');
    } catch (error) {
      expect((error as WalletAuthError).reason).toBe('legacy_wallet');
    }
  });

  it('separates "not base64" from "wrong length"', () => {
    // Two different mistakes that a single "invalid signature" would blur.
    expect(() => decodeSignature('not base64!!')).toThrow(/not base64/);
    expect(() => decodeSignature(Buffer.alloc(32, 1).toString('base64'))).toThrow(/64 bytes/);
  });

  it('refuses an absent signature as a shape problem, not a mismatch', () => {
    for (const value of [null, undefined, '', 42]) {
      try {
        decodeSignature(value);
        expect.unreachable(`${String(value)} must not decode`);
      } catch (error) {
        expect((error as WalletAuthError).reason).toBe('bad_signature_shape');
      }
    }
  });
});

describe('an address is checked as an address', () => {
  it('accepts a real G address', () => {
    const kp = Keypair.random();
    expect(assertStellarAddress(kp.publicKey())).toBe(kp.publicKey());
  });

  it('refuses a contract address, which cannot sign anything', () => {
    // `C…` is a valid strkey and a completely different kind of thing. Refused
    // by name so it does not surface later as a signature that did not verify.
    expect(() => assertStellarAddress('CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ')).toThrow(
      /starts with G/,
    );
  });

  it('refuses a secret seed, loudly', () => {
    // The worst possible paste. It must never be treated as an identity.
    const kp = Keypair.random();
    expect(() => assertStellarAddress(kp.secret())).toThrow(WalletAuthError);
  });

  it('refuses a G address with a broken checksum', () => {
    const kp = Keypair.random();
    const corrupted = `${kp.publicKey().slice(0, -1)}${kp.publicKey().endsWith('A') ? 'B' : 'A'}`;
    expect(() => assertStellarAddress(corrupted)).toThrow(/not a valid Stellar address/);
  });
});

describe('the ceremony spends a challenge exactly once', () => {
  it('signs in, creates the user, and issues a session', async () => {
    const deps = harness();
    const kp = Keypair.random();
    deps.challenges.issue('wallet', CHALLENGE);

    const result = await loginWithWallet(deps, {
      address: kp.publicKey(),
      challenge: CHALLENGE,
      signedMessage: signBase64(kp, CHALLENGE),
    });

    expect(result.user.authMethod).toBe('wallet');
    expect(result.user.stellarAddress).toBe(kp.publicKey());
    // The token is never what the store holds — `session.ts`'s whole argument.
    expect(deps.sessions.rows.has(result.token)).toBe(false);
    expect(deps.sessions.rows.has(hashToken(result.token))).toBe(true);
  });

  it('refuses the same challenge a second time', async () => {
    const deps = harness();
    const kp = Keypair.random();
    deps.challenges.issue('wallet', CHALLENGE);
    const signedMessage = signBase64(kp, CHALLENGE);

    await loginWithWallet(deps, { address: kp.publicKey(), challenge: CHALLENGE, signedMessage });

    // The identical, valid signature replayed. It must not work twice.
    await expect(
      loginWithWallet(deps, { address: kp.publicKey(), challenge: CHALLENGE, signedMessage }),
    ).rejects.toThrow(WebAuthnError);
  });

  it('refuses a challenge minted for the passkey login', async () => {
    // Purpose is part of the key. A login challenge is not spendable here, and
    // the two verify against entirely different credentials.
    const deps = harness();
    const kp = Keypair.random();
    deps.challenges.issue('login', CHALLENGE);

    await expect(
      loginWithWallet(deps, {
        address: kp.publicKey(),
        challenge: CHALLENGE,
        signedMessage: signBase64(kp, CHALLENGE),
      }),
    ).rejects.toThrow(/not issued for this ceremony/);
  });

  it('returns the existing user on a second sign-in rather than a twin', async () => {
    const deps = harness();
    const kp = Keypair.random();

    deps.challenges.issue('wallet', CHALLENGE);
    const first = await loginWithWallet(deps, {
      address: kp.publicKey(),
      challenge: CHALLENGE,
      signedMessage: signBase64(kp, CHALLENGE),
    });

    // A fresh challenge, because the first was spent.
    deps.challenges.issue('wallet', 'second-challenge-value');
    const second = await loginWithWallet(deps, {
      address: kp.publicKey(),
      challenge: 'second-challenge-value',
      signedMessage: signBase64(kp, 'second-challenge-value'),
    });

    expect(second.user.id).toBe(first.user.id);
    expect(deps.users.wallets.size).toBe(1);
  });
});

describe('nothing is created before the signature is checked', () => {
  it('creates no user when the signature does not verify', async () => {
    const deps = harness();
    const signer = Keypair.random();
    const victim = Keypair.random();
    deps.challenges.issue('wallet', CHALLENGE);

    // Claiming to be `victim` while holding `signer`'s key. This is the attack
    // the whole ceremony exists to refuse: if a user were created before
    // verification, an address would be claimable by anyone who names it.
    await expect(
      loginWithWallet(deps, {
        address: victim.publicKey(),
        challenge: CHALLENGE,
        signedMessage: signBase64(signer, CHALLENGE),
      }),
    ).rejects.toThrow(WalletAuthError);

    expect(deps.users.created).toEqual([]);
    expect(deps.users.wallets.size).toBe(0);
    expect(deps.sessions.rows.size).toBe(0);
  });

  it('creates no user and spends no challenge when the address is malformed', async () => {
    // Validated before the challenge is spent, so a caller sending rubbish
    // does not burn a challenge and leave a working client stuck.
    const deps = harness();
    deps.challenges.issue('wallet', CHALLENGE);

    await expect(
      loginWithWallet(deps, { address: 'not-an-address', challenge: CHALLENGE, signedMessage: 'AAAA' }),
    ).rejects.toThrow(WalletAuthError);

    expect(deps.challenges.spent).toEqual([]);
    expect(deps.challenges.issued.has(`wallet:${CHALLENGE}`)).toBe(true);
    expect(deps.users.created).toEqual([]);
  });

  it('creates no user when the wallet is a legacy v3 one', async () => {
    const deps = harness();
    const kp = Keypair.random();
    deps.challenges.issue('wallet', CHALLENGE);

    await expect(
      loginWithWallet(deps, {
        address: kp.publicKey(),
        challenge: CHALLENGE,
        signedMessage: { type: 'Buffer', data: [...kp.signMessage(CHALLENGE)] },
      }),
    ).rejects.toThrow(/Update Freighter/);

    expect(deps.users.created).toEqual([]);
    expect(deps.sessions.rows.size).toBe(0);
  });

  it('records a hashed IP, never the address itself', async () => {
    const deps = harness();
    const kp = Keypair.random();
    deps.challenges.issue('wallet', CHALLENGE);

    await loginWithWallet(deps, {
      address: kp.publicKey(),
      challenge: CHALLENGE,
      signedMessage: signBase64(kp, CHALLENGE),
      ip: '203.0.113.9',
    });

    const [recorded] = deps.sessions.createdIpHashes;
    expect(recorded).not.toBe('203.0.113.9');
    expect(recorded).toMatch(/^[0-9a-f]{16}$/);
  });
});
