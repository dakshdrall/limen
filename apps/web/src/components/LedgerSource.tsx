'use client';

import { createContext, useContext } from 'react';
import { LedgerHeartbeat } from '@/components/LedgerHeartbeat';
import { useLedgerSequence } from '@/lib/use-ledger';

/**
 * One poller, three readings.
 *
 * PLAN-V4 §8's three motions read the same number, and the number has to be the
 * same one: a top bar counting 3,976,740 above a hairline computed from
 * 3,976,738 is two instruments disagreeing about the present, which is worse
 * than either of them being absent. So the impure read happens once, here, and
 * is handed down.
 *
 * The context value is `number | null` and nothing else — deliberately not a
 * status object. Consumers must not be able to distinguish "still loading" from
 * "the endpoint is unreachable", because the honest rendering of both is
 * identical and a component holding the distinction would eventually draw it.
 *
 * This wraps the whole application in the root layout, which is why it takes
 * `children` rather than being dropped beside the top bar: `children` stays a
 * server-rendered tree passed through as a prop, so putting the provider at the
 * root does not make the pages under it client components.
 */

const LedgerContext = createContext<number | null>(null);

export function LedgerSource({ children }: { children: React.ReactNode }) {
  const sequence = useLedgerSequence();

  return (
    <LedgerContext.Provider value={sequence}>
      {/* Rendered here rather than in the layout so there is exactly one, and
          so it cannot be mounted on a page that has no poller above it. */}
      <LedgerHeartbeat sequence={sequence} />
      {children}
    </LedgerContext.Provider>
  );
}

/**
 * The current ledger sequence, or `null` when it is not known.
 *
 * `null` is also what a consumer rendered outside the provider sees, and that
 * is the correct answer rather than an error: no provider means no reading, and
 * no reading means the static state. A component that threw here would turn a
 * missing motion into a broken page.
 */
export function useLedger(): number | null {
  return useContext(LedgerContext);
}
