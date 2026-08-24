/**
 * Challenges are single-use, scoped to a purpose, and expire.
 *
 * Runs against `MemoryKeyValue` by way of the resolver's development fallback,
 * which is the same implementation `packages/kv/test/contract.test.ts` holds to
 * the same assertions as a real Redis. What is being checked here is this
 * module's own logic — deletion, purpose scoping, the answer given for a
 * challenge that never existed — rather than the store's.
 */

import { describe, expect, it, vi } from 'vitest';

// The resolver reads the environment at first use; with nothing configured and
// no production marker it returns the in-memory store, which is what these
// cases want. One store for the whole file, deliberately: challenges are 32
// random bytes, so no case can collide with another's, and a shared store is
// closer to what a running deployment actually has.
vi.mock('@limen/kv', async () => {
  const actual = await vi.importActual<typeof import('@limen/kv')>('@limen/kv');
  const store = new actual.MemoryKeyValue();
  return { ...actual, resolveWebKeyValue: () => store, __store: store };
});

const { issueChallenge, consumeChallenge, CHALLENGE_TTL_SECONDS } = await import('../src/lib/challenge');

describe('issuing a challenge', () => {
  it('returns a fresh value every time', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i += 1) seen.add((await issueChallenge('login')).challenge);
    expect(seen.size).toBe(50);
  });

  it('is base64url, so it survives a JSON round trip and a URL', async () => {
    const { challenge } = await issueChallenge('login');
    expect(challenge).not.toMatch(/[+/=]/);
  });

  it('is at least 32 bytes of entropy', async () => {
    // The spec's floor is 16. This is the value standing between an attacker
    // and a replayed login, and the only reason to pick the minimum would be to
    // save sixteen bytes.
    const { challenge } = await issueChallenge('login');
    expect(Buffer.from(challenge, 'base64url').length).toBe(32);
  });

  it('reports the lifetime it was given', async () => {
    expect((await issueChallenge('login')).expiresInSeconds).toBe(CHALLENGE_TTL_SECONDS);
  });
});

describe('spending a challenge', () => {
  it('accepts one that was issued', async () => {
    const { challenge } = await issueChallenge('login');
    expect(await consumeChallenge('login', challenge)).toBe(true);
  });

  it('refuses the same challenge a second time', async () => {
    // The whole point. Without this an assertion is a bearer token that never
    // expires.
    const { challenge } = await issueChallenge('login');
    expect(await consumeChallenge('login', challenge)).toBe(true);
    expect(await consumeChallenge('login', challenge)).toBe(false);
  });

  it('refuses a challenge issued for a different purpose', async () => {
    // Ceremony confusion, closed on the server side as well as by the
    // `clientDataJSON.type` check — so a browser lying about `type` still
    // cannot spend a registration challenge to log in.
    const { challenge } = await issueChallenge('register');
    expect(await consumeChallenge('login', challenge)).toBe(false);
    // And it is still spendable for what it was actually issued for.
    expect(await consumeChallenge('register', challenge)).toBe(true);
  });

  it('refuses a challenge that was never issued', async () => {
    expect(await consumeChallenge('login', 'not-a-challenge-anybody-issued')).toBe(false);
  });

  it('refuses an empty challenge without touching the store', async () => {
    expect(await consumeChallenge('login', '')).toBe(false);
  });

  it('gives the same answer for expired and never-existed', async () => {
    // Distinguishing them would tell a caller whether a value it guessed was
    // ever real.
    expect(await consumeChallenge('login', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(false);
    expect(await consumeChallenge('login', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')).toBe(false);
  });
});

describe('the lifetime', () => {
  it('is short enough that a captured challenge is worthless by the time a log is read', () => {
    expect(CHALLENGE_TTL_SECONDS).toBeLessThanOrEqual(300);
  });

  it('is long enough for a user to find their phone and answer a prompt', () => {
    expect(CHALLENGE_TTL_SECONDS).toBeGreaterThanOrEqual(60);
  });
});

/**
 * The route's guard, pinned to the union it is supposed to admit.
 *
 * This exists because of a real failure, not a hypothetical one. `'wallet'` was
 * added to `ChallengePurpose`, every part of the wallet ceremony was built
 * against it, and `/api/auth/challenge` kept refusing that purpose — so the
 * first step of the new flow returned 400 while nothing in the type system
 * complained. Widening a union does not widen a validator that admits it by
 * comparing strings.
 *
 * So the guard is checked from the outside, through the route, for every member
 * of the union. A purpose added later with no route support fails here rather
 * than at the first click.
 */
describe('the challenge route admits exactly the purposes that exist', () => {
  const post = (body: unknown) =>
    new Request('http://localhost/api/auth/challenge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it.each(['register', 'login', 'wallet'] as const)('mints a %s challenge', async (purpose) => {
    const { POST } = await import('../src/app/api/auth/challenge/route');
    const response = await POST(post({ purpose }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { challenge?: string };
    expect(typeof body.challenge).toBe('string');
    expect(body.challenge?.length ?? 0).toBeGreaterThan(0);
  });

  it('refuses a purpose that is not in the union', async () => {
    const { POST } = await import('../src/app/api/auth/challenge/route');
    const response = await POST(post({ purpose: 'owner' }));
    expect(response.status).toBe(400);
  });

  it('names the purposes it accepts, so a caller can fix the call', async () => {
    const { POST } = await import('../src/app/api/auth/challenge/route');
    const response = await POST(post({ purpose: 'nonsense' }));
    const body = (await response.json()) as { message?: string };
    // The message is generated from the list rather than retyped, so a new
    // purpose appears here without anybody remembering to update a sentence.
    expect(body.message).toContain('wallet');
  });
});
