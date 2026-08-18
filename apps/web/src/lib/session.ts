/**
 * Sessions: what the cookie carries, what the database keeps, and why they are
 * not the same value.
 *
 * The cookie carries a 32-byte random token. The database stores **SHA-256 of
 * that token** and never the token itself, which is the whole reason
 * `sessions.token_hash` exists rather than the cookie carrying `sessions.id`.
 *
 * ## Why that distinction is load-bearing here specifically
 *
 * N10 in §VIII is the row this project's threat table calls *"the whole
 * argument"*: an operator or an attacker with the database cannot widen an
 * agent's authority, because the database is not the boundary — the gate
 * re-reads the rule from the chain, and the chain enforces. That claim survives
 * a database compromise on purpose.
 *
 * A session table holding live bearer tokens would not break it, but it would
 * quietly narrow it. The same attacker could act as any logged-in user
 * everywhere the chain is *not* the boundary, which is most of the product's
 * surface. Storing a hash costs nothing — the server only ever needs to
 * *recognise* a token, never to reproduce one — so there is no trade here, only
 * a design that was available and a design that was not taken.
 *
 * ## Lookup is by hash, and that is also the index
 *
 * A session is found by hashing the presented token and looking up that value,
 * which is a unique-index hit rather than a scan. Storing a hash therefore
 * costs one SHA-256 per request and nothing else. `sessions_token_hash_key` is
 * unique because two rows with the same hash would be a token collision, and a
 * collision should be a constraint violation rather than an ambiguous lookup
 * that silently picks one.
 *
 * No HMAC and no salt, deliberately. Those defend against an attacker who can
 * *guess* the input, and the input here is 32 bytes from a CSPRNG — there is no
 * dictionary of session tokens to precompute. A salt would also break the
 * unique index and the single-lookup property, which is a real cost for no
 * gain.
 *
 * ## Expiry is checked in the query, not after it
 *
 * A row that has expired must not be returned and then discarded by the caller,
 * because that is one `if` away from a session that never ends. `findValid`
 * takes the clock and filters on it, so the only thing a caller can get back is
 * a live session.
 */

import 'server-only';
import { createHash, randomBytes } from 'node:crypto';

/**
 * Thirty days.
 *
 * A permissions tool people check occasionally rather than live in, so a short
 * session means re-authenticating to answer *"is my agent still limited"* —
 * which is the question the product exists to make cheap to ask. The passkey
 * makes re-authentication easy rather than free, and a login that feels like a
 * toll gets answered by not asking.
 *
 * It is a ceiling and not a promise: revocation is immediate, because the
 * session is a row and deleting it takes effect on the next request.
 */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export const SESSION_COOKIE = 'limen_session';

/** 32 bytes, the same size and for the same reason as a login challenge. */
const TOKEN_BYTES = 32;

export interface SessionRecord {
  id: string;
  userId: string;
  expiresAt: Date;
}

/**
 * What a session needs from storage, and nothing else.
 *
 * An interface rather than a direct `@limen/db` call for a reason §7.5.2
 * forces: `apps/web` reaches Postgres over `neon-http`, which speaks Neon's
 * HTTP protocol, so a local Postgres container **cannot** exercise that path at
 * all. Every other property in this file is provable against a fake; the
 * binding to Drizzle is thin by design so that the untestable part is as small
 * as it can be. Recorded in PLAN-V8 §7.5 alongside the `neon-http` transaction
 * measurement, which is unrun for the same reason.
 */
export interface SessionStore {
  create(session: { userId: string; tokenHash: string; expiresAt: Date; createdIpHash: string | null }): Promise<SessionRecord>;
  findValid(tokenHash: string, now: Date): Promise<SessionRecord | undefined>;
  deleteByTokenHash(tokenHash: string): Promise<void>;
  deleteAllForUser(userId: string): Promise<void>;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Hash an address the same way, so a session can answer "did this move
 * continent" without the table being able to answer "where was this person".
 *
 * Truncated to 16 hex characters. A full hash of an IPv4 address is trivially
 * reversible — there are only four billion of them, and a rainbow table is an
 * afternoon — so the length here is doing the work that a salt would otherwise
 * do, by making collisions common enough that a hash names a *set* of addresses
 * rather than one. That is precisely the resolution the stated purpose needs:
 * enough to notice a change, not enough to locate anybody.
 */
export function hashAddress(address: string): string | null {
  if (address.length === 0) return null;
  return createHash('sha256').update(address).digest('hex').slice(0, 16);
}

export interface IssuedSession {
  token: string;
  record: SessionRecord;
}

export async function issueSession(
  store: SessionStore,
  { userId, address, now = new Date() }: { userId: string; address?: string; now?: Date },
): Promise<IssuedSession> {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const record = await store.create({
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + SESSION_TTL_SECONDS * 1000),
    createdIpHash: address === undefined ? null : hashAddress(address),
  });
  // The token is returned exactly once, to be put in a cookie. Nothing stores
  // it, and there is no path that can retrieve it again.
  return { token, record };
}

/** The live session this token names, or nothing. Never an expired one. */
export async function readSession(
  store: SessionStore,
  token: string | undefined,
  now: Date = new Date(),
): Promise<SessionRecord | undefined> {
  if (token === undefined || token.length === 0) return undefined;
  return await store.findValid(hashToken(token), now);
}

export async function endSession(store: SessionStore, token: string | undefined): Promise<void> {
  if (token === undefined || token.length === 0) return;
  await store.deleteByTokenHash(hashToken(token));
}

/**
 * The cookie, and each attribute's reason.
 *
 * - `httpOnly` — script cannot read it, so an XSS becomes a bug rather than a
 *   session handover.
 * - `sameSite: 'lax'` — the cookie is not sent on cross-site POSTs, which is
 *   CSRF protection that does not depend on a token being remembered. `strict`
 *   would break following a link into the app from anywhere, including the
 *   Telegram deep link §7.4 depends on, and `lax` is what makes that work
 *   while still refusing the cross-site form post that matters.
 * - `secure` — off only where the origin is not HTTPS, which is `next dev`.
 *   Hard-coding it on would mean the cookie is silently dropped in development
 *   and every local login appears to fail for no visible reason.
 * - `path: '/'` — one session for the app, not one per route prefix.
 */
export function sessionCookieOptions(secure: boolean): {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: '/';
  maxAge: number;
} {
  return { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: SESSION_TTL_SECONDS };
}

/** Clearing is the same cookie with a zero lifetime, so attributes still match. */
export function clearedSessionCookieOptions(secure: boolean): ReturnType<typeof sessionCookieOptions> {
  return { ...sessionCookieOptions(secure), maxAge: 0 };
}
