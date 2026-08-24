/**
 * The trading cycle's decision half, which is pure so it can be checked here.
 *
 * `evaluateTrigger` is the whole reason the strategy is structured rather than
 * prose: a decision has to be reproducible from the log. Everything below is a
 * price and a trigger going in and a verdict coming out, with no network — the
 * same computation anybody reading an activity row can redo by hand.
 *
 * The property asserted hardest is the one that keeps this honest: **a trigger
 * that does not fire trades nothing, and a trigger firing is not permission.**
 * What bounds a trade is `gate.ts` and then the installed cap; this function
 * decides only whether to try.
 */

import { describe, expect, it } from 'vitest';
import { evaluateTrigger, PRICE_PROBE_AMOUNT, type PriceReading, type TradingTrigger } from '../src/trading.js';

const XLM = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const USDC = 'CB3TLW74NBIOT3BUWOZ3TUM6RFDF6A4GVIRUQRQZABG5KPOUL4JJOV2F';

const price = (outFor: bigint): PriceReading => ({
  inputAsset: XLM,
  outputAsset: USDC,
  outFor,
  probeAmount: PRICE_PROBE_AMOUNT,
  ledger: 4_310_000,
});

const trigger = (overrides: Partial<TradingTrigger> = {}): TradingTrigger => ({
  kind: 'price_drop',
  referencePrice: '2500000',
  dropBps: 500,
  amount: '20000000',
  ...overrides,
});

describe('a trigger fires on the fall it names, and not before', () => {
  it('fires at exactly the threshold', () => {
    // 2,500,000 less 5% is 2,375,000. The boundary case is asserted because it
    // is the one a float implementation would get wrong intermittently.
    const verdict = evaluateTrigger(trigger(), price(2_375_000n));
    expect(verdict.fires).toBe(true);
    expect(verdict.fires && verdict.amount).toBe(20_000_000n);
  });

  it('does not fire one basis point short', () => {
    const verdict = evaluateTrigger(trigger(), price(2_375_001n));
    expect(verdict.fires).toBe(false);
    expect(verdict.reason).toContain('and the trigger needs 500');
  });

  it('fires further below the threshold, and says how far', () => {
    const verdict = evaluateTrigger(trigger(), price(2_000_000n));
    expect(verdict.fires).toBe(true);
    // 20% down, in basis points, so the log states a checkable number.
    expect(verdict.reason).toContain('2000 basis points below');
  });

  it('does not fire when the price has risen', () => {
    const verdict = evaluateTrigger(trigger(), price(3_000_000n));
    expect(verdict.fires).toBe(false);
    expect(verdict.reason).toContain('at or above');
  });
});

describe('a cycle with nothing to evaluate says so', () => {
  it('trades nothing when there is no trigger, and does not call it a decision', () => {
    // "No trigger configured" and "decided not to trade" are different facts.
    const verdict = evaluateTrigger(null, price(1n));
    expect(verdict.fires).toBe(false);
    expect(verdict.reason).toContain('no trigger configured');
  });

  it('refuses to measure a drop against a non-positive reference', () => {
    for (const referencePrice of ['0', '-1']) {
      const verdict = evaluateTrigger(trigger({ referencePrice }), price(1n));
      expect(verdict.fires).toBe(false);
      expect(verdict.reason).toContain('not a positive number');
    }
  });
});

describe('the decision is integer arithmetic all the way down', () => {
  it('computes the same verdict for the same numbers, every time', () => {
    // The point of the structured trigger: a decision anybody can recompute.
    // Two runs on identical inputs that disagreed would make the activity log
    // a record of something unrepeatable.
    const inputs = [2_375_000n, 2_374_999n, 2_500_000n, 1n];
    // A BigInt-aware serialiser: the verdict carries `amount` as a bigint, and
    // the point of this case is that the whole verdict repeats, not just its
    // prose.
    const show = (p: bigint) =>
      JSON.stringify(evaluateTrigger(trigger(), price(p)), (_k, v) =>
        typeof v === 'bigint' ? `${v}n` : v,
      );
    expect(inputs.map(show)).toEqual(inputs.map(show));
  });

  it('handles a price far below the reference without overflowing', () => {
    const verdict = evaluateTrigger(trigger({ referencePrice: '99999999999999999999' }), price(1n));
    expect(verdict.fires).toBe(true);
  });
});
