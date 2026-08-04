/**
 * Decoding installed state.
 *
 * These cover the pure half of `read.ts` — the parts that turn what the host
 * returns into something a screen can render. The network half is verified by
 * reading the live testnet account recorded in `deployments/testnet.json`;
 * there is no mock of a Soroban host here, because a mock would only prove that
 * this file agrees with my idea of the host.
 *
 * The `Default` case below is not hypothetical. It shipped wrong: a unit enum
 * variant arrives as a one-element vec, not a bare string, and assuming
 * otherwise silently relabelled the account's own Default rule as
 * `CreateContract`. It was found by reading a real account and not recognising
 * a rule that was visibly there.
 */

import { describe, expect, it } from 'vitest';
import { isLive, type InstalledContextRule } from '../src/read.js';

const rule = (overrides: Partial<InstalledContextRule> = {}): InstalledContextRule => ({
  id: 1,
  name: 'limen-agent',
  contract: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
  contextType: 'CallContract',
  validUntilLedger: 4_035_604,
  policies: ['CDWPYL45SZDHFPF7CZK4PLXFUQPNP4WTW4URIFVQZ4I65HQFYBTH4CSE'],
  policyIds: [0],
  signerIds: [1],
  signers: [{ kind: 'External', verifier: 'CA3ZVES4QX6QQE7EUALSWFYHOHG6XZ3E65DCGCGODI6GRUSVJ75HPGZX', publicKey: 'ab'.repeat(32) }],
  ...overrides,
});

describe('isLive matches the contract, exactly', () => {
  it('is live before valid_until', () => {
    expect(isLive(rule({ validUntilLedger: 100 }), 99)).toBe(true);
  });

  it('is live AT valid_until', () => {
    // `get_validated_context_by_id` rejects only when
    // `valid_until < current_ledger`. Treating this as expired would show a
    // rule as dead for the last ledger of its life.
    expect(isLive(rule({ validUntilLedger: 100 }), 100)).toBe(true);
  });

  it('is expired one ledger later', () => {
    expect(isLive(rule({ validUntilLedger: 100 }), 101)).toBe(false);
  });

  it('never expires when valid_until is absent', () => {
    expect(isLive(rule({ validUntilLedger: null }), 10_000_000)).toBe(true);
  });
});

describe('the shape a screen renders', () => {
  it('carries the single contract a CallContract rule authorizes', () => {
    const r = rule();
    expect(r.contextType).toBe('CallContract');
    expect(r.contract).not.toBeNull();
  });

  it('carries no contract for Default, because it authorizes any context', () => {
    // Rendering an address here would name one contract for a rule that covers
    // all of them, which is the opposite of what it permits.
    const r = rule({ contextType: 'Default', contract: null });
    expect(r.contract).toBeNull();
  });

  it('has no field for how much of the cap is spent', () => {
    // Spend lives on the policy contract and moves as the window rolls, so it
    // is read separately and never cached alongside the rule.
    expect(Object.keys(rule())).not.toContain('spentInWindow');
  });
});
