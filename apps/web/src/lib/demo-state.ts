/**
 * The demo stepper's resumable state.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE SYNTHESIZER IS THE ONLY THING THAT PRODUCES POLICY.                  │
 * │                                                                          │
 * │ This object may hold ONLY the beat index and the transaction hash. It    │
 * │ must never hold a proposal, a cap, a policy, a rationale line, or an     │
 * │ XDR payload. Every derived value the stepper renders is recomputed by    │
 * │ calling `synthesize()` on the observed transaction — because a stored    │
 * │ derived value is a number on screen that the synthesizer did not emit    │
 * │ on this run, and that is exactly the failure mode the whole product      │
 * │ argues against.                                                          │
 * │                                                                          │
 * │ `PERSISTED_KEYS` is asserted by test. Adding a field here without        │
 * │ adding it there fails CI; adding it to both is a deliberate act that     │
 * │ has to survive review.                                                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

const STORAGE_KEY = 'limen.demo.v1';

/**
 * Bumped when the shape changes, so old state is discarded rather than
 * crashing a returning reviewer's page.
 */
const VERSION = 1;

/**
 * The highest beat there is. Six since the simulator gained "could it be
 * installed?"; the stepper exports the same number, and a state whose beat
 * exceeds it is discarded rather than clamped.
 */
export const LAST_BEAT = 6;

export interface DemoState {
  version: number;
  /** 1–6; which beat the reviewer has reached. */
  beat: number;
  /**
   * The transaction step 1 produced, or null before it has run.
   *
   * A shipped fixture's hash goes in this same slot. Which one it is stays
   * derivable — the fixture hashes are constants of this repository — so
   * distinguishing a real transaction from a shipped one never needed a stored
   * flag, and this object did not have to grow a field to gain a second source.
   */
  hash: string | null;
}

/** The complete allowlist of persisted fields. See the header. */
export const PERSISTED_KEYS = ['version', 'beat', 'hash'] as const;

export const INITIAL_STATE: DemoState = { version: VERSION, beat: 1, hash: null };

/** Strips anything not on the allowlist, so a stale or tampered blob cannot smuggle a derived value in. */
export function sanitise(raw: unknown): DemoState | null {
  if (raw === null || typeof raw !== 'object') return null;
  const value = raw as Partial<DemoState>;

  if (value.version !== VERSION) return null;
  if (
    typeof value.beat !== 'number' ||
    !Number.isInteger(value.beat) ||
    value.beat < 1 ||
    value.beat > LAST_BEAT
  ) {
    return null;
  }
  if (value.hash !== null && (typeof value.hash !== 'string' || !/^[0-9a-f]{64}$/i.test(value.hash))) {
    return null;
  }

  return { version: VERSION, beat: value.beat, hash: value.hash ?? null };
}

/** Serialises exactly the allowlisted fields and nothing else. */
export function serialise(state: DemoState): string {
  return JSON.stringify({ version: VERSION, beat: state.beat, hash: state.hash });
}

export function loadState(storage: Pick<Storage, 'getItem'>): DemoState {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return INITIAL_STATE;
    return sanitise(JSON.parse(raw)) ?? INITIAL_STATE;
  } catch {
    return INITIAL_STATE;
  }
}

export function saveState(storage: Pick<Storage, 'setItem'>, state: DemoState): void {
  try {
    storage.setItem(STORAGE_KEY, serialise(state));
  } catch {
    // Storage can be unavailable (private mode, quota). Resume is a
    // convenience; losing it must not break the stepper.
  }
}

export function clearState(storage: Pick<Storage, 'removeItem'>): void {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // As above.
  }
}
