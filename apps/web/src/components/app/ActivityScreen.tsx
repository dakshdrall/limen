'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Address } from '@/components/Address';
import { EmptyState, Pending, ReadFailure } from '@/components/app/ScreenState';
import { StatusLabel } from '@/components/StatusLabel';
import { Verdict } from '@/components/Verdict';
import type { AccountReadError } from '@/lib/account-contract';
import { UNCONFIGURED_CODES } from '@/lib/account-contract';
import { ACTIVITY_DESCRIPTIONS, type ActivityResponse } from '@/lib/activity-contract';
import { decimalise, ledgersToDuration } from '@/lib/format';
import { formatPolicyId } from '@/lib/policy-id';
import { listAccounts } from '@/lib/store';
import { useStored } from '@/lib/use-store';

/**
 * Everything the accounts this browser knows have been permitted to do.
 *
 * "Permitted" is the load-bearing word and it is on the screen, not only in
 * this comment. Contract events are emitted on success, so a refused
 * transaction is not in this feed and cannot be — refusals come from
 * transaction results, a different source with different confidence, and they
 * live on the policy screen where their provenance can be stated per row.
 *
 * A feed that quietly contained only successes while implying completeness
 * would be the most flattering possible misrepresentation of a permissions
 * tool: every boundary looks perfectly obeyed if you only read the transactions
 * that got through.
 */

type FeedState =
  | { status: 'pending' }
  | { status: 'ok'; response: ActivityResponse }
  | { status: 'failed'; message: string; detail?: string; unconfigured: boolean };

/** A settled answer, tagged with the request it answers. */
type Settled = Exclude<FeedState, { status: 'pending' }>;

export function ActivityScreen() {
  const accounts = useStored(() => listAccounts().map((account) => account.contractId), []);

  if (accounts === undefined) {
    return <Pending what="Reading the accounts this browser has been shown." />;
  }

  if (accounts.length === 0) {
    return (
      <EmptyState title="No accounts to read activity for.">
        <p>
          Activity is scanned per account. Add one on the{' '}
          <Link
            href="/app/accounts"
            className="rounded-[2px] underline decoration-border-bright underline-offset-4 transition-colors hover:text-accent hover:decoration-accent focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          >
            accounts screen
          </Link>{' '}
          and its history is read from the ledger.
        </p>
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-12">
      {accounts.map((contractId) => (
        <AccountActivity key={contractId} contractId={contractId} />
      ))}
    </div>
  );
}

function AccountActivity({ contractId }: { contractId: string }) {
  const [answer, setAnswer] = useState<{ key: string; state: Settled } | null>(null);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  // Pending is derived from the answer not matching the request rather than
  // written when the scan starts, so a previous account's feed can never be on
  // screen under this account's address. Same reasoning as
  // `useAccountSnapshot`.
  const key = `${contractId}:${nonce}`;
  const state: FeedState = answer?.key === key ? answer.state : { status: 'pending' };

  useEffect(() => {
    let current = true;

    void (async () => {
      try {
        const response = await fetch(`/api/account/${contractId}/activity`, { cache: 'no-store' });
        const body: unknown = await response.json();
        if (!current) return;

        if (!response.ok) {
          const { error } = body as AccountReadError;
          setAnswer({
            key,
            state: {
              status: 'failed',
              message: error.message,
              detail: error.detail,
              unconfigured: UNCONFIGURED_CODES.has(error.code),
            },
          });
          return;
        }
        setAnswer({ key, state: { status: 'ok', response: body as ActivityResponse } });
      } catch (error) {
        if (!current) return;
        setAnswer({
          key,
          state: {
            status: 'failed',
            message: 'the scan could not be sent from this browser',
            detail: error instanceof Error ? error.message : String(error),
            unconfigured: false,
          },
        });
      }
    })();

    return () => {
      current = false;
    };
  }, [contractId, key]);

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={`/app/accounts/${contractId}`}
          className="rounded-[3px] font-mono text-[13px] text-foreground underline decoration-border-bright underline-offset-4 transition-colors hover:text-accent hover:decoration-accent focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
        >
          {contractId.slice(0, 10)}…{contractId.slice(-6)}
        </Link>
        <button
          type="button"
          onClick={reload}
          className="rounded-[2px] font-mono text-[10.5px] tracking-[0.12em] text-muted-dim uppercase transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
        >
          Scan again
        </button>
      </header>

      {state.status === 'pending' && (
        <Pending what="Scanning contract events for this account. A full retention window is over twenty upstream requests, so this is not instant." />
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
          <ScanWindow response={state.response} />
          {state.response.events.length === 0 ? (
            <EmptyState title="Nothing in the scanned window.">
              <p>
                The scan completed and found no events in the ledger range above. That is not the
                same as this account having no history — anything older than the retention floor is
                gone from the RPC, not absent from the chain.
              </p>
            </EmptyState>
          ) : (
            <EventTable response={state.response} />
          )}
        </>
      )}
    </section>
  );
}

/**
 * What was looked at.
 *
 * This block is not metadata. Every claim the table makes about absence is only
 * as good as this range, and a reader who cannot see the range cannot judge the
 * absence.
 */
function ScanWindow({ response }: { response: ActivityResponse }) {
  const { window } = response;
  const span = window.toLedger - window.fromLedger;

  return (
    <div className="flex flex-col gap-2 rounded-[4px] border border-border-subtle bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <StatusLabel name="ON-CHAIN" />
        <p className="text-[12.5px] text-muted">
          Scanned ledgers{' '}
          <span className="value">{window.fromLedger.toLocaleString('en-US')}</span> to{' '}
          <span className="value">{window.toLedger.toLocaleString('en-US')}</span> —{' '}
          {ledgersToDuration(span)} — in {window.requests} upstream requests.
        </p>
      </div>

      {window.reachedRetentionFloor && (
        <p className="max-w-[86ch] text-[12px] leading-relaxed text-unproven">
          The scan started at this endpoint&rsquo;s retention floor, ledger{' '}
          <span className="value">{window.oldestRetainedLedger.toLocaleString('en-US')}</span>.
          Anything before it is gone from the RPC&rsquo;s memory — that is not the account&rsquo;s
          history ending, it is the endpoint&rsquo;s.
        </p>
      )}

      {window.truncated && (
        <p className="max-w-[86ch] text-[12px] leading-relaxed text-deny">
          The scan ran out of its request budget before reaching the head of the chain. This feed is
          incomplete, and the gap is at the recent end.
        </p>
      )}

      <p className="max-w-[86ch] text-[12px] leading-relaxed text-muted-dim">
        Contract events are emitted on success only, so every row below is something the boundary{' '}
        <em>permitted</em>. Refused attempts publish no events and are not in this feed.
      </p>
    </div>
  );
}

function EventTable({ response }: { response: ActivityResponse }) {
  return (
    <div className="scroll-x rounded-[5px] border border-border-default bg-surface">
      <table className="tbl w-full min-w-[58rem]">
        <thead>
          <tr>
            <th scope="col" className="col-ledger">
              ledger
            </th>
            <th scope="col">what happened</th>
            <th scope="col" className="col-ledger">
              rule
            </th>
            <th scope="col" className="col-amount">
              amount
            </th>
            <th scope="col" className="col-hash">
              transaction
            </th>
          </tr>
        </thead>
        <tbody>
          {response.events.map((event) => (
            <tr key={`${event.txHash}-${event.name}-${event.contextRuleId ?? 'x'}-${event.source}`}>
              <td className="col-ledger num">{event.ledger.toLocaleString('en-US')}</td>

              <td>
                <div className="flex flex-wrap items-center gap-2">
                  {event.kind === 'spending_limit_enforced' && <Verdict state="permitted" />}
                  <span className="text-[12.5px] text-foreground/90">
                    {ACTIVITY_DESCRIPTIONS[event.name] ?? (
                      <>
                        unrecognised event <span className="value">{event.name}</span> — this build
                        has no reader for it
                      </>
                    )}
                  </span>
                  {event.ruleName !== null && <span className="value text-[12px]">{event.ruleName}</span>}
                </div>
                {event.spend !== null && (
                  <p className="mt-1 text-[11.5px] text-muted-dim">
                    <span className="value">{event.spend.fnName}</span> on{' '}
                    <Address value={event.spend.contract} tone="dim" /> · window total{' '}
                    <span className="value">{decimalise(event.spend.totalSpentInPeriod)}</span>
                  </p>
                )}
              </td>

              <td className="col-ledger num">
                {event.contextRuleId === null ? (
                  <span className="text-muted-dim">—</span>
                ) : (
                  <Link
                    href={`/app/policies/${formatPolicyId({
                      contractId: response.contractId,
                      ruleId: event.contextRuleId,
                    })}`}
                    className="rounded-[2px] underline decoration-border-bright underline-offset-4 transition-colors hover:text-accent hover:decoration-accent focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
                  >
                    {event.contextRuleId}
                  </Link>
                )}
              </td>

              <td className="col-amount num">
                {event.spend === null ? (
                  <span className="text-muted-dim">—</span>
                ) : (
                  decimalise(event.spend.amount)
                )}
              </td>

              <td className="col-hash">
                <a
                  href={`https://stellar.expert/explorer/testnet/tx/${event.txHash}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  title={event.txHash}
                  className="rounded-[2px] font-mono text-[12.5px] text-foreground/90 underline decoration-border-bright underline-offset-4 transition-colors hover:text-accent hover:decoration-accent focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
                >
                  {event.txHash.slice(0, 8)}…
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
