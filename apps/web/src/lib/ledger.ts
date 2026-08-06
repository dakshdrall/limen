/**
 * The three readings, as arithmetic.
 *
 * PLAN-V4 §8 states the rule these exist to satisfy, and states it as a test
 * rather than as an intention: *each of the three is a pure function of a ledger
 * sequence passed in as a prop, and renders its static state when that value is
 * `null`.* The enforceable form of "if the network went down and the motion
 * continued, it was decoration".
 *
 * So the arithmetic lives here, with no React, no clock, and no network. A
 * frozen sequence produces no change because the same input produces the same
 * output; a `null` sequence produces no motion because every function below
 * returns its static answer for it. Both are assertions a unit test can make
 * without rendering a pixel, which is the point — a motion system that can only
 * be checked by watching it is one nobody checks.
 *
 * There is no `Date.now()` in this file and there must never be one. The moment
 * a reading interpolates against wall-clock time it is animating on its own
 * authority, and it would keep animating with the RPC unreachable — which is
 * precisely the failure §8 forbids.
 */

/**
 * The ledger sequence in a `getHealth` reply, or `null` if there is not one.
 *
 * Parsing lives here, with the arithmetic, rather than inside the hook that
 * does the fetching — so it can be tested against real recorded replies without
 * a network, a DOM, or a testing library. The hook is then only scheduling and
 * `fetch`, which is the part a source scan can honestly cover.
 *
 * `null` for every unhappy shape, and deliberately not a thrown error carrying
 * a reason: the caller has exactly one behaviour for "no reading", and a
 * distinction it cannot render is a distinction that eventually gets rendered.
 *
 * An endpoint that does not call itself healthy is not one to read a current
 * ledger from. There is no rendering for "probably the current ledger", so it
 * is treated as no reading at all.
 */
export function ledgerFromHealth(body: unknown): number | null {
  const result = (body as { result?: { status?: unknown; latestLedger?: unknown } } | null)?.result;
  if (result === undefined || result === null) return null;
  if (result.status !== 'healthy') return null;

  const sequence = result.latestLedger;
  // Not a number is a failed read, not a zero. Coercing would put a ledger
  // sequence of 0 on screen and start the heartbeat on a value the network
  // never reported.
  if (typeof sequence !== 'number' || !Number.isFinite(sequence)) return null;

  return sequence;
}

/**
 * Which of the two contrast steps the ground's minor rule is on.
 *
 * Parity, deliberately, and worth stating because it is a narrower reading than
 * the plan's wording. §8 asks for the minor rule to *brighten one contrast step
 * on each ledger close*. Taken as a pulse — brighten, then decay back — that
 * needs a second state change the ledger did not cause, driven by a timer, and a
 * timer is exactly the thing that keeps moving when the network stops. Taken as
 * parity it is one contrast step of change on every close, caused by the close
 * and by nothing else, and it is a pure function of the sequence.
 *
 * `null` is phase 0: the ground as it is drawn with no reading at all, which is
 * what every page renders before the first poll returns and after a failure.
 */
export function heartbeatPhase(sequence: number | null): 0 | 1 {
  if (sequence === null) return 0;
  return (Math.abs(Math.trunc(sequence)) % 2) as 0 | 1;
}

/**
 * The sequence as the counter renders it, or `null` when there is nothing to
 * render.
 *
 * Grouped with thousands separators, because a seven-digit number without them
 * is a number nobody reads. `null` rather than a dash or a zero: the caller
 * decides what absence looks like, and this module must not invent a value that
 * could be mistaken for a ledger.
 */
export function formatLedgerSequence(sequence: number | null): string | null {
  if (sequence === null || !Number.isFinite(sequence)) return null;
  return Math.trunc(sequence).toLocaleString('en-US');
}

/** How much of a context rule's validity is left, as a fraction and a count. */
export interface ClosingWindow {
  /** Remaining validity as a fraction of the whole window, clamped to 0…1. */
  fraction: number;
  /** Ledgers until expiry. Negative once the rule is past it. */
  ledgersRemaining: number;
  /** Past `validUntilLedger`. The hairline is gone rather than short. */
  expired: boolean;
}

/**
 * The closing window, or `null` when it cannot be drawn honestly.
 *
 * Three inputs, and all three have to be real. §8 insists both ends of this
 * hairline are: the current ledger comes from RPC and the expiry from
 * `read.ts`. The third — how long the window was to begin with — comes from
 * this browser's own provenance record, because an OpenZeppelin context rule
 * stores only the ledger it expires at and never the span it was given. Without
 * the span there is no denominator, and a bar drawn against an assumed one
 * would be this application inventing the very quantity it is depicting.
 *
 * That is why the absence of provenance returns `null` here rather than a full
 * bar. A full bar is a claim that the window has barely started.
 */
export function closingWindow({
  sequence,
  validUntilLedger,
  windowLedgers,
}: {
  sequence: number | null;
  validUntilLedger: number | null;
  windowLedgers: number | null;
}): ClosingWindow | null {
  if (sequence === null || validUntilLedger === null) return null;
  if (windowLedgers === null || windowLedgers <= 0) return null;

  const ledgersRemaining = Math.trunc(validUntilLedger) - Math.trunc(sequence);
  const fraction = Math.min(1, Math.max(0, ledgersRemaining / windowLedgers));

  return { fraction, ledgersRemaining, expired: ledgersRemaining <= 0 };
}
