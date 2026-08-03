'use client';

import Link from 'next/link';
import { Address } from '@/components/Address';
import { EmptyState, Pending, ReadFailure } from '@/components/app/ScreenState';
import { RulesTable } from '@/components/app/RulesTable';
import { StatusLabel } from '@/components/StatusLabel';
import { useAccountSnapshot } from '@/lib/use-account-snapshot';
import { getAccount, rememberAccount } from '@/lib/store';
import { useStored } from '@/lib/use-store';

/**
 * One smart account, read from the chain.
 *
 * The address in the URL is the whole input. An account does not need to be in
 * this browser's list to be readable — a reviewer following a link from the
 * README has never seen it — so this screen reads first and offers to remember
 * afterwards. Requiring the pointer before showing the chain would be this app
 * putting its own bookkeeping in front of the ledger.
 */

export function AccountDetail({ contractId }: { contractId: string }) {
  const { state, reload } = useAccountSnapshot(contractId);
  const known = useStored(() => getAccount(contractId) !== undefined, [contractId]);

  return (
    <div className="flex flex-col gap-9">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Address value={contractId} />
          {known === false && (
            <button
              type="button"
              onClick={() => rememberAccount(contractId)}
              className="rounded-[3px] border border-border-default px-3 py-1.5 font-mono text-[10.5px] tracking-[0.12em] text-muted uppercase transition-colors hover:border-border-bright hover:text-foreground focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
            >
              Remember in this browser
            </button>
          )}
        </div>
        <Link
          href="/app/accounts"
          className="rounded-[3px] text-[12.5px] text-muted underline decoration-border-bright underline-offset-4 transition-colors hover:text-foreground hover:decoration-accent focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
        >
          All accounts
        </Link>
      </div>

      {state.status === 'pending' && (
        <Pending what="Simulating a read of every context rule and every attached policy on this account." />
      )}

      {state.status === 'failed' && (
        <ReadFailure
          message={state.message}
          detail={state.detail}
          unconfigured={state.unconfigured}
          onRetry={reload}
        />
      )}

      {state.status === 'ok' && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <StatusLabel name="ON-CHAIN" />
            <p className="text-[12.5px] text-muted-dim">
              Read at ledger{' '}
              <span className="value">{state.snapshot.ledger.toLocaleString('en-US')}</span>. Every
              expiry and every cap below is that ledger&rsquo;s answer, not a stored one.
            </p>
            <button
              type="button"
              onClick={reload}
              className="rounded-[2px] font-mono text-[10.5px] tracking-[0.12em] text-muted-dim uppercase transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
            >
              Read again
            </button>
          </div>

          {state.snapshot.rules.length === 0 ? (
            <EmptyState title="This account has no context rules.">
              <p>
                The contract answered, so this is the account&rsquo;s real state rather than a failed
                read: nothing is installed, and no signer is authorized for anything. An account in
                this state cannot act.
              </p>
            </EmptyState>
          ) : (
            <RulesTable
              contractId={contractId}
              rules={state.snapshot.rules}
              atLedger={state.snapshot.ledger}
            />
          )}
        </>
      )}
    </div>
  );
}
