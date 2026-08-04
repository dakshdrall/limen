import Link from 'next/link';
import { AccountDetail } from '@/components/app/AccountDetail';
import { ScreenHeader } from '@/components/app/ScreenHeader';
import { looksLikeContractAddress } from '@/lib/account-contract';

export const metadata = {
  title: 'Limen — account',
  description: 'The permission boundary installed on one smart account, read live from Stellar testnet.',
};

/**
 * The address is checked for shape here rather than only in the route, so a
 * mistyped URL is a screen that explains itself instead of a client component
 * mounting and rendering a failed fetch. The checksum is still the server's
 * business — see `looksLikeContractAddress`.
 */
export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <main className="screen">
      <ScreenHeader
        eyebrow="smart account"
        title="Installed boundary"
        labels={['TESTNET ONLY', 'NOT AUDITED', 'COMPOSITION ONLY']}
      />

      {looksLikeContractAddress(id) ? (
        <AccountDetail contractId={id} />
      ) : (
        <div className="panel" data-tone="refused">
          <span className="eyebrow text-deny">not an address</span>
          <p className="measure text-[13px] leading-relaxed text-foreground/90">
            A smart account address is 56 characters and starts with <span className="value">C</span>.
            The value in this URL is not that shape, so there is nothing to read.
          </p>
          <Link href="/app/accounts" className="link self-start text-[12.5px]">
            All accounts
          </Link>
        </div>
      )}
    </main>
  );
}
