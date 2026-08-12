'use client';

import type { ObservedTransaction } from '@limen/core';
import { Address } from '@/components/Address';
import { ExplorerLink } from '@/components/ExplorerLink';
import { decimalise } from '@/lib/format';
import { explorerTxUrl } from '@/lib/explorer';
import { UNREADABLE_ARG } from '@/lib/markers';

export function ObservedSection({ observed }: { observed: ObservedTransaction }) {
  const explorer = explorerTxUrl(observed);

  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-x-5 gap-y-2.5">
        <dt className="col-head text-muted-dim">hash</dt>
        <dd className="value truncate text-foreground" title={observed.hash}>
          {observed.hash}
        </dd>

        <dt className="col-head text-muted-dim">network</dt>
        <dd className="value text-foreground">
          {observed.network}
          {/* The fixture caveat and the live-ingest marker occupy the same slot
              and carry the same weight, so the two can never be confused for
              one another at a glance. */}
          {observed.network === 'simulated' && (
            <span className="ml-2 font-sans text-[12.5px] text-muted-dim">
              (shipped fixture — not observed on a live network)
            </span>
          )}
          {observed.network === 'testnet' && (
            <span className="ml-2 font-sans text-[12.5px] text-permit">
              (observed on testnet
              {explorer !== undefined && (
                <>
                  {' — '}
                  <ExplorerLink href={explorer}>view on stellar.expert</ExplorerLink>
                </>
              )}
              )
            </span>
          )}
        </dd>

        <dt className="col-head text-muted-dim">ledger</dt>
        <dd className="value text-foreground">{observed.ledger}</dd>

        <dt className="col-head text-muted-dim">source</dt>
        <dd className="flex flex-wrap items-baseline gap-x-2">
          <Address value={observed.source} />
          <span className="text-[12.5px] text-muted-dim">the account the policy installs on</span>
        </dd>
      </dl>

      <div className="scroll-x rounded-[5px] border border-border-default bg-surface">
        <table className="w-full min-w-[44rem] border-collapse text-left">
          <thead>
            <tr className="border-b border-border-bright bg-surface-raised text-muted-dim">
              <th scope="col" className="col-head w-[3rem] px-4 py-2.5">
                #
              </th>
              <th scope="col" className="col-head w-[11rem] px-4 py-2.5">
                Contract
              </th>
              <th scope="col" className="col-head w-[10rem] px-4 py-2.5">
                Function
              </th>
              <th scope="col" className="col-head px-4 py-2.5">
                Arguments
              </th>
            </tr>
          </thead>
          <tbody>
            {observed.invocations.map((invocation, index) => (
              <tr
                key={`${invocation.contractId}-${invocation.functionName}-${index}`}
                className="border-b border-border-subtle transition-colors last:border-b-0 hover:bg-surface-hover"
              >
                <td className="value px-4 py-3.5 align-top text-faint">{index}</td>
                <td className="px-4 py-3.5 align-top">
                  <Address value={invocation.contractId} />
                </td>
                <td className="value px-4 py-3.5 align-top text-foreground">
                  {invocation.functionName}()
                </td>
                <td className="px-4 py-3.5 align-top">
                  {invocation.args.length === 0 ? (
                    <span className="text-[12.5px] text-muted-dim">none</span>
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {invocation.args.map((arg, argIndex) => (
                        <li key={argIndex} className="value text-muted">
                          {arg === UNREADABLE_ARG ? (
                            // Marked, not silently rendered as a value. Arguments
                            // are presentational — no policy reads them — so an
                            // unreadable one is labelled rather than fatal.
                            <span className="text-muted-dim italic">unreadable argument</span>
                          ) : (
                            <span className="break-all">{arg}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Movements observed={observed} />
    </div>
  );
}

/**
 * Movements are transaction-level. When there is exactly one invocation they
 * provably belong to it; when there is more than one, Soroban's contract events
 * do not say which call emitted which transfer, and this block says so instead
 * of drawing them under a call that may not have caused them.
 */
function Movements({ observed }: { observed: ObservedTransaction }) {
  const exact = observed.attribution === 'exact';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h4 className="col-head text-muted">Token movements</h4>
        <span className="text-[12.5px] text-muted-dim">
          {exact
            ? 'caused by the single invocation above'
            : 'observed in this transaction; the metadata does not say which call caused them'}
        </span>
      </div>

      {observed.movements.length === 0 ? (
        <p className="text-[12.5px] text-muted-dim">No token movements in this transaction.</p>
      ) : (
        <div className="scroll-x rounded-[5px] border border-border-default bg-surface">
          <ul className="grid min-w-[36rem] grid-cols-[3.5rem_auto_auto_1fr] items-baseline gap-x-4 gap-y-2.5 px-4 py-3.5">
            {observed.movements.map((movement, index) => {
              const outbound = movement.from === observed.source;
              return (
                <li key={index} className="contents">
                  <span
                    className={`col-head ${outbound ? 'text-deny' : 'text-permit'}`}
                    title={outbound ? 'leaves the source account' : 'arrives at the source account'}
                  >
                    {outbound ? 'OUT' : 'IN'}
                  </span>
                  <span className="value text-right text-foreground">{movement.amount}</span>
                  <span className="value text-right text-muted-dim">
                    ({decimalise(movement.amount)})
                  </span>
                  <span className="flex flex-wrap items-baseline gap-x-1.5">
                    <Address value={movement.asset} />
                    <span aria-hidden="true" className="text-faint">
                      →
                    </span>
                    <Address value={movement.to} tone="dim" />
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <p className="measure text-[12.5px] leading-relaxed text-muted-dim">
        Amounts are integers in the asset&apos;s smallest unit; the parenthesised value is a display
        rendering only. Only <span className="font-mono text-deny">OUT</span>{' '}
        movements — those leaving the source account — contribute to a derived cap, and they are
        summed gross: an inflow of the same asset is never subtracted.
      </p>
    </div>
  );
}
