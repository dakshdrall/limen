/**
 * The one decision in `balance.ts`, and the coercion it refuses.
 *
 * Same division as `read.test.ts`: the decode is unit-tested and the network
 * half is not mocked, because a fake Soroban host would only establish that
 * this file agrees with my idea of one. What is testable here is the check that
 * turns a returned value into a balance, and it is worth testing precisely
 * because the wrong version of it is the shorter one.
 */

import { describe, expect, it } from 'vitest';
import { decodeBalance } from '../src/balance.js';
import { ContractReadError } from '../src/read.js';

const TOKEN = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

describe('a balance is a bigint or it is a refusal', () => {
  it('passes an i128 through unchanged', () => {
    expect(decodeBalance(10_000_000n, TOKEN)).toBe(10_000_000n);
  });

  it('keeps precision above 2^53, which is the reason for bigint at all', () => {
    const beyondDouble = 9_007_199_254_740_993n;
    expect(decodeBalance(beyondDouble, TOKEN)).toBe(beyondDouble);
    // The same value through a double comes back a different number. Written as
    // a round trip rather than against a literal, because the literal rounds too
    // and the assertion would then pass by both sides being wrong identically.
    expect(BigInt(Number(beyondDouble))).not.toBe(beyondDouble);
  });

  it('refuses a number rather than accepting it', () => {
    // `scValToNative` returns a `number` for u32/i32. A token contract does not
    // return one from `balance`, so this is a different contract answering.
    expect(() => decodeBalance(42, TOKEN)).toThrow(ContractReadError);
  });

  it('refuses undefined instead of reading as a zero balance', () => {
    // The failure this exists for: `Number(undefined)` is `NaN`, `Number(null)`
    // and `Number({})` bottom out at 0 or NaN, and a zero balance is a number a
    // person acts on. "You have nothing" must not be something a decode invents.
    expect(() => decodeBalance(undefined, TOKEN)).toThrow(/expected an i128/);
    expect(() => decodeBalance(null, TOKEN)).toThrow(/got null/);
  });

  it('names the contract it asked, so a wrong address is findable', () => {
    expect(() => decodeBalance('12', TOKEN)).toThrow(new RegExp(TOKEN));
  });
});
