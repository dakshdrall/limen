'use client';

import { useCallback, useRef, useState } from 'react';
import {
  toWriteOutcome,
  type SubmitResultLike,
  type WriteOutcome,
} from '@/lib/chain-write';

/**
 * Running the write steps a screen is made of, and remembering what each did.
 *
 * The flows on these screens are sequences — fund, deploy; or permitted,
 * refused, revoke, refused-again — where every step produces a hash that stays
 * on screen while the next one runs. So this holds a *log* keyed by step rather
 * than one current state: a screen that replaced the permitted transfer's hash
 * with the refusal's would have thrown away half of the evidence at the moment
 * it became meaningful.
 *
 * ## The guard is a ref, not the state
 *
 * `busy` is checked and set synchronously before any `await`. React batches
 * state updates, so two clicks landing in the same tick would both read
 * `running === false` from state and both submit. Here that costs a duplicate
 * smart account and a second fee, and — on the agent screens — a second
 * transaction whose refusal is indistinguishable from the first except by hash.
 * A disabled attribute is a hint to a person; this is the mechanism.
 */

export type WriteState =
  | { status: 'idle' }
  | { status: 'running'; what: string }
  | WriteOutcome;

const IDLE: WriteState = { status: 'idle' };

export interface WriteLog {
  /** The state of one step, `idle` if it has not run. */
  stateOf: (key: string) => WriteState;
  /** True while any step is in flight. Every submitting control reads this. */
  busy: boolean;
  /**
   * Run one step. Resolves to its outcome so a caller can sequence on it —
   * a screen that installs after deploying needs the contract address, and
   * chaining on the returned value is clearer than watching state.
   */
  run: (
    key: string,
    what: string,
    fn: () => Promise<SubmitResultLike>,
  ) => Promise<WriteOutcome | null>;
  /**
   * Record something that is not a submission — a friendbot call, a read — so
   * it appears in the same log as the transactions around it.
   */
  note: (key: string, outcome: WriteOutcome) => void;
  reset: () => void;
}

export function useWriteLog(): WriteLog {
  const [entries, setEntries] = useState<Record<string, WriteState>>({});
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const stateOf = useCallback((key: string): WriteState => entries[key] ?? IDLE, [entries]);

  const note = useCallback((key: string, outcome: WriteOutcome) => {
    setEntries((current) => ({ ...current, [key]: outcome }));
  }, []);

  const run = useCallback(
    async (key: string, what: string, fn: () => Promise<SubmitResultLike>) => {
      // Synchronous, before the first await. See the note above.
      if (busyRef.current) return null;
      busyRef.current = true;
      setBusy(true);
      setEntries((current) => ({ ...current, [key]: { status: 'running', what } }));

      let outcome: WriteOutcome;
      try {
        outcome = toWriteOutcome(what, await fn());
      } catch (error) {
        // Anything thrown before a submission is a browser-side failure and
        // never a refusal: the network was not asked. `assertTestnet` and
        // `assertDistinctSigners` land here, which is where they belong — a
        // fence firing is a bug in this application, not a verdict from a
        // boundary, and it must not render as one.
        outcome = {
          status: 'failed',
          what,
          stage: 'browser',
          message: error instanceof Error ? error.message : String(error),
          code: null,
        };
      } finally {
        busyRef.current = false;
        setBusy(false);
      }

      setEntries((current) => ({ ...current, [key]: outcome }));
      return outcome;
    },
    [],
  );

  const reset = useCallback(() => {
    setEntries({});
  }, []);

  return { stateOf, busy, run, note, reset };
}
