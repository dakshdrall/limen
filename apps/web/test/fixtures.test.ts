/**
 * The shipped fixtures, run through the real synthesizer.
 *
 * These assert what each fixture is *for*. A fixture that quietly stopped
 * demonstrating its property — the swap that proves two observed functions
 * become two permitted functions, or the rebalance that proves Limen refuses
 * rather than merging — would still render fine and prove nothing.
 */

import { describe, expect, it } from 'vitest';
import { SynthesisError, evaluate, generateDenyCases, synthesize } from '@limen/core';
import { FIXTURES, REFUSING_FIXTURES } from '@/fixtures';

function fixture(key: string) {
  const tx = FIXTURES[key];
  if (tx === undefined) throw new Error(`missing fixture ${key}`);
  return tx;
}

describe('every fixture is well-formed', () => {
  it.each(Object.keys(FIXTURES))('%s carries the caveat and a coherent shape', (key) => {
    const tx = fixture(key);
    // Fixtures were never observed on a live network, and the UI's verbatim
    // caveat is keyed off exactly this value.
    expect(tx.network).toBe('simulated');
    expect(tx.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(tx.invocations.length).toBeGreaterThan(0);
    // Attribution must match the invocation count, or the page would claim a
    // certainty the metadata does not support.
    expect(tx.attribution).toBe(tx.invocations.length === 1 ? 'exact' : 'transaction-level');
  });
});

describe('fixtures that derive a policy', () => {
  const deriving = Object.keys(FIXTURES).filter((key) => !REFUSING_FIXTURES.has(key));

  it.each(deriving)('%s permits the flow it was derived from', (key) => {
    const tx = fixture(key);
    const proposal = synthesize(tx);
    expect(evaluate(proposal, tx).permitted).toBe(true);
  });

  it.each(deriving)('%s refuses every generated deny case', (key) => {
    const tx = fixture(key);
    const proposal = synthesize(tx);
    const cases = generateDenyCases(tx, proposal);
    expect(cases.length).toBeGreaterThanOrEqual(6);

    for (const denyCase of cases) {
      const decision = evaluate(proposal, denyCase.candidate);
      expect(
        decision.permitted,
        `over-permissive on axis "${denyCase.axis}": policy permitted a transaction it must refuse`,
      ).toBe(false);
    }
  });

  it('swap-two-calls permits exactly the two functions it observed', () => {
    const proposal = synthesize(fixture('swap-two-calls'));
    const permitted = Object.values(proposal.contextRule.allowedFunctions).flat().sort();
    expect(permitted).toEqual(['approve', 'swap']);
  });
});

describe('over-limit is refused, and that is its purpose', () => {
  it('throws policy_limit_exceeded rather than merging limits to fit', () => {
    const tx = fixture('over-limit');
    // 5 spending limits + 1 function allowlist = 6, against a rule that holds 5.
    expect(() => synthesize(tx)).toThrow(SynthesisError);
    try {
      synthesize(tx);
      throw new Error('expected synthesize to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(SynthesisError);
      expect((error as SynthesisError).code).toBe('policy_limit_exceeded');
      expect((error as SynthesisError).message).toContain('at most 5');
    }
  });

  it('is listed as a refusing fixture so the demo can label it', () => {
    expect(REFUSING_FIXTURES.has('over-limit')).toBe(true);
  });
});
