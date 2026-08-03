import Link from 'next/link';
import { AccountDetail } from '@/components/app/AccountDetail';
import { StatusLabels } from '@/components/StatusLabel';
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
    <main className="mx-auto flex w-full max-w-[68rem] flex-col gap-9 px-6 py-14 sm:px-10">
      <header className="flex flex-col gap-4">
        <span className="eyebrow-lead text-faint">smart account</span>
        <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.015em] text-foreground">
          Installed boundary
        </h1>
        <StatusLabels names={['TESTNET ONLY', 'NOT AUDITED', 'COMPOSITION ONLY']} />
      </header>

      {looksLikeContractAddress(id) ? (
        <AccountDetail contractId={id} />
      ) : (
        <div className="flex flex-col gap-3 rounded-[4px] border border-deny-line bg-surface px-5 py-4">
          <span className="eyebrow text-deny">not an address</span>
          <p className="max-w-[74ch] text-[13px] leading-relaxed text-foreground/90">
            A smart account address is 56 characters and starts with <span className="value">C</span>.
            The value in this URL is not that shape, so there is nothing to read.
          </p>
          <Link
            href="/app/accounts"
            className="self-start rounded-[3px] text-[12.5px] text-muted underline decoration-border-bright underline-offset-4 transition-colors hover:text-foreground hover:decoration-accent focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          >
            All accounts
          </Link>
        </div>
      )}
    </main>
  );
}
