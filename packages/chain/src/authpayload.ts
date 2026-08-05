/**
 * The `AuthPayload` an OpenZeppelin smart account's `__check_auth` expects, and
 * the digest its signers actually sign.
 *
 * Every value here is an encoding of a Rust type in
 * `OpenZeppelin/stellar-contracts` at the tag pinned in `wasm/manifest.json`.
 * The encodings are unit-tested for round-trip and, more importantly, are
 * exercised against live testnet by the scripts in `scripts/` — an encoding
 * that only this repository agrees with is not verified.
 *
 * Two things are easy to get wrong and are called out where they happen:
 *
 *  1. Signers do NOT sign the host's `signature_payload`. They sign
 *     `sha256(signature_payload || context_rule_ids.to_xdr())`, which binds the
 *     selected rules into the signature. Without it a sponsor could collect
 *     signatures under a strict rule and submit them against a weaker one.
 *  2. `to_xdr()` on a soroban `Vec<u32>` is the XDR of its `ScVal`, not a bare
 *     array of integers.
 */

import { Address, xdr } from '@stellar/stellar-sdk';
import { concatBytes, scvBytes, sha256 } from './bytes.js';

const sym = (s: string) => xdr.ScVal.scvSymbol(s);
const u32 = (n: number) => xdr.ScVal.scvU32(n);

/** Soroban requires `contracttype` struct maps in sorted key order. */
export function structMap(entries: Array<[string, xdr.ScVal]>): xdr.ScVal {
  const sorted = [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return xdr.ScVal.scvMap(sorted.map(([key, val]) => new xdr.ScMapEntry({ key: sym(key), val })));
}

/** `ContextRuleType::CallContract(Address)`. */
export function callContractType(contract: string): xdr.ScVal {
  return xdr.ScVal.scvVec([sym('CallContract'), new Address(contract).toScVal()]);
}

/** `Signer::External(verifier, key_data)`. */
export function externalSigner(verifier: string, publicKey: Uint8Array): xdr.ScVal {
  return xdr.ScVal.scvVec([
    sym('External'),
    new Address(verifier).toScVal(),
    scvBytes(publicKey),
  ]);
}

/** `Signer::Delegated(Address)`. */
export function delegatedSigner(address: string): xdr.ScVal {
  return xdr.ScVal.scvVec([sym('Delegated'), new Address(address).toScVal()]);
}

/** `SpendingLimitAccountParams { spending_limit: i128, period_ledgers: u32 }`. */
export function spendingLimitParams(limit: bigint, periodLedgers: number): xdr.ScVal {
  return structMap([
    ['spending_limit', i128(limit)],
    ['period_ledgers', u32(periodLedgers)],
  ]);
}

/** i128 without going through `nativeToScVal`, so the amount path stays bigint. */
export function i128(value: bigint): xdr.ScVal {
  const mask = (1n << 64n) - 1n;
  const lo = value & mask;
  const hi = value >> 64n;
  return xdr.ScVal.scvI128(
    new xdr.Int128Parts({
      hi: xdr.Int64.fromString(hi.toString()),
      lo: xdr.Uint64.fromString(lo.toString()),
    }),
  );
}

/**
 * `auth_digest = sha256(signature_payload || context_rule_ids.to_xdr())`.
 *
 * `signaturePayload` is the 32-byte hash the host hands to `__check_auth` —
 * the same value `authorizeEntry` passes to its signing callback.
 */
export function authDigest(signaturePayload: Uint8Array, contextRuleIds: number[]): Uint8Array {
  const ids = xdr.ScVal.scvVec(contextRuleIds.map(u32));
  return sha256(concatBytes(signaturePayload, new Uint8Array(ids.toXDR())));
}

export interface SignerSignature {
  /** The `Signer` enum value, from `externalSigner` or `delegatedSigner`. */
  signer: xdr.ScVal;
  /** The raw signature bytes over `authDigest`. */
  signature: Uint8Array;
}

/**
 * `AuthPayload { signers: Map<Signer, Bytes>, context_rule_ids: Vec<u32> }`.
 *
 * Goes verbatim into the credentials' signature field via `authorizeEntry`'s
 * `{ signatureScVal }` return.
 */
export function authPayload(
  signatures: SignerSignature[],
  contextRuleIds: number[],
): xdr.ScVal {
  return structMap([
    ['context_rule_ids', xdr.ScVal.scvVec(contextRuleIds.map(u32))],
    [
      'signers',
      xdr.ScVal.scvMap(
        signatures.map(
          ({ signer, signature }) =>
            new xdr.ScMapEntry({ key: signer, val: scvBytes(signature) }),
        ),
      ),
    ],
  ]);
}
