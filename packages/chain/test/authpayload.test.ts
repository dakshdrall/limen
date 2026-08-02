/**
 * Encoding tests.
 *
 * These pin the wire shapes the smart account expects. They cannot prove the
 * shapes are *right* — only the host can do that, and it does, in the scripts
 * whose transaction hashes are recorded in `deployments/testnet.json`. What
 * they catch is a shape changing without anyone meaning to change it.
 */

import { describe, expect, it } from 'vitest';
import { Keypair, xdr } from '@stellar/stellar-sdk';
import {
  authDigest,
  authPayload,
  callContractType,
  delegatedSigner,
  externalSigner,
  i128,
  spendingLimitParams,
  structMap,
} from '../src/authpayload.js';

const CONTRACT = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const VERIFIER = 'CA3ZVES4QX6QQE7EUALSWFYHOHG6XZ3E65DCGCGODI6GRUSVJ75HPGZX';
const KEY = new Uint8Array(32).fill(7);

const roundTrips = (v: xdr.ScVal) => xdr.ScVal.fromXDR(v.toXDR()).toXDR('base64') === v.toXDR('base64');

describe('ScVal encodings round-trip', () => {
  it('ContextRuleType::CallContract', () => {
    expect(roundTrips(callContractType(CONTRACT))).toBe(true);
  });

  it('Signer::External and Signer::Delegated', () => {
    expect(roundTrips(externalSigner(VERIFIER, KEY))).toBe(true);
    expect(roundTrips(delegatedSigner(CONTRACT))).toBe(true);
  });

  it('SpendingLimitAccountParams', () => {
    expect(roundTrips(spendingLimitParams(1_000_000n, 17_280))).toBe(true);
  });

  it('AuthPayload', () => {
    const payload = authPayload(
      [{ signer: externalSigner(VERIFIER, KEY), signature: new Uint8Array(64).fill(3) }],
      [1],
    );
    expect(roundTrips(payload)).toBe(true);
  });
});

describe('struct maps are sorted, because the host rejects them otherwise', () => {
  it('sorts keys regardless of the order they were written in', () => {
    const a = structMap([
      ['zebra', xdr.ScVal.scvU32(1)],
      ['alpha', xdr.ScVal.scvU32(2)],
    ]);
    const b = structMap([
      ['alpha', xdr.ScVal.scvU32(2)],
      ['zebra', xdr.ScVal.scvU32(1)],
    ]);
    expect(a.toXDR('base64')).toBe(b.toXDR('base64'));
    expect(a.map()!.map((e) => e.key().sym().toString())).toEqual(['alpha', 'zebra']);
  });

  it('puts AuthPayload fields in the order the contract type declares', () => {
    const payload = authPayload([], [0]);
    expect(payload.map()!.map((e) => e.key().sym().toString())).toEqual([
      'context_rule_ids',
      'signers',
    ]);
  });
});

describe('i128', () => {
  it('encodes values above 2^64 without losing the high word', () => {
    const value = (1n << 100n) + 12345n;
    const parts = i128(value).i128();
    const decoded = (BigInt(parts.hi().toString()) << 64n) | BigInt(parts.lo().toString());
    expect(decoded).toBe(value);
  });

  it('encodes zero and small values', () => {
    for (const v of [0n, 1n, 1_000_000n]) {
      const parts = i128(v).i128();
      const decoded = (BigInt(parts.hi().toString()) << 64n) | BigInt(parts.lo().toString());
      expect(decoded).toBe(v);
    }
  });
});

describe('authDigest binds the selected rules into the signature', () => {
  const payload = new Uint8Array(32).fill(9);

  it('is not the host payload itself — signing that would be the bug', () => {
    expect(authDigest(payload, [0]).equals(Buffer.from(payload))).toBe(false);
  });

  it('changes when the selected rule changes', () => {
    // This is the whole point of the digest. If these matched, a signature
    // collected under a strict rule could be replayed against a weaker one.
    expect(authDigest(payload, [0]).equals(authDigest(payload, [1]))).toBe(false);
  });

  it('changes when the number of contexts changes', () => {
    expect(authDigest(payload, [1]).equals(authDigest(payload, [1, 1]))).toBe(false);
  });

  it('is stable for the same inputs', () => {
    expect(authDigest(payload, [2, 3]).equals(authDigest(payload, [2, 3]))).toBe(true);
  });

  it('is 32 bytes, so it can be signed as an ed25519 message digest', () => {
    const digest = authDigest(payload, [0]);
    expect(digest).toHaveLength(32);
    expect(() => Keypair.random().sign(digest)).not.toThrow();
  });
});
