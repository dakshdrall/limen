import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SYNTHESIS_OPTIONS,
  HEADROOM_SCALE,
  MAX_POLICIES,
  SynthesisError,
  evaluate,
  synthesize,
  type PolicyConfig,
} from '../src/index.js';
import { OBSERVED_LEDGER, ROUTER, USDC, manyContracts, roundTrip, singleTransfer, twoInvocations } from './factories.js';

function spendingLimit(policies: PolicyConfig[], asset: string): string {
  const policy = policies.find((p) => p.kind === 'spending_limit' && p.asset === asset);
  if (policy?.kind !== 'spending_limit') throw new Error(`no spending limit for ${asset}`);
  return policy.limit;
}

describe('cap derivation', () => {
  it('caps at the observed outflow exactly, at default headroom', () => {
    const proposal = synthesize(singleTransfer());
    expect(DEFAULT_SYNTHESIS_OPTIONS.headroomBps).toBe(HEADROOM_SCALE);
    expect(spendingLimit(proposal.policies, USDC)).toBe('500000000');
  });

  it('does not derive a limit for an asset that only flows in', () => {
    // The two-invocation flow receives XLM and spends USDC. Capping what
    // arrives is not a permission boundary.
    const proposal = synthesize(twoInvocations());
    const assets = proposal.policies
      .filter((p) => p.kind === 'spending_limit')
      .map((p) => (p.kind === 'spending_limit' ? p.asset : ''));
    expect(assets).toEqual([USDC]);
  });
});

describe('gross outflow is never netted against inflows', () => {
  it('caps a round trip at its gross outflow, not its net of zero', () => {
    const proposal = synthesize(roundTrip());
    // Net would be 0, which would derive no limit at all — or a limit of zero
    // that the observed flow itself violates.
    expect(spendingLimit(proposal.policies, USDC)).toBe('1000');
  });

  it('refuses an over-cap spend even when the same amount comes back', () => {
    const observed = roundTrip();
    const proposal = synthesize(observed);

    // Sends 1001 out, receives 1001 back. Nets to zero; spends 1001.
    const candidate = structuredCloneTx(observed);
    const movements = candidate.invocations[0]!.movements;
    movements[0]!.amount = '1001';
    movements[1]!.amount = '1001';

    const decision = evaluate(proposal, candidate);
    expect(
      decision.permitted,
      'a round trip hid spend: netting inflows against outflows would let this repeat without ever consuming the cap',
    ).toBe(false);
    expect(decision.reasons.join(' ')).toContain('spending limit exceeded');
  });
});

describe('headroom', () => {
  it('widens the cap and changes nothing else', () => {
    const observed = singleTransfer();
    const tight = synthesize(observed);
    const loose = synthesize(observed, { ...DEFAULT_SYNTHESIS_OPTIONS, headroomBps: 20_000 });

    expect(spendingLimit(loose.policies, USDC)).toBe('1000000000');

    // The context rule must not move at all.
    expect(loose.contextRule).toEqual(tight.contextRule);
    // Strip the caps and the rest of the proposal must be identical — any
    // collateral drift in the allowlists or the policy ordering fails here.
    expect(stripLimits(loose)).toEqual(stripLimits(tight));
  });

  it('rounds the cap down, never up', () => {
    const observed = singleTransfer();
    // 500000000 * 10001 / 10000 = 500050000 exactly; use a headroom that does
    // not divide evenly to prove truncation.
    const proposal = synthesize(observed, { ...DEFAULT_SYNTHESIS_OPTIONS, headroomBps: 10_003 });
    expect(spendingLimit(proposal.policies, USDC)).toBe('500150000');

    const odd = synthesize(
      { ...observed, invocations: [{ ...observed.invocations[0]!, movements: [{ ...observed.invocations[0]!.movements[0]!, amount: '7' }] }] },
      { ...DEFAULT_SYNTHESIS_OPTIONS, headroomBps: 15_000 },
    );
    // 7 * 1.5 = 10.5 -> 10, not 11.
    expect(spendingLimit(odd.policies, USDC)).toBe('10');
  });

  it('refuses a headroom below 1.0', () => {
    expect(() => synthesize(singleTransfer(), { ...DEFAULT_SYNTHESIS_OPTIONS, headroomBps: 9_999 }))
      .toThrow(SynthesisError);
  });
});

describe('window validation', () => {
  it('refuses a spending window longer than the rule lifetime', () => {
    expect(() =>
      synthesize(singleTransfer(), {
        ...DEFAULT_SYNTHESIS_OPTIONS,
        windowLedgers: 200_000,
        validityLedgers: 120_960,
      }),
    ).toThrow(/never resets/);
  });

  it('accepts a window equal to the rule lifetime', () => {
    expect(() =>
      synthesize(singleTransfer(), {
        ...DEFAULT_SYNTHESIS_OPTIONS,
        windowLedgers: 1_000,
        validityLedgers: 1_000,
      }),
    ).not.toThrow();
  });

  it('derives the validity window from the observed ledger', () => {
    const proposal = synthesize(singleTransfer());
    expect(proposal.contextRule.validFromLedger).toBe(OBSERVED_LEDGER);
    expect(proposal.contextRule.validUntilLedger).toBe(OBSERVED_LEDGER + 120_960);
  });
});

describe('breadth', () => {
  it('permits exactly the functions observed', () => {
    const proposal = synthesize(twoInvocations());
    expect(proposal.contextRule.allowedFunctions).toEqual({
      [USDC]: ['approve'],
      [ROUTER]: ['swap'],
    });
  });

  it('throws above the OpenZeppelin policy limit rather than merging', () => {
    expect(() => synthesize(manyContracts(MAX_POLICIES + 1))).toThrow(SynthesisError);
    expect(() => synthesize(manyContracts(MAX_POLICIES + 1))).toThrow(/at most 5/);
  });

  it('refuses a transaction with no invocations', () => {
    expect(() => synthesize({ ...singleTransfer(), invocations: [] })).toThrow(/no contract invocations/);
  });

  it('refuses a non-integer amount rather than coercing it', () => {
    const observed = singleTransfer();
    observed.invocations[0]!.movements[0]!.amount = '50.5';
    expect(() => synthesize(observed)).toThrow(/smallest unit/);
  });
});

describe('determinism', () => {
  it('is byte-identical across calls', () => {
    expect(JSON.stringify(synthesize(singleTransfer()))).toBe(JSON.stringify(synthesize(singleTransfer())));
  });

  it('is byte-identical when the invocation order is shuffled', () => {
    const forward = twoInvocations();
    const reversed = twoInvocations();
    reversed.invocations.reverse();
    expect(JSON.stringify(synthesize(reversed))).toBe(JSON.stringify(synthesize(forward)));
  });

  it('always emits compositionOnly', () => {
    expect(synthesize(singleTransfer()).compositionOnly).toBe(true);
  });
});

/**
 * Blanks the cap-bearing fields. The `limit:` rationale line records the cap,
 * the observed gross outflow, and the headroom that produced it, so the whole
 * line is normalised rather than just the number.
 */
function stripLimits(proposal: ReturnType<typeof synthesize>) {
  return {
    ...proposal,
    policies: proposal.policies.map((p) => (p.kind === 'spending_limit' ? { ...p, limit: '<stripped>' } : p)),
    rationale: proposal.rationale.map((line) => (line.startsWith('limit:') ? 'limit:<stripped>' : line)),
  };
}

function structuredCloneTx<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
