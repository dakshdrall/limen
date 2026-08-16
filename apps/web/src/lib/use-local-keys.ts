'use client';

import { useCallback, useSyncExternalStore } from 'react';
import {
  LOCAL_KEY_LABEL,
  SERVER_KEY_SNAPSHOT,
  getLocalKey,
  readLocalKeySnapshot,
  subscribeToLocalKeys,
  type LocalKey,
} from '@/lib/local-key';
import { KEY_ROLES, type KeyRole } from '@limen/shared/key-roles';

/**
 * Which keys this browser holds, as a screen sees them.
 *
 * The same argument as `use-store.ts`: `localStorage` is an external store, so
 * another tab clearing the keys must not leave a screen offering to sign with
 * one that is gone. `useSyncExternalStore` is the API for that, and it gives the
 * server render a defined answer instead of a flash.
 *
 * `undefined` means "not known yet" — the server has no storage and neither
 * does the hydration pass. It is deliberately distinct from "no keys yet",
 * which is the state `/app/accounts/new` exists to resolve and which gets a
 * designed screen rather than a spinner.
 *
 * This module names {@link LOCAL_KEY_LABEL} because it imports the key module,
 * and `test/local-key-label.test.ts` requires every such file to. That rule is
 * doing real work here rather than being satisfied on a technicality: a hook
 * that hands a screen a signing key is exactly the layer where the label could
 * quietly stop travelling with it.
 */
export const LOCAL_KEYS_LABEL = LOCAL_KEY_LABEL;

export type LocalKeyPublics = Partial<Record<KeyRole, string>>;

/**
 * The public keys this browser holds.
 *
 * Public keys only. The snapshot is a string React holds and compares, and
 * there is no version of it that should contain a secret — `local-key.ts` makes
 * the same point where it produces the snapshot.
 */
export function useLocalKeyPublics(): LocalKeyPublics | undefined {
  return parseSnapshot(useKeySnapshot(), 1);
}

/**
 * The same keys as hex, which is how a context rule names them.
 *
 * `readAllContextRules` returns an `External` signer's key as hex of the raw 32
 * bytes — it is reporting what the contract stores. `useLocalKeyPublics`
 * returns `G…`, because that is what a person reads. Both are correct and they
 * are never equal, so a screen asking *does this browser hold the key this rule
 * names* must ask in hex. It is a separate hook rather than a second field on
 * the same one so that a comparison cannot reach for the wrong form: the type
 * of the display value and the type of the comparison value are the same
 * `string`, and nothing but the hook name distinguishes them.
 *
 * This existing in a shape that can be got wrong is the reason it is documented
 * at this length. Comparing the two forms directly is what made every account
 * created in this browser render as somebody else's.
 */
export function useLocalKeyRawPublics(): LocalKeyPublics | undefined {
  return parseSnapshot(useKeySnapshot(), 2);
}

function useKeySnapshot(): string | null {
  return useSyncExternalStore(
    subscribeToLocalKeys,
    readLocalKeySnapshot,
    () => SERVER_KEY_SNAPSHOT,
  );
}

/** `ROLE:G…:hex` per role, `field` selecting which of the two public forms. */
function parseSnapshot(snapshot: string | null, field: 1 | 2): LocalKeyPublics | undefined {
  if (snapshot === null) return undefined;

  const publics: LocalKeyPublics = {};
  for (const entry of snapshot.split('|')) {
    const parts = entry.split(':');
    const role = parts[0];
    const value = parts[field];
    if (value !== undefined && value.length > 0 && (KEY_ROLES as readonly string[]).includes(role!)) {
      publics[role as KeyRole] = value;
    }
  }
  return publics;
}

/**
 * Both keys as signers, for the moment a screen submits.
 *
 * Returns a getter rather than the keys themselves. A component that held live
 * signers in state would keep them across a `clearLocalKeys` from another tab
 * and sign with a key this browser no longer claims to have; reading at the
 * point of use cannot.
 */
export function useSigners(): () => { owner: LocalKey; agent: LocalKey } | null {
  return useCallback(() => {
    const owner = getLocalKey('OWNER');
    const agent = getLocalKey('AGENT');
    if (owner === undefined || agent === undefined) return null;
    return { owner, agent };
  }, []);
}
