import { AccountsScreen } from '@/components/app/AccountsScreen';
import { StatusLabels } from '@/components/StatusLabel';

export const metadata = {
  title: 'Limen — accounts',
  description:
    'Read the permission boundary installed on an OpenZeppelin smart account, live from Stellar testnet.',
};

export default function AccountsPage() {
  return (
    <main className="mx-auto flex w-full max-w-[68rem] flex-col gap-10 px-6 py-14 sm:px-10">
      <header className="flex flex-col gap-4">
        <span className="eyebrow-lead text-faint">interface</span>
        <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.015em] text-foreground">
          Accounts
        </h1>
        <p className="max-w-[76ch] text-[14px] leading-relaxed text-muted">
          Every rule, cap, and signer on this screen is read from the ledger when the screen loads.
          This browser stores the addresses it has been shown and how each policy was derived —
          nothing about what is installed, because that is the chain&rsquo;s answer to give.
        </p>
        <StatusLabels names={['TESTNET ONLY', 'NOT AUDITED', 'IN DEVELOPMENT']} />
      </header>

      <AccountsScreen />
    </main>
  );
}
