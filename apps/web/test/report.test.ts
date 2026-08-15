/**
 * The scrub, pinned — the way the bundle fences are pinned.
 *
 * The claim this file exists to keep true is one sentence: **no error report
 * carries an address, a hash tied to a person, or key material.** That claim is
 * worth exactly as much as its test, and the model for the test is
 * `.github/workflows/ci.yml` rather than anything else in this suite.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ TWO-SIDED, LIKE THE BUNDLE FENCES                                        │
 * │                                                                          │
 * │ CI greps the server bundle for the demo signer's sentinel *before* it     │
 * │ greps the client bundle for its absence, because a check that can never   │
 * │ match passes forever while proving nothing. The same failure is available │
 * │ here and is cheaper to fall into: a redactor tested against values that   │
 * │ were never the right shape removes nothing and reports success.           │
 * │                                                                          │
 * │ So every removal case first asserts that the fixture is the shape it      │
 * │ claims to be — that a `G…` is 56 base32 characters, that a hash is 64 hex │
 * │ — and only then asserts that the redactor took it out. If a pattern is    │
 * │ broken by an edit, these go red rather than green-and-vacuous.            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The other half is the opposite risk, and it has no analogue in CI because a
 * bundle fence cannot over-fire: a redactor that removes everything is
 * trivially correct and useless. `keeps what the report is for` pins the values
 * that must survive, and `Minified React error #418` is first among them
 * because it is the string that started all of this.
 *
 * ## What is not tested here
 *
 * `sendReport` and the window listeners. Both need a browser, this suite is
 * `environment: 'node'`, and the parts of them worth pinning — which fields,
 * redacted how — are `serializeReport`, which is tested exhaustively below. The
 * browser half is exercised end to end by the console fallback in
 * `api/report/route.ts`: a `next dev` or a Playwright run with no webhook
 * configured logs the report it would have sent.
 */

import { describe, expect, it } from 'vitest';
import { REDACTED, redact, redactPath } from '@/lib/redact';
import { REPORT_FIELDS, REPORT_KINDS, serializeReport } from '@/lib/report';

/**
 * Structurally real, deliberately not usable — the same construction the CI
 * StrKey canary uses, and for the same reason. These exist to fire a pattern.
 *
 * A `S…` seed is among them. `local-key.ts` has no export path and CI greps the
 * client bundle for a 56-character `S…`, so one should be unable to reach a
 * string in the browser at all; it is here because this is the last thing a
 * value passes before leaving, and a fence that assumes the fences upstream
 * held is not a fence.
 */
const FIXTURES = {
  account: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  contract: 'CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
  muxed: 'MCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
  seed: 'SDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
  /** A transaction hash. 64 hex. */
  hash: '3f1a9c02e7b48d5a6c0f21837be9d4a05c17e3f8b26094ad7152cbe08f3d64a1',
  /** A passkey's public key, as `toHex` emits it. Same shape, different meaning. */
  publicKeyHex: 'a17c3e95b02d48f6112a7c0e93b5d8407fe62c1938ab04d5e7c31629b8fa50d3',
  email: 'reviewer@example.com',
} as const;

describe('the fixtures are the shapes they claim to be', () => {
  /**
   * The vacuity check, first, exactly as CI does it. Everything below is only
   * meaningful if these hold.
   */
  it('are StrKeys, a hash, a key and an address', () => {
    expect(FIXTURES.account).toMatch(/^G[A-Z2-7]{55}$/);
    expect(FIXTURES.contract).toMatch(/^C[A-Z2-7]{55}$/);
    expect(FIXTURES.muxed).toMatch(/^M[A-Z2-7]{68}$/);
    expect(FIXTURES.seed).toMatch(/^S[A-Z2-7]{55}$/);
    expect(FIXTURES.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(FIXTURES.publicKeyHex).toMatch(/^[0-9a-f]{64}$/);
    expect(FIXTURES.email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/);
  });
});

describe('the redactor removes what must never be reported', () => {
  const cases: [string, string, string][] = [
    ['an account address', FIXTURES.account, REDACTED.address],
    ['a contract address', FIXTURES.contract, REDACTED.address],
    ['a muxed address', FIXTURES.muxed, REDACTED.address],
    ['a secret seed', FIXTURES.seed, REDACTED.address],
    ['a transaction hash', FIXTURES.hash, REDACTED.key],
    ['a raw public key in hex', FIXTURES.publicKeyHex, REDACTED.key],
    ['an email address', FIXTURES.email, REDACTED.email],
  ];

  for (const [what, value, placeholder] of cases) {
    it(`takes out ${what}, and says something was there`, () => {
      const out = redact(`the read failed for ${value} on ledger 1284471`);
      expect(out, `${what} survived redaction`).not.toContain(value);
      expect(out, `${what} was removed without leaving a marker`).toContain(placeholder);
    });
  }

  it('takes them out of every position a value actually arrives in', () => {
    // A message, a URL inside a message, a JSON body quoted into an error, and
    // a stack frame. All four are real shapes from this application's own
    // failures, and three of them put the value against a delimiter rather than
    // a space — which is the case a `\s`-anchored pattern would miss.
    const shapes = [
      `Error: no rule 1 on ${FIXTURES.contract}`,
      `GET https://horizon-testnet.stellar.org/accounts/${FIXTURES.account} 404`,
      `{"contractId":"${FIXTURES.contract}","hash":"${FIXTURES.hash}"}`,
      `    at readAccount (/app/accounts/${FIXTURES.contract}:1:1)`,
      `(${FIXTURES.account})`,
      `[${FIXTURES.hash}]`,
    ];
    for (const shape of shapes) {
      const out = redact(shape);
      for (const value of Object.values(FIXTURES)) {
        expect(out, `a value survived in: ${shape}`).not.toContain(value);
      }
    }
  });

  it('takes out every value when several share one string', () => {
    const out = redact(
      `install failed: account ${FIXTURES.account} policy ${FIXTURES.contract} tx ${FIXTURES.hash}`,
    );
    for (const value of Object.values(FIXTURES)) expect(out).not.toContain(value);
  });

  it('still finishes on a stack the size a render loop produces', () => {
    // The case that caught a real defect. The email pattern was written with
    // unbounded `+` quantifiers, which is quadratic on a subject with no `@` in
    // it: 20,000 characters took 492ms and this one never finished.
    //
    // It matters because the caps in `report.ts` are applied *after* redaction
    // — truncating first could cut an address in half and leave an identifying
    // prefix — so the redactor is the thing that sees the whole 50,000
    // characters. The address is at the end so a pattern that gave up early
    // would fail this rather than pass it quickly.
    const huge = `${'x'.repeat(50_000)} ${FIXTURES.contract}`;
    const out = redact(huge);
    expect(out).not.toContain(FIXTURES.contract);
    expect(out).toContain(REDACTED.address);
  });

  it('is safe to run twice, which is what actually happens', () => {
    // The browser redacts before sending and the route redacts again on
    // arrival. If the second pass changed anything, the report a reader sees
    // would not be the report the first pass produced.
    const once = redact(`read ${FIXTURES.contract} at ${FIXTURES.hash}`);
    expect(redact(once)).toBe(once);
  });
});

describe('the redactor keeps what the report is for', () => {
  /**
   * The other half of the two-sided rule. A redactor that removed these would
   * pass every case above and be worth nothing — the report would arrive
   * saying that something happened somewhere.
   */
  const mustSurvive = [
    // The string this whole mechanism was built for.
    'Minified React error #418; visit https://react.dev/errors/418 for the full message',
    // A chunk hash is 8 hex characters and is how you find the file. The hex
    // rule starts at 32, deliberately clear of it.
    'at PasskeyOwnerControl (/_next/static/chunks/page-8a2f3c9d.js:1:2345)',
    // Numbers a reader needs: a ledger sequence, a status, a line and column.
    'read failed on ledger 1284471 (HTTP 503) at line 42:11',
    // Names. A stack with its identifiers removed is not a stack.
    'TypeError: Cannot read properties of undefined (reading "contextRules")',
    // Our own placeholders, so a second pass does not eat the first pass.
    `boundary on /app/accounts/${REDACTED.address}`,
  ];

  for (const line of mustSurvive) {
    it(`leaves "${line.slice(0, 44)}…" intact`, () => {
      expect(redact(line)).toBe(line);
    });
  }

  it('does not treat a 31-character hex run as a key, or a 32 as anything else', () => {
    // The floor, from both sides. Pinned because it is the one number in
    // `redact.ts` that is a judgement rather than a shape, and an edit that
    // moved it to 8 would silently start eating chunk hashes.
    const thirtyOne = 'a'.repeat(31);
    const thirtyTwo = 'a'.repeat(32);
    expect(redact(`chunk ${thirtyOne}`)).toContain(thirtyOne);
    expect(redact(`key ${thirtyTwo}`)).not.toContain(thirtyTwo);
  });
});

describe('the path is rebuilt, not merely scrubbed', () => {
  /**
   * The path is the one allowlisted field that carries an address by design.
   * `/app/accounts/C…` and `/app/policies/C…-1` are the two screens most likely
   * to be open when something breaks, which makes this the most load-bearing
   * function in the module.
   */
  it('replaces an address in a segment and leaves the route readable', () => {
    expect(redactPath(`/app/accounts/${FIXTURES.contract}`)).toBe('/app/accounts/[address]');
  });

  it('handles the policy id, which is an address and a rule number joined', () => {
    // The rule number must survive: it is per-account and identifies nobody.
    expect(redactPath(`/app/policies/${FIXTURES.contract}-1`)).toBe('/app/policies/[address]-1');
  });

  it('drops the query string entirely rather than redacting it', () => {
    // Dropping is the only treatment that is correct for a parameter nobody has
    // thought of yet. Redacting a query would carry every future parameter
    // name, and one of them will eventually hold a value no rule here matches.
    expect(redactPath(`/app/activity?account=${FIXTURES.account}&raw=${FIXTURES.seed}`)).toBe(
      '/app/activity',
    );
  });

  it('drops the fragment', () => {
    expect(redactPath('/docs/authorization#__check_auth')).toBe('/docs/authorization');
  });

  it('drops the origin, so a preview hostname is not carried along', () => {
    expect(redactPath(`https://limen-abc123.vercel.app/app/accounts/${FIXTURES.contract}`)).toBe(
      '/app/accounts/[address]',
    );
  });

  it('reports the shape and nothing else when it cannot parse', () => {
    // A protocol-relative URL with no host is the reachable case: with a base
    // supplied almost nothing throws, and `%%%` parses to `/%%%`. This branch
    // is reachable because the route handler is public and is handed whatever a
    // request body contained.
    for (const hostile of ['//', '////', 'http://']) {
      expect(redactPath(hostile), `${hostile} should not have parsed`).toBe('[unparseable]');
    }
    // …and the near-miss that does parse still goes through the redactor rather
    // than through this branch, so the case above is not quietly catching both.
    expect(redactPath('%%%')).toBe('/%%%');
  });
});

describe('the allowlist is the guarantee', () => {
  /**
   * `a field nobody added cannot leak` is the property the whole design rests
   * on, and this is where it is checked. Every case below is about
   * `serializeReport` reading only `REPORT_FIELDS` — never about it filtering
   * something out, because it never sees anything to filter.
   */

  const valid = { kind: 'boundary', message: 'it broke', path: '/app/accounts' };

  it('pins the field list, so widening it is a deliberate edit', () => {
    // The same argument as `SIGNER_SENTINEL`: if this list changes, the change
    // must be made here too, in front of someone reading this file's docstring.
    expect(REPORT_FIELDS).toEqual([
      'kind',
      'message',
      'stack',
      'path',
      'digest',
      'at',
      'userAgent',
      'release',
    ]);
    expect(REPORT_KINDS).toEqual(['boundary', 'window', 'rejection']);
  });

  it('drops a field nobody put on the allowlist', () => {
    const out = serializeReport({
      ...valid,
      // Every one of these is something a reporting SDK collects by default,
      // and every one of them would carry user data off this application.
      ip: '203.0.113.7',
      cookies: 'session=abc',
      localStorage: JSON.stringify({ 'limen.keys.v1': FIXTURES.seed }),
      breadcrumbs: [`/app/accounts/${FIXTURES.contract}`],
      user: { id: FIXTURES.account },
      deviceId: FIXTURES.hash,
    });

    expect(out).not.toBeNull();
    expect(Object.keys(out ?? {}).sort()).toEqual(['kind', 'message', 'path']);
    // Stated as a property of the serialized output as well, so the case reads
    // as "none of it left" rather than as "the keys I remembered to check".
    const wire = JSON.stringify(out);
    for (const value of Object.values(FIXTURES)) expect(wire).not.toContain(value);
    expect(wire).not.toContain('203.0.113.7');
  });

  it('redacts a body that arrives already carrying an address', () => {
    // The route calls this on an unauthenticated request body. The client
    // redacts first, and the server cannot check that it did.
    const out = serializeReport({
      kind: 'window',
      message: `hydration failed while reading ${FIXTURES.contract}`,
      path: `/app/accounts/${FIXTURES.contract}`,
      stack: `at read (${FIXTURES.hash})`,
    });
    const wire = JSON.stringify(out);
    for (const value of Object.values(FIXTURES)) expect(wire).not.toContain(value);
    expect(out?.path).toBe('/app/accounts/[address]');
  });

  it('ignores a field that is on the list but is not a string', () => {
    // A nested object under an allowlisted name is the way an allowlist gets
    // walked around: `message: { toString: … }` or `path: ['..']`.
    const out = serializeReport({
      ...valid,
      stack: { frames: [FIXTURES.contract] },
      userAgent: 42,
      release: null,
    });
    expect(Object.keys(out ?? {}).sort()).toEqual(['kind', 'message', 'path']);
  });

  it('refuses a report that cannot say what happened or where', () => {
    expect(serializeReport({ kind: 'boundary', path: '/x' })).toBeNull();
    expect(serializeReport({ kind: 'boundary', message: 'it broke' })).toBeNull();
    expect(serializeReport({ message: 'it broke', path: '/x' })).toBeNull();
    expect(serializeReport({})).toBeNull();
  });

  it('refuses a kind outside the closed set', () => {
    expect(serializeReport({ ...valid, kind: 'exfiltrate' })).toBeNull();
  });

  it('caps every field, so one runaway error cannot flood the channel', () => {
    const out = serializeReport({ ...valid, message: 'x'.repeat(50_000), stack: 'y'.repeat(50_000) });
    expect(out?.message.length).toBe(1_000);
    expect(out?.stack?.length).toBe(2_000);
  });

  it('produces the same report the second time, which is what the route does', () => {
    const once = serializeReport({
      kind: 'window',
      message: `failed for ${FIXTURES.account}`,
      path: `/app/accounts/${FIXTURES.contract}`,
      at: '2026-08-15T12:00:00.000Z',
    });
    expect(once).not.toBeNull();
    expect(serializeReport({ ...once })).toEqual(once);
  });
});
