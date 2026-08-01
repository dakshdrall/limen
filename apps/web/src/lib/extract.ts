/**
 * Pure XDR → domain-model extraction. No network IO happens here; the caller
 * has already fetched the transaction.
 *
 * Scope note: movement→invocation attribution is approximate. Contract events
 * carry the *token* contract, not the invocation that caused them, so a swap's
 * transfer events cannot be attributed to the router call with certainty. All
 * movements are therefore attached to the first invocation.
 *
 * This is safe because attribution is presentational only: `synthesize` sums
 * outflow across every invocation, and derives contracts and functions from the
 * invocation list independently of where movements sit. No derived cap, no
 * allowlist, and no deny case changes if a movement is attached to invocation 0
 * instead of invocation 1. It affects how the Observed section reads, nothing
 * else.
 */

import {
  Address,
  Networks,
  StrKey,
  TransactionBuilder,
  scValToNative,
  xdr,
  type FeeBumpTransaction,
  type Transaction,
  type rpc,
} from '@stellar/stellar-sdk';
import type { Invocation, ObservedTransaction, TokenMovement } from '@limen/core';

function unwrapFeeBump(tx: Transaction | FeeBumpTransaction): Transaction {
  return 'innerTransaction' in tx ? (tx as FeeBumpTransaction).innerTransaction : (tx as Transaction);
}

function readInvocations(tx: Transaction): Invocation[] {
  const invocations: Invocation[] = [];

  for (const operation of tx.operations) {
    if (operation.type !== 'invokeHostFunction') continue;

    const hostFunction = operation.func;
    if (hostFunction.switch() !== xdr.HostFunctionType.hostFunctionTypeInvokeContract()) continue;

    const invokeContract = hostFunction.invokeContract();
    const contractId = Address.fromScAddress(invokeContract.contractAddress()).toString();
    const functionName = invokeContract.functionName().toString();
    const args = invokeContract.args().map((arg) => {
      try {
        const native: unknown = scValToNative(arg);
        return typeof native === 'string' ? native : JSON.stringify(native, bigintSafe);
      } catch {
        return '<unreadable>';
      }
    });

    invocations.push({ contractId, functionName, args, movements: [] });
  }

  return invocations;
}

function bigintSafe(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

function readContractEvents(meta: xdr.TransactionMeta): xdr.ContractEvent[] {
  try {
    // Soroban metadata lives on the v3 arm. Older arms carry classic
    // operation meta only, which has no contract events to read.
    if (meta.switch() !== 3) return [];
    return meta.v3().sorobanMeta()?.events() ?? [];
  } catch {
    return [];
  }
}

/**
 * `ContractEvent.contractId()` is declared as `xdr.Hash` but is a 32-byte
 * Buffer at runtime. The length check is what makes the conversion safe rather
 * than a blind cast — a malformed id is skipped instead of producing a
 * garbage address.
 */
function encodeContractId(raw: unknown): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  const bytes = raw as Uint8Array;
  if (typeof bytes.length !== 'number' || bytes.length !== 32) return undefined;
  try {
    return StrKey.encodeContract(Buffer.from(bytes));
  } catch {
    return undefined;
  }
}

/**
 * Recognises SEP-41 / Stellar Asset Contract `transfer` events:
 * topics `[symbol("transfer"), Address from, Address to, (string asset)?]`
 * with an i128 amount in the event data.
 */
function readMovements(meta: xdr.TransactionMeta): TokenMovement[] {
  const movements: TokenMovement[] = [];

  for (const event of readContractEvents(meta)) {
    try {
      if (event.type().name !== 'contract') continue;

      const asset = encodeContractId(event.contractId());
      if (asset === undefined) continue;

      const body = event.body().v0();
      const topics = body.topics();
      if (topics.length < 3) continue;

      const label: unknown = scValToNative(topics[0]!);
      if (label !== 'transfer') continue;

      const from: unknown = scValToNative(topics[1]!);
      const to: unknown = scValToNative(topics[2]!);
      if (typeof from !== 'string' || typeof to !== 'string') continue;

      const rawAmount: unknown = scValToNative(body.data());
      const amount = normaliseAmount(rawAmount);
      if (amount === undefined) continue;

      movements.push({ asset, from, to, amount });
    } catch {
      // A single unreadable event must not discard the rest of the
      // transaction. Anything skipped here simply does not contribute to the
      // derived cap, which errs toward less permission.
      continue;
    }
  }

  return movements;
}

/** Amounts must reach the core as integer strings in the smallest unit. */
function normaliseAmount(raw: unknown): string | undefined {
  if (typeof raw === 'bigint') return raw >= 0n ? raw.toString() : undefined;
  if (typeof raw === 'string' && /^(?:0|[1-9][0-9]*)$/.test(raw)) return raw;
  // Deliberately no `number` branch: a float amount is a malformed amount, not
  // a value to round.
  if (raw !== null && typeof raw === 'object' && 'amount' in raw) {
    return normaliseAmount((raw as { amount: unknown }).amount);
  }
  return undefined;
}

export function extractObservedTransaction(
  hash: string,
  network: 'testnet',
  response: rpc.Api.GetSuccessfulTransactionResponse,
): ObservedTransaction {
  const envelope = TransactionBuilder.fromXDR(response.envelopeXdr.toXDR('base64'), Networks.TESTNET);
  const inner = unwrapFeeBump(envelope);

  const invocations = readInvocations(inner);
  if (invocations.length === 0) {
    throw new Error(
      'transaction contains no contract invocations; there is no agent flow here to derive a policy from',
    );
  }

  const movements = readMovements(response.resultMetaXdr);
  // See the attribution note at the top of this file.
  invocations[0]!.movements = movements;

  return {
    hash,
    network,
    ledger: response.ledger,
    source: inner.source,
    invocations,
  };
}
