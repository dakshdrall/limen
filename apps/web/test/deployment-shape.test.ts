import { describe, expect, it } from 'vitest';
import type { InstallPlan } from '@limen/chain';
import { deploymentShape } from '@/lib/deployment-shape';

/**
 * The plan a trading agent actually lowers to, with the addresses this product
 * ships and in the order `lower()` produces them.
 *
 * The order is the point of the fixture and is not incidental: `lower()` sorts
 * rules by contract address, `CCJUD5…` (Soroswap's router) sorts before
 * `CDLZFC…` (the XLM SAC), so the venue is `rules[0]` and the boundary is
 * `rules[1]`. A fixture that put them the other way round would pass against
 * the bug this file exists to hold shut.
 */
const ROUTER = 'CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD';
const XLM = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

const tradingPlan: InstallPlan = {
  notes: [],
  rules: [
    { name: 'limen-0', contract: ROUTER, policies: [], validUntilLedger: 4_967_508 },
    {
      name: 'limen-1',
      contract: XLM,
      policies: [
        { kind: 'spending_limit', asset: XLM, limit: '200000000', windowLedgers: 17_280 },
      ],
      validUntilLedger: 4_967_508,
    },
  ],
};

const paymentPlan: InstallPlan = {
  notes: [],
  rules: [
    {
      name: 'limen-0',
      contract: XLM,
      policies: [
        { kind: 'spending_limit', asset: XLM, limit: '5000000', windowLedgers: 17_280 },
      ],
      validUntilLedger: 4_967_508,
    },
  ],
};

describe('deploymentShape', () => {
  it('records a two-rule trading plan, taking the boundary from what it carries', () => {
    const shape = deploymentShape(tradingPlan, { venueContextRuleId: 1 });

    expect(shape.ok).toBe(true);
    if (!shape.ok) return;
    // Not `rules[0]`. This is the whole defect: the venue sorts first.
    expect(shape.boundary.contract).toBe(XLM);
    expect(shape.boundary.policies[0]?.limit).toBe('200000000');
    expect(shape.venue?.contract).toBe(ROUTER);
  });

  it('still records a one-rule payment plan, with no venue', () => {
    const shape = deploymentShape(paymentPlan, { venueContextRuleId: null });

    expect(shape.ok).toBe(true);
    if (!shape.ok) return;
    expect(shape.boundary.contract).toBe(XLM);
    expect(shape.venue).toBeNull();
  });

  it('refuses a trading plan whose venue rule id was not reported', () => {
    // The agent would be recorded ACTIVE and refused at every swap, because
    // `gate.ts` finds the venue rule by the id saved here or not at all.
    const shape = deploymentShape(tradingPlan, { venueContextRuleId: null });

    expect(shape.ok).toBe(false);
    if (shape.ok) return;
    expect(shape.message).toContain(ROUTER);
    expect(shape.message).toContain('Nothing was recorded.');
  });

  it('refuses a plan carrying no spending limit at all', () => {
    const shape = deploymentShape(
      { notes: [], rules: [tradingPlan.rules[0]!] },
      { venueContextRuleId: 1 },
    );

    expect(shape.ok).toBe(false);
    if (shape.ok) return;
    expect(shape.message).toContain('0 rules carrying a spending limit');
  });

  it('refuses a plan with two capped rules, because the row records one boundary', () => {
    const second = 'CB3TLW74NBIOT3BUWOZ3TUM6RFDF6A4GVIRUQRQZABG5KPOUL4JJOV2F';
    const shape = deploymentShape(
      {
        notes: [],
        rules: [
          ...tradingPlan.rules,
          {
            name: 'limen-2',
            contract: second,
            policies: [
              { kind: 'spending_limit', asset: second, limit: '1', windowLedgers: 17_280 },
            ],
            validUntilLedger: 4_967_508,
          },
        ],
      },
      { venueContextRuleId: 1 },
    );

    expect(shape.ok).toBe(false);
    if (shape.ok) return;
    expect(shape.message).toContain('2 rules carrying a spending limit');
  });

  it('refuses a plan with two venue rules, because the row records one venue', () => {
    const other = 'CB3TLW74NBIOT3BUWOZ3TUM6RFDF6A4GVIRUQRQZABG5KPOUL4JJOV2F';
    const shape = deploymentShape(
      {
        notes: [],
        rules: [
          ...tradingPlan.rules,
          { name: 'limen-2', contract: other, policies: [], validUntilLedger: 4_967_508 },
        ],
      },
      { venueContextRuleId: 1 },
    );

    expect(shape.ok).toBe(false);
    if (shape.ok) return;
    expect(shape.message).toContain('2 venue rules');
  });
});
