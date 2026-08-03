/**
 * The wire contract for `/api/account/[id]/activity`.
 *
 * The types come straight from `@limen/chain` — they are plain data with no SDK
 * value in them, so re-exporting the types costs the browser nothing, and
 * restating them here would create a second definition to drift.
 */

import type { ActivityEvent, ActivityWindow } from '@limen/chain';

export type { ActivityEvent, ActivityWindow };

export interface ActivityResponse {
  contractId: string;
  events: ActivityEvent[];
  /**
   * What was actually scanned. Rendering the events without this would turn
   * "we looked at four days and found nothing" into "nothing ever happened".
   */
  window: ActivityWindow;
  /** The policy contracts scanned alongside the account, read off the account. */
  policyContracts: string[];
}

/**
 * One line per event kind, in the second person, for a table cell.
 *
 * Kept out of the chain package on purpose: `events.ts` decodes what the
 * contracts emit and should not also own how a screen words it. `unknown` has
 * no entry — an unrecognised event is rendered with its raw name, because
 * inventing a description for an event this build has never seen is precisely
 * the guess the decoder refused to make.
 */
export const ACTIVITY_DESCRIPTIONS: Record<string, string> = {
  context_rule_added: 'context rule created',
  context_rule_removed: 'context rule removed',
  policy_registered: 'policy contract registered on the account',
  policy_removed: 'policy contract removed from the account',
  signer_registered: 'signer registered on the account',
  signer_removed: 'signer removed from the account',
  spending_limit_installed: 'spending limit installed',
  spending_limit_enforced: 'spend permitted and counted against the limit',
  spending_limit_uninstalled: 'spending limit removed',
  spending_limit_changed: 'spending limit changed',
};
