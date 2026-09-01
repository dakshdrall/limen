/**
 * Which rule in a reviewed plan is the boundary, and which is the venue.
 *
 * Pure, and separate from the route that uses it, because the way it was
 * previously written was wrong in two ways at once and only one of them was
 * visible:
 *
 *     const planned = policy.installPlan.rules[0];
 *     if (planned === undefined || policy.installPlan.rules.length !== 1) …
 *
 * The visible half is the length check. It was correct while a boundary was one
 * rule, and became the thing standing between a reviewed trading plan and its
 * record the moment a trading agent's boundary became two — the token rule
 * carrying the cap and the venue rule authorizing the router.
 *
 * The invisible half is `rules[0]`, and it would have survived deleting the
 * first. `lower()` sorts a plan's rules by contract address, which it says
 * where it does it, so position is not a fact about which rule is which. For
 * the one pair this product ships — Soroswap's router `CCJUD5…` and the XLM SAC
 * `CDLZFC…` — `rules[0]` is the **venue**: the rule with no policies, no cap
 * and no asset. Relaxing the length check without moving off the index would
 * have compared the reviewed cap against a rule that carries none, and the
 * comparison would have failed on `The installed rule carries no spending
 * limit` — a message about the ledger, describing a mistake made here.
 *
 * So the boundary is found by what it carries. `DeployStep` already picks it
 * that way when it decides which returned rule id is which, and this is the
 * same claim made on the server, where it is checked rather than reported.
 *
 * ## Why a venue rule the plan describes must also have been reported
 *
 * `gate.ts` looks a venue rule up **by the id saved at deployment**. A
 * deployment recorded without one is an agent whose swaps have no rule to
 * authorize the router call, so every cycle refuses — and the row still says
 * `ACTIVE`. That is the failure the route's own header calls the most expensive
 * one it can let through, *because it looks like success*, and it is refused
 * here for the same reason the reported agent key is checked against the held
 * one.
 */

import type { InstallPlan, PlannedContextRule } from '@limen/chain';

export type DeploymentShape =
  | { ok: true; boundary: PlannedContextRule; venue: PlannedContextRule | null }
  | { ok: false; message: string };

/** A rule that carries the cap. There is exactly one in a recordable plan. */
function carriesLimit(rule: PlannedContextRule): boolean {
  return rule.policies.some((policy) => policy.kind === 'spending_limit');
}

/** A rule that carries nothing. That is what makes it a venue — see `lower.ts`. */
function isVenue(rule: PlannedContextRule): boolean {
  return rule.policies.length === 0;
}

/**
 * @param venueContextRuleId what the deploying client reported, or null.
 */
export function deploymentShape(
  plan: InstallPlan,
  { venueContextRuleId }: { venueContextRuleId: number | null },
): DeploymentShape {
  const capped = plan.rules.filter(carriesLimit);
  const venues = plan.rules.filter(isVenue);

  const boundary = capped[0];
  if (boundary === undefined || capped.length !== 1) {
    return {
      ok: false,
      message:
        `The reviewed plan describes ${capped.length} rules carrying a spending limit, and a deployment ` +
        'records exactly one boundary. Nothing was recorded.',
    };
  }
  if (capped.length + venues.length !== plan.rules.length) {
    // Neither capped nor empty: a rule carrying some policy that is not a
    // spending limit. Nothing lowers to one today, and recording it as either
    // kind would be recording authority under the wrong description.
    return {
      ok: false,
      message:
        'The reviewed plan describes a rule that is neither the boundary nor a venue. Nothing was recorded.',
    };
  }
  if (venues.length > 1) {
    // The row holds one venue id. A plan with two would record one and drop
    // the other, and the dropped one is authority nothing would ever mention.
    return {
      ok: false,
      message:
        `The reviewed plan describes ${venues.length} venue rules, and a deployment records one. ` +
        'Nothing was recorded.',
    };
  }

  const venue = venues[0] ?? null;
  if (venue !== null && venueContextRuleId === null) {
    return {
      ok: false,
      message:
        `The reviewed plan installs a venue rule on ${venue.contract ?? 'no contract'} and this deployment ` +
        'reported no venue rule id. An agent recorded without it would be recorded as active and refused ' +
        'at every swap. Nothing was recorded.',
    };
  }

  return { ok: true, boundary, venue };
}
