/**
 * Calling a token contract.
 *
 * Three screens and the acceptance script all need the same two things: the
 * contract id of the native asset's SAC, and a `transfer` host function. Each
 * had built them inline, which is three places for the argument order of
 * `transfer(from, to, amount)` to be wrong in — and getting it backwards
 * produces a transaction that is perfectly valid, moves funds the other way,
 * and derives a boundary from the wrong direction of flow.
 *
 * Nothing here is specific to a boundary. It is the token half of the
 * demonstration: what the account does, so that there is something for a
 * boundary to be derived from and later refused against.
 */

import { Address, Asset, xdr } from '@stellar/stellar-sdk';
import { i128 } from './authpayload.js';
import type { SupportedPassphrase } from './network.js';

/**
 * The Stellar Asset Contract id for native XLM on this network.
 *
 * Derived from the passphrase rather than hardcoded, because it *is* a function
 * of the network: the same asset has a different contract id on testnet and on
 * mainnet. A literal here would be a second place for the network to be wrong,
 * and it would be wrong silently — the transfer would simply address a contract
 * that does not exist.
 */
export function nativeTokenId(passphrase: SupportedPassphrase): string {
  return Asset.native().contractId(passphrase);
}

/** A contract call as a host function. */
export function invokeContract(
  contract: string,
  functionName: string,
  args: xdr.ScVal[],
): xdr.HostFunction {
  return xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: new Address(contract).toScAddress(),
      functionName,
      args,
    }),
  );
}

export interface TransferOptions {
  token: string;
  /** Classic `G…` or contract `C…`; the SAC takes either. */
  from: string;
  to: string;
  /** Smallest units. `bigint` because integer math only — see design rule 5. */
  amount: bigint;
}

/**
 * `transfer(from, to, amount)` on a token contract.
 *
 * Named parameters rather than positional, which is the whole reason this
 * function exists: `transfer(a, b, n)` reads identically whichever way round
 * the two addresses go, and the compiler cannot tell them apart. `{ from, to }`
 * cannot be swapped by accident.
 */
export function transferFunction({ token, from, to, amount }: TransferOptions): xdr.HostFunction {
  return invokeContract(token, 'transfer', [
    new Address(from).toScVal(),
    new Address(to).toScVal(),
    i128(amount),
  ]);
}
