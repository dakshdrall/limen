/**
 * Which asset the trigger is about, and which way it has to move.
 *
 * This exists because of a silent trap, not because a screen was thin. A person
 * writes *"buy XLM when the price drops"*, fills the form with XLM as the token
 * the agent spends and USDC as the pair, sets a fall of 100 basis points, and
 * gets an agent that **sells** XLM when XLM drops. Nothing on any screen said
 * so. The strategy sentence and the installed behaviour are opposites, and the
 * only place the difference is visible is in the arithmetic.
 *
 * ## Where the inversion comes from
 *
 * `readPrice(input, output)` asks the venue what one unit of the **input** asset
 * buys, and returns that in units of the output asset. `evaluateTrigger` fires
 * when that number falls. So `price_drop` always means *the asset this agent
 * spends got cheaper* — and the asset it spends is the one the cap is installed
 * on, the one on the `Token contract` field.
 *
 * Reversing the pair does not reverse the strategy, it reverses the *price*.
 * With USDC in and XLM out, `outFor` is XLM-per-USDC, and XLM getting cheaper
 * makes that number go **up**. A `price_drop` trigger on that agent fires when
 * XLM *rises*. So buying a dip needs a rise trigger and a quote-funded account,
 * neither of which exists — recorded in PLAN-V8. Until they do, the honest thing
 * is to say plainly what the configured pair means.
 *
 * ## Derived, never written down
 *
 * Every value below comes from the draft the person is looking at. Static copy
 * naming XLM and USDC would be right for one pair and quietly wrong for the
 * next one, which is the same failure this module exists to close.
 */

import { truncateAddress } from '@/lib/format';
import type { AgentConfigDraft } from '@/lib/agent-config';

export interface TriggerDirection {
  /** The asset the agent spends. The trigger measures *its* price. */
  sells: string;
  /** The asset it receives, and the units the price is quoted in. */
  buys: string;
  dropBps: number;
  /** `100` -> `1%`. Display only; the basis points are the stored value. */
  percent: string;
  /** What a fall actually is, in the two assets' own names. */
  fallMeans: string;
}

/**
 * A label if one was typed, the contract otherwise.
 *
 * The label is display-only and a person can type anything into it, so it is
 * never the only thing on screen: the two contract fields sit directly above
 * this note. What the label buys is a sentence that reads like the strategy it
 * is contradicting, which is the point of writing the sentence at all.
 */
function nameOf(label: string, contractId: string): string | null {
  const trimmed = label.trim();
  if (trimmed.length > 0) return trimmed;
  const contract = contractId.trim();
  return contract.length > 0 ? truncateAddress(contract) : null;
}

/** Basis points as a percentage, with no trailing zeros: 100 -> `1%`. */
function asPercent(bps: number): string {
  return `${Number((bps / 100).toFixed(2))}%`;
}

/**
 * `null` when there is nothing true to say yet — no trigger, no pair, or a
 * fall that is not a number. A half-filled form gets no sentence rather than a
 * sentence with a hole in it.
 */
export function triggerDirection(draft: AgentConfigDraft): TriggerDirection | null {
  const raw = draft.triggerDropBps.trim();
  if (!/^[0-9]+$/.test(raw)) return null;
  const dropBps = Number(raw);
  if (!Number.isInteger(dropBps) || dropBps < 1 || dropBps >= 10_000) return null;

  const sells = nameOf(draft.assetLabel, draft.assetContractId);
  const buys = nameOf(draft.outputAssetLabel, draft.outputAssetContractId);
  if (sells === null || buys === null) return null;

  return {
    sells,
    buys,
    dropBps,
    percent: asPercent(dropBps),
    fallMeans: `fewer ${buys} for one ${sells}`,
  };
}
