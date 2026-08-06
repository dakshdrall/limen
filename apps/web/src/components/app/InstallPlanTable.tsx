'use client';

import { Address } from '@/components/Address';
import { StatusLabel } from '@/components/StatusLabel';
import type { InstallPlan } from '@/lib/lower-contract';
import { decimalise, ledgersToDuration } from '@/lib/format';

/**
 * Exactly what would be written to the chain. Nothing else.
 *
 * This is the strictest table in the application. `validFromLedger` has no
 * on-chain counterpart (plan §2.3) and every derived rationale line is this
 * repository's reasoning rather than the network's — so neither appears here,
 * at any size, in any colour. The install summary shows the fields that go to
 * the chain and nothing more, because a user reviewing a boundary is entitled
 * to assume that what they are reading is what will be enforced.
 *
 * The `notes` block sits outside the table for the same reason: it is the
 * lowering explaining itself, which is useful and is not part of the write.
 */
export function InstallPlanTable({ plan }: { plan: InstallPlan }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <StatusLabel name="COMPOSITION ONLY" />
        <p className="text-[12.5px] text-muted-dim">
          {plan.rules.length === 1 ? 'One context rule' : `${plan.rules.length} context rules`}, each a
          configuration of an audited OpenZeppelin primitive.
        </p>
      </div>

      <div className="scroll-x rounded-[5px] border border-border-default bg-surface">
        <table className="tbl w-full min-w-[48rem]">
          <thead>
            <tr>
              <th scope="col">rule name</th>
              <th scope="col" className="col-addr">
                contract
              </th>
              <th scope="col">valid until</th>
              <th scope="col">policy</th>
              <th scope="col" className="col-amount">
                cap
              </th>
              <th scope="col">window</th>
            </tr>
          </thead>
          <tbody>
            {plan.rules.flatMap((rule) =>
              rule.policies.length === 0
                ? [
                    <tr key={rule.name}>
                      <td className="value">{rule.name}</td>
                      <td className="col-addr">
                        <Address value={rule.contract} />
                      </td>
                      <td className="num">
                        {rule.validUntilLedger === null ? '—' : rule.validUntilLedger.toLocaleString('en-US')}
                      </td>
                      <td colSpan={3} className="text-[12.5px] text-unproven">
                        no policy — this rule would authorize its context unbounded
                      </td>
                    </tr>,
                  ]
                : rule.policies.map((policy, index) => (
                    <tr key={`${rule.name}-${policy.asset}-${index}`}>
                      <td className="value">{index === 0 ? rule.name : ''}</td>
                      <td className="col-addr">{index === 0 ? <Address value={rule.contract} /> : null}</td>
                      <td className="num">
                        {index === 0
                          ? rule.validUntilLedger === null
                            ? '—'
                            : rule.validUntilLedger.toLocaleString('en-US')
                          : ''}
                      </td>
                      <td className="text-[12.5px] text-muted">spending limit</td>
                      <td className="col-amount num">{decimalise(policy.limit)}</td>
                      <td className="text-[12.5px] text-muted">
                        {ledgersToDuration(policy.windowLedgers)}
                      </td>
                    </tr>
                  )),
            )}
          </tbody>
        </table>
      </div>

      {plan.notes.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="col-head text-muted-dim">how it lowered</span>
          <ul className="flex flex-col gap-1.5">
            {plan.notes.map((note) => (
              // `break-words`: a lowering note is a machine string —
              // `rule:C…:CallContract(C…)` — with no spaces in it, so at a phone
              // width it is one unbreakable 950px token. It has `overflow:
              // visible`, so it does not scroll inside anything; it pushes the
              // document sideways and takes every screen that renders a plan
              // with it. Measured at 390px, where it was the whole of the
              // overflow on `/app/policies/new`.
              <li key={note} className="measure text-[12.5px] leading-relaxed break-words text-muted">
                {note}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
