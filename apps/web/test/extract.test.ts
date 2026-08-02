/**
 * The extractor is where "accurate or absent" is enforced, so these tests are
 * mostly about what it REFUSES. A silently-dropped movement produces an
 * `ObservedTransaction` that does not describe the transaction, and every
 * number downstream is then derived from a flow that was never observed.
 */

import { describe, expect, it } from 'vitest';
import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  xdr,
  type rpc,
} from '@stellar/stellar-sdk';
import { synthesize } from '@limen/core';
import { ExtractionError, UNREADABLE_ARG, extractObservedTransaction } from '@/lib/extract';

const SOURCE = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1));
const RECIPIENT = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2));

const TOKEN_RAW = Buffer.alloc(32, 7);
const TOKEN = StrKey.encodeContract(TOKEN_RAW);
const ROUTER_RAW = Buffer.alloc(32, 9);
const ROUTER = StrKey.encodeContract(ROUTER_RAW);

const LEDGER = 51_234;

/* --- builders ------------------------------------------------------------ */

function invokeOp(contract: string, fn: string, args: xdr.ScVal[] = []) {
  return Operation.invokeContractFunction({ contract, function: fn, args });
}

function envelope(operations: xdr.Operation[]): xdr.TransactionEnvelope {
  const builder = new TransactionBuilder(new Account(SOURCE.publicKey(), '1'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  });
  for (const operation of operations) builder.addOperation(operation);
  return builder.setTimeout(30).build().toEnvelope();
}

function contractEvent({
  contractId = TOKEN_RAW,
  topics,
  data,
  type = xdr.ContractEventType.contract(),
}: {
  contractId?: Buffer;
  topics: xdr.ScVal[];
  data: xdr.ScVal;
  type?: xdr.ContractEventType;
}): xdr.ContractEvent {
  return new xdr.ContractEvent({
    ext: new xdr.ExtensionPoint(0),
    contractId,
    type,
    body: new xdr.ContractEventBody(0, new xdr.ContractEventV0({ topics, data })),
  });
}

function transferEvent(from: string, to: string, amount: bigint, contractId = TOKEN_RAW) {
  return contractEvent({
    contractId,
    topics: [
      nativeToScVal('transfer', { type: 'symbol' }),
      nativeToScVal(from, { type: 'address' }),
      nativeToScVal(to, { type: 'address' }),
    ],
    data: nativeToScVal(amount, { type: 'i128' }),
  });
}

function meta(events: xdr.ContractEvent[]): xdr.TransactionMeta {
  return new xdr.TransactionMeta(
    3,
    new xdr.TransactionMetaV3({
      ext: new xdr.ExtensionPoint(0),
      txChangesBefore: [],
      operations: [],
      txChangesAfter: [],
      sorobanMeta: new xdr.SorobanTransactionMeta({
        ext: new xdr.SorobanTransactionMetaExt(0),
        events,
        returnValue: xdr.ScVal.scvVoid(),
        diagnosticEvents: [],
      }),
    }),
  );
}

/** Classic (pre-Soroban) meta: no contract events exist to read at all. */
function classicMeta(): xdr.TransactionMeta {
  return new xdr.TransactionMeta(0, []);
}

function response(
  operations: xdr.Operation[],
  transactionMeta: xdr.TransactionMeta,
): rpc.Api.GetSuccessfulTransactionResponse {
  return {
    ledger: LEDGER,
    envelopeXdr: envelope(operations),
    resultMetaXdr: transactionMeta,
  } as unknown as rpc.Api.GetSuccessfulTransactionResponse;
}

const hash = 'a'.repeat(64);
const extract = (ops: xdr.Operation[], m: xdr.TransactionMeta) =>
  extractObservedTransaction(hash, 'testnet', response(ops, m));

/* --- the happy path ------------------------------------------------------ */

describe('a readable transfer', () => {
  it('extracts the invocation and the movement', () => {
    const observed = extract(
      [invokeOp(TOKEN, 'transfer')],
      meta([transferEvent(SOURCE.publicKey(), RECIPIENT.publicKey(), 500_000_000n)]),
    );

    expect(observed.hash).toBe(hash);
    expect(observed.network).toBe('testnet');
    expect(observed.ledger).toBe(LEDGER);
    expect(observed.source).toBe(SOURCE.publicKey());
    expect(observed.invocations).toEqual([
      { contractId: TOKEN, functionName: 'transfer', args: [] },
    ]);
    expect(observed.movements).toEqual([
      {
        asset: TOKEN,
        from: SOURCE.publicKey(),
        to: RECIPIENT.publicKey(),
        amount: '500000000',
      },
    ]);
  });

  it('feeds synthesize a flow that derives the observed cap', () => {
    const observed = extract(
      [invokeOp(TOKEN, 'transfer')],
      meta([transferEvent(SOURCE.publicKey(), RECIPIENT.publicKey(), 500_000_000n)]),
    );
    const proposal = synthesize(observed);
    const limit = proposal.policies.find((p) => p.kind === 'spending_limit');
    expect(limit?.kind === 'spending_limit' && limit.limit).toBe('500000000');
  });
});

/* --- attribution --------------------------------------------------------- */

describe('attribution', () => {
  it('is exact when there is one invocation', () => {
    const observed = extract(
      [invokeOp(TOKEN, 'transfer')],
      meta([transferEvent(SOURCE.publicKey(), RECIPIENT.publicKey(), 1n)]),
    );
    expect(observed.attribution).toBe('exact');
  });

  it('is transaction-level when more than one invocation could have caused a movement', () => {
    const observed = extract(
      [invokeOp(TOKEN, 'approve'), invokeOp(ROUTER, 'swap')],
      meta([transferEvent(SOURCE.publicKey(), ROUTER, 1n)]),
    );
    // The meta does not say which call emitted the transfer, so neither do we.
    expect(observed.attribution).toBe('transaction-level');
    expect(observed.movements).toHaveLength(1);
  });

  it('does not change the derived policy either way', () => {
    // The whole argument for representing attribution rather than resolving it
    // is that no derived value depends on it. If that stops being true, this
    // fails.
    const single = extract(
      [invokeOp(TOKEN, 'transfer')],
      meta([transferEvent(SOURCE.publicKey(), RECIPIENT.publicKey(), 500n)]),
    );
    const multi = extract(
      [invokeOp(TOKEN, 'transfer'), invokeOp(TOKEN, 'transfer')],
      meta([transferEvent(SOURCE.publicKey(), RECIPIENT.publicKey(), 500n)]),
    );
    const capOf = (p: ReturnType<typeof synthesize>) =>
      p.policies.find((x) => x.kind === 'spending_limit');
    expect(capOf(synthesize(single))).toEqual(capOf(synthesize(multi)));
  });
});

/* --- what is correctly ignored ------------------------------------------- */

describe('events that are provably not token transfers are ignored, not refused', () => {
  it('ignores a non-contract event type', () => {
    const observed = extract(
      [invokeOp(TOKEN, 'transfer')],
      meta([
        contractEvent({
          type: xdr.ContractEventType.system(),
          topics: [nativeToScVal('transfer', { type: 'symbol' })],
          data: nativeToScVal(1n, { type: 'i128' }),
        }),
      ]),
    );
    expect(observed.movements).toEqual([]);
  });

  it('ignores an event with no topics', () => {
    const observed = extract(
      [invokeOp(TOKEN, 'transfer')],
      meta([contractEvent({ topics: [], data: xdr.ScVal.scvVoid() })]),
    );
    expect(observed.movements).toEqual([]);
  });

  it('ignores a readable non-transfer event', () => {
    const observed = extract(
      [invokeOp(TOKEN, 'mint')],
      meta([
        contractEvent({
          topics: [
            nativeToScVal('mint', { type: 'symbol' }),
            nativeToScVal(SOURCE.publicKey(), { type: 'address' }),
          ],
          data: nativeToScVal(1n, { type: 'i128' }),
        }),
      ]),
    );
    // Nothing we model moved out of the source, so there is nothing to record.
    expect(observed.movements).toEqual([]);
  });

  it('reads classic meta as having no contract events rather than as unreadable', () => {
    const observed = extract([invokeOp(TOKEN, 'transfer')], classicMeta());
    expect(observed.movements).toEqual([]);
  });
});

/* --- what is refused ----------------------------------------------------- */

describe('a transfer that cannot be fully read is refused, never narrowed', () => {
  it('refuses a transfer whose amount is not an integer', () => {
    const bad = contractEvent({
      topics: [
        nativeToScVal('transfer', { type: 'symbol' }),
        nativeToScVal(SOURCE.publicKey(), { type: 'address' }),
        nativeToScVal(RECIPIENT.publicKey(), { type: 'address' }),
      ],
      // A string where an i128 belongs: readable as an ScVal, not usable as an
      // amount. The old extractor skipped this and under-derived the cap.
      data: nativeToScVal('not-an-amount', { type: 'string' }),
    });

    expect(() => extract([invokeOp(TOKEN, 'transfer')], meta([bad]))).toThrow(ExtractionError);
    try {
      extract([invokeOp(TOKEN, 'transfer')], meta([bad]));
    } catch (error) {
      expect((error as ExtractionError).code).toBe('unreadable_movement');
      expect((error as ExtractionError).message).toContain('amount that moved cannot be established');
      expect((error as ExtractionError).detail).toContain('not-an-amount');
    }
  });

  it('refuses a transfer with a negative amount', () => {
    const bad = contractEvent({
      topics: [
        nativeToScVal('transfer', { type: 'symbol' }),
        nativeToScVal(SOURCE.publicKey(), { type: 'address' }),
        nativeToScVal(RECIPIENT.publicKey(), { type: 'address' }),
      ],
      data: nativeToScVal(-5n, { type: 'i128' }),
    });
    expect(() => extract([invokeOp(TOKEN, 'transfer')], meta([bad]))).toThrow(/amount/);
  });

  it('refuses a transfer missing its `to` topic', () => {
    const bad = contractEvent({
      topics: [
        nativeToScVal('transfer', { type: 'symbol' }),
        nativeToScVal(SOURCE.publicKey(), { type: 'address' }),
      ],
      data: nativeToScVal(1n, { type: 'i128' }),
    });
    expect(() => extract([invokeOp(TOKEN, 'transfer')], meta([bad]))).toThrow(/got 2 topics/);
  });

  it('refuses a transfer whose emitting contract id is malformed', () => {
    const bad = contractEvent({
      // 31 bytes: not a contract id, and not silently encodable as one.
      contractId: Buffer.alloc(31, 3),
      topics: [
        nativeToScVal('transfer', { type: 'symbol' }),
        nativeToScVal(SOURCE.publicKey(), { type: 'address' }),
        nativeToScVal(RECIPIENT.publicKey(), { type: 'address' }),
      ],
      data: nativeToScVal(1n, { type: 'i128' }),
    });
    expect(() => extract([invokeOp(TOKEN, 'transfer')], meta([bad]))).toThrow(/token contract id/);
  });

  it('refuses the whole transaction when one of several transfers is unreadable', () => {
    // The failure mode that matters: a good transfer alongside a bad one must
    // not produce a policy derived from the good one alone.
    const good = transferEvent(SOURCE.publicKey(), RECIPIENT.publicKey(), 1_000n);
    const bad = contractEvent({
      topics: [
        nativeToScVal('transfer', { type: 'symbol' }),
        nativeToScVal(SOURCE.publicKey(), { type: 'address' }),
        nativeToScVal(RECIPIENT.publicKey(), { type: 'address' }),
      ],
      data: nativeToScVal('nope', { type: 'string' }),
    });
    expect(() => extract([invokeOp(TOKEN, 'transfer')], meta([good, bad]))).toThrow(ExtractionError);
  });

  it('names the index of the offending event', () => {
    const good = transferEvent(SOURCE.publicKey(), RECIPIENT.publicKey(), 1n);
    const bad = contractEvent({
      topics: [
        nativeToScVal('transfer', { type: 'symbol' }),
        nativeToScVal(SOURCE.publicKey(), { type: 'address' }),
      ],
      data: nativeToScVal(1n, { type: 'i128' }),
    });
    expect(() => extract([invokeOp(TOKEN, 'transfer')], meta([good, good, bad]))).toThrow(
      /contract event 2/,
    );
  });
});

describe('transactions with nothing to derive from', () => {
  it('refuses a transaction with no contract invocations', () => {
    const payment = Operation.payment({
      destination: RECIPIENT.publicKey(),
      asset: Asset.native(),
      amount: '10',
    });
    expect(() => extract([payment], classicMeta())).toThrow(/no contract invocations/);
  });
});

describe('arguments', () => {
  it('records readable arguments and marks unreadable ones without failing', () => {
    const observed = extract(
      [invokeOp(TOKEN, 'transfer', [nativeToScVal(SOURCE.publicKey(), { type: 'address' })])],
      meta([]),
    );
    expect(observed.invocations[0]!.args).toEqual([SOURCE.publicKey()]);
    // The marker exists and is a distinct sentinel, so the UI can render it as
    // unreadable rather than as a value.
    expect(UNREADABLE_ARG).toBe('<unreadable>');
  });
});
