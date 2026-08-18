/**
 * What the cookie carries, what the store keeps, and the gap between them.
 *
 * The store is a fake, for the reason `session.ts` gives: `apps/web` reaches
 * Postgres over `neon-http`, which a local container cannot speak, so the
 * binding is kept thin and everything above it is proved here.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  clearedSessionCookieOptions,
  endSession,
  hashAddress,
  hashToken,
  issueSession,
  readSession,
  sessionCookieOptions,
  type SessionRecord,
  type SessionStore,
} from '../src/lib/session';

class FakeStore implements SessionStore {
  rows = new Map<string, { record: SessionRecord; tokenHash: string }>();
  #next = 0;

  create(session: { userId: string; tokenHash: string; expiresAt: Date; createdIpHash: string | null }) {
    this.#next += 1;
    const record: SessionRecord = { id: `s${this.#next}`, userId: session.userId, expiresAt: session.expiresAt };
    this.rows.set(session.tokenHash, { record, tokenHash: session.tokenHash });
    this.createdIpHashes.push(session.createdIpHash);
    return Promise.resolve(record);
  }

  createdIpHashes: (string | null)[] = [];

  findValid(tokenHash: string, now: Date) {
    const row = this.rows.get(tokenHash);
    if (row === undefined) return Promise.resolve(undefined);
    // Expiry is part of the lookup, not something the caller filters after.
    if (row.record.expiresAt.getTime() <= now.getTime()) return Promise.resolve(undefined);
    return Promise.resolve(row.record);
  }

  deleteByTokenHash(tokenHash: string) {
    this.rows.delete(tokenHash);
    return Promise.resolve();
  }

  deleteAllForUser(userId: string) {
    for (const [hash, row] of this.rows) if (row.record.userId === userId) this.rows.delete(hash);
    return Promise.resolve();
  }
}

describe('the token in the cookie is not the value in the database', () => {
  it('stores the hash and never the token', async () => {
    // The property N10 depends on: a database compromise must not hand over
    // the ability to act as any logged-in user.
    const store = new FakeStore();
    const { token } = await issueSession(store, { userId: 'u1' });

    const stored = [...store.rows.keys()];
    expect(stored).toHaveLength(1);
    expect(stored[0]).not.toBe(token);
    expect(stored[0]).toBe(createHash('sha256').update(token).digest('hex'));
  });

  it('cannot find a session from the stored value alone', async () => {
    // The compromise test, stated directly: holding everything in the table is
    // not enough to present a valid cookie.
    const store = new FakeStore();
    await issueSession(store, { userId: 'u1' });
    const storedHash = [...store.rows.keys()][0] ?? '';

    // An attacker with the row tries the only value it has.
    expect(await readSession(store, storedHash)).toBeUndefined();
  });

  it('issues a different token every time', async () => {
    const store = new FakeStore();
    const seen = new Set<string>();
    for (let i = 0; i < 25; i += 1) seen.add((await issueSession(store, { userId: 'u1' })).token);
    expect(seen.size).toBe(25);
  });

  it('issues at least 32 bytes of entropy', async () => {
    const store = new FakeStore();
    const { token } = await issueSession(store, { userId: 'u1' });
    expect(Buffer.from(token, 'base64url').length).toBe(32);
  });
});

describe('reading a session', () => {
  it('finds a live one from its token', async () => {
    const store = new FakeStore();
    const { token, record } = await issueSession(store, { userId: 'u1' });
    expect(await readSession(store, token)).toEqual(record);
  });

  it('does not find an expired one', async () => {
    // Filtered in the lookup rather than by the caller — a caller-side check is
    // one missing `if` away from a session that never ends.
    const store = new FakeStore();
    const { token } = await issueSession(store, { userId: 'u1', now: new Date(0) });
    const afterExpiry = new Date(SESSION_TTL_SECONDS * 1000 + 1);
    expect(await readSession(store, token, afterExpiry)).toBeUndefined();
  });

  it('finds one that has not quite expired', async () => {
    // The other side, so the case above is not passing because everything is
    // rejected.
    const store = new FakeStore();
    const { token } = await issueSession(store, { userId: 'u1', now: new Date(0) });
    expect(await readSession(store, token, new Date(SESSION_TTL_SECONDS * 1000 - 1))).toBeDefined();
  });

  it('returns nothing for a missing or empty cookie', async () => {
    const store = new FakeStore();
    expect(await readSession(store, undefined)).toBeUndefined();
    expect(await readSession(store, '')).toBeUndefined();
  });

  it('returns nothing for a token nobody issued', async () => {
    const store = new FakeStore();
    await issueSession(store, { userId: 'u1' });
    expect(await readSession(store, 'a-token-nobody-issued')).toBeUndefined();
  });
});

describe('ending a session', () => {
  it('takes effect immediately', async () => {
    // Revocation is what makes a thirty-day ceiling acceptable.
    const store = new FakeStore();
    const { token } = await issueSession(store, { userId: 'u1' });
    await endSession(store, token);
    expect(await readSession(store, token)).toBeUndefined();
  });

  it('does nothing, rather than throwing, for a cookie that is not there', async () => {
    const store = new FakeStore();
    await expect(endSession(store, undefined)).resolves.toBeUndefined();
  });
});

describe('the address hash', () => {
  it('is not the address', async () => {
    expect(hashAddress('203.0.113.7')).not.toContain('203');
  });

  it('is stable, so a change is detectable', () => {
    expect(hashAddress('203.0.113.7')).toBe(hashAddress('203.0.113.7'));
  });

  it('differs between addresses', () => {
    expect(hashAddress('203.0.113.7')).not.toBe(hashAddress('203.0.113.8'));
  });

  it('is truncated, so it names a set rather than one address', () => {
    // A full SHA-256 of an IPv4 address is trivially reversible — four billion
    // candidates is an afternoon. The truncation is what makes this answer
    // "did it change" without answering "where were they".
    expect(hashAddress('203.0.113.7')).toHaveLength(16);
  });

  it('is null when there is no address to hash', () => {
    expect(hashAddress('')).toBeNull();
  });

  it('is what gets recorded, never the address itself', async () => {
    const store = new FakeStore();
    await issueSession(store, { userId: 'u1', address: '203.0.113.7' });
    expect(store.createdIpHashes[0]).toBe(hashAddress('203.0.113.7'));
  });
});

describe('the cookie', () => {
  it('is httpOnly, so an XSS is a bug rather than a session handover', () => {
    expect(sessionCookieOptions(true).httpOnly).toBe(true);
  });

  it('is sameSite lax, which refuses the cross-site post without breaking deep links', () => {
    // `strict` would break following a link into the app, including §7.4's
    // Telegram deep link.
    expect(sessionCookieOptions(true).sameSite).toBe('lax');
  });

  it('is secure where the origin is HTTPS and not where it cannot be', () => {
    // Hard-coding it on means the cookie is silently dropped by `next dev` and
    // every local login appears to fail for no visible reason.
    expect(sessionCookieOptions(true).secure).toBe(true);
    expect(sessionCookieOptions(false).secure).toBe(false);
  });

  it('clears with the same attributes and a zero lifetime', () => {
    // A clear whose attributes differ from the set leaves the original cookie
    // in place, and the user stays logged in while being told they are not.
    const set = sessionCookieOptions(true);
    const cleared = clearedSessionCookieOptions(true);
    expect(cleared.maxAge).toBe(0);
    expect(cleared.path).toBe(set.path);
    expect(cleared.sameSite).toBe(set.sameSite);
    expect(cleared.httpOnly).toBe(set.httpOnly);
    expect(cleared.secure).toBe(set.secure);
  });

  it('has a name that says whose it is', () => {
    expect(SESSION_COOKIE).toBe('limen_session');
  });
});

describe('hashToken', () => {
  it('is SHA-256 hex, so the column is a fixed width and indexable', () => {
    expect(hashToken('x')).toMatch(/^[0-9a-f]{64}$/);
  });
});
