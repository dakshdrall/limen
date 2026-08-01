'use client';

import type { ObservedTransaction } from '@limen/core';
import { Address } from './Address';
import { decimalise } from '@/lib/format';

export function ObservedSection({ observed }: { observed: ObservedTransaction }) {
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted">hash</dt>
        <dd className="truncate text-foreground" title={observed.hash}>
          {observed.hash}
        </dd>
        <dt className="text-muted">network</dt>
        <dd className="text-foreground">
          {observed.network}
          {observed.network === 'simulated' && (
            <span className="ml-2 text-muted-dim">
              (shipped fixture — not observed on a live network)
            </span>
          )}
        </dd>
        <dt className="text-muted">ledger</dt>
        <dd className="text-foreground tabular-nums">{observed.ledger}</dd>
        <dt className="text-muted">source</dt>
        <dd>
          <Address value={observed.source} />
          <span className="ml-2 text-muted-dim">the account the policy installs on</span>
        </dd>
      </dl>

      <div className="scroll-x rounded-sm border border-border-subtle">
        <table className="w-full min-w-[44rem] border-collapse text-left">
          <thead>
            <tr className="border-b border-border-bright bg-surface-raised text-muted">
              <th scope="col" className="px-3 py-2 font-medium tracking-wide uppercase">
                #
              </th>
              <th scope="col" className="px-3 py-2 font-medium tracking-wide uppercase">
                Contract
              </th>
              <th scope="col" className="px-3 py-2 font-medium tracking-wide uppercase">
                Function
              </th>
              <th scope="col" className="px-3 py-2 font-medium tracking-wide uppercase">
                Token movements
              </th>
            </tr>
          </thead>
          <tbody>
            {observed.invocations.map((invocation, index) => (
              <tr
                key={`${invocation.contractId}-${invocation.functionName}-${index}`}
                className="border-b border-border-subtle last:border-b-0"
              >
                <td className="px-3 py-3 align-top text-muted-dim tabular-nums">{index}</td>
                <td className="px-3 py-3 align-top">
                  <Address value={invocation.contractId} />
                </td>
                <td className="px-3 py-3 align-top text-foreground">
                  {invocation.functionName}()
                </td>
                <td className="px-3 py-3 align-top">
                  {invocation.movements.length === 0 ? (
                    <span className="text-muted-dim">none</span>
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {invocation.movements.map((movement, movementIndex) => {
                        const outbound = movement.from === observed.source;
                        return (
                          <li key={movementIndex} className="flex flex-wrap items-baseline gap-1.5">
                            <span
                              className={outbound ? 'text-deny' : 'text-permit'}
                              title={outbound ? 'leaves the source account' : 'arrives at the source account'}
                            >
                              {outbound ? 'OUT' : 'IN'}
                            </span>
                            <span className="text-foreground tabular-nums">{movement.amount}</span>
                            <span className="text-muted-dim">
                              ({decimalise(movement.amount)})
                            </span>
                            <Address value={movement.asset} />
                            <span className="text-muted-dim">→</span>
                            <Address value={movement.to} />
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
      <p className="text-muted-dim">
        Amounts are integers in the asset&apos;s smallest unit; the parenthesised value is a display
        rendering only. Only <span className="text-deny">OUT</span> movements — those leaving the
        source account — contribute to a derived cap.
      </p>
    </div>
  );
}
