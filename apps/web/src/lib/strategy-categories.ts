/**
 * The four strategy categories, as written copy and nothing else.
 *
 * These are product descriptions a person wrote. They are filed here so there
 * is one place they live, and this module deliberately has no consumer: no
 * screen reads it, nothing validates against it, and nothing on chain or in the
 * runtime knows these names exist.
 *
 * ## They say what to trade, not when
 *
 * Every one of these is an *asset-selection* statement — which universe an
 * agent draws from. None of them is a trigger. `executeTradingDecision`
 * evaluates a `TradingTrigger` — a reference price, a fall in basis
 * points, and a size. Nothing in the four sentences below reduces to those
 * three numbers, so putting a picker over them on the builder would leave the
 * Run Agent screen still asking a person for the trigger at cycle time, which
 * is the thing that makes it a button rather than an agent.
 *
 * When there is a stored trigger, a category selects `allowedPairs` and sits on
 * top of it. It does not replace it.
 *
 * ## What Limen can actually execute, as of 2026-08-27
 *
 * One venue: Soroswap's testnet router, `swap_exact_tokens_for_tokens`, spot,
 * on Stellar testnet. One pair has ever executed — XLM/USDC (PLAN-V8 C1). One
 * price source: `router_get_amounts_out` on that router, quoting one pair at a
 * time.
 *
 * Measured against that, none of these four is expressible as written:
 *
 *   - `bluechip` names BTC and ETH, which have no liquid Soroswap testnet
 *     market. Its *shape* — one deep major pair, capital preservation over
 *     return — is the only one of the four that survives narrowing to
 *     XLM/USDC, and it survives by changing the assets it names.
 *   - `hip3` describes Hyperliquid builder-perps. A different chain, a
 *     different venue, and perps rather than spot AMM swaps. Nothing in this
 *     repository executes it.
 *   - `trending` needs a multi-asset universe with relative strength and
 *     volume. Limen reads one price for one pair per cycle and stores no
 *     history, so there is nothing to rank.
 *   - `tradeXyz` names an engine — Cortex Alpha — that does not exist in this
 *     repository.
 *
 * Three of the four describe a product running somewhere else. That is not an
 * argument against writing them down; it is the reason the note is attached to
 * them rather than left to be rediscovered.
 */

export interface StrategyCategory {
  id: string;
  label: string;
  description: string;
}

export const STRATEGY_CATEGORIES: readonly StrategyCategory[] = [
  {
    id: 'bluechip',
    label: 'BlueChip',
    description:
      'Strategies focused on high-liquidity assets like BTC and ETH. Prioritizes consistency and ' +
      'capital preservation over aggressive returns.',
  },
  {
    id: 'hip3',
    label: 'HIP-3 [RWA assets]',
    description:
      'Targets the Hyperliquid builder-perp (HIP-3) ecosystem, which spans real-world markets like ' +
      'equities, stocks, commodities and other builder-deployed assets. Captures momentum across ' +
      'these markets, with higher APR potential and higher volatility.',
  },
  {
    id: 'trending',
    label: 'Trending',
    description:
      'Momentum-based strategies. Scans for assets with the highest relative strength and volume, ' +
      'entering and exiting as trends develop.',
  },
  {
    id: 'tradeXyz',
    label: 'Trade[XYZ]',
    description:
      'Broad-market strategies running across mixed asset classes via the Cortex Alpha engine.',
  },
] as const;
