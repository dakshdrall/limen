import { HEADROOM_SCALE, LEDGERS_PER_WEEK } from '@limen/core';

/**
 * The complete set of widening options a user may choose from.
 *
 * These numbers are defined here, on the server, and are the ONLY values that
 * can ever reach `synthesize`. Claude may choose which of these to surface and
 * may phrase the question and the labels, but it cannot introduce a headroom or
 * a window that is not in this table. A model that hallucinated
 * `headroomBps: 1000000` would have that option dropped, not applied.
 */
export interface HeadroomOption {
  id: string;
  /** Fallback label, used when Claude is unavailable. */
  label: string;
  headroomBps: number;
  windowLedgers: number;
}

/** ~24h at roughly 5 seconds per ledger. */
const LEDGERS_PER_DAY = 17_280;

export const HEADROOM_OPTIONS: readonly HeadroomOption[] = [
  {
    id: 'exact-weekly',
    label: 'Cap at exactly what was spent, per week',
    headroomBps: HEADROOM_SCALE,
    windowLedgers: LEDGERS_PER_WEEK,
  },
  {
    id: 'exact-daily',
    label: 'Cap at exactly what was spent, per day',
    headroomBps: HEADROOM_SCALE,
    windowLedgers: LEDGERS_PER_DAY,
  },
  {
    id: 'double-weekly',
    label: 'Allow up to twice what was spent, per week',
    headroomBps: 2 * HEADROOM_SCALE,
    windowLedgers: LEDGERS_PER_WEEK,
  },
  {
    id: 'double-daily',
    label: 'Allow up to twice what was spent, per day',
    headroomBps: 2 * HEADROOM_SCALE,
    windowLedgers: LEDGERS_PER_DAY,
  },
] as const;

export const HEADROOM_OPTION_IDS = HEADROOM_OPTIONS.map((option) => option.id);

/** Resolves an id to its server-defined numbers, or `undefined` if unknown. */
export function resolveHeadroomOption(id: string): HeadroomOption | undefined {
  return HEADROOM_OPTIONS.find((option) => option.id === id);
}
