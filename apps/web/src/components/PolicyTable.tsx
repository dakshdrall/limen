'use client';

import type { PolicyProposal } from '@limen/core';
import { Address } from './Address';
import { decimalise, ledgersToDuration } from '@/lib/format';

/**
 * The derived policy, rendered as data: the context rule and every
 * `PolicyConfig` it carries.
 *
 * Shared by the main review page and the guided demo so both render the same
 * proposal the same way. Neither computes anything — every value below comes
 * straight off a `synthesize()` return value, which is the invariant the whole
 * product rests on.
 */
export function PolicyTable({ proposal }: { proposal: PolicyProposal }) {
  const rule = proposal.contextRule;

  return (
    <div className="flex flex-col gap-7">
    {/* --- context rule -------------------------------------------------- */}
    <div className="flex flex-col gap-2.5">
      <h3 className="col-head text-muted">Context rule</h3>
      <div className="scroll-x rounded-[5px] border border-border-default bg-surface">
        <table className="w-full min-w-[42rem] border-collapse text-left">
          <tbody>
            <tr className="border-b border-border-subtle">
              <th
                scope="row"
                className="col-head w-[13rem] px-4 py-3 text-left align-top text-muted-dim"
              >
                allowed contracts
              </th>
              <td className="px-4 py-3">
                <ul className="flex flex-col gap-1">
                  {rule.allowedContracts.map((contractId) => (
                    <li key={contractId}>
                      <Address value={contractId} />
                    </li>
                  ))}
                </ul>
              </td>
            </tr>
            <tr className="border-b border-border-subtle">
              <th scope="row" className="col-head px-4 py-3 text-left align-top text-muted-dim">
                allowed functions
              </th>
              <td className="px-4 py-3">
                <ul className="flex flex-col gap-1.5">
                  {rule.allowedContracts.map((contractId) => (
                    <li key={contractId} className="flex flex-wrap items-baseline gap-x-2">
                      <Address value={contractId} tone="dim" />
                      <span aria-hidden="true" className="text-faint">
                        →
                      </span>
                      <span className="value text-foreground">
                        {(rule.allowedFunctions[contractId] ?? [])
                          .map((fn) => `${fn}()`)
                          .join(', ')}
                      </span>
                    </li>
                  ))}
                </ul>
              </td>
            </tr>
            <tr>
              <th scope="row" className="col-head px-4 py-3 text-left align-top text-muted-dim">
                validity
              </th>
              <td className="px-4 py-3">
                <span className="value text-foreground">
                  ledger {rule.validFromLedger} → {rule.validUntilLedger}
                </span>{' '}
                <span className="text-[12.5px] text-muted-dim">
                  ({ledgersToDuration(rule.validUntilLedger - rule.validFromLedger)})
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    {/* --- policies ------------------------------------------------------ */}
    <div className="flex flex-col gap-2.5">
      <h3 className="col-head flex items-baseline gap-2 text-muted">
        Policies
        <span className="text-faint normal-case tracking-normal">
          ({proposal.policies.length} of 5 max)
        </span>
      </h3>
      <div className="scroll-x rounded-[5px] border border-border-default bg-surface">
        <table className="w-full min-w-[46rem] border-collapse text-left">
          <thead>
            <tr className="border-b border-border-bright bg-surface-raised text-muted-dim">
              <th scope="col" className="col-head w-[12rem] px-4 py-2.5">
                Primitive
              </th>
              <th scope="col" className="col-head w-[11rem] px-4 py-2.5">
                Target
              </th>
              <th scope="col" className="col-head px-4 py-2.5">
                Configuration
              </th>
            </tr>
          </thead>
          <tbody>
            {proposal.policies.map((policy) => (
              <tr
                key={
                  policy.kind === 'spending_limit'
                    ? `limit-${policy.asset}`
                    : `allow-${policy.contractId}`
                }
                className="border-b border-border-subtle transition-colors last:border-b-0 hover:bg-surface-hover"
              >
                <td className="value px-4 py-3 align-top text-accent">{policy.kind}</td>
                <td className="px-4 py-3 align-top">
                  <Address
                    value={policy.kind === 'spending_limit' ? policy.asset : policy.contractId}
                  />
                </td>
                <td className="px-4 py-3 align-top">
                  {policy.kind === 'spending_limit' ? (
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="value font-semibold text-foreground">{policy.limit}</span>
                      <span className="value text-muted-dim">({decimalise(policy.limit)})</span>
                      <span className="text-[12.5px] text-muted">
                        per <span className="value">{policy.windowLedgers}</span> ledgers
                      </span>
                      <span className="text-[12.5px] text-muted-dim">
                        ({ledgersToDuration(policy.windowLedgers)})
                      </span>
                    </span>
                  ) : (
                    <span className="value text-foreground">
                      {policy.functions.map((fn) => `${fn}()`).join(', ')}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
    </div>
  );
}
