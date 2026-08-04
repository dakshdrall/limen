import { AccountsScreen } from '@/components/app/AccountsScreen';
import { ScreenHeader } from '@/components/app/ScreenHeader';

export const metadata = {
  title: 'Limen — accounts',
  description:
    'Read the permission boundary installed on an OpenZeppelin smart account, live from Stellar testnet.',
};

export default function AccountsPage() {
  return (
    <main className="screen">
      <ScreenHeader
        eyebrow="interface"
        title="Accounts"
        lede={
          <>
            Every rule, cap, and signer on this screen is read from the ledger when the screen
            loads. This browser stores the addresses it has been shown and how each policy was
            derived — nothing about what is installed, because that is the chain&rsquo;s answer to
            give.
          </>
        }
        labels={['TESTNET ONLY', 'NOT AUDITED', 'IN DEVELOPMENT']}
      />

      <AccountsScreen />
    </main>
  );
}
