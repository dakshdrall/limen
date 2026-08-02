/**
 * The load-bearing suite.
 *
 * If this file goes red, the product claim is false: the derived policy is
 * permitting something adjacent to the observed flow. The failure message names
 * the over-permissive dimension, because "expected true to be false" would tell
 * you the policy is broken without telling you where.
 */

import { describe, expect, it } from 'vitest';
import { evaluate, generateDenyCases, synthesize, type ObservedTransaction } from '../src/index.js';
import { roundTrip, singleTransfer, twoInvocations } from './factories.js';

const FLOWS: Array<[name: string, build: () => ObservedTransaction]> = [
  ['single transfer', singleTransfer],
  ['two invocations', twoInvocations],
  ['round trip', roundTrip],
];

describe.each(FLOWS)('deny cases for %s', (_name, build) => {
  const observed = build();
  const proposal = synthesize(observed);
  const cases = generateDenyCases(observed, proposal);

  it('permits the flow it was derived from', () => {
    const decision = evaluate(proposal, observed);
    expect(
      decision.permitted,
      `policy refused the transaction it was derived from: ${decision.reasons.join('; ')}`,
    ).toBe(true);
  });

  it('generates a case for every required axis', () => {
    expect([...cases.map((c) => c.axis)].sort()).toEqual(
      ['amount', 'asset', 'contract', 'expiry', 'function', 'invocation'],
    );
  });

  it.each(cases.map((c) => [c.axis, c] as const))('refuses the %s case', (axis, denyCase) => {
    const decision = evaluate(proposal, denyCase.candidate);

    expect(
      decision.permitted,
      `OVER-PERMISSIVE on axis "${axis}": the derived policy permitted a transaction it must refuse.\n` +
        `  case:  ${denyCase.label}\n` +
        `  why it must be refused: ${denyCase.why}\n` +
        `  the policy raised no objection, which means the "${axis}" dimension of this proposal is too wide.`,
    ).toBe(false);

    expect(
      decision.reasons.length,
      `axis "${axis}" was refused but produced no reason; a refusal with no explanation cannot be reviewed`,
    ).toBeGreaterThan(0);
  });
});

describe('deny cases are deterministic', () => {
  it('produces byte-identical cases across runs', () => {
    const a = generateDenyCases(singleTransfer(), synthesize(singleTransfer()));
    const b = generateDenyCases(singleTransfer(), synthesize(singleTransfer()));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('the amount case sits exactly one unit over the cap', () => {
  it('is the smallest possible violation', () => {
    const observed = singleTransfer();
    const proposal = synthesize(observed);
    const limit = proposal.policies.find((p) => p.kind === 'spending_limit');
    if (limit?.kind !== 'spending_limit') throw new Error('expected a spending limit');

    const amountCase = generateDenyCases(observed, proposal).find((c) => c.axis === 'amount');
    if (amountCase === undefined) throw new Error('expected an amount case');

    let gross = 0n;
    for (const movement of amountCase.candidate.movements) {
      if (movement.from === amountCase.candidate.source && movement.asset === limit.asset) {
        gross += BigInt(movement.amount);
      }
    }
    // A boundary bug that used `>=` instead of `>` would only be caught by a
    // case this tight.
    expect(gross).toBe(BigInt(limit.limit) + 1n);
  });
});
