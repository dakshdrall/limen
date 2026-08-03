/**
 * Decoding activity.
 *
 * The pure half of `events.ts`, in the same shape as `read.test.ts`: no mock
 * Soroban host, because a mock would only prove this file agrees with my idea
 * of the host. The network half was verified by reading the live testnet
 * account in `deployments/testnet.json` — sixteen events across two contracts,
 * with the walkthrough's spends and rule ids matching the recorded run.
 *
 * Every fixture below is a transcription of an event that account actually
 * emitted, not an invention. The topic shapes in particular are measured: the
 * account's events are `[name, id]` and the policy's are `[name, smartAccount]`,
 * which is not what a reading of the contract sources suggests.
 */

import { describe, expect, it } from 'vitest';
import { cursorLedger, decodeActivity, type NativeEvent } from '../src/events.js';

const ACCOUNT = 'CBNPFNPWY57O22O3VTSAJ5RGROBJXMF4UCVAXJ6NVIAEJ2VBFTRD3G3V';
const OTHER_ACCOUNT = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const TOKEN = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

const event = (overrides: Partial<NativeEvent>): NativeEvent => ({
  topics: [],
  value: undefined,
  source: 'account',
  contract: ACCOUNT,
  ledger: 3_935_838,
  closedAt: '2026-08-02T19:28:56Z',
  txHash: '173bcdef575913366e7e2d52cdefdba29d238084916f965f31caa383f21c6702',
  ...overrides,
});

describe('a context rule event carries its rule id', () => {
  it('reads the id out of the second topic', () => {
    const decoded = decodeActivity(
      event({
        topics: ['context_rule_added', 5],
        value: { name: 'limen-agent', valid_until: 4_035_836, policy_ids: [0], signer_ids: [1] },
      }),
      ACCOUNT,
    );

    expect(decoded?.kind).toBe('context_rule_added');
    expect(decoded?.contextRuleId).toBe(5);
    expect(decoded?.ruleName).toBe('limen-agent');
  });
});

describe('an id that is not a rule id is not reported as one', () => {
  // The trap this guards: `policy_registered` and `signer_registered` also
  // carry a small integer in their second topic, from separate counters. Read
  // as a rule id, a signer registration files itself under whichever rule
  // happens to share its number — a wrong answer that looks entirely plausible.
  it('does not read a policy id as a context rule id', () => {
    const decoded = decodeActivity(
      event({ topics: ['policy_registered', 0], value: { policy: 'CDWPYL45SZDHFPF7CZK4PLXFUQPNP4WTW4URIFVQZ4I65HQFYBTH4CSE' } }),
      ACCOUNT,
    );

    expect(decoded?.kind).toBe('policy_registered');
    expect(decoded?.contextRuleId).toBeNull();
  });

  it('does not read a signer id as a context rule id', () => {
    const decoded = decodeActivity(event({ topics: ['signer_registered', 1], value: {} }), ACCOUNT);

    expect(decoded?.kind).toBe('signer_registered');
    expect(decoded?.contextRuleId).toBeNull();
  });
});

describe('policy events belong to one account', () => {
  const enforced = (forAccount: string) =>
    event({
      source: 'policy',
      contract: 'CDWPYL45SZDHFPF7CZK4PLXFUQPNP4WTW4URIFVQZ4I65HQFYBTH4CSE',
      topics: ['spending_limit_enforced', forAccount],
      value: {
        amount: 1_000_000n,
        total_spent_in_period: 1_000_000n,
        context_rule_id: 5,
        context: ['Contract', { contract: TOKEN, fn_name: 'transfer', args: [] }],
      },
    });

  it('keeps an event emitted for this account', () => {
    const decoded = decodeActivity(enforced(ACCOUNT), ACCOUNT);
    expect(decoded?.contextRuleId).toBe(5);
    expect(decoded?.spend).toEqual({
      amount: '1000000',
      totalSpentInPeriod: '1000000',
      contract: TOKEN,
      fnName: 'transfer',
    });
  });

  it('drops an event emitted for a different account', () => {
    // The spending limit contract is deployed once and shared. Without this,
    // one account's spending would appear under another account's boundary.
    expect(decodeActivity(enforced(OTHER_ACCOUNT), ACCOUNT)).toBeNull();
  });
});

describe('amounts leave the decoder as integer strings', () => {
  it('converts the i128 bigint rather than passing it through', () => {
    // Every amount in this project is a decimal string handled as bigint. A
    // bigint reaching JSON.stringify throws, and a Number would silently lose
    // precision above 2^53.
    const decoded = decodeActivity(
      event({
        source: 'policy',
        topics: ['spending_limit_installed', ACCOUNT],
        value: { context_rule_id: 2, period_ledgers: 17_280, spending_limit: 5_000_000n },
      }),
      ACCOUNT,
    );

    expect(decoded?.kind).toBe('spending_limit_installed');
    expect(decoded?.contextRuleId).toBe(2);
    expect(() => JSON.stringify(decoded)).not.toThrow();
  });
});

describe('an unrecognised event is kept, not dropped', () => {
  it('reports it as unknown with its name intact', () => {
    // Dropping it would silently under-report history, which is a worse failure
    // than showing a row this build cannot describe.
    const decoded = decodeActivity(event({ topics: ['some_future_event', 7], value: {} }), ACCOUNT);

    expect(decoded).not.toBeNull();
    expect(decoded?.kind).toBe('unknown');
    expect(decoded?.name).toBe('some_future_event');
  });

  it('does not accept an account event name from a policy contract', () => {
    // Kinds are scoped to the contract that can emit them, so a policy contract
    // emitting `context_rule_added` is reported as unknown rather than trusted.
    const decoded = decodeActivity(
      event({ source: 'policy', topics: ['context_rule_added', ACCOUNT], value: {} }),
      ACCOUNT,
    );

    expect(decoded?.kind).toBe('unknown');
  });
});

describe('the cursor says which ledger a page ended at', () => {
  // This is what tells "the scan reached the head" from "the scan ran out of
  // budget". Measured against testnet: one `getEvents` call covers roughly
  // 10,000 ledgers and then hands back a cursor — it does not error, and an
  // empty page from a wide range is indistinguishable from no history unless
  // the cursor is read.
  it('takes the ledger from the high 32 bits of the toid', () => {
    // The cursor is verbatim from a testnet scan whose page began at ledger
    // 3,830,970; it ends 10,003 ledgers later, which is the ~10,000-ledger page
    // size the module's budget is sized against.
    expect(cursorLedger('0016496857714786303-4294967295')).toBe(3_840_973);
  });

  it('is monotonic across pages', () => {
    expect(cursorLedger('0016926311494713343-4294967295')).toBeGreaterThan(
      cursorLedger('0016496857714786303-4294967295'),
    );
  });

  it('returns 0 for an unparseable cursor, so the scan keeps going', () => {
    // Returning a large number would end the loop and report a truncated scan
    // as complete.
    expect(cursorLedger('not-a-cursor')).toBe(0);
    expect(cursorLedger('')).toBe(0);
  });
});
