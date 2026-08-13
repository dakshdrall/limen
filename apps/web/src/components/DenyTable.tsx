'use client';

import type { DenyCase, Decision, ObservedTransaction } from '@limen/core';
import { Verdict } from '@/components/Verdict';

export interface AdjudicatedCase {
  denyCase: DenyCase;
  decision: Decision;
}

/**
 * The simulator's deny table: local adjudication, one row per axis.
 *
 * Every row is a single-axis mutation of the observed transaction, adjudicated
 * by the same `evaluate` the test suite runs. The observed flow sits at the top
 * as the one PERMIT, so the contrast is visible without scrolling.
 *
 * ## Not the same table as the narrative's
 *
 * `site/DenyAxisTable` renders the six axes as they were *recorded on chain* —
 * hashes, contract error codes, a network's verdict. This one renders what this
 * repository's evaluator decides about a transaction chosen in the page, right
 * now, with no chain involved at all.
 *
 * They look similar and they are different claims, which is exactly why they are
 * two components rather than one with a flag. A single table that could render
 * either would eventually render local reasoning under the on-chain table's
 * framing, and that is the one mistake this project cannot afford. The caption
 * below says which of the two this is, in the row where a reader would look for
 * a hash and not find one.
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

      {/* `.tbl w-full min-w-[58rem]`, the house pattern, joined here off
          `w-[9rem]` and `w-[7rem]` — the last two inline column widths in
          `/app`, and the ones nobody named while the proposal tables were being
          converted.

          `w-[9rem]` was not even the width it stated. Under the auto layout this
          table had, a column is at least its widest cell, and the `lg` verdict
          badge's own `min-w-[7rem]` plus the old `px-5` came to 152px — so the
          declared 144px had been losing to the content since the badge grew.
          That is the failure mode an inline width has and a token does not: it
          reads as a decision and behaves as a suggestion.

          `min-w` is kept, unlike on `RefusalTable`. That table is `.tbl-fit`
          because every one of its columns carries a token; two of these four are
          prose with no token, so this one is `width: 100%` with a floor, and the
          two prose columns share the leftover. */}
      <div className="scroll-x rounded-[5px] border border-border-default bg-surface">
        <table className="tbl w-full min-w-[58rem]">
          <thead>
            <tr className="border-b border-border-bright bg-surface-raised text-muted-dim">
              <th scope="col" className="col-head col-verdict-lg">
                Verdict
              </th>
              <th scope="col" className="col-head col-axis">
                Axis
              </th>
              <th scope="col" className="col-head">
                Transaction
              </th>
              <th scope="col" className="col-head">
                Reason
              </th>
            </tr>
          </thead>
          <tbody>
            {/* `row-tinted` opts out of `.tbl`'s hover background, which is set
                on the cell and would otherwise paint over the tint set here on
                the row. */}
            <tr className="row-tinted border-b-2 border-border-bright bg-permit-dim/25">
              <td>
                <Verdict state={observedDecision.permitted ? 'permitted' : 'denied'} size="lg" />
              </td>
              <td>
                <span className="value text-muted-dim">observed</span>
              </td>
              <td>
                <div className="text-[13px] text-foreground">
                  the transaction the policy was derived from
                </div>
                <div className="value mt-1 text-muted-dim">
                  {observed.invocations.length} invocation
                  {observed.invocations.length === 1 ? '' : 's'} at ledger {observed.ledger}
                </div>
              </td>
              <td className="text-[12.5px] text-muted">
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
                    wrong ? 'row-tinted bg-deny-dim/40' : ''
                  }`}
                >
                  <td>
                    <Verdict state={decision.permitted ? 'permitted' : 'denied'} size="lg" />
                  </td>
                  <td>
                    <span className="value text-muted-dim">{denyCase.axis}</span>
                  </td>
                  <td>
                    <div className="text-[13px] text-foreground">{denyCase.label}</div>
                    <div className="mt-1 max-w-[46ch] text-[12.5px] leading-relaxed text-muted-dim">
                      {denyCase.why}
                    </div>
                  </td>
                  <td>
                    {decision.reasons.length > 0 ? (
                      <ul className="flex flex-col gap-1.5">
                        {decision.reasons.map((reason) => (
                          <li
                            key={reason}
                            // Reasons quote 56-character contract addresses.
                            // `.tbl` sets `overflow-wrap: anywhere`, which is
                            // the same backstop this `break-all` was, but it is
                            // kept: `anywhere` breaks only when the line cannot
                            // fit, and an address is one unbreakable token that
                            // has to break mid-string every time.
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

      <p className="measure text-[12.5px] leading-relaxed text-muted-dim">
        Each row changes exactly one dimension of the observed transaction, so a PERMIT here names
        the single over-permissive dimension. Rows are generated by{' '}
        <code className="font-mono text-muted">generateDenyCases</code> and adjudicated by{' '}
        <code className="font-mono text-muted">evaluate</code> — the same functions the test suite
        runs, in this browser. No network was asked.
      </p>
    </div>
  );
}
