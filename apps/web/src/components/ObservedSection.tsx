'use client';

import type { ObservedTransaction } from '@limen/core';
import { Address } from './Address';
import { decimalise } from '@/lib/format';

export function ObservedSection({ observed }: { observed: ObservedTransaction }) {
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
          {observed.network === 'simulated' && (
            <span className="ml-2 font-sans text-[12.5px] text-muted-dim">
              (shipped fixture — not observed on a live network)
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
        <table className="w-full min-w-[48rem] border-collapse text-left">
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
                Token movements
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
                  {invocation.movements.length === 0 ? (
                    <span className="text-[12.5px] text-muted-dim">none</span>
                  ) : (
                    <ul className="grid grid-cols-[2.75rem_auto_auto_1fr] items-baseline gap-x-3 gap-y-2">
                      {invocation.movements.map((movement, movementIndex) => {
                        const outbound = movement.from === observed.source;
                        return (
                          <li key={movementIndex} className="contents">
                            <span
                              className={`col-head ${outbound ? 'text-deny' : 'text-permit'}`}
                              title={
                                outbound
                                  ? 'leaves the source account'
                                  : 'arrives at the source account'
                              }
                            >
                              {outbound ? 'OUT' : 'IN'}
                            </span>
                            <span className="value text-right text-foreground">
                              {movement.amount}
                            </span>
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
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="max-w-[86ch] text-[12.5px] leading-relaxed text-muted-dim">
        Amounts are integers in the asset&apos;s smallest unit; the parenthesised value is a display
        rendering only. Only <span className="font-mono text-deny">OUT</span> movements — those
        leaving the source account — contribute to a derived cap.
      </p>
    </div>
  );
}
