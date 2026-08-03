import { ActivityScreen } from '@/components/app/ActivityScreen';
import { StatusLabels } from '@/components/StatusLabel';

export const metadata = {
  title: 'Limen — activity',
  description:
    'What the accounts this browser knows have been permitted to do, read from Soroban contract events.',
};

export default function ActivityPage() {
  return (
    <main className="mx-auto flex w-full max-w-[74rem] flex-col gap-10 px-6 py-14 sm:px-10">
      <header className="flex flex-col gap-4">
        <span className="eyebrow-lead text-faint">interface</span>
        <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.015em] text-foreground">
          Activity
        </h1>
        <p className="max-w-[78ch] text-[14px] leading-relaxed text-muted">
          Read from contract events, which are emitted on success — so this is a record of what each
          boundary <em>permitted</em>, and it says so on every scan. Refusals emit nothing and are
          not here; they are on the policy screen, where each one can carry its own transaction hash.
        </p>
        <StatusLabels names={['TESTNET ONLY', 'IN DEVELOPMENT']} />
      </header>

      <ActivityScreen />
    </main>
  );
}
