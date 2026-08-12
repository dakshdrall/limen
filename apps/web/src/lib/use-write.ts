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
 *
 * ## Submissions and the things that are not submissions
 *
 * That split is real and is kept: a friendbot call is not a transaction this
 * application built, signed and submitted, and `toWriteOutcome` has nothing to
 * say about one. What the split is *not* is a reason for the second kind to run
 * unguarded and unannounced.
 *
 * It used to be. `note` recorded a finished outcome and nothing else, so the
 * one caller that funded from friendbot never set `busy` and never wrote a
 * `running` entry: its button stayed live through its own call, and a second
 * click bought a second friendbot request that comes back "already exists" and
 * is reported as success. PLAN-V5 §2.3 found it by driving the screen; nothing
 * readable in either file was wrong.
 *
 * So `track` replaces `note`. Both kinds now take the same path — ref guard,
 * `running` entry, `busy`, outcome — and differ only in who builds the outcome:
 * `run` converts a submission result, `track` is handed one. That is the
 * distinction that was worth keeping, and it is the whole of it.
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
   * Run something that is not a submission — a friendbot call, a read — under
   * the same guard, and log it beside the transactions around it.
   *
   * The caller builds the outcome because only the caller knows what the result
   * means; everything else about the step is identical to `run`.
   */
  track: (
    key: string,
    what: string,
    fn: () => Promise<WriteOutcome>,
  ) => Promise<WriteOutcome | null>;
  reset: () => void;
}

export function useWriteLog(): WriteLog {
  const [entries, setEntries] = useState<Record<string, WriteState>>({});
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const stateOf = useCallback((key: string): WriteState => entries[key] ?? IDLE, [entries]);

  /**
   * One step, whatever kind it is: guard, mark running, await, log.
   *
   * `run` and `track` are both this with a different way of arriving at the
   * outcome. Written once rather than twice because the two copies is how the
   * fault existed in the first place — the second path had none of this, and
   * the difference was invisible from either call site.
   */
  const perform = useCallback(
    async (key: string, what: string, fn: () => Promise<WriteOutcome>) => {
      // Synchronous, before the first await. See the note above.
      if (busyRef.current) return null;
      busyRef.current = true;
      setBusy(true);
      setEntries((current) => ({ ...current, [key]: { status: 'running', what } }));

      let outcome: WriteOutcome;
      try {
        outcome = await fn();
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

  const run = useCallback(
    (key: string, what: string, fn: () => Promise<SubmitResultLike>) =>
      // Inside `perform`'s try, so a throw from either the submission or the
      // conversion lands in the same browser-stage outcome it always did.
      perform(key, what, async () => toWriteOutcome(what, await fn())),
    [perform],
  );

  const track = perform;

  const reset = useCallback(() => {
    setEntries({});
  }, []);

  return { stateOf, busy, run, track, reset };
}
