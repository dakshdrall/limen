/**
 * What an error report is allowed to contain, and the browser half of sending
 * one.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE ALLOWLIST                                                            │
 * │                                                                          │
 * │ `REPORT_FIELDS` below is every field that may leave this browser.        │
 * │ `serializeReport` copies those keys and no others, so a property added   │
 * │ to an error object, attached by a library, or set on an event by the     │
 * │ platform is not omitted by a filter — it is never read.                  │
 * │                                                                          │
 * │ That is the whole argument for building this rather than installing an   │
 * │ SDK. A reporter that collects by default and subtracts in a `beforeSend`  │
 * │ hook makes "no user data" a rule enforced against one surface, while     │
 * │ breadcrumbs, request URLs and console capture go out by other paths.     │
 * │ Here a field nobody added cannot leak.                                   │
 * │                                                                          │
 * │ Every field is justified individually below, because the point of an     │
 * │ allowlist is that adding to it is a decision somebody has to defend.     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ## Which half of this catches what
 *
 * The two are not redundant and neither covers the other:
 *
 *   - **`app/error.tsx`** — the route error boundary. Catches a throw *during
 *     render* of a page or a nested layout, and replaces it with a screen. It
 *     reports with `kind: 'boundary'`.
 *   - **`instrumentation-client.ts`** — a window listener. Catches everything
 *     the boundary structurally cannot: a rejected promise with no handler, a
 *     throw in an event handler, and **recoverable errors**, which is the class
 *     the React #418 on `/app/accounts/new` belongs to. A hydration mismatch is
 *     recovered by React re-rendering on the client, so it never reaches an
 *     error boundary and never fails a page — React's default
 *     `onRecoverableError` calls `reportError()`, which dispatches an `error`
 *     event on `window`, and that listener is the only thing in a browser that
 *     sees it.
 *
 * The #418 sat on a live screen for a release because nothing was listening. It
 * would still sit there with only the boundary, which is why both were built.
 *
 * ## Safe on both sides of the wire
 *
 * The route handler imports the shape and the serializer; the browser imports
 * the sender as well. Nothing here touches `window` at module scope, so
 * importing it on the server is inert, and it imports only `redact.ts`, which
 * imports nothing.
 */

import { redact, redactPath } from '@/lib/redact';

/**
 * Where the failure was caught, which is the first thing a reader needs and the
 * one thing the error itself never says.
 *
 * A closed union rather than a free string: these are the three places this
 * application can catch anything, and a fourth would be a new listener somebody
 * had to write.
 */
export const REPORT_KINDS = ['boundary', 'window', 'rejection'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

/**
 * Every field that may leave the browser. The order is the order they are read
 * in.
 *
 *   - **`kind`** — which of the three catchers fired. See above.
 *   - **`message`** — the error's own words, redacted. `Minified React error
 *     #418` is this field, and is the entire reason the volume is worth a route.
 *   - **`stack`** — redacted and truncated. Minified in production, which is
 *     the honest cost of not running an SDK with source-map upload: what
 *     survives is the chunk name and a line, which narrows a search rather than
 *     ending it.
 *   - **`path`** — which screen. Rebuilt rather than merely redacted, because
 *     it is the one allowlisted field that carries an address by design; see
 *     `redactPath`.
 *   - **`digest`** — Next's hash of a *server* error, and the join key to the
 *     server log holding the unminified version. It is a hash of an error
 *     message, not of a person, and it identifies nobody — the exception the
 *     no-hashes rule is drawn around, stated here rather than left to be
 *     noticed.
 *   - **`at`** — an ISO timestamp from the browser's clock. Approximate and
 *     enough to order two reports.
 *   - **`userAgent`** — the field that decides whether a hydration mismatch is
 *     everyone's bug or one engine's, and the first thing anyone asks about a
 *     #418. Not an identifier on its own.
 *   - **`release`** — the short commit SHA, so a report names the build it came
 *     from. Seven characters: `git show` takes it, and it is well under the
 *     32-character floor the hex rule redacts at, so the value that would
 *     otherwise be destroyed by its own redactor survives by being the form a
 *     human uses anyway.
 *
 * ## What is deliberately absent
 *
 * No IP — the route never reads one into a report, though `clientIp` is right
 * there for the rate limit. No `localStorage`, which on this application is
 * where the account list and the local key live. No breadcrumbs, no console
 * capture, no DOM interaction trail, no session or device id: each is a thing
 * an SDK would collect by default and each would carry addresses off screens
 * whose URLs contain them. No viewport — it would be defensible and it is not
 * defended, and an allowlist is only worth having if the bar for a new field is
 * real.
 */
export const REPORT_FIELDS = [
  'kind',
  'message',
  'stack',
  'path',
  'digest',
  'at',
  'userAgent',
  'release',
] as const;

export type ReportField = (typeof REPORT_FIELDS)[number];

export interface ErrorReport {
  kind: ReportKind;
  message: string;
  stack?: string;
  path: string;
  digest?: string;
  at: string;
  userAgent?: string;
  release?: string;
}

/**
 * Per-field ceilings, applied after redaction.
 *
 * A cap is not a privacy control — the redactor is — but an uncapped `stack` is
 * how one runaway error turns a webhook into a denial of service against the
 * person who is meant to be reading it. `message` is generous because React's
 * are long and the useful part is not always at the front.
 */
const LIMITS: Record<ReportField, number> = {
  kind: 16,
  message: 1_000,
  stack: 2_000,
  path: 256,
  digest: 64,
  at: 32,
  userAgent: 256,
  release: 16,
};

/**
 * Copies the allowlisted keys out of a candidate, redacts every free-text one,
 * and drops everything else.
 *
 * This is the function the guarantee rests on, and it is written as a loop over
 * `REPORT_FIELDS` rather than as an object literal on purpose: an object
 * literal listing eight properties is a place where a ninth gets added in a
 * hurry, and it would not be visible as a change to the allowlist. Here the
 * allowlist is the only thing that decides.
 *
 * Run on both sides. The browser calls it before sending; the route calls it
 * again on what arrives, because a request body is attacker-controlled and the
 * server cannot check that the client redacted anything.
 */
export function serializeReport(candidate: Record<string, unknown>): ErrorReport | null {
  const out: Record<string, string> = {};

  for (const field of REPORT_FIELDS) {
    const value = candidate[field];
    if (typeof value !== 'string' || value.length === 0) continue;
    // `path` is rebuilt rather than redacted in place; see `redactPath`.
    const cleaned = field === 'path' ? redactPath(value) : redact(value);
    out[field] = cleaned.slice(0, LIMITS[field]);
  }

  // The two fields with no honest default. A report that cannot say what
  // happened or where is not a report, and inventing a placeholder for either
  // would put an unreadable line in front of whoever is on the other end.
  if (out.message === undefined || out.path === undefined) return null;
  if (!REPORT_KINDS.includes(out.kind as ReportKind)) return null;

  return out as unknown as ErrorReport;
}

/* --- the browser half ---------------------------------------------------- */

/**
 * The endpoint. A route on this origin rather than a third-party host, so the
 * webhook URL stays server-side and no report leaves the browser to anywhere
 * but here.
 */
export const REPORT_ENDPOINT = '/api/report';

/**
 * Reports per page load.
 *
 * An error inside a render can fire on every attempt, and a rejected promise in
 * a poll fires on every tick — `LedgerSource` polls the whole time the tab is
 * open. Without a cap the first bad deploy sends thousands of identical lines
 * to the person who has already read the first one and cannot act any faster
 * for having the rest.
 *
 * Five rather than one, because a page usually has more than one thing wrong
 * with it and the second failure is often the one that explains the first.
 */
const MAX_PER_PAGE = 5;

let sent = 0;
/** Identical failures collapse: same kind, same message, same screen. */
const seen = new Set<string>();

/**
 * A client-side navigation is a new page for the budget's purposes.
 *
 * Without this the cap is per *document*, and this application is a single
 * document for as long as the tab is open — five reports into a session it
 * would go permanently silent, including for the screen the reviewer navigates
 * to next. `instrumentation-client.ts` calls this from
 * `onRouterTransitionStart`.
 *
 * The count resets and `seen` deliberately does not. The cap is there to bound
 * a loop, and a loop is per screen; the dedup is there so nobody reads the same
 * line twice, and that is true for as long as the tab is open.
 */
export function startNewPage(): void {
  sent = 0;
}

/** Test seam. Both counters are module state, and a test needs them at zero. */
export function resetReportBudget(): void {
  sent = 0;
  seen.clear();
}

/**
 * Reduces anything throwable to a message and a stack.
 *
 * `unknown` because that is what a `catch`, a rejection and an `ErrorEvent` all
 * genuinely hand you: code throws strings, and `Promise.reject()` with no
 * argument produces `undefined`. A reporter that assumes `Error` reports
 * `undefined is not an object` about its own input.
 */
function describe(thrown: unknown): { message: string; stack?: string; digest?: string } {
  if (thrown instanceof Error) {
    const digest = (thrown as Error & { digest?: unknown }).digest;
    return {
      message: thrown.message.length > 0 ? thrown.message : thrown.name,
      stack: thrown.stack,
      digest: typeof digest === 'string' ? digest : undefined,
    };
  }
  if (typeof thrown === 'string' && thrown.length > 0) return { message: thrown };
  return { message: `a non-Error value was thrown (${typeof thrown})` };
}

/**
 * Builds a report from something thrown, and posts it.
 *
 * Silent on every failure path, deliberately and in both directions: a reporter
 * that throws turns a recovered error into an unrecovered one, and a reporter
 * that logs its own failure fills the console a developer is trying to read
 * with noise about the thing watching the console. If the route is unreachable
 * the report is lost, which is the correct trade — the page keeps working.
 *
 * `keepalive` so a report survives the navigation that a failed screen usually
 * prompts. `sendBeacon` would also survive it and cannot set a content type
 * without a `Blob`, so the route would have to accept `text/plain` to hear
 * from it; `fetch` states what it is sending.
 */
export function sendReport(kind: ReportKind, thrown: unknown): void {
  try {
    if (typeof window === 'undefined') return;
    if (sent >= MAX_PER_PAGE) return;

    const { message, stack, digest } = describe(thrown);

    const report = serializeReport({
      kind,
      message,
      stack,
      path: window.location.pathname,
      digest,
      at: new Date().toISOString(),
      userAgent: window.navigator.userAgent,
      release: process.env.NEXT_PUBLIC_LIMEN_RELEASE,
    });
    if (report === null) return;

    // Deduped on the redacted report rather than on the raw error, so two
    // failures that differ only in an address collapse into one line. That is
    // the right behaviour and it is also forced: after redaction they are the
    // same report, and sending both would send the same text twice.
    const signature = `${report.kind}:${report.path}:${report.message}`;
    if (seen.has(signature)) return;
    seen.add(signature);
    sent += 1;

    void fetch(REPORT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // See above. A failure to report is never itself reported.
  }
}
