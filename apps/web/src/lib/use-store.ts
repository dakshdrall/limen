'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { SERVER_SNAPSHOT, readRaw, subscribeToStore } from '@/lib/store';

/**
 * Reading browser storage from a screen.
 *
 * `localStorage` is an external store: another tab can write it, and so can the
 * user clearing site data. `useSyncExternalStore` is the API for exactly that,
 * and using it instead of copying the value into state on mount buys two things
 * beyond correctness — a second tab stays in sync, and the server render has a
 * defined answer rather than a flash.
 *
 * `undefined` means "not known yet": the server has no storage, and neither
 * does the hydration pass. Screens render their pending state for it rather
 * than showing an empty list, which would tell a returning reviewer their
 * accounts were gone for one frame.
 */
export function useStored<T>(select: () => T, deps: readonly unknown[]): T | undefined {
  const raw = useSyncExternalStore(subscribeToStore, readRaw, () => SERVER_SNAPSHOT);

  // Keyed on the stored string *and* on whatever the selector reads from its
  // closure. Without the second half, navigating between two policies would
  // leave the first one's provenance on screen: the stored string never
  // changed, so nothing would tell the memo to recompute.
  //
  // The caller's dependencies are collapsed into one string because the hooks
  // lint requires a literal dependency array and a spread is not one. They are
  // addresses and ids — primitives — so serializing them is exact rather than
  // approximate.
  const depsKey = JSON.stringify(deps);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (raw === null ? undefined : select()), [raw, depsKey]);
}
