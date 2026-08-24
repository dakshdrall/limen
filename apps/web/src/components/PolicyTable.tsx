'use client';

import type { PolicyProposal } from '@limen/core';
import { Address } from '@/components/Address';
import { decimalise, ledgersToDuration } from '@/lib/format';

/**
 * The derived policy, rendered as data: the context rule and every
 * `PolicyConfig` it carries.
 *
 * Shared by the review screen and the simulator so both render the same
 * proposal the same way. Neither computes anything — every value below comes
 * straight off a `synthesize()` return value, which is the invariant the whole
 * product rests on.
 *
 * ## The inline column widths are gone
 *
 * `w-[13rem]`, `w-[12rem]` and `w-[11rem]` used to sit on the cells below, which
 * is exactly what `globals.css` says a table should not do: the column tokens
 * exist so a width is stated once and applied, never re-derived per table. These
 * two tables predated the tokens and had not been moved over. They are now, in
 * their own commit and against a measured before-and-after, which is what the
 * note here previously promised.
 *
 * The move is to `.tbl`, not to the tokens alone, and that is the whole reason
 * it was worth doing. The tokens are stated in `ch`, so they only mean the same
 * width in the type scale they were measured in: applying `.col-addr` to a table
 * still at 13.5px would have produced a third address width rather than removed
 * the second one. `.tbl w-full min-w-[Nrem]` is the pattern `RulesTable`,
 * `ActivityScreen` and `InstallPlanTable` already use, so this is these two
 * joining the house table rather than a new arrangement for them.
 *
 * The payoff is `--col-addr`. Three of the six converted columns hold an address
 * and needed no new token at all — `Target` here and `Contract` in
 * `ObservedSection` are now the same width as the contract column on the rules
 * table and the install plan, which they were not while each file named its own.
 */
export function PolicyTable({ proposal }: { proposal: PolicyProposal }) {
  const rule = proposal.contextRule;

  return (
    <div className="flex flex-col gap-7">
      {/* --- context rule -------------------------------------------------- */}
      <div className="flex flex-col gap-2.5">
        <h3 className="col-head text-muted">Context rule</h3>
        <div className="scroll-x rounded-[5px] border border-border-default bg-surface">
          <table className="tbl w-full min-w-[42rem]">
            <tbody>
              <tr>
                <th scope="row" className="col-head col-rowhead text-muted-dim">
                  allowed contracts
                </th>
                <td>
                  <ul className="flex flex-col gap-1">
                    {rule.allowedContracts.map((contractId) => (
                      <li key={contractId}>
                        <Address value={contractId} />
                      </li>
                    ))}
                  </ul>
                </td>
              </tr>
              <tr>
                <th scope="row" className="col-head col-rowhead text-muted-dim">
                  allowed functions
                </th>
                <td>
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
                <th scope="row" className="col-head col-rowhead text-muted-dim">
                  validity
                </th>
                <td>
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
          <span className="text-faint tracking-normal normal-case">
            ({proposal.policies.length} of 5 max)
          </span>
        </h3>
        <div className="scroll-x rounded-[5px] border border-border-default bg-surface">
          <table className="tbl w-full min-w-[46rem]">
            <thead>
              <tr className="bg-surface-raised text-muted-dim">
                <th scope="col" className="col-head col-primitive">
                  Primitive
                </th>
                <th scope="col" className="col-head col-addr">
                  Target
                </th>
                <th scope="col" className="col-head">
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
                >
                  <td className="col-primitive value text-accent">{policy.kind}</td>
                  <td className="col-addr">
                    <Address
                      value={policy.kind === 'spending_limit' ? policy.asset : policy.contractId}
                    />
                  </td>
                  <td>
                    {policy.kind === 'spending_limit' ? (
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span className="value font-semibold text-foreground">{policy.limit}</span>
                        <span className="value text-muted-dim">({decimalise(policy.limit)})</span>
                        <span className="text-[12.5px] text-muted">
                          per <span className="value">{policy.windowLedgers}</span>{' '}
                          ledgers
                        </span>
                        <span className="text-[12.5px] text-muted-dim">
                          ({ledgersToDuration(policy.windowLedgers)})
                        </span>
                      </span>
                    ) : policy.kind === 'function_allowlist' ? (
                      <span className="value text-foreground">
                        {policy.functions.map((fn: string) => `${fn}()`).join(', ')}
                      </span>
                    ) : (
                      // A venue. It constrains no function, and saying so is
                      // the honest render — an empty cell would read as a
                      // missing value rather than as an absent limit.
                      <span className="text-[12.5px] text-muted">
                        any function — bounded by the token cap, not here
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
