/**
 * Addressing a policy.
 *
 * There is no globally unique policy id on chain. A spending limit is held for
 * a (smart account, context rule id) pair, and rule ids come from a per-account
 * counter — so rule 5 exists on every account that has created five rules.
 *
 * The failure this guards is specific and severe: a route that resolved an id
 * to the wrong account would render one account's cap, spend, and expiry under
 * another account's policy, with every label correct and every number wrong.
 */

import { describe, expect, it } from 'vitest';
import { formatPolicyId, parsePolicyId } from '@/lib/policy-id';
import { looksLikeContractAddress } from '@/lib/account-contract';

const ACCOUNT = 'CBNPFNPWY57O22O3VTSAJ5RGROBJXMF4UCVAXJ6NVIAEJ2VBFTRD3G3V';

describe('a policy id round-trips', () => {
  it('carries both halves', () => {
    const id = formatPolicyId({ contractId: ACCOUNT, ruleId: 5 });
    expect(parsePolicyId(id)).toEqual({ contractId: ACCOUNT, ruleId: 5 });
  });

  it('survives rule 0, which is a real rule and not an absent one', () => {
    // The account's own `Default` rule is id 0. A falsy-id bug would make it
    // unreachable.
    expect(parsePolicyId(formatPolicyId({ contractId: ACCOUNT, ruleId: 0 }))).toEqual({
      contractId: ACCOUNT,
      ruleId: 0,
    });
  });
});

describe('a malformed id resolves to nothing, never to something else', () => {
  it('refuses a bare rule id', () => {
    expect(parsePolicyId('5')).toBeNull();
  });

  it('refuses an account with no rule', () => {
    expect(parsePolicyId(ACCOUNT)).toBeNull();
  });

  it('refuses a G-address, which cannot hold a context rule', () => {
    expect(parsePolicyId('GAROIM2HS4IQ4Q2A7GEANZK2RVH3HYX7RGY6FUOHLL7IVEYNELBFNXQT-1')).toBeNull();
  });

  it('refuses a non-numeric rule id', () => {
    expect(parsePolicyId(`${ACCOUNT}-abc`)).toBeNull();
    expect(parsePolicyId(`${ACCOUNT}--1`)).toBeNull();
  });

  it('refuses trailing junk rather than parsing the prefix', () => {
    // Lenient parsing here would resolve `…-5-6` to rule 5 on the right
    // account, which is a guess dressed as an answer.
    expect(parsePolicyId(`${ACCOUNT}-5-6`)).toBeNull();
  });
});

describe('the separator cannot appear inside either half', () => {
  it('holds, because addresses are base32 over A-Z2-7 and ids are decimal', () => {
    const id = formatPolicyId({ contractId: ACCOUNT, ruleId: 12 });
    expect(id.split('-')).toHaveLength(2);
  });
});

describe('the client-side address check is a shape check and says so', () => {
  it('accepts a real contract address', () => {
    expect(looksLikeContractAddress(ACCOUNT)).toBe(true);
  });

  it('rejects what a reviewer is most likely to paste by mistake', () => {
    // A transaction hash and a G-address are the two near misses.
    expect(looksLikeContractAddress('173bcdef575913366e7e2d52cdefdba29d238084916f965f31caa383f21c6702')).toBe(false);
    expect(looksLikeContractAddress('GAROIM2HS4IQ4Q2A7GEANZK2RVH3HYX7RGY6FUOHLL7IVEYNELBFNXQT')).toBe(false);
    expect(looksLikeContractAddress('')).toBe(false);
  });

  it('does not claim to verify the checksum', () => {
    // One character changed keeps the shape and breaks the CRC. This returns
    // true, and the route is what refuses it — which is exactly why the route
    // validates independently rather than trusting the form.
    const corrupted = `${ACCOUNT.slice(0, -1)}A`;
    expect(looksLikeContractAddress(corrupted)).toBe(true);
  });
});
