'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AccountReadError, AccountReadErrorCode, AccountSnapshot } from '@/lib/account-contract';
import { UNCONFIGURED_CODES } from '@/lib/account-contract';

/**
 * Reading an account's boundary from a screen.
 *
 * Deliberately not cached, deduplicated, or kept in a context. The rule the
 * whole chain layer is built on — the chain is the source of truth, the browser
 * stores only what the chain does not know — is worth very little if a store
 * quietly serves the previous answer to the next screen that asks. Every mount
 * re-reads.
 *
 * The cost is a round trip per screen, and it buys the guarantee that nothing
 * on screen is older than the ledger printed next to it.
 */

export type SnapshotState =
  | { status: 'pending' }
  | { status: 'ok'; snapshot: AccountSnapshot }
  | { status: 'failed'; code: AccountReadErrorCode; message: string; detail?: string; unconfigured: boolean };

/** A settled answer, tagged with the request it answers. */
type Settled = Exclude<SnapshotState, { status: 'pending' }>;

export function useAccountSnapshot(contractId: string | null): {
  state: SnapshotState;
  reload: () => void;
} {
  const [answer, setAnswer] = useState<{ key: string; state: Settled } | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  // Pending is *derived* from the answer not matching the request, rather than
  // written into state when the effect starts. Same rendering, one fewer place
  // for the two to disagree: there is no window in which a stale answer is
  // still on screen because the pending write has not landed yet.
  const key = `${contractId ?? ''}:${nonce}`;
  const state: SnapshotState = answer?.key === key ? answer.state : { status: 'pending' };

  const setState = useCallback((next: Settled, forKey: string) => {
    setAnswer({ key: forKey, state: next });
  }, []);

  useEffect(() => {
    if (contractId === null) return;

    // An unmounted or superseded read must not write its answer over a newer
    // one. Without this, switching accounts quickly can leave the previous
    // account's boundary rendered under the current account's address — which
    // is the single most dangerous mislabelling this screen could produce.
    let current = true;

    void (async () => {
      try {
        const response = await fetch(`/api/account/${contractId}`, { cache: 'no-store' });
        const body: unknown = await response.json();

        if (!current) return;

        if (!response.ok) {
          const { error } = body as AccountReadError;
          setState(
            {
              status: 'failed',
              code: error.code,
              message: error.message,
              detail: error.detail,
              unconfigured: UNCONFIGURED_CODES.has(error.code),
            },
            key,
          );
          return;
        }

        setState({ status: 'ok', snapshot: body as AccountSnapshot }, key);
      } catch (error) {
        if (!current) return;
        setState(
          {
            status: 'failed',
            code: 'rpc_failed',
            message: 'the read could not be sent from this browser',
            detail: error instanceof Error ? error.message : String(error),
            unconfigured: false,
          },
          key,
        );
      }
    })();

    return () => {
      current = false;
    };
  }, [contractId, key, setState]);

  return { state, reload };
}
