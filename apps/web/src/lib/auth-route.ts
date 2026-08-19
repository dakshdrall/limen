/**
 * What the five auth routes share: decoding, wiring, the cookie, and the map
 * from a refusal to a status code.
 *
 * It is one module rather than four copies because the interesting property of
 * these routes is that they are *identical* apart from which ceremony they run.
 * A helper each would drift, and the first thing to drift would be the error
 * mapping — which is the part where a difference between two routes is a signal
 * an attacker can read.
 */

import 'server-only';
import { cookies } from 'next/headers';
import { consumeChallenge } from './challenge';
import { drizzleSessionStore, drizzleUserStore } from './stores';
import { expectationFor } from './webauthn-config';
import { base64UrlToBytes, WebAuthnError } from './webauthn';
import { clearedSessionCookieOptions, sessionCookieOptions, SESSION_COOKIE } from './session';
import type { AuthDeps } from './auth';

/**
 * A registration response is a few hundred bytes and an assertion is smaller.
 *
 * Eight kilobytes is an order of magnitude of headroom over anything an
 * authenticator emits, and the point of the cap is that a body which is not one
 * of those is refused before it is decoded rather than after.
 */
export const MAX_BODY = 8_192;

/** Per-field caps, so one oversized field cannot use the whole body budget. */
const FIELD_LIMITS: Record<string, number> = {
  clientDataJSON: 4_096,
  attestationObject: 6_144,
  authenticatorData: 1_024,
  signature: 512,
  // WebAuthn bounds a credential id at 1023 bytes; base64url of that is 1364.
  credentialId: 1_400,
};

export function authDeps(): AuthDeps {
  return {
    users: drizzleUserStore(),
    sessions: drizzleSessionStore(),
    consume: consumeChallenge,
    expectation: expectationFor,
  };
}

/**
 * Whether the cookie may carry `secure`.
 *
 * `x-forwarded-proto` first, because on Vercel the function is reached over
 * HTTP behind a proxy that terminated TLS, and `request.url`'s scheme there
 * describes the last hop rather than the browser's. Falling back to the URL
 * covers `next start` on a machine with no proxy.
 *
 * The failure mode this avoids is the quiet one: `secure` hard-coded on means
 * the browser silently drops the cookie in `next dev`, and every local login
 * appears to succeed and then not be logged in. `session.ts` records the same
 * reasoning where the option is defined.
 */
export function isSecureRequest(request: Request): boolean {
  const forwarded = request.headers.get('x-forwarded-proto');
  if (forwarded !== null && forwarded.length > 0) return forwarded.split(',')[0]?.trim() === 'https';
  try {
    return new URL(request.url).protocol === 'https:';
  } catch {
    return false;
  }
}

export class BadRequest extends Error {}

/** The body, as JSON, refused before it is parsed if it is not the right size. */
export async function readBody(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (raw.length > MAX_BODY) throw new BadRequest('The request body is larger than any WebAuthn response.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BadRequest('The request body is not JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new BadRequest('The request body is not an object.');
  }
  return parsed as Record<string, unknown>;
}

/**
 * One base64url field, decoded to bytes.
 *
 * The alphabet is checked rather than inferred, because `base64UrlToBytes` is
 * built on `Buffer.from(…, 'base64')`, which ignores characters it does not
 * recognise. Without this, `"!!!!"` decodes to an empty array and the error
 * surfaces much later as "the credential id is empty".
 */
export function decodeField(body: Record<string, unknown>, name: string): Uint8Array {
  const value = body[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new BadRequest(`'${name}' is missing.`);
  }
  const limit = FIELD_LIMITS[name] ?? MAX_BODY;
  if (value.length > limit) throw new BadRequest(`'${name}' is longer than ${limit} characters.`);
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new BadRequest(`'${name}' is not base64url.`);
  return base64UrlToBytes(value);
}

export function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function setSessionCookie(token: string, secure: boolean): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions(secure));
}

export async function clearSessionCookie(secure: boolean): Promise<void> {
  // Set to empty with a zero lifetime rather than deleted, so the attributes
  // match the cookie being replaced. A `delete` that disagrees about `path` or
  // `secure` leaves the original in place, which reads as a logout that did
  // nothing.
  (await cookies()).set(SESSION_COOKIE, '', clearedSessionCookieOptions(secure));
}

export async function sessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

/**
 * A refusal, as a status and a body.
 *
 * Two rules, both deliberate:
 *
 * **Every ceremony failure is 401.** Not 400 for a malformed attestation object
 * and 401 for a bad signature — one status for all of them. The distinction is
 * defensible in the abstract and useless here, and a status code that varies
 * with which check fired is a free oracle for anybody probing the endpoint. A
 * body that is not a WebAuthn response at all still gets 400, because that is
 * decided before any ceremony begins.
 *
 * **The reason travels, the fact of the failure does not vary.** `reason` is in
 * the body so a support conversation can be about a code rather than a
 * screenshot, and because it is what the browser needs to tell a person whether
 * to try again or to log in instead. It says nothing an attacker cannot already
 * determine by construction: the one question worth hiding — whether a given
 * credential is registered here — is answered identically either way, because
 * `loginWithPasskey` returns `login_failed` for both an unknown credential and
 * a bad signature.
 */
export function failure(error: unknown): Response {
  if (error instanceof BadRequest) {
    return Response.json({ error: 'bad_request', message: error.message }, { status: 400 });
  }
  if (error instanceof WebAuthnError) {
    const status = error.reason === 'credential_registered' ? 409 : 401;
    return Response.json({ error: error.reason, message: error.message }, { status });
  }
  // Anything else is a bug or an outage — a database that will not answer, a
  // Redis that is gone. It is logged here because the alternative is a 500 with
  // no trace of what produced it, and it is not returned, because the text of
  // an unexpected error is the one place a connection string can turn up.
  console.error('limen auth: unexpected failure', error);
  return Response.json({ error: 'unavailable' }, { status: 503 });
}
