/**
 * The motion, checked as arithmetic.
 *
 * PLAN-V4 §8 permits three motions and states the condition all three must meet
 * in a form that can be tested rather than admired: *each of the three is a pure
 * function of a ledger sequence passed in as a prop, and renders its static
 * state when that value is `null`.* The enforceable version of "if the network
 * went down and the motion continued, it was decoration".
 *
 * So: a frozen sequence produces no change, and a `null` one produces no
 * motion. Both are assertions about `lib/ledger.ts`, and neither needs a
 * browser. The source scans below cover the half arithmetic cannot — that
 * nothing reintroduces a self-driving animation, and that the components
 * actually take the sequence as a prop instead of reaching for a clock.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  closingWindow,
  formatLedgerSequence,
  heartbeatPhase,
  ledgerFromHealth,
} from '../src/lib/ledger';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../src/${relative}`, import.meta.url)), 'utf8');

/**
 * Source with its comments removed.
 *
 * Every scan below is a claim about what the code *does*, and this project
 * comments heavily about the things it deliberately does not do — the motion
 * block in `globals.css` explains at length why there is no `@keyframes`, and
 * `use-ledger.ts` names `@stellar/stellar-sdk` to say it is not importing it.
 * Scanning the raw text turned all three of those explanations into failures,
 * which would have left exactly two ways out: delete the reasoning, or weaken
 * the assertion. Stripping comments keeps both.
 */
const code = (relative: string) =>
  read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const css = read('app/globals.css');

describe('the reading is taken from what the endpoint actually returns', () => {
  // Recorded from soroban-testnet.stellar.org on 2026-08-05, not invented.
  // `getHealth` is what this poller calls, and the reason is in `use-ledger.ts`:
  // `getLatestLedger` returns the full header and metadata XDR — 186,664 bytes
  // measured, against 205 for this — to carry the same integer.
  const healthy = {
    jsonrpc: '2.0',
    id: 1,
    result: {
      status: 'healthy',
      latestLedger: 3_986_746,
      latestLedgerCloseTime: '1785953967',
      oldestLedger: 3_865_787,
      oldestLedgerCloseTime: '1785347961',
      ledgerRetentionWindow: 120_960,
    },
  };

  it('reads the sequence out of a healthy reply', () => {
    expect(ledgerFromHealth(healthy)).toBe(3_986_746);
  });

  it('refuses an endpoint that does not call itself healthy', () => {
    // There is no rendering for "probably the current ledger", so a degraded
    // endpoint produces no reading rather than a hedged one.
    expect(ledgerFromHealth({ ...healthy, result: { ...healthy.result, status: 'syncing' } })).toBeNull();
  });

  it('refuses a reply carrying no sequence, rather than reading it as zero', () => {
    // The shape `getLatestLedger` returns — `result.sequence`, not
    // `result.latestLedger`. Swapping the method back without changing the
    // parser must produce no reading, not a heartbeat stuck on phase 0 that
    // looks like a working static state.
    expect(ledgerFromHealth({ result: { sequence: 3_986_746 } })).toBeNull();
    expect(ledgerFromHealth({ result: { status: 'healthy' } })).toBeNull();
    expect(ledgerFromHealth({ result: { status: 'healthy', latestLedger: '3986746' } })).toBeNull();
  });

  it('refuses an error reply and a malformed body', () => {
    expect(ledgerFromHealth({ jsonrpc: '2.0', id: 1, error: { code: -32_601 } })).toBeNull();
    expect(ledgerFromHealth(null)).toBeNull();
    expect(ledgerFromHealth('not json')).toBeNull();
    expect(ledgerFromHealth(undefined)).toBeNull();
  });
});

describe('a frozen ledger produces no change', () => {
  it('gives the same heartbeat phase for the same sequence, every time', () => {
    for (const sequence of [0, 1, 3_976_732, 3_976_733]) {
      expect(heartbeatPhase(sequence)).toBe(heartbeatPhase(sequence));
    }
  });

  it('changes phase on every close, and only on a close', () => {
    // One contrast step per ledger. Consecutive sequences differ; a repeated
    // poll of the same sequence does not.
    expect(heartbeatPhase(3_976_732)).not.toBe(heartbeatPhase(3_976_733));
    expect(heartbeatPhase(3_976_733)).not.toBe(heartbeatPhase(3_976_734));
    expect(heartbeatPhase(3_976_732)).toBe(heartbeatPhase(3_976_734));
  });

  it('gives the same closing window for the same inputs', () => {
    const input = { sequence: 3_976_732, validUntilLedger: 4_097_692, windowLedgers: 120_960 };
    expect(closingWindow(input)).toEqual(closingWindow(input));
  });
});

describe('a null ledger produces no motion', () => {
  it('parks the heartbeat on the phase the static ground is drawn at', () => {
    expect(heartbeatPhase(null)).toBe(0);
  });

  it('renders no counter rather than a placeholder that looks like a ledger', () => {
    expect(formatLedgerSequence(null)).toBeNull();
    // Nor for a value that is not a ledger. `Infinity` and `NaN` reach this
    // only through a malformed RPC reply, and both would render as text a
    // reader could mistake for a reading.
    expect(formatLedgerSequence(Number.NaN)).toBeNull();
    expect(formatLedgerSequence(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('draws no closing window when any of its three inputs is missing', () => {
    const whole = { sequence: 3_976_732, validUntilLedger: 4_097_692, windowLedgers: 120_960 };
    expect(closingWindow({ ...whole, sequence: null })).toBeNull();
    expect(closingWindow({ ...whole, validUntilLedger: null })).toBeNull();
    expect(closingWindow({ ...whole, windowLedgers: null })).toBeNull();
    // A zero or negative span is not a window either, and dividing by it would
    // produce Infinity and a bar drawn at 100%.
    expect(closingWindow({ ...whole, windowLedgers: 0 })).toBeNull();
    expect(closingWindow({ ...whole, windowLedgers: -1 })).toBeNull();
  });
});

describe('the closing window is a reading, not a shape', () => {
  it('is full at the start of the window and empty at its end', () => {
    const validUntilLedger = 4_097_692;
    const windowLedgers = 120_960;
    const start = validUntilLedger - windowLedgers;

    expect(closingWindow({ sequence: start, validUntilLedger, windowLedgers })?.fraction).toBe(1);
    expect(
      closingWindow({ sequence: validUntilLedger, validUntilLedger, windowLedgers })?.fraction,
    ).toBe(0);
    expect(
      closingWindow({ sequence: start + windowLedgers / 2, validUntilLedger, windowLedgers })
        ?.fraction,
    ).toBeCloseTo(0.5, 10);
  });

  it('clamps rather than overflowing once the rule is past its expiry', () => {
    const past = closingWindow({
      sequence: 5_000_000,
      validUntilLedger: 4_097_692,
      windowLedgers: 120_960,
    });
    expect(past?.fraction).toBe(0);
    expect(past?.expired).toBe(true);
    // The count stays signed. The bar is clamped because a negative width is
    // not drawable; the number is not, because "902,308 ledgers ago" is true.
    expect(past?.ledgersRemaining).toBeLessThan(0);
  });

  it('shortens monotonically as the ledger advances', () => {
    const validUntilLedger = 4_097_692;
    const windowLedgers = 120_960;
    let previous = 2;
    for (let sequence = 3_976_732; sequence < 4_100_000; sequence += 5_000) {
      const fraction = closingWindow({ sequence, validUntilLedger, windowLedgers })!.fraction;
      expect(fraction).toBeLessThanOrEqual(previous);
      previous = fraction;
    }
  });
});

describe('nothing here can move on its own authority', () => {
  // The stylesheet's half of this — no `@keyframes`, ever — lives in
  // `design-system.test.ts` beside the bans on gradient, glow and shadow
  // depth, because it is a property of the system rather than of these three
  // readings. What is asserted here is the half that is specific to them.

  it('reads no clock in the module the three readings are computed in', () => {
    // The other way a reading becomes an effect: interpolating against
    // wall-clock time between polls. That would keep moving after the endpoint
    // stopped answering, and it would do it smoothly enough to look correct.
    const ledger = code('lib/ledger.ts');
    expect(ledger).not.toMatch(/Date\.now|new Date|performance\.now/);
    expect(ledger).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
  });

  it('takes the sequence as a prop in all three components', () => {
    for (const path of [
      'components/LedgerHeartbeat.tsx',
      'components/LedgerCounter.tsx',
      'components/ClosingWindow.tsx',
    ]) {
      const source = code(path);
      expect(source, `${path} should take a sequence prop`).toContain('sequence');
      // None of the three may poll. There is one poller, in `LedgerSource`.
      expect(source, `${path} should not read the RPC itself`).not.toContain('useLedgerSequence');
      expect(source, `${path} should not schedule its own motion`).not.toMatch(
        /setInterval|requestAnimationFrame/,
      );
    }
  });
});

describe('the poller stops rather than faking it', () => {
  const poller = code('lib/use-ledger.ts');

  it('stops on a hidden tab', () => {
    expect(poller).toContain('visibilitychange');
    expect(poller).toContain('document.hidden');
  });

  it('clears the reading on an RPC failure instead of holding the last one', () => {
    // A counter still displaying a sequence after the endpoint stopped
    // answering is asserting something it cannot check. The catch sets null.
    expect(poller).toMatch(/catch[\s\S]{0,400}setSequence\(null\)/);
  });

  it('refuses a reply that carries no numeric sequence', () => {
    expect(poller).toContain('the endpoint returned no ledger sequence');
  });

  it('does not pull the signing SDK into the root layout', () => {
    // `LedgerSource` wraps every page, including the landing and the docs. The
    // whole reason the write path is behind a dynamic import is to keep the
    // Stellar SDK off those screens, and a poller that imported `rpc.Server`
    // for one argument-less method would undo it for the sake of a convenience
    // wrapper around one `fetch`.
    expect(poller).not.toContain('@stellar/stellar-sdk');
    expect(code('components/LedgerSource.tsx')).not.toContain('@stellar/stellar-sdk');
  });
});

describe('reduced motion is honoured by kind, not by blanket', () => {
  it('stops the heartbeat entirely rather than letting it blink', () => {
    // The global reduce rule collapses transition durations to 0.01ms. For a
    // texture that changes every five seconds that converts a slow fade into a
    // hard blink — reduced motion made worse. The heartbeat carries no
    // information, so under reduce it is simply not drawn.
    const reduced = /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n  \}/g;
    const blocks = css.match(reduced) ?? [];
    expect(blocks.some((block) => block.includes(".ground-beat[data-phase='1']"))).toBe(true);
  });

  it('keeps the closing window length, because that length is the reading', () => {
    // What reduced motion should take from this one is the easing, which the
    // global rule already does. Removing the bar would remove a quantity the
    // reader is being shown.
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).not.toContain('.closing-window > span { width');
  });

  it('puts every transition behind the no-preference query', () => {
    for (const selector of ['.ground-beat { transition', '.closing-window > span { transition']) {
      const at = css.indexOf(selector);
      expect(at, `${selector} should exist`).toBeGreaterThan(-1);
      const preceding = css.lastIndexOf('@media (prefers-reduced-motion: no-preference)', at);
      expect(preceding, `${selector} should sit inside a no-preference query`).toBeGreaterThan(-1);
    }
  });
});
