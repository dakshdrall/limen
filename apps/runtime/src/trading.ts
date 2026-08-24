/**
 * One trading cycle: read the price, decide, maybe swap, write it down.
 *
 * `executeTradingDecision` runs **once** per invocation. There is no scheduler,
 * no loop and no timer — something outside calls this, and what it does is
 * bounded by what one call can do. A cycle that scheduled itself would be an
 * agent nobody can stop by stopping asking.
 *
 * ## The strategy it evaluates is structured, and the prose is not
 *
 * An agent's description is a sentence a person wrote — *"buy XLM whenever the
 * price drops 5%, spend at most 20 USDC a day"*. This function does **not**
 * read that sentence. It evaluates a {@link TradingTrigger}, which the builder
 * collects and stores, and which says the same thing in numbers.
 *
 * That split is deliberate and is the honest version of "evaluate the strategy".
 * Parsing prose at cycle time would mean a trade whose reason cannot be
 * reproduced — the same sentence and the same price could decide differently on
 * two runs, and no record would say why. A structured trigger evaluated by a
 * pure function gives a decision anybody can recompute from the log.
 *
 * When an agent has no trigger, the cycle reads the price, records it, and
 * trades nothing. That is reported as what it is — *no trigger configured* —
 * rather than as a decision not to trade, because those are different facts.
 *
 * ## The price comes from the chain, not from an API
 *
 * `router_get_amounts_out(amount_in, path)` on the Soroswap router, read by
 * simulation. It costs no fee, needs no key, and it is the same contract the
 * swap will actually go through, so the number the decision is made on is the
 * venue's own. The Route API's `POST /quote` would give a better *route* across
 * pools; it needs a registered key and it is not what a price check is for.
 *
 * ## What bounds any of this
 *
 * Nothing here. The cycle can decide to trade whatever it likes; `swap_tokens`
 * gates it and the network refuses what exceeds the installed cap. A decision
 * function that also enforced limits would be the thing this project exists to
 * argue against — see `gate.ts`.
 */

import { Address, nativeToScVal, scValToNative, rpc, TransactionBuilder, Operation, Keypair } from '@stellar/stellar-sdk';
import { invokeContract } from '@limen/chain';
import { TESTNET_PASSPHRASE } from '@limen/chain/network';
import { SOROSWAP_TESTNET_ROUTER, swapTokens } from './tools/swap.js';
import type { ToolContext } from './tools/registry.js';
import type { ToolResult } from './tools/types.js';

/**
 * What makes this agent trade, in numbers.
 *
 * One shape, deliberately narrow. `dropBps` is a fall in the output-per-input
 * price relative to `referencePrice`, in basis points — 500 is the five percent
 * of the example sentence. A trigger this small covers one strategy honestly,
 * which is better than a general one that covers many badly.
 *
 * `TODO(roadmap)`: rises, ranges, and moving averages each need their own field
 * and their own test, and each should arrive with the builder input that
 * collects it.
 */
export interface TradingTrigger {
  kind: 'price_drop';
  /** The price this is measured against: output units per `probeAmount` input. */
  referencePrice: string;
  /** How far it must fall, in basis points of the reference. */
  dropBps: number;
  /** How much to trade when it fires, in the input asset's smallest unit. */
  amount: string;
}

export interface TradingConfig {
  inputAsset: string;
  outputAsset: string;
  trigger: TradingTrigger | null;
}

/**
 * The input amount every price is quoted for.
 *
 * Prices are read as "how much output for this much input", so a fixed probe
 * makes two readings comparable. One whole unit at seven decimals — big enough
 * that pool rounding is not the signal, small enough not to move the pool it is
 * measuring.
 */
export const PRICE_PROBE_AMOUNT = 10_000_000n;

export interface PriceReading {
  inputAsset: string;
  outputAsset: string;
  /** Output units received for {@link PRICE_PROBE_AMOUNT} of input. */
  outFor: bigint;
  probeAmount: bigint;
  ledger: number;
}

/**
 * Ask the venue what one unit buys, right now.
 *
 * A simulation, so nothing is signed and no fee is spent. It throws rather than
 * returning a fallback: a cycle that traded on a price it could not read would
 * be trading on a guess, and "the venue did not answer" is a real outcome the
 * caller has to be able to report.
 */
export async function readPrice(
  options: { rpcUrl: string; simulationSource: string },
  { inputAsset, outputAsset }: { inputAsset: string; outputAsset: string },
): Promise<PriceReading> {
  const server = new rpc.Server(options.rpcUrl);
  const account = await server.getAccount(options.simulationSource);
  const tx = new TransactionBuilder(account, { fee: '1000000', networkPassphrase: TESTNET_PASSPHRASE })
    .addOperation(
      Operation.invokeHostFunction({
        func: invokeContract(SOROSWAP_TESTNET_ROUTER, 'router_get_amounts_out', [
          nativeToScVal(PRICE_PROBE_AMOUNT, { type: 'i128' }),
          nativeToScVal([new Address(inputAsset), new Address(outputAsset)], { type: 'address' }),
        ]),
        auth: [],
      }),
    )
    .setTimeout(60)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`the venue could not quote ${inputAsset}/${outputAsset}: ${sim.error.split('\n')[0]}`);
  }
  const amounts = scValToNative(sim.result!.retval) as bigint[];
  const out = amounts[amounts.length - 1];
  if (out === undefined) throw new Error('the venue returned no output amount');

  return {
    inputAsset,
    outputAsset,
    outFor: BigInt(out),
    probeAmount: PRICE_PROBE_AMOUNT,
    ledger: (await server.getLatestLedger()).sequence,
  };
}

export type TriggerVerdict =
  | { fires: true; amount: bigint; reason: string }
  | { fires: false; reason: string };

/**
 * Does this trigger fire at this price?
 *
 * Pure, so a decision can be recomputed from the log without a network. That is
 * the whole reason the trigger is structured: *"it traded because XLM was 6.2%
 * below the reference of 2,500,000"* is a sentence somebody can check.
 */
export function evaluateTrigger(trigger: TradingTrigger | null, price: PriceReading): TriggerVerdict {
  if (trigger === null) {
    return {
      fires: false,
      reason: 'This agent has no trigger configured, so there is nothing to evaluate and nothing was traded.',
    };
  }

  const reference = BigInt(trigger.referencePrice);
  if (reference <= 0n) {
    return { fires: false, reason: 'The reference price is not a positive number, so no drop can be measured.' };
  }

  if (price.outFor >= reference) {
    const upBps = ((price.outFor - reference) * 10_000n) / reference;
    return {
      fires: false,
      reason:
        `The price is ${price.outFor} per ${price.probeAmount}, which is ${upBps} basis points at or above ` +
        `the reference of ${reference}. The trigger fires on a fall of ${trigger.dropBps}.`,
    };
  }

  // Integer basis points throughout. A float here would make two runs on the
  // same numbers able to disagree at the boundary, which is the one place a
  // trading decision must not be able to.
  const dropBps = ((reference - price.outFor) * 10_000n) / reference;
  if (dropBps < BigInt(trigger.dropBps)) {
    return {
      fires: false,
      reason:
        `The price is ${dropBps} basis points below the reference of ${reference}, and the trigger needs ` +
        `${trigger.dropBps}.`,
    };
  }

  return {
    fires: true,
    amount: BigInt(trigger.amount),
    reason:
      `The price is ${dropBps} basis points below the reference of ${reference}, which meets the ` +
      `trigger's ${trigger.dropBps}. Trading ${trigger.amount} of ${price.inputAsset}.`,
  };
}

export interface CycleResult {
  price: PriceReading | null;
  verdict: TriggerVerdict | null;
  /** The swap's result, when one was attempted. Null when the trigger did not fire. */
  swap: ToolResult | null;
  /** The transaction hash, when a swap reached a ledger — refused or not. */
  hash: string | null;
  summary: string;
}

/**
 * One cycle.
 *
 * Read, evaluate, maybe trade, record. Every branch writes an audit row,
 * including the ones that trade nothing — a cycle that ran and decided not to
 * act is a fact worth keeping, and an activity log that only shows trades makes
 * an agent look busier than it is.
 */
export async function executeTradingDecision(
  ctx: ToolContext,
  config: TradingConfig,
): Promise<CycleResult> {
  let price: PriceReading;
  try {
    price = await readPrice(ctx.read, config);
  } catch (error) {
    const summary =
      `The venue could not be asked for a price, so nothing was decided and nothing was traded. ` +
      `${error instanceof Error ? error.message : String(error)}`;
    await ctx.store.audit({
      actor: 'agent',
      actorId: ctx.agent.id,
      action: 'trading.cycle',
      target: ctx.agent.smartAccount,
      result: 'price_unavailable',
      metadata: { turnId: ctx.turnId, summary },
    });
    return { price: null, verdict: null, swap: null, hash: null, summary };
  }

  const verdict = evaluateTrigger(config.trigger, price);

  if (!verdict.fires) {
    await ctx.store.audit({
      actor: 'agent',
      actorId: ctx.agent.id,
      action: 'trading.cycle',
      target: ctx.agent.smartAccount,
      result: 'no_trade',
      metadata: {
        turnId: ctx.turnId,
        price: price.outFor.toString(),
        probeAmount: price.probeAmount.toString(),
        ledger: price.ledger,
        reason: verdict.reason,
      },
    });
    return { price, verdict, swap: null, hash: null, summary: verdict.reason };
  }

  // The trigger fired. Everything from here is `swap_tokens`, unchanged — the
  // gate refuses what only Limen can see, and the network refuses what exceeds
  // the cap. This function adds no limit of its own.
  const swap = await swapTokens.run(
    {
      inputAsset: config.inputAsset,
      outputAsset: config.outputAsset,
      stroops: verdict.amount.toString(),
    },
    ctx,
  );

  const hash = 'evidence' in swap && swap.evidence !== null ? swap.evidence.hash : null;

  await ctx.store.audit({
    actor: 'agent',
    actorId: ctx.agent.id,
    action: 'trading.cycle',
    target: ctx.agent.smartAccount,
    result: swap.outcome,
    metadata: {
      turnId: ctx.turnId,
      price: price.outFor.toString(),
      probeAmount: price.probeAmount.toString(),
      ledger: price.ledger,
      reason: verdict.reason,
      amount: verdict.amount.toString(),
      hash,
    },
  });

  return { price, verdict, swap, hash, summary: `${verdict.reason} ${swap.summary}` };
}
