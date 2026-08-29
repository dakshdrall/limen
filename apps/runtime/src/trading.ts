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
 * ## The price comes from the chain, and no longer from here
 *
 * `readPrice` moved to `@limen/chain`'s `quote.ts` when the builder needed the
 * same call: a stored trigger's reference is stamped from the live venue at
 * configure time, and two copies of a quote could disagree about the probe
 * amount a reference is denominated in. This module still owns the *decision*;
 * it no longer owns the read.
 *
 * ## What bounds any of this
 *
 * Nothing here. The cycle can decide to trade whatever it likes; `swap_tokens`
 * gates it and the network refuses what exceeds the installed cap. A decision
 * function that also enforced limits would be the thing this project exists to
 * argue against — see `gate.ts`.
 */

import { PRICE_PROBE_AMOUNT, readPrice, type PriceReading } from '@limen/chain';
import { swapTokens } from './tools/swap.js';
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
  /**
   * The ledger `referencePrice` was read at.
   *
   * A price is a read, and every stored read in this project states when it was
   * taken. It is also the only way to tell a reference a person accepted at
   * configure time from one a later cycle re-stamped: the ledger moves with the
   * price, so *"this reference is from three weeks ago"* and *"this reference is
   * from the trade an hour ago"* are distinguishable without the audit log —
   * though the audit log carries both halves too.
   */
  referenceLedger: number;
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
 * Re-exported so a caller reasoning about a cycle has one import.
 *
 * The definitions live in `@limen/chain/quote.js`; these names are part of this
 * module's surface because `evaluateTrigger` takes a {@link PriceReading} and a
 * reference is denominated in {@link PRICE_PROBE_AMOUNT}.
 */
export { PRICE_PROBE_AMOUNT, readPrice, type PriceReading };

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

/**
 * Whether this cycle moves the trigger's reference, and where to.
 *
 * ## Why a re-stamp exists at all
 *
 * A reference stamped once at configure time and never touched makes a
 * one-shot, not an agent. After the trigger fires the price is below the
 * reference, and it stays below until it recovers — so the agent either fires
 * on every cycle forever or, if the price recovers past the reference, never
 * fires again. Neither is a trading strategy; both are an artefact of the
 * reference being frozen.
 *
 * So a cycle that actually traded re-stamps the reference to the price it
 * traded at, and the agent buys each further fall.
 *
 * ## The three conditions, and why each is a refusal rather than a filter
 *
 * 1. **Only on `succeeded`.** A refusal — by Limen, by the network, by an
 *    over-cap `spending_limit` — moved no money, and moving the strategy
 *    because a trade was *rejected* would let a bounded agent walk its own
 *    trigger down by repeatedly proposing trades it is not allowed to make.
 *    The reference tracks what the agent *did*, never what it attempted.
 * 2. **Downward only.** The new reference must be strictly below the old one.
 *    This is what makes the re-stamp a ratchet: every application makes the
 *    trigger harder to fire, never easier. An upward re-stamp is take profit —
 *    a different strategy with its own trigger kind — and not the unwritten
 *    half of this one.
 * 3. **A trigger must exist.** There is nothing to re-stamp otherwise, and an
 *    agent with no trigger did not trade on one.
 *
 * Pure, for `evaluateTrigger`'s reason: the decision to move a stored strategy
 * has to be recomputable from the audit row by hand. The second refusal —
 * downward only — is also enforced in the `WHERE` clause of the UPDATE that
 * writes it, so a widening re-stamp is impossible at the database and not
 * merely absent from this function.
 */
export type RestampVerdict =
  | { restamps: true; from: string; to: string; ledger: number; reason: string }
  | { restamps: false; reason: string };

export function restampReference(
  trigger: TradingTrigger | null,
  price: PriceReading,
  outcome: ToolResult['outcome'],
): RestampVerdict {
  if (trigger === null) {
    return { restamps: false, reason: 'There is no trigger, so there is no reference to move.' };
  }

  if (outcome !== 'succeeded') {
    return {
      restamps: false,
      reason:
        `This cycle ended as ${outcome} rather than succeeding, so no money moved and the ` +
        `reference stays at ${trigger.referencePrice}. A reference tracks what this agent traded, ` +
        'never what it attempted.',
    };
  }

  const reference = BigInt(trigger.referencePrice);
  if (price.outFor >= reference) {
    return {
      restamps: false,
      reason:
        `The traded price of ${price.outFor} is at or above the reference of ${reference}, and a ` +
        'reference only ever moves down. Moving it up would loosen this trigger, which is take ' +
        'profit and is a different strategy.',
    };
  }

  return {
    restamps: true,
    from: trigger.referencePrice,
    to: price.outFor.toString(),
    ledger: price.ledger,
    reason:
      `This cycle traded at ${price.outFor}, below the reference of ${reference}, so the reference ` +
      `moves down to ${price.outFor} at ledger ${price.ledger}. The next fall is measured from there.`,
  };
}

export interface CycleResult {
  price: PriceReading | null;
  verdict: TriggerVerdict | null;
  /** The swap's result, when one was attempted. Null when the trigger did not fire. */
  swap: ToolResult | null;
  /** The transaction hash, when a swap reached a ledger — refused or not. */
  hash: string | null;
  /**
   * Whether this cycle moved the trigger's reference, and why or why not.
   *
   * Null only when there was no price to judge against — the venue could not be
   * asked. Every other cycle returns a verdict, including the overwhelming
   * majority that do not re-stamp, because *"the reference did not move"* is a
   * fact about a stored strategy and should not be inferred from silence.
   */
  restamp: RestampVerdict | null;
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
    return { price: null, verdict: null, swap: null, hash: null, restamp: null, summary };
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
    return {
      price,
      verdict,
      swap: null,
      hash: null,
      // Not `null`: a cycle that read a price and chose not to trade has a
      // real answer to "did the reference move", and it is no.
      restamp: {
        restamps: false,
        reason: 'This cycle traded nothing, so there was nothing to move the reference to.',
      },
      summary: verdict.reason,
    };
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

  // The strategy moves only after the trade that justifies it is recorded, and
  // only ever downward. `restampReference` gives the reason either way; the
  // UPDATE refuses an upward move a second time, in SQL.
  const restamp = restampReference(config.trigger, price, swap.outcome);
  if (restamp.restamps) {
    const next: TradingTrigger = {
      ...(config.trigger as TradingTrigger),
      referencePrice: restamp.to,
      referenceLedger: restamp.ledger,
    };
    const applied = await ctx.store.restampTrigger({
      agentId: ctx.agent.id,
      // The new reference, not the old one. The guard reads "the stored
      // reference must still be above this", so passing the value being
      // replaced would compare a number against itself and refuse every write.
      mustBeAbove: restamp.to,
      trigger: next,
    });

    // Its own audit row rather than a field on the cycle's, because this is a
    // different kind of event: the cycle is something the agent did, and this
    // is the agent's stored strategy changing with no person present. That
    // deserves a name somebody can grep for, and the pair of prices on the row
    // is what makes the change reconstructible from the log alone.
    await ctx.store.audit({
      actor: 'agent',
      actorId: ctx.agent.id,
      action: 'trading.restamp',
      target: ctx.agent.smartAccount,
      result: applied ? 'restamped' : 'not_restamped',
      metadata: {
        turnId: ctx.turnId,
        referenceFrom: restamp.from,
        referenceTo: restamp.to,
        referenceLedger: restamp.ledger,
        hash,
        reason: applied
          ? restamp.reason
          : // The database refused it. Either something else moved the reference
            // between the read and this write, or the guard caught a widening
            // this function should have caught first. Recorded rather than
            // retried: a second attempt would be racing the same row again.
            `${restamp.reason} The write did not apply — the stored reference was no longer above ` +
            `${restamp.to} when it ran, so the reference was left as it stands.`,
      },
    });
  }

  return {
    price,
    verdict,
    swap,
    hash,
    restamp,
    summary: `${verdict.reason} ${swap.summary}`,
  };
}
