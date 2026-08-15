/**
 * Judging a settled write, in the one place that does it.
 *
 * PLAN-V7 §3.4. This was a private function inside `AgentRunSteps`, which was
 * fine while exactly one screen ran the agent. `/app/try` runs the same five
 * steps, and the distinction below is the single most load-bearing judgement in
 * the product — a second copy of it is the copy that eventually rounds a missing
 * rule up to a refusal.
 *
 * Lifted unchanged. Its behaviour is pinned by the steps that exercise it in
 * `e2e/account-lifecycle.spec.ts`, which asserts a decoded contract error code
 * on every deny rather than inferring a refusal from an absence.
 */

import { isBoundaryRefusal, isRevokedRule } from '@limen/chain/errors';
import type { WriteState } from '@/lib/use-write';

export interface VerdictReading {
  state: 'permitted' | 'denied' | 'rule-revoked';
  note: string;
}

/**
 * The verdict for a settled step, or `null` while there is nothing to judge.
 *
 * `expected` is what a *successful* run of this step looks like: the permitted
 * spend should be permitted; the over-cap attempt, the agent's revoke and the
 * post-revoke repeat should be refused. It is not used to decide the verdict —
 * the codes are — but to keep an on-ledger success from rendering as a permit on
 * a step where success would mean the boundary failed.
 */
export function verdictFor(state: WriteState, expected: 'permit' | 'deny'): VerdictReading | null {
  if (state.status !== 'onLedger') return null;

  if (state.ok) {
    return expected === 'permit'
      ? { state: 'permitted', note: 'The network ran it and it succeeded.' }
      : {
          state: 'permitted',
          note: 'This succeeded, and on this step that means the boundary did not hold. It is reported as it happened.',
        };
  }

  if (isRevokedRule(state.codes)) {
    return {
      state: 'rule-revoked',
      note: 'The rule is gone, so nothing refused this — there was no boundary left to consult. Not counted as a refusal.',
    };
  }

  if (isBoundaryRefusal(state.codes)) {
    return { state: 'denied', note: 'Refused by the policy contract, executed by the host.' };
  }

  return {
    state: 'denied',
    note: 'It failed on a ledger, but no code identifying a boundary refusal was decoded — so it is not attributable to the boundary.',
  };
}
