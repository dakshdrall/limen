/**
 * The ratchet: what a cycle does to its own stored strategy after it trades.
 *
 * `evaluateTrigger` decides whether to trade and is tested next door with no
 * network at all. This file is about the write that happens *after* a trade —
 * the one place in this project where an agent changes a stored rule with no
 * person present — and three properties are pinned here rather than left to be
 * intended:
 *
 *   1. **A re-stamp can only ever move the reference down.** Not "does not
 *      currently move it up": cannot. Asserted over a range rather than at a
 *      chosen point, because the interesting failure is a boundary somebody
 *      moves later.
 *   2. **A cycle that did not succeed leaves the reference alone.** An over-cap
 *      swap refused by the account moved no money, and must not move the
 *      strategy either — otherwise a bounded agent could walk its own trigger
 *      down by proposing trades it is not allowed to make.
 *   3. **The audit row carries both prices.** A re-stamp has to be
 *      reconstructible from the log alone, which means the row says what the
 *      reference was as well as what it became. A row with only the new value
 *      records a change nobody can check.
 *
 * The network is mocked here and nowhere else in this file's neighbourhood: the
 * price read and the swap are the two things a unit test cannot do, and every
 * decision between them is the real code. The store is the ordinary fake, which
 * `fakes.ts` exists for — what gets recorded is exactly what it is for.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRICE_PROBE_AMOUNT, type PriceReading } from '@limen/chain';
import type { ToolResult } from '../src/tools/types.js';

const XLM = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const USDC = 'CB3TLW74NBIOT3BUWOZ3TUM6RFDF6A4GVIRUQRQZABG5KPOUL4JJOV2F';

const readPrice = vi.hoisted(() => vi.fn());
const swapRun = vi.hoisted(() => vi.fn());

vi.mock('@limen/chain', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@limen/chain')>()),
  readPrice,
}));

vi.mock('../src/tools/swap.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/tools/swap.js')>()),
  swapTokens: { name: 'swap_tokens', kind: 'write', run: swapRun },
}));

import { executeTradingDecision, restampReference, type TradingTrigger } from '../src/trading.js';
import { fakeAgent, fakeStore } from './fakes.js';

const price = (outFor: bigint, ledger = 4_310_000): PriceReading => ({
  inputAsset: XLM,
  outputAsset: USDC,
  outFor,
  probeAmount: PRICE_PROBE_AMOUNT,
  ledger,
});

const trigger = (overrides: Partial<TradingTrigger> = {}): TradingTrigger => ({
  kind: 'price_drop',
  referencePrice: '2500000',
  referenceLedger: 4_300_000,
  dropBps: 500,
  amount: '20000000',
  ...overrides,
});

const succeeded: ToolResult = {
  outcome: 'succeeded',
  summary: 'The swap went through.',
  data: {},
  evidence: { hash: 'a'.repeat(64), status: 'SUCCESS', opResult: 'invokeHostFunctionSuccess' },
};

const overCap: ToolResult = {
  outcome: 'refused_by_network',
  summary: 'The account refused it: SpendingLimitExceeded.',
  codes: [3221],
  boundaryRefusal: true,
  revokedRule: false,
  evidence: { hash: 'b'.repeat(64), status: 'FAILED', opResult: 'invokeHostFunctionTrapped' },
};

const refusedByLimen: ToolResult = {
  outcome: 'refused_by_limen',
  summary: 'Limen refused it: over the maximum position size.',
  constraint: 'max_position_size',
  ledgerWould: 'permit',
  reachedLedger: false,
};

/** A cycle whose trigger fires: the price is well below the reference. */
function runCycle(swap: ToolResult, traded: bigint, storedTrigger: TradingTrigger | null = trigger()) {
  readPrice.mockResolvedValue(price(traded));
  swapRun.mockResolvedValue(swap);
  const { store, recorded } = fakeStore({ agent: fakeAgent() });
  return {
    recorded,
    result: executeTradingDecision(
      {
        agent: fakeAgent(),
        store,
        provider: {} as never,
        rpcUrl: 'https://example.invalid',
        read: { rpcUrl: 'https://example.invalid', simulationSource: 'GA' },
        turnId: '33333333-3333-4333-8333-333333333333',
        executionId: 'exec-1',
      },
      { inputAsset: XLM, outputAsset: USDC, trigger: storedTrigger },
    ),
  };
}

beforeEach(() => {
  readPrice.mockReset();
  swapRun.mockReset();
});

describe('a reference only ever moves down', () => {
  it('never returns a new reference at or above the old one, at any price', () => {
    const reference = 2_500_000n;
    const widened: string[] = [];

    // Every price from far below the reference to well above it, including the
    // two boundary values. If any of these produced an upward move the ratchet
    // would be a suggestion rather than a property.
    for (let outFor = 2_000_000n; outFor <= 3_000_000n; outFor += 12_345n) {
      const verdict = restampReference(trigger({ referencePrice: String(reference) }), price(outFor), 'succeeded');
      if (verdict.restamps && BigInt(verdict.to) >= BigInt(verdict.from)) {
        widened.push(`${verdict.from} -> ${verdict.to}`);
      }
    }

    expect(widened, 'a re-stamp that widens the trigger must be impossible').toEqual([]);
  });

  it('refuses a price exactly at the reference, which is the boundary that would be a no-op', () => {
    const verdict = restampReference(trigger(), price(2_500_000n), 'succeeded');
    expect(verdict.restamps).toBe(false);
    expect(verdict.restamps === false && verdict.reason).toContain('only ever moves down');
  });

  it('names take profit rather than reporting an upward move as unsupported', () => {
    // The reason a person reads when the price rose. "Take profit is a
    // different strategy" is the honest answer; "cannot move up" alone reads as
    // a missing feature.
    const verdict = restampReference(trigger(), price(2_600_000n), 'succeeded');
    expect(verdict.restamps === false && verdict.reason).toContain('take profit');
  });

  it('moves down to exactly the price that traded, and dates it to that ledger', () => {
    const verdict = restampReference(trigger(), price(2_300_000n, 4_311_222), 'succeeded');
    expect(verdict).toMatchObject({ restamps: true, from: '2500000', to: '2300000', ledger: 4_311_222 });
  });
});

describe('a cycle that did not succeed leaves the reference where it was', () => {
  // The price is far below the reference in every one of these, so the only
  // thing stopping a re-stamp is the outcome.
  const untouched: ToolResult['outcome'][] = [
    'refused_by_limen',
    'refused_by_network',
    'infra_error',
    'agent_error',
  ];

  for (const outcome of untouched) {
    it(`does not re-stamp on ${outcome}`, () => {
      const verdict = restampReference(trigger(), price(2_000_000n), outcome);
      expect(verdict.restamps).toBe(false);
      expect(verdict.restamps === false && verdict.reason).toContain('2500000');
    });
  }

  it('writes nothing when the account refuses an over-cap swap on a ledger', async () => {
    const { recorded, result } = runCycle(overCap, 2_000_000n);
    const cycle = await result;

    expect(cycle.swap?.outcome).toBe('refused_by_network');
    expect(cycle.restamp?.restamps).toBe(false);
    // The strongest form of the claim: the store was never asked. A refused
    // trade must not reach the write at all, not merely fail its guard.
    expect(recorded.restamps, 'a refused swap must not touch the stored strategy').toEqual([]);
    expect(recorded.audits.filter((row) => (row as { action: string }).action === 'trading.restamp')).toEqual([]);
  });

  it('writes nothing when Limen refuses before anything is signed', async () => {
    // No hash, nothing on a ledger, nothing moved — and so nothing moves the
    // reference either. This is the cheaper refusal to reach repeatedly, which
    // is exactly why it must not be able to walk the trigger down.
    const { recorded, result } = runCycle(refusedByLimen, 2_000_000n);
    const cycle = await result;

    expect(cycle.swap?.outcome).toBe('refused_by_limen');
    expect(recorded.restamps).toEqual([]);
  });
});

describe('the audit row is enough to reconstruct the re-stamp', () => {
  it('carries the old price, the new price and the ledger', async () => {
    const { recorded, result } = runCycle(succeeded, 2_300_000n);
    await result;

    const row = recorded.audits.find(
      (entry) => (entry as { action: string }).action === 'trading.restamp',
    ) as { result: string; metadata: Record<string, unknown> } | undefined;

    expect(row, 'a re-stamp writes its own audit row').toBeDefined();
    expect(row!.result).toBe('restamped');
    // Both halves. A row with only `referenceTo` records that something changed
    // and makes the change itself unrecoverable.
    expect(row!.metadata).toMatchObject({
      referenceFrom: '2500000',
      referenceTo: '2300000',
      referenceLedger: 4_310_000,
    });
  });

  it('records the write the database refused as not_restamped, and still carries both prices', async () => {
    // The fake's guard refuses a re-stamp that is not strictly downward, the
    // same way the UPDATE's WHERE does. The audit row still has to say what was
    // attempted, or a refused write is invisible in the log.
    readPrice.mockResolvedValue(price(2_300_000n));
    swapRun.mockResolvedValue(succeeded);
    const { store, recorded } = fakeStore({ agent: fakeAgent() });
    const spy = vi.spyOn(store, 'restampTrigger').mockResolvedValue(false);

    await executeTradingDecision(
      {
        agent: fakeAgent(),
        store,
        provider: {} as never,
        rpcUrl: 'https://example.invalid',
        read: { rpcUrl: 'https://example.invalid', simulationSource: 'GA' },
        turnId: '33333333-3333-4333-8333-333333333333',
        executionId: 'exec-1',
      },
      { inputAsset: XLM, outputAsset: USDC, trigger: trigger() },
    );

    expect(spy).toHaveBeenCalledWith({
      agentId: fakeAgent().id,
      // The new reference. The guard reads "the stored reference must still be
      // above this", so handing it the old one would compare a number against
      // itself and refuse every downward write — which is exactly the bug a
      // real Postgres caught and a fake would not have.
      mustBeAbove: '2300000',
      trigger: expect.objectContaining({ referencePrice: '2300000', referenceLedger: 4_310_000 }),
    });

    const row = recorded.audits.find(
      (entry) => (entry as { action: string }).action === 'trading.restamp',
    ) as { result: string; metadata: Record<string, unknown> };
    expect(row.result).toBe('not_restamped');
    expect(row.metadata).toMatchObject({ referenceFrom: '2500000', referenceTo: '2300000' });
  });

  it('does not write a re-stamp row for a cycle that traded nothing', async () => {
    // The price is above the reference, so the trigger does not fire and no
    // swap happens. A log full of "the reference did not move" rows would bury
    // the ones where it did.
    readPrice.mockResolvedValue(price(2_600_000n));
    const { store, recorded } = fakeStore({ agent: fakeAgent() });

    const cycle = await executeTradingDecision(
      {
        agent: fakeAgent(),
        store,
        provider: {} as never,
        rpcUrl: 'https://example.invalid',
        read: { rpcUrl: 'https://example.invalid', simulationSource: 'GA' },
        turnId: '33333333-3333-4333-8333-333333333333',
        executionId: 'exec-1',
      },
      { inputAsset: XLM, outputAsset: USDC, trigger: trigger() },
    );

    expect(swapRun).not.toHaveBeenCalled();
    expect(cycle.restamp?.restamps).toBe(false);
    expect(recorded.restamps).toEqual([]);
  });
});
