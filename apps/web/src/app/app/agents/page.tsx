import { AgentsScreen } from '@/components/app/AgentsScreen';
import { ScreenHeader } from '@/components/app/ScreenHeader';

export const metadata = {
  title: 'Limen — agents',
  description:
    'The agents you own, each with the permission boundary installed on its smart account, read from the ledger.',
};

/**
 * The list, and where deploying returns to.
 *
 * Deliberately not a server component that reads the rows itself. The three
 * identity states — unknown, signed-out, unavailable — are decided in the
 * browser from the session store, because a server render cannot read the
 * cookie during a static pass and its only honest answer is `unknown`.
 * `AgentBuilder` settled that shape and `use-identity.ts` records the React
 * #418 that came from doing it the other way; this screen inherits both rather
 * than re-deciding.
 */
export default function AgentsPage() {
  return (
    <main className="screen">
      <ScreenHeader
        eyebrow="agents"
        title="Your agents"
        lede={
          <>
            One row per agent you own. The cap on each is read from its account when this screen
            loads and carries the ledger it was read at — nothing here is a stored copy, because a
            boundary revoked somewhere else would still look obeyed in one.
          </>
        }
        labels={['TESTNET ONLY', 'NOT AUDITED', 'LIMEN HOLDS THE AGENT KEY']}
      />

      <AgentsScreen />
    </main>
  );
}
