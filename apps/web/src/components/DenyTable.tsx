'use client';

import type { DenyCase, Decision, ObservedTransaction } from '@limen/core';
import { Verdict } from './Verdict';

export interface AdjudicatedCase {
  denyCase: DenyCase;
  decision: Decision;
}

/**
 * The product.
 *
 * Every row is a single-axis mutation of the observed transaction, adjudicated
 * by the same `evaluate` the test suite runs. The observed flow sits at the top
 * as the one PERMIT, so the contrast is visible without scrolling.
 *
 * This table carries the most visual weight on the page: it sits on a raised
 * surface, its rows respond to hover, and the verdict column is a fixed-width
 * gutter so the PERMIT/DENY stripe reads as a single vertical signal.
 */
export function DenyTable({
  observed,
  observedDecision,
  cases,
}: {
  observed: ObservedTransaction;
  observedDecision: Decision;
  cases: AdjudicatedCase[];
}) {
  const overPermissive = cases.filter(({ decision }) => decision.permitted);

  // Counted over every adjudicated row, the observed flow included, so the
  // summary can never disagree with the table under it. On a correct policy
  // this reads "1 permitted · 6 refused"; an over-permissive dimension moves a
  // row from one side to the other and the line moves with it.
  const permittedCount = (observedDecision.permitted ? 1 : 0) + overPermissive.length;
  const refusedCount = cases.length + 1 - permittedCount;

  return (
    <div className="flex flex-col gap-4">
      {overPermissive.length > 0 && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-[4px] border border-deny-line bg-deny-dim px-4 py-3 text-[13px] text-deny"
        >
          <span aria-hidden="true" className="mt-px font-bold">
            ✕
          </span>
          <p>
            <strong className="font-semibold">Over-permissive.</strong> {overPermissive.length}{' '}
            adjacent transaction
            {overPermissive.length === 1 ? '' : 's'} that this policy must refuse
            {overPermissive.length === 1 ? ' was' : ' were'} permitted:{' '}
            <span className="font-mono">
              {overPermissive.map(({ denyCase }) => denyCase.axis).join(', ')}
            </span>
            .
          </p>
        </div>
      )}

      {/* Same colour, glyph, and weight as the verdict column below, so the
          summary reads in greyscale exactly as the rows do. */}
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="value font-bold tracking-[0.06em] text-permit">
          <span aria-hidden="true">✓</span> {permittedCount} permitted
        </span>
        <span aria-hidden="true" className="text-faint">
          ·
        </span>
        <span className="value font-bold tracking-[0.06em] text-deny">
          <span aria-hidden="true">✕</span> {refusedCount} refused
        </span>
      </p>

      <div className="scroll-x rounded-[5px] border border-border-default bg-surface">
        <table className="w-full min-w-[58rem] border-collapse text-left">
          <thead>
            <tr className="border-b border-border-bright bg-surface-raised text-muted-dim">
              <th scope="col" className="col-head w-[9rem] px-5 py-3">
                Verdict
              </th>
              <th scope="col" className="col-head w-[7rem] px-4 py-3">
                Axis
              </th>
              <th scope="col" className="col-head px-4 py-3">
                Transaction
              </th>
              <th scope="col" className="col-head px-4 py-3">
                Reason
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b-2 border-border-bright bg-permit-dim/25">
              <td className="px-5 py-4 align-top">
                <Verdict state={observedDecision.permitted ? 'permitted' : 'denied'} size="lg" />
              </td>
              <td className="px-4 py-4 align-top">
                <span className="value text-muted-dim">observed</span>
              </td>
              <td className="px-4 py-4 align-top">
                <div className="text-[13px] text-foreground">
                  the transaction the policy was derived from
                </div>
                <div className="value mt-1 text-muted-dim">
                  {observed.invocations.length} invocation
                  {observed.invocations.length === 1 ? '' : 's'} at ledger {observed.ledger}
                </div>
              </td>
              <td className="px-4 py-4 align-top text-[12.5px] text-muted">
                {observedDecision.permitted
                  ? 'within every derived constraint'
                  : observedDecision.reasons.join('; ')}
              </td>
            </tr>

            {cases.map(({ denyCase, decision }) => {
              const wrong = decision.permitted;
              return (
                <tr
                  key={denyCase.axis}
                  className={`border-b border-border-subtle transition-colors last:border-b-0 ${
                    wrong ? 'bg-deny-dim/40' : 'hover:bg-surface-hover'
                  }`}
                >
                  <td className="px-5 py-4 align-top">
                    <Verdict state={decision.permitted ? 'permitted' : 'denied'} size="lg" />
                  </td>
                  <td className="px-4 py-4 align-top">
                    <span className="value text-muted-dim">{denyCase.axis}</span>
                  </td>
                  <td className="px-4 py-4 align-top">
                    <div className="text-[13px] text-foreground">{denyCase.label}</div>
                    <div className="mt-1 max-w-[46ch] text-[12.5px] leading-relaxed text-muted-dim">
                      {denyCase.why}
                    </div>
                  </td>
                  <td className="px-4 py-4 align-top">
                    {decision.reasons.length > 0 ? (
                      <ul className="flex flex-col gap-1.5">
                        {decision.reasons.map((reason) => (
                          <li
                            key={reason}
                            // Reasons quote 56-character contract addresses.
                            // Without an explicit break they push the column
                            // past the viewport and the table has to be
                            // scrolled sideways to be read at all.
                            className="value max-w-[52ch] leading-relaxed break-all text-muted"
                          >
                            {reason}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-[12.5px] font-semibold text-deny">
                        no objection raised — this dimension of the policy is too wide
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="max-w-[86ch] text-[12.5px] leading-relaxed text-muted-dim">
        Each row changes exactly one dimension of the observed transaction, so a PERMIT here names
        the single over-permissive dimension. Rows are generated by{' '}
        <code className="font-mono text-muted">generateDenyCases</code> and adjudicated by{' '}
        <code className="font-mono text-muted">evaluate</code> — the same functions the test suite
        runs.
      </p>
    </div>
  );
}
