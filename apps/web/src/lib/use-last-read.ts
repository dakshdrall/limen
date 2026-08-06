'use client';

import { useState } from 'react';

/**
 * The last non-`null` value a re-read produced.
 *
 * `useAccountSnapshot` derives `pending` from "the answer on hand does not
 * answer the request on hand", so every `reload()` swaps the snapshot back to
 * `pending` before the new one lands. That is deliberate and correct — it is
 * what guarantees no stale rule is ever rendered under a fresh ledger number.
 *
 * It is also what broke the write screens, and the failure was invisible until
 * the §1 acceptance test was driven in a browser for the first time. Both
 * `/app/accounts/[id]` and `/app/policies/[id]` rendered their write steps
 * *inside* the `status === 'ok'` branch, and every write ends by calling
 * `reload()`. So the sequence was: submit, land on a ledger, re-read, and the
 * component holding the hash unmounts — taking the write log with it. The
 * transaction succeeded and the evidence for it disappeared from the screen
 * about a second later.
 *
 * On the policy screen it was worse than cosmetic. After step 04 revokes the
 * rule, the rule is *gone* from the chain, so `rule` stayed `undefined` and the
 * steps never came back at all — which makes step 05, the call that must fail
 * because the boundary is no longer there, unreachable. PLAN-V4 §1's tenth
 * transaction could not be performed from the browser.
 *
 * So the write steps stay mounted across a re-read, and this is what lets them:
 * the identity of the thing being exercised is held here, while the tables
 * above still swap to `pending` and still show only what the ledger said at the
 * sequence number printed beside them. The two are different questions —
 * *what does the chain hold right now* and *what have I just done to it* — and
 * only the first one should go blank while a read is in flight.
 *
 * Retaining the rule after a revoke is not a stale render. It is the subject of
 * the remaining step: submitting against a rule id that no longer exists is
 * precisely how `ContextRuleNotFound` is produced, and the screen says the rule
 * is gone in the section that reads the chain.
 */
export function useLastRead<T>(value: T | null): T | null {
  const [held, setHeld] = useState<T | null>(value);

  // Adjusting state during render, which React sanctions for exactly this
  // shape: the new value is available now, and deferring it to an effect would
  // render one frame of the old one first.
  if (value !== null && value !== held) setHeld(value);

  return value ?? held;
}
