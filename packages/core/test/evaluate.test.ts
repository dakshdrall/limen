/**
 * Evaluator-specific behaviour, beyond the deny-case harness.
 *
 * `evaluate` is deny-by-default: it refuses anything it cannot positively
 * account for, and it never throws on a malformed candidate.
 */

import { describe, expect, it } from 'vitest';
import { evaluate, synthesize } from '../src/index.js';
import { RECIPIENT, SOURCE, USDC, singleTransfer } from './factories.js';

const observed = singleTransfer();
const proposal = synthesize(observed);

describe('boundaries', () => {
  it('permits a spend exactly at the cap', () => {
    expect(evaluate(proposal, observed).permitted).toBe(true);
  });

  it('permits the flow on the last valid ledger', () => {
    const candidate = { ...observed, ledger: proposal.contextRule.validUntilLedger };
    expect(evaluate(proposal, candidate).permitted).toBe(true);
  });

  it('refuses the flow one ledger after expiry', () => {
    const candidate = { ...observed, ledger: proposal.contextRule.validUntilLedger + 1 };
    expect(evaluate(proposal, candidate).permitted).toBe(false);
  });

  it('refuses the flow before the rule takes effect', () => {
    const candidate = { ...observed, ledger: proposal.contextRule.validFromLedger - 1 };
    const decision = evaluate(proposal, candidate);
    expect(decision.permitted).toBe(false);
    expect(decision.reasons.join(' ')).toContain('not yet valid');
  });
});

describe('deny-by-default', () => {
  it('refuses rather than throws on an unparseable amount', () => {
    const candidate = singleTransfer();
    candidate.movements[0]!.amount = 'not-a-number';
    const decision = evaluate(proposal, candidate);
    expect(decision.permitted).toBe(false);
    expect(decision.reasons.join(' ')).toContain('unparseable amount');
  });

  it('refuses a proposal whose allowlist disagrees with its own context rule', () => {
    // A synthesizer bug that widened the context rule without widening the
    // matching policy (or vice versa) must not pass on the strength of the
    // wider of the two.
    const inconsistent = structuredClone(proposal);
    inconsistent.contextRule.allowedFunctions[USDC] = ['transfer', 'set_admin'];

    const candidate = singleTransfer();
    candidate.invocations[0]!.functionName = 'set_admin';

    const decision = evaluate(inconsistent, candidate);
    expect(decision.permitted).toBe(false);
    expect(decision.reasons.join(' ')).toContain('function_allowlist policy');
  });

  it('ignores movements that do not leave the source account', () => {
    const candidate = singleTransfer();
    candidate.movements.push({
      asset: USDC,
      from: RECIPIENT,
      to: SOURCE,
      amount: '999999999999',
    });
    // A large inbound movement is not a spend and must not trip the cap.
    expect(evaluate(proposal, candidate).permitted).toBe(true);
  });
});

describe('reasons', () => {
  it('names the asset, the amount, and the cap when a limit is exceeded', () => {
    const candidate = singleTransfer();
    candidate.movements[0]!.amount = '500000001';
    const [reason] = evaluate(proposal, candidate).reasons;
    expect(reason).toContain(USDC);
    expect(reason).toContain('500000001');
    expect(reason).toContain('500000000');
  });

  it('reports every independent violation, not just the first', () => {
    const candidate = singleTransfer();
    candidate.ledger = proposal.contextRule.validUntilLedger + 1;
    candidate.invocations[0]!.functionName = 'set_admin';
    candidate.movements[0]!.amount = '900000000';

    const decision = evaluate(proposal, candidate);
    expect(decision.permitted).toBe(false);
    expect(decision.reasons.length).toBeGreaterThanOrEqual(3);
  });
});
