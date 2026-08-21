'use client';

import { useSyncExternalStore } from 'react';
import {
  PASSKEY_LABEL,
  SERVER_IDENTITY,
  readIdentitySnapshot,
  subscribeToIdentity,
  type IdentityState,
} from '@/lib/identity';

/**
 * Who the cookie names, as a screen sees it.
 *
 * `useSyncExternalStore` for the reason `use-passkey.ts` gives and one more.
 * The shared reason: the session is external state — signing out in another tab
 * must not leave this one rendering a name. The extra one is hydration. The
 * server cannot read the cookie during a static render, so its only honest
 * answer is `unknown`; `getServerSnapshot` returns exactly that, so the first
 * client frame agrees with the markup by construction rather than by a
 * `useEffect` that flips it one frame later. `PasskeyOwnerControl` shipped a
 * React #418 by doing the other thing, and it is recorded in `use-passkey.ts`.
 *
 * The store fetches on first subscribe, so a component only has to render what
 * it is handed.
 *
 * This module names {@link PASSKEY_LABEL} because it imports the identity
 * module, which imports the passkey module. `test/local-key-label.test.ts`
 * requires that of every file on that import chain.
 */
export const USE_IDENTITY_LABEL = PASSKEY_LABEL;

export function useIdentity(): IdentityState {
  return useSyncExternalStore(subscribeToIdentity, readIdentitySnapshot, () => SERVER_IDENTITY);
}
