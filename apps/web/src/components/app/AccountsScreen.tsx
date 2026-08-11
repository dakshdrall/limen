'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Address } from '@/components/Address';
import { AccountLink } from '@/components/app/AccountLink';
import { EmptyState, Pending, ReadFailure } from '@/components/app/ScreenState';
import { looksLikeContractAddress } from '@/lib/account-contract';
import { RECORDED_ACCOUNT } from '@/lib/recorded-runs';
import { useAccountSnapshot } from '@/lib/use-account-snapshot';
import { useStored } from '@/lib/use-store';
import { forgetAccount, listAccounts, rememberAccount, type StoredAccount } from '@/lib/store';

/**
 * The accounts this browser knows about.
 *
 * "Knows about" is the whole honest claim. This list is browser storage —
 * pointers, nothing else — and every fact displayed *about* an account on it is
 * read live from the chain when the row renders. Forgetting an account here
 * removes a pointer and touches no ledger, which the screen says in those words
 * rather than leaving "remove" to be read as "revoke".
 *
 * There is no wallet connection and no sign-in. An account is added by pasting
 * its address, which is all "survives a new browser" can honestly mean when the
 * source of truth is a public ledger: paste the address, read the chain.
 */

export function AccountsScreen() {
  // `undefined` until hydrated, because `localStorage` does not exist during
  // the server render and an empty array would flash the empty state at every
  // reviewer who does have accounts. Writes re-render through the store's own
  // subscription, so nothing here has to remember to refresh.
  const accounts = useStored<StoredAccount[]>(listAccounts, []);

  return (
    <div className="flex flex-col gap-10">
      <AddAccount known={accounts ?? []} />

      {accounts === undefined ? (
        <Pending what="Reading the accounts this browser has been shown." />
      ) : accounts.length === 0 ? (
        <EmptyState title="This browser has not been shown an account yet.">
          <p>
            Paste a deployed smart account address above and its installed boundary is read from
            testnet — no sign-in, and nothing of yours stored anywhere but this browser. The
            walkthrough account works, read here from the deployments file rather than typed in:{' '}
            <span className="value break-all">{RECORDED_ACCOUNT}</span>
          </p>
          <p className="mt-2.5">
            A browser that has never seen an account can still read any account. It can only{' '}
            <em>sign</em>{' '}
            for one it owns — that is, one whose signer is a key this browser generated. Reading is
            open to everyone; acting is not.
          </p>
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-4">
          {accounts.map((account) => (
            <li key={account.contractId}>
              <AccountRow account={account} onForget={() => forgetAccount(account.contractId)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AddAccount({ known }: { known: StoredAccount[] }) {
  const [value, setValue] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const trimmed = value.trim();
  const alreadyKnown = known.some((account) => account.contractId === trimmed);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!looksLikeContractAddress(trimmed)) {
          setProblem(
            'A smart account address is 56 characters and starts with C. This does not have that shape.',
          );
          return;
        }
        if (!rememberAccount(trimmed)) {
          // Storage can be full or disabled. Saying so beats showing the row
          // and losing it on reload.
          setProblem(
            'This browser refused to store the address — private mode or a full storage quota. The account can still be read; it will not be remembered.',
          );
          return;
        }
        setProblem(null);
        setValue('');
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <label htmlFor="account-address" className="col-head text-muted">
          Read a smart account
        </label>
        {/* Reading someone else's account and creating your own are different
            acts, so they are different controls rather than one field that
            changes meaning. */}
        <Link href="/app/accounts/new" className="link text-[12.5px]">
          Create one instead
        </Link>
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        <input
          id="account-address"
          name="account-address"
          value={value}
          spellCheck={false}
          autoComplete="off"
          placeholder="C…"
          onChange={(event) => {
            setValue(event.target.value);
            setProblem(null);
          }}
          className="field min-w-0 flex-1 font-mono text-[12.5px]"
          aria-describedby={problem === null ? undefined : 'account-address-problem'}
          aria-invalid={problem !== null}
        />
        <button
          type="submit"
          disabled={trimmed.length === 0 || alreadyKnown}
          className="btn"
          data-variant="secondary"
          data-register="label"
        >
          {alreadyKnown ? 'Already listed' : 'Read'}
        </button>
      </div>
      {problem !== null && (
        <p
          id="account-address-problem"
          role="alert"
          className="text-[12.5px] leading-relaxed text-deny"
        >
          {problem}
        </p>
      )}
    </form>
  );
}

/**
 * One account, with its boundary read live.
 *
 * The summary is deliberately thin — how many rules, how many still live, at
 * which ledger. Anything more would be the detail screen rendered twice, and the
 * numbers that matter (caps, spend) deserve the space the detail screen gives
 * them.
 */
function AccountRow({ account, onForget }: { account: StoredAccount; onForget: () => void }) {
  const { state, reload } = useAccountSnapshot(account.contractId);

  return (
    <div className="flex flex-col gap-3.5 rounded-[5px] border border-border-default bg-surface px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <AccountLink contractId={account.contractId} />
        <button
          type="button"
          onClick={onForget}
          title="Removes this address from this browser. Nothing on chain changes; the account and everything installed on it are untouched."
          className="btn"
          data-variant="quiet"
          data-register="label"
          data-tone="destructive"
        >
          Forget
        </button>
      </div>

      {state.status === 'pending' && (
        <Pending what="Reading this account's context rules from testnet." />
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
        <dl className="flex flex-wrap gap-x-8 gap-y-2 text-[12.5px]">
          <Stat label="context rules" value={String(state.snapshot.rules.length)} />
          <Stat
            label="live now"
            value={String(state.snapshot.rules.filter((rule) => rule.live).length)}
          />
          <Stat
            label="policies"
            value={String(
              state.snapshot.rules.reduce((total, rule) => total + rule.policies.length, 0),
            )}
          />
          <Stat label="at ledger" value={state.snapshot.ledger.toLocaleString('en-US')} />
        </dl>
      )}

      {account.deployTxHash !== undefined && (
        <p className="text-[12px] text-muted-dim">
          Deployed in <Address value={account.deployTxHash} tone="dim" />
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="col-head text-muted-dim">{label}</dt>
      <dd className="value text-[13px] text-foreground">{value}</dd>
    </div>
  );
}
