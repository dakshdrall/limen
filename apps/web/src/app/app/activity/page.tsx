import { ActivityScreen } from '@/components/app/ActivityScreen';
import { ScreenHeader } from '@/components/app/ScreenHeader';

export const metadata = {
  title: 'Limen — activity',
  description:
    'What the accounts this browser knows have been permitted to do, read from Soroban contract events.',
};

export default function ActivityPage() {
  return (
    <main className="screen">
      <ScreenHeader
        eyebrow="interface"
        title="Activity"
        lede={
          <>
            Read from contract events, which are emitted on success — so this is a record of what
            each boundary <em>permitted</em>, and it says so on every scan. Refusals emit nothing
            and are not here; they are on the policy screen, where each one can carry its own
            transaction hash.
          </>
        }
        labels={['TESTNET ONLY', 'IN DEVELOPMENT']}
      />

      <ActivityScreen />
    </main>
  );
}
