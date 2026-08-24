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

/**
 * The venue rule, and the boundary it does and does not have.
 *
 * PLAN-V8 C0 measured that a swap's two auth contexts — the router call and the
 * `token.transfer` behind it — each need their own context rule, and that a
 * router rule cannot validate the token context (`UnvalidatedContext#3002` on
 * live testnet). That is what makes an unconstrained venue rule bounded: the
 * money still has to leave through a capped transfer.
 *
 * These pin the four things that follow from it. The one that matters most is
 * the third — the same unconstrained rule on a *token* must stay refused,
 * because there is no second context behind a transfer to catch the amount.
 */
describe('lower — a declared venue', () => {
  const withVenue = (): PolicyProposal => {
    const base = synthesize(singleTransfer());
    return { ...base, policies: [...base.policies, { kind: 'venue', contractId: ROUTER }] };
  };

  it('installs a rule with no policies, and says so in the notes', () => {
    const plan = lower(withVenue());
    const rule = plan.rules.find((r) => r.contract === ROUTER);
    expect(rule, 'no rule was installed for the venue').toBeDefined();
    expect(rule?.policies).toEqual([]);
    expect(
      plan.notes.some((n) => n.includes(`${ROUTER}`) && n.includes('venue=unconstrained')),
      'the plan does not record that the venue rule constrains nothing',
    ).toBe(true);
    // And the note says what does bound it, so a reader of the plan alone can
    // tell this apart from an accidental empty rule.
    expect(plan.notes.some((n) => n.includes('bounded_by=spending_limit_on_token_transfer'))).toBe(true);
  });

  it('keeps the token rule and its spending limit alongside', () => {
    // The whole argument rests on this rule still being there. If a venue ever
    // replaced the token rule rather than joining it, the backstop would be
    // gone and the venue rule would be exactly the thing it must never be.
    const plan = lower(withVenue());
    const token = plan.rules.find((r) => r.contract === USDC);
    expect(token?.policies.map((p) => p.kind)).toEqual(['spending_limit']);
  });

  it('still refuses an unconstrained rule on a TOKEN, which has no backstop', () => {
    // The asymmetry, asserted directly. A transfer IS the value movement, so an
    // unconstrained rule there is an uncapped agent — no measurement changes
    // that and no label should be able to.
    const base = synthesize(singleTransfer());
    const asVenue: PolicyProposal = {
      ...base,
      policies: [{ kind: 'venue', contractId: USDC }],
    };
    try {
      lower(asVenue);
      expect.unreachable('an unconstrained rule on a token must be refused');
    } catch (error) {
      const e = error as NotEnforceableError;
      expect(e.code).toBe('unconstrained_contract');
      expect(e.message).toContain('installs no spending limit on any token');
    }
  });

  it('refuses a contract declared both a venue and a capped asset', () => {
    const base = synthesize(singleTransfer());
    const both: PolicyProposal = {
      ...base,
      policies: [...base.policies, { kind: 'venue', contractId: USDC }],
    };
    try {
      lower(both);
      expect.unreachable('a contract cannot be both');
    } catch (error) {
      expect((error as NotEnforceableError).code).toBe('not_representable');
    }
  });

  it('refuses a venue that also carries a function allowlist', () => {
    const base = synthesize(singleTransfer());
    const contradictory: PolicyProposal = {
      ...base,
      policies: [
        ...base.policies,
        { kind: 'venue', contractId: ROUTER },
        { kind: 'function_allowlist', contractId: ROUTER, functions: ['swap'] },
      ],
    };
    try {
      lower(contradictory);
      expect.unreachable('a venue enforces no function set');
    } catch (error) {
      expect((error as NotEnforceableError).code).toBe('function_allowlist_not_expressible');
    }
  });

  it('does not treat an undeclared router as a venue', () => {
    // A venue is declared, never inferred. The router-shaped proposal that this
    // file already refuses must keep being refused, or "is this a router" would
    // have become a guess about somebody else's contract.
    expect(() => lower(synthesize(routerSwap()))).toThrow(NotEnforceableError);
  });
});
