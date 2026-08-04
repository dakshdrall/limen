'use client';

import { useEffect, useState } from 'react';
import type { PolicyProposal } from '@limen/core';
import type { InstallPlan, LowerFailure, LowerRefusal, LowerSuccess } from '@/lib/lower-contract';

/**
 * "Could an OpenZeppelin smart account actually hold this boundary?"
 *
 * Two screens ask it now — `/app/policies/new`, on the way to installing, and
 * `/app/simulator`, which installs nothing and asks anyway. They must get the
 * same answer in the same words, because the simulator's whole claim to being
 * honest is that the boundary it draws is the one the real path would refuse or
 * write. Two copies of this effect would drift, and the direction they drift is
 * predictable: the screen with no install button is the one where an
 * unenforceable boundary costs nothing to render as fine.
 *
 * The round-trip is to `/api/lower` rather than a direct call because `lower`
 * is exported from `@limen/chain`'s index alongside modules that pull in the
 * Stellar SDK — see `lib/lower-contract.ts`.
 */

export type LowerState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'lowered'; plan: InstallPlan }
  | { status: 'refused'; constraint: string; message: string }
  | { status: 'failed'; message: string };

/** A settled answer, tagged with the proposal it answers. */
type Settled = Exclude<LowerState, { status: 'idle' } | { status: 'pending' }>;

/**
 * `null` means there is nothing to lower — synthesis refused, or nothing has
 * been observed yet — and returns `idle` rather than an empty success.
 *
 * The answer is keyed on the serialized proposal, so a plan derived from the
 * previous transaction is never on screen beside this one's boundary. While a
 * new proposal is outstanding the state is `pending`, not the stale answer.
 */
export function useLowering(proposal: PolicyProposal | null): LowerState {
  const serialized = proposal === null ? null : JSON.stringify(proposal);
  const [answer, setAnswer] = useState<{ key: string; state: Settled } | null>(null);

  useEffect(() => {
    if (serialized === null) return;

    let current = true;

    void (async () => {
      try {
        const response = await fetch('/api/lower', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: `{"proposal":${serialized}}`,
        });
        const body: unknown = await response.json();
        if (!current) return;

        if (response.status === 422) {
          const { refusal } = body as LowerRefusal;
          setAnswer({
            key: serialized,
            state: { status: 'refused', constraint: refusal.constraint, message: refusal.message },
          });
          return;
        }
        if (!response.ok) {
          setAnswer({
            key: serialized,
            state: { status: 'failed', message: (body as LowerFailure).error.message },
          });
          return;
        }
        setAnswer({ key: serialized, state: { status: 'lowered', plan: (body as LowerSuccess).plan } });
      } catch (error) {
        if (!current) return;
        setAnswer({
          key: serialized,
          state: {
            status: 'failed',
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    })();

    return () => {
      current = false;
    };
  }, [serialized]);

  if (serialized === null) return { status: 'idle' };
  return answer?.key === serialized ? answer.state : { status: 'pending' };
}
