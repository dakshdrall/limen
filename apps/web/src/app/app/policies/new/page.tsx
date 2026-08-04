import { connection } from 'next/server';
import { NewPolicyScreen } from '@/components/app/NewPolicyScreen';
import { ScreenHeader } from '@/components/app/ScreenHeader';
import { DEFAULT_FIXTURE_KEY, FIXTURES, REFUSING_FIXTURES } from '@/fixtures';

export const metadata = {
  title: 'Limen — new policy',
  description:
    'Derive a permission boundary from an observed transaction and lower it onto audited OpenZeppelin primitives.',
};

export default async function NewPolicyPage() {
  const initial = FIXTURES[DEFAULT_FIXTURE_KEY];
  if (initial === undefined) throw new Error(`missing fixture ${DEFAULT_FIXTURE_KEY}`);

  // Read at request time for the same reason `/` does: whether live ingest works
  // is a property of the running deployment, not of the build.
  await connection();
  const liveIngestEnabled = (process.env.SOROBAN_RPC_URL ?? '').length > 0;

  return (
    <main className="screen">
      <ScreenHeader
        eyebrow="interface"
        title="New policy"
        lede="One transaction in, one installable boundary out — with the step between them shown rather than assumed. What Limen derives and what an OpenZeppelin smart account can hold are different languages, and the translation either succeeds or is refused with the constraint named."
        labels={['TESTNET ONLY', 'COMPOSITION ONLY', 'NOT AUDITED', 'IN DEVELOPMENT']}
      />

      <NewPolicyScreen
        initialTransaction={initial}
        initialKey={DEFAULT_FIXTURE_KEY}
        fixtureKeys={Object.keys(FIXTURES)}
        refusingKeys={[...REFUSING_FIXTURES]}
        liveIngestEnabled={liveIngestEnabled}
      />
    </main>
  );
}
