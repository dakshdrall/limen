/**
 * What the venue says one unit buys, right now.
 *
 * `router_get_amounts_out(amount_in, path)` on the Soroswap router, read by
 * simulation. It costs no fee, needs no key, and it is the same contract a swap
 * will actually go through — so the number a decision is made on is the venue's
 * own rather than an oracle's opinion of it. Soroswap's Route API would give a
 * better *route* across pools; it needs a registered key, and a price check is
 * not what routing is for.
 *
 * ## Why this is in `@limen/chain` and not in the runtime
 *
 * It was in `apps/runtime/src/trading.ts`, which was the only caller while the
 * only thing that read a price was a cycle. The builder now has to read one
 * too: a stored trigger's `referencePrice` is stamped at configure time from
 * the live venue, so the web app needs the same call. Two copies of a quote is
 * the shape `venues.ts` refuses for the router address and for the same reason
 * — if the two ever disagreed about the probe amount, a trigger would be
 * configured against one price scale and evaluated against another, and both
 * halves would keep working while only the comparison was wrong.
 *
 * ## The ledger comes back with the price
 *
 * `balance.ts`'s rule, and a price is the same kind of claim: stale the moment
 * it is read. A caller that stores one — `agents.trigger_json` stores exactly
 * one — has to store the ledger beside it, and cannot if this does not return
 * it.
 */

import { Address, nativeToScVal } from '@stellar/stellar-sdk';
import { latestLedger } from './balance.js';
import { ContractReadError, simulateRead, type ReadOptions } from './read.js';
import { SOROSWAP_QUOTE_FN, SOROSWAP_TESTNET_ROUTER } from './venues.js';

/**
 * The input amount every price is quoted for.
 *
 * Prices are read as "how much output for this much input", so a fixed probe is
 * what makes two readings comparable — including one taken in the builder and
 * one taken in a cycle a week later. One whole unit at seven decimals: big
 * enough that pool rounding is not the signal, small enough not to move the
 * pool it is measuring.
 *
 * Changing this number invalidates every stored `referencePrice`, because a
 * reference is denominated in it. It is not a tuning knob.
 */
export const PRICE_PROBE_AMOUNT = 10_000_000n;

/** A price, and the ledger it was true at. */
export interface PriceReading {
  inputAsset: string;
  outputAsset: string;
  /** Output units received for {@link PRICE_PROBE_AMOUNT} of input. */
  outFor: bigint;
  probeAmount: bigint;
  /** The ledger this was read at. Every render or storage of `outFor` states it. */
  ledger: number;
}

/**
 * Ask the venue what one unit buys.
 *
 * Throws rather than returning a fallback. A cycle that traded on a price it
 * could not read would be trading on a guess, and *"the venue did not answer"*
 * is a real outcome a caller has to be able to report as itself —
 * `executeTradingDecision` reports it as `price_unavailable`, which is neither
 * a decision nor a failure to decide.
 */
export async function readPrice(
  options: ReadOptions,
  { inputAsset, outputAsset }: { inputAsset: string; outputAsset: string },
): Promise<PriceReading> {
  const amounts = (await simulateRead(options, SOROSWAP_TESTNET_ROUTER, SOROSWAP_QUOTE_FN, [
    nativeToScVal(PRICE_PROBE_AMOUNT, { type: 'i128' }),
    nativeToScVal([new Address(inputAsset), new Address(outputAsset)], { type: 'address' }),
  ])) as bigint[];

  // The last hop's output. A one-hop path returns two amounts and the second is
  // the answer; the index is taken from the end so a future multi-hop path does
  // not silently read an intermediate amount as the price.
  const out = amounts[amounts.length - 1];
  if (out === undefined) {
    throw new ContractReadError(
      SOROSWAP_TESTNET_ROUTER,
      SOROSWAP_QUOTE_FN,
      `no output amount for ${inputAsset}/${outputAsset}`,
    );
  }

  return {
    inputAsset,
    outputAsset,
    outFor: BigInt(out),
    probeAmount: PRICE_PROBE_AMOUNT,
    ledger: await latestLedger(options),
  };
}
