/**
 * The lowering harness.
 *
 * Two things are under test, and the second is the one that matters:
 *
 *  1. A proposal that CAN be installed lowers to exactly the rules and policies
 *     the chain will hold — no more permission than the proposal described.
 *  2. A proposal that CANNOT be installed throws, naming the constraint. The
 *     failure mode this guards against is not a crash; it is installing a rule
 *     that permits more than the user reviewed and reporting success.
 *
 * The subsumption claim — that a `['transfer']` allowlist needs no allowlist
 * policy because `spending_limit::enforce` refuses every other function name —
 * is a claim about a contract in another repository. These tests pin the claim;
 * `deployments/testnet.json` records the live testnet run that confirms it. A
 * claim verified only by the code that makes it is not verified.
 */

import { describe, expect, it } from 'vitest';
import { synthesize, type ObservedTransaction, type PolicyProposal } from '@limen/core';
import { lower } from '../src/lower.js';
import { NotEnforceableError } from '../src/plan.js';

const SOURCE = 'GSOURCEACCOUNTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const RECIPIENT = 'GRECIPIENTACCOUNTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const USDC = 'CUSDCTOKENCONTRACTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const XLM = 'CXLMTOKENCONTRACTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const ROUTER = 'CROUTERCONTRACTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const LEDGER = 51_234;

/** The shape v3 installs: one token, one transfer. */
function singleTransfer(): ObservedTransaction {
  return {
    hash: 'a'.repeat(64),
    network: 'simulated',
    ledger: LEDGER,
    source: SOURCE,
    invocations: [{ contractId: USDC, functionName: 'transfer', args: [SOURCE, RECIPIENT, '500000000'] }],
    attribution: 'exact',
    movements: [{ asset: USDC, from: SOURCE, to: RECIPIENT, amount: '500000000' }],
  };
}

/** A router call beside a token transfer — the multi-contract shape. */
function routerSwap(): ObservedTransaction {
  return {
    hash: 'b'.repeat(64),
    network: 'simulated',
    ledger: LEDGER,
    source: SOURCE,
    invocations: [
      { contractId: USDC, functionName: 'transfer', args: [SOURCE, ROUTER, '500000000'] },
      { contractId: ROUTER, functionName: 'swap', args: [USDC, XLM, '500000000'] },
    ],
    attribution: 'transaction-level',
    movements: [{ asset: USDC, from: SOURCE, to: ROUTER, amount: '500000000' }],
  };
}

describe('lower — what installs', () => {
  it('lowers a single-token transfer to one CallContract rule carrying one spending limit', () => {
    const plan = lower(synthesize(singleTransfer()));

    expect(plan.rules).toHaveLength(1);
    const rule = plan.rules[0]!;
    expect(rule.contract).toBe(USDC);
    expect(rule.policies).toEqual([
      { kind: 'spending_limit', asset: USDC, limit: '500000000', windowLedgers: 120_960 },
    ]);
  });

  it('carries the cap through unchanged — the chain holds the number the user reviewed', () => {
    const proposal = synthesize(singleTransfer());
    const derivedCap = proposal.policies.find((p) => p.kind === 'spending_limit')?.limit;
    const plan = lower(proposal);

    expect(plan.rules[0]!.policies[0]!.limit).toBe(derivedCap);
    expect(plan.rules[0]!.policies[0]!.limit).toBe('500000000');
  });

  it('takes valid_until from the proposal and installs no lower bound', () => {
    const proposal = synthesize(singleTransfer());
    const plan = lower(proposal);

    expect(plan.rules[0]!.validUntilLedger).toBe(proposal.contextRule.validUntilLedger);
    // validFromLedger has no on-chain counterpart. It must not be smuggled in.
    expect(JSON.stringify(plan.rules)).not.toContain(String(proposal.contextRule.validFromLedger));
  });

  it('records the subsumption rather than leaving it implicit', () => {
    const plan = lower(synthesize(singleTransfer()));
    const note = plan.notes.find((n) => n.startsWith('allowlist:'));

    expect(note).toBeDefined();
    expect(note).toContain('subsumed_by=spending_limit');
    expect(note).toContain('NotAllowed');
  });

  it('says out loud that valid_from was not installed', () => {
    const plan = lower(synthesize(singleTransfer()));
    expect(plan.notes.some((n) => n.startsWith('not_installed:valid_from_ledger='))).toBe(true);
  });

  it('names rules within the 20-byte on-chain limit', () => {
    const plan = lower(synthesize(singleTransfer()));
    for (const rule of plan.rules) {
      expect(new TextEncoder().encode(rule.name).length).toBeLessThanOrEqual(20);
    }
  });

  it('is deterministic', () => {
    const a = lower(synthesize(singleTransfer()));
    const b = lower(synthesize(singleTransfer()));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('lower — what refuses', () => {
  it('refuses a router call that no audited policy can constrain', () => {
    // The router is invoked but nothing flows out through it, so it gets an
    // allowlist and no spending limit. A rule with no policy would permit every
    // function on the router.
    expect(() => lower(synthesize(routerSwap()))).toThrow(NotEnforceableError);

    try {
      lower(synthesize(routerSwap()));
      expect.unreachable('should have refused');
    } catch (error) {
      const e = error as NotEnforceableError;
      expect(e.code).toBe('unconstrained_contract');
      expect(e.constraint).toContain(ROUTER);
      expect(e.message).toContain('broader than the derived allowlist');
    }
  });

  it('refuses a function allowlist the spending limit does not already impose', () => {
    const observed: ObservedTransaction = {
      ...singleTransfer(),
      invocations: [
        { contractId: USDC, functionName: 'transfer', args: [] },
        { contractId: USDC, functionName: 'burn', args: [] },
      ],
    };

    try {
      lower(synthesize(observed));
      expect.unreachable('should have refused');
    } catch (error) {
      const e = error as NotEnforceableError;
      expect(e.code).toBe('function_allowlist_not_expressible');
      expect(e.constraint).toContain('burn');
      // The reason has to name what IS enforced, or the message is unactionable.
      expect(e.message).toContain('transfer');
    }
  });

  it('refuses anything not marked composition-only, with no way to override', () => {
    const proposal: PolicyProposal = { ...synthesize(singleTransfer()), compositionOnly: false };

    try {
      lower(proposal);
      expect.unreachable('should have refused');
    } catch (error) {
      const e = error as NotEnforceableError;
      expect(e.code).toBe('not_representable');
      expect(e.message).toContain('generated policy');
    }
  });

  it('names the constraint, not just the failure — the UI has to render it', () => {
    try {
      lower(synthesize(routerSwap()));
      expect.unreachable('should have refused');
    } catch (error) {
      const e = error as NotEnforceableError;
      expect(e.constraint.length).toBeGreaterThan(0);
      expect(e.constraint).not.toBe(e.code);
    }
  });
});

describe('lower — the boundary it hands to the chain is never wider than the proposal', () => {
  it('installs no contract the proposal did not name', () => {
    const proposal = synthesize(singleTransfer());
    const plan = lower(proposal);

    const named = new Set(proposal.contextRule.allowedContracts);
    for (const rule of plan.rules) expect(named.has(rule.contract)).toBe(true);
  });

  it('installs a spending limit for every asset the proposal capped', () => {
    const proposal = synthesize(singleTransfer());
    const plan = lower(proposal);

    const capped = proposal.policies.filter((p) => p.kind === 'spending_limit');
    const installed = plan.rules.flatMap((r) => r.policies);
    expect(installed).toHaveLength(capped.length);

    for (const cap of capped) {
      const match = installed.find((p) => p.asset === cap.asset);
      expect(match).toBeDefined();
      expect(match!.limit).toBe(cap.limit);
      expect(match!.windowLedgers).toBe(cap.windowLedgers);
    }
  });
});
