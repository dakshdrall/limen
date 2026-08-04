/**
 * A policy's address in this application.
 *
 * There is no such thing as a globally unique policy id on chain. A spending
 * limit is held by a policy contract *for* a (smart account, context rule id)
 * pair, and the rule id comes from a per-account counter — so rule 5 exists on
 * as many accounts as have created five rules. A route keyed on the rule id
 * alone would show one account's boundary under another account's policy.
 *
 * So `/app/policies/[id]` takes both, joined by a hyphen. Contract addresses are
 * base32 over `A-Z2-7` and rule ids are decimal, so neither half can contain the
 * separator and the split is unambiguous.
 */

export interface PolicyRef {
  contractId: string;
  ruleId: number;
}

export function formatPolicyId({ contractId, ruleId }: PolicyRef): string {
  return `${contractId}-${ruleId}`;
}

/**
 * Returns `null` rather than throwing or guessing. A malformed id in the URL is
 * a screen that says so, not a crash and not a redirect to some other account's
 * policy.
 */
export function parsePolicyId(id: string): PolicyRef | null {
  const match = /^(C[A-Z2-7]{55})-(\d{1,10})$/.exec(id);
  if (match === null) return null;
  return { contractId: match[1], ruleId: Number(match[2]) };
}
