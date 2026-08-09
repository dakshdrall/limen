import { ExplorerLink } from '@/components/ExplorerLink';
import { Verdict } from '@/components/Verdict';
import { chainTxUrl } from '@/lib/explorer';
import { truncateHash } from '@/lib/format';
import type { RecordedAxis } from '@/lib/recorded-runs';

/**
 * The six refusals, transcribed.
 *
 * The centre of the page, and the only part of it that is evidence rather than
 * argument. Every row is one axis of adjacency to the permitted flow — a
 * different amount, a different function, a different asset, a different
 * contract, an extra invocation, a later ledger — attempted against a real rule
 * on a real account, and refused on a real ledger. Six hashes, all checkable.
 *
 * ## What this table is careful not to claim
 *
 * The recording distinguishes two things that are easy to blur, and the blur
 * would flatter us. `sim` is the error the simulation reported. `ledger` is the
 * error decoded from the submitted transaction's own diagnostic events — the
 * stronger claim, because it is what the network actually did rather than what
 * it predicted it would do.
 *
 * Five of the six carry both, and they agree. The expiry axis does not: it
 * reached a ledger and failed there, but that run's diagnostic scan did not
 * recover a contract error code for it, so the recording stores prose in
 * `ledger` instead of a code and says why.
 *
 * The honest rendering of that is not to fall back to the simulation error and
 * present it as though the ledger returned it. So `decoded()` decides per row
 * which claim the recording actually supports, and the sixth row says
 * `refused on ledger; code not recovered` in the neutral ramp — visibly a
 * weaker attribution rather than a missing one. The refusal itself is not
 * weaker; every one of the six is on a ledger, and the count in the caption
 * says six for that reason.
 *
 * This is the same distinction `Verdict` draws between `denied` and
 * `refused-at-simulation`, applied one level down to the error code rather than
 * to the outcome. All six rows are `denied`: all six reached a ledger.
 */

/** A contract error as the recording spells one: `SpendingLimitExceeded#3221`. */
const ERROR_CODE = /^[A-Za-z]+#\d+$/;

/**
 * Whether the recording's `ledger` field is an error code or a note about not
 * having one.
 *
 * Matched on shape rather than on the specific prose, so a future run that
 * fails to decode a different axis for a different reason is described by
 * whatever it says rather than by a hardcoded exception for `expiry`.
 */
function decoded(axis: RecordedAxis): boolean {
  return ERROR_CODE.test(axis.ledger);
}

export function DenyAxisTable({ axes }: { axes: readonly RecordedAxis[] }) {
  const onLedger = axes.filter((axis) => axis.hash !== undefined).length;
  const withCode = axes.filter(decoded).length;

  return (
    <div className="flex flex-col gap-4">
      {/* `w-fit` so the rule hugs the table rather than running to the edge of
          the bleed band. `.tbl-fit` makes the table the sum of its column
          tokens — deliberately, so a wide band cannot silently widen the
          columns — and a full-width border around a max-content table leaves an
          empty bordered strip that reads as a table that failed to fill its
          box. `max-w-full` keeps the scroll container honest below the sum. */}
      <div className="scroll-x on-ground w-fit max-w-full">
        <table className="tbl tbl-fit">
          <colgroup>
            <col className="col-verdict" />
            <col className="col-axis" />
            <col className="col-attempt" />
            <col className="col-error" />
            <col className="col-hash" />
          </colgroup>
          <thead>
            <tr className="bg-surface-raised">
              <th scope="col" className="col-head">
                Verdict
              </th>
              <th scope="col" className="col-head">
                Axis
              </th>
              <th scope="col" className="col-head">
                What was attempted
              </th>
              <th scope="col" className="col-head">
                Refused by
              </th>
              <th scope="col" className="col-head">
                On ledger
              </th>
            </tr>
          </thead>
          <tbody>
            {axes.map((axis) => (
              <tr key={axis.axis}>
                <td>
                  {/* Every row reached a ledger and failed there, so every row
                      is `denied`. Whether the *code* was recovered is a separate
                      question, answered in the next column but one. */}
                  <Verdict state="denied" />
                </td>
                <td>
                  <span className="value text-muted-dim">{axis.axis}</span>
                </td>
                <td className="text-foreground/90">{axis.attempt}</td>
                <td>
                  {decoded(axis) ? (
                    <span className="value text-deny">{axis.ledger}</span>
                  ) : (
                    // Not the simulation error wearing the ledger's authority.
                    // Drawn in the neutral ramp, like the third verdict, because
                    // it is a weaker attribution and must read as one.
                    <span className="value text-unproven" title={axis.ledger}>
                      refused on ledger; code not recovered
                    </span>
                  )}
                </td>
                <td>
                  {axis.hash === undefined ? (
                    <span className="value text-faint">—</span>
                  ) : (
                    <ExplorerLink href={chainTxUrl(axis.hash)} title={axis.hash}>
                      <span className="value">{truncateHash(axis.hash)}</span>
                    </ExplorerLink>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="measure text-[12.5px] leading-relaxed text-muted-dim">
        {onLedger} of {axes.length} attempts reached a ledger and failed there; every hash above is
        checkable in an explorer. {withCode} of {onLedger}
        {' '}
        also had a contract error code recovered from the transaction&rsquo;s own diagnostic events
        — the remainder is recorded as it happened rather than filled in from the simulation.
      </p>
    </div>
  );
}
