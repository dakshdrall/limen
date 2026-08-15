'use client';

import { useCallback, useSyncExternalStore } from 'react';
import {
  PASSKEY_LABEL,
  SERVER_PASSKEY_SNAPSHOT,
  getPasskey,
  readPasskeySnapshot,
  subscribeToPasskey,
  type Passkey,
} from '@/lib/passkey';

/**
 * Whether this browser has a passkey, as a screen sees it.
 *
 * The same argument as `use-local-keys.ts`: `localStorage` is an external
 * store, so another tab forgetting the credential must not leave a screen
 * offering to sign with it. `undefined` means "not known yet" — the server has
 * no storage — and is deliberately distinct from "no passkey", which is the
 * ordinary state and gets an offer rather than a spinner.
 *
 * This module names {@link PASSKEY_LABEL} because it imports the passkey
 * module, and `test/local-key-label.test.ts` requires every such file to. The
 * rule is the passkey's own, written against `navigator.credentials` rather
 * than inherited from the local-key detectors — those match nothing here, and a
 * tripwire satisfied by not resembling anything is not a tripwire.
 */
export const USE_PASSKEY_LABEL = PASSKEY_LABEL;

/** The hex public key of the passkey this browser holds, or `undefined`. */
export function usePasskeyPublic(): string | undefined | null {
  const snapshot = useSyncExternalStore(
    subscribeToPasskey,
    readPasskeySnapshot,
    () => SERVER_PASSKEY_SNAPSHOT,
  );
  if (snapshot === null) return undefined; // not known yet
  if (snapshot === '') return null; // known, and there is none
  return snapshot.split(':')[1];
}

/**
 * The passkey as a signer, for the moment a screen submits.
 *
 * A getter rather than the value, for the reason `useSigners` is one: a
 * component holding a live signer in state would keep it across another tab
 * forgetting the credential.
 */
export function usePasskeySigner(): () => Passkey | undefined {
  return useCallback(() => getPasskey(), []);
}
