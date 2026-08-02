/**
 * Pure XDR → domain-model extraction. No network IO happens here; the caller
 * has already fetched the transaction.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ACCURATE OR ABSENT. This file never narrows silently.                    │
 * │                                                                          │
 * │ An earlier version of this module skipped any event it could not parse,  │
 * │ on the reasoning that a dropped movement lowers the derived cap and less │
 * │ permission is the safe direction. That reasoning is wrong for this       │
 * │ product. A dropped transfer still produces an `ObservedTransaction` that │
 * │ does not describe the transaction, and every number downstream — the     │
 * │ cap, the deny table's `cap + 1` row, the rationale Claude explains — is  │
 * │ then derived from a flow that was never observed. "Biased safe" is not   │
 * │ the standard. Accurate, or absent with the reason named, is.             │
 * │                                                                          │
 * │ So the rule below is: knowing nothing moved is not a guess and is        │
 * │ skipped; knowing something moved and not knowing how much is a guess     │
 * │ and throws.                                                              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Movement→invocation attribution is not resolved here, because the meta does
 * not carry it: contract events name the *token* contract that emitted them,
 * not the call that caused them. Rather than attach every movement to the
 * first invocation and assert something the chain never said, movements are
 * transaction-level and carry an explicit `attribution` marker. See
 * `MovementAttribution` in `@limen/core`.
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
import type {
  Invocation,
  MovementAttribution,
  ObservedTransaction,
  TokenMovement,
} from '@limen/core';
import { UNREADABLE_ARG } from './markers';

export type ExtractionErrorCode = 'no_invocations' | 'unreadable_movement' | 'unreadable_meta';

/**
 * Thrown rather than guessed, in the same spirit as `SynthesisError`. `detail`
 * names the specific field that could not be read, so a refusal is actionable
 * rather than a shrug.
 */
export class ExtractionError extends Error {
  readonly code: ExtractionErrorCode;
  readonly detail: string | undefined;

  constructor(code: ExtractionErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'ExtractionError';
    this.code = code;
    this.detail = detail;
  }
}

// Defined in a dependency-free module so client components can read it without
// reaching through this file into the Stellar SDK. Re-exported for the server
// side, which naturally imports it from here.
export { UNREADABLE_ARG };

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
        return UNREADABLE_ARG;
      }
    });

    invocations.push({ contractId, functionName, args });
  }

  return invocations;
}

function bigintSafe(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

/**
 * Contract events, wherever the metadata version in question keeps them.
 *
 * Arms 0–2 are classic, pre-Soroban metadata: they genuinely carry no contract
 * events, so an empty list is the accurate answer rather than a narrowed one.
 *
 * Arm 3 (`TransactionMetaV3`) keeps them under `sorobanMeta().events()`.
 *
 * Arm 4 (`TransactionMetaV4`, Protocol 23) moved them. Contract invocations now
 * emit their events per-operation, and the transaction carries a separate
 * stage-marked list for fee charges and refunds. Both are read: the classifier
 * below decides what is a token transfer, and it is not this function's job to
 * pre-judge which list one might arrive in.
 *
 * **An unrecognised arm throws.** This is the case that matters, and the one an
 * earlier version of this file got wrong: it returned `[]` for every arm that
 * was not 3, which silently reclassified Protocol 23 metadata as "classic, no
 * events" and produced a transaction whose real transfer went unrecorded. That
 * is exactly the narrowing this module exists to prevent — applied to the
 * metadata version rather than to a field, which is why it slipped through.
 * A version we cannot read may contain transfers we cannot see, and the honest
 * answer is to refuse.
 */
function readContractEvents(meta: xdr.TransactionMeta): xdr.ContractEvent[] {
  let arm: number;
  try {
    arm = meta.switch();
  } catch (error) {
    throw new ExtractionError(
      'unreadable_meta',
      'could not read the transaction metadata to determine whether it carries Soroban events',
      error instanceof Error ? error.message : String(error),
    );
  }

  // Classic metadata. No contract events exist to read.
  if (arm === 0 || arm === 1 || arm === 2) return [];

  if (arm === 3) {
    try {
      return meta.v3().sorobanMeta()?.events() ?? [];
    } catch (error) {
      throw new ExtractionError(
        'unreadable_meta',
        'transaction carries Soroban metadata whose event list could not be read; token movements cannot be established',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  if (arm === 4) {
    try {
      const v4 = meta.v4();
      const events: xdr.ContractEvent[] = [];
      // Transaction-level, stage-marked: fee charges and refunds live here.
      for (const transactionEvent of v4.events()) events.push(transactionEvent.event());
      // Per-operation: where an invoked contract's own events are emitted.
      for (const operation of v4.operations()) events.push(...operation.events());
      return events;
    } catch (error) {
      throw new ExtractionError(
        'unreadable_meta',
        'transaction carries Protocol 23 metadata whose event list could not be read; token movements cannot be established',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  throw new ExtractionError(
    'unreadable_meta',
    `transaction metadata version ${arm} is not one this extractor knows how to read, so it cannot establish which tokens moved; it may contain transfers that would go uncounted`,
    'supported: classic (v0–v2), Soroban v3, Protocol 23 v4',
  );
}

/**
 * `ContractEvent.contractId()` is declared as `xdr.Hash` but is a 32-byte
 * Buffer at runtime. The length check is what makes the conversion safe rather
 * than a blind cast.
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

function unreadableMovement(index: number, field: string, detail?: string): ExtractionError {
  return new ExtractionError(
    'unreadable_movement',
    `contract event ${index} is a token transfer whose ${field} could not be read, so the amount that moved cannot be established`,
    detail,
  );
}

/**
 * Recognises SEP-41 / Stellar Asset Contract `transfer` events:
 * topics `[symbol("transfer"), Address from, Address to, (string asset)?]`
 * with an i128 amount in the event data.
 *
 * Three-way classification, per the header:
 *
 *   ignore — provably not a token transfer (wrong event type, no topics, or a
 *            readable topic 0 that is not `transfer`). Nothing we model moved.
 *   throw  — topic 0 says `transfer`, or topic 0 cannot be read at all, and
 *            some field needed to record the movement is unreadable.
 *   accept — fully readable.
 */
function readMovements(meta: xdr.TransactionMeta): TokenMovement[] {
  const movements: TokenMovement[] = [];

  for (const [index, event] of readContractEvents(meta).entries()) {
    let topics: xdr.ScVal[];
    let eventType: string;
    try {
      eventType = event.type().name;
      topics = event.body().v0().topics();
    } catch (error) {
      // The event exists but its shape is unreadable, so we cannot rule out
      // that it is a transfer.
      throw unreadableMovement(index, 'event body', error instanceof Error ? error.message : String(error));
    }

    // Only contract events carry token transfers; diagnostic and system events
    // do not. Skipping these is classification, not a guess.
    if (eventType !== 'contract') continue;
    // A SEP-41 transfer always carries `symbol("transfer")` as topic 0. An
    // event with no topics at all definitively is not one.
    if (topics.length === 0) continue;

    let label: unknown;
    try {
      label = scValToNative(topics[0]!);
    } catch (error) {
      throw unreadableMovement(index, 'first topic, so it cannot be classified', error instanceof Error ? error.message : String(error));
    }

    if (label !== 'transfer') continue;

    // From here the event has told us a transfer happened. Every remaining
    // field is required; an unreadable one is a refusal, never a skip.
    if (topics.length < 3) {
      throw unreadableMovement(index, `topic list (a transfer needs from and to; got ${topics.length} topics)`);
    }

    const asset = encodeContractId(event.contractId());
    if (asset === undefined) {
      throw unreadableMovement(index, 'emitting token contract id');
    }

    let from: unknown;
    let to: unknown;
    let rawAmount: unknown;
    try {
      from = scValToNative(topics[1]!);
      to = scValToNative(topics[2]!);
      rawAmount = scValToNative(event.body().v0().data());
    } catch (error) {
      throw unreadableMovement(index, 'from/to/amount fields', error instanceof Error ? error.message : String(error));
    }

    if (typeof from !== 'string') throw unreadableMovement(index, 'from address');
    if (typeof to !== 'string') throw unreadableMovement(index, 'to address');

    const amount = normaliseAmount(rawAmount);
    if (amount === undefined) {
      throw unreadableMovement(
        index,
        'amount',
        `expected a non-negative integer in the asset's smallest unit, got ${JSON.stringify(rawAmount, bigintSafe)}`,
      );
    }

    movements.push({ asset, from, to, amount });
  }

  return movements;
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
    throw new ExtractionError(
      'no_invocations',
      'transaction contains no contract invocations; there is no agent flow here to derive a policy from',
    );
  }

  const movements = readMovements(response.resultMetaXdr);

  // With one invocation there is only one call the movements can belong to.
  // With more, the meta does not say, and neither do we.
  const attribution: MovementAttribution = invocations.length === 1 ? 'exact' : 'transaction-level';

  return {
    hash,
    network,
    ledger: response.ledger,
    source: inner.source,
    invocations,
    attribution,
    movements,
  };
}
