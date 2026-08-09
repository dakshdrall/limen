'use client';

import { Address } from '@/components/Address';
import { TxHash } from '@/components/ExplorerLink';
import { Verdict } from '@/components/Verdict';
import type { RecordedAxis, RecordedWalkthrough } from '@/lib/recorded-runs';

/**
 * The refusal table. This is the product.
 *
 * One permitted transaction next to the attempts the boundary refused, each
 * with its hash or with the absence of one stated in the row. Everything here
 * is a network verdict — the host executed the policy contract and the contract
 * said no — which is why the rows carry explorer links and error codes rather
 * than adjectives.
 *
 * Three things this table refuses to do:
 *
 * 1. **Blend provenance.** Limen's own evaluator also produces DENY rows, in
 *    the simulator. None of them appear here. A table that mixed them would
 *    make the local ones look like network refusals, which is the single most
 *    valuable thing this project has to be careful about.
 * 2. **Fill a missing hash.** An attempt with no hash never reached a ledger,
 *    and the row says so where the hash would be.
 * 3. **Over-attribute an error.** The expiry row reached a ledger, but its
 *    run's diagnostic scan did not recover the contract code, so only the
 *    simulation error is attributed and the row says that in place of the
 *    on-ledger code it does not have.
 */

/**
 * The permitted transaction and the refusals under it, as one object.
 *
 * They are one exhibit and not two adjacent elements — one transaction this
 * boundary was built to permit, and six it refused, making a single argument.
 * That reads as one thing only if it looks like one, which means sharing both
 * edges rather than only the left.
 *
 * `w-max` so the container is the width of its widest child, which is the
 * table: `.tbl-fit` makes that the sum of the column tokens rather than
 * whatever holds it. `max-w-full` keeps it bounded by the band, so when the
 * viewport is narrower than the sum the container stops at the band and the
 * table scrolls inside its own `.scroll-x` box rather than pushing the page
 * sideways.
 *
 * The alternative was letting the panel hug its own content. It was declined:
 * the band would then carry three different right edges — prose at `.measure`,
 * the panel at roughly 800, the table at 1074. Left alignment makes differing
 * right edges acceptable, not free, and three is where it stops reading as
 * deliberate.
 *
 * Both children then fill that width by the flex default — `align-items:
 * stretch` on a column, with neither child setting a width of its own. An
 * explicit `w-full` on the panel was tried and measured to change nothing, so
 * it is not here; a class that does nothing while a comment calls it
 * load-bearing is worse than no class.
 *
 * The one thing this arrangement asks of its children: **the table has to be
 * the widest of them.** If the panel's max-content ever exceeded the table's,
 * the panel would size the container and the table — still `w-max` — would sit
 * inside it at its own narrower width, which is the mismatch this exists to
 * remove, mirrored. Today it is not close: measured at 1440 the panel asks for
 * 663px against the table's 1074. Nothing in the panel is free to grow either,
 * since both its rows are truncated values at fixed widths and its one run of
 * prose is capped at the measure. None of that is enforced by the CSS, which is
 * why `e2e/viewports.spec.ts` measures the two edges rather than trusting it.
 */
export function Exhibit({ children }: { children: React.ReactNode }) {
  // `data-exhibit` is a test hook and is here deliberately rather than in the
  // spec as a class selector. The table's own bordered box is also `w-max`, so
  // a test that went looking for the container by that class would, if this
  // component were ever removed, find the table box instead and compare it to
  // itself — passing loudly while the two panels drifted apart. An attribute
  // only this component sets cannot be satisfied by the thing it wraps.
  return (
    <div data-exhibit className="flex w-max max-w-full flex-col gap-6">
      {children}
    </div>
  );
}

export function PermittedRow({ run }: { run: RecordedWalkthrough }) {
  return (
    <div className="flex flex-col gap-4 rounded-[5px] border border-permit-line bg-surface px-5 py-4">
      <div className="flex flex-wrap items-center gap-4">
        <Verdict state="permitted" size="lg" />
        {/* `measure` is a bound rather than typography, and it is headroom
            rather than a thing currently doing work: this sentence renders at
            less than the cap, so removing the class changes nothing today. It
            is here because this is the one element in the panel free to grow —
            the two rows below are truncated values at fixed widths — and inside
            the `Exhibit` above, a panel that outgrew the table would silently
            take over sizing the exhibit. Measured at 1440: the panel asks for
            663px and the table for 1074. */}
        <p className="measure text-[13px] leading-relaxed text-foreground/90">
          The transfer this boundary was built to permit. It reached a ledger and succeeded.
        </p>
      </div>
      <dl className="flex flex-wrap gap-x-10 gap-y-3 text-[12.5px]">
        <div className="flex flex-col gap-0.5">
          <dt className="col-head text-muted-dim">transaction</dt>
          <dd>
            <TxHash hash={run.permittedTx} />
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="col-head text-muted-dim">token</dt>
          <dd>
            <Address value={run.token} />
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="col-head text-muted-dim">installed by</dt>
          <dd>
            <TxHash hash={run.installTx} />
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function RefusedTable({
  rows,
  caption,
}: {
  rows: RecordedAxis[];
  /** The recording's own note about what these rows were produced against. */
  caption: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      {/* `w-max max-w-full` so the panel is the table's width, not the band's.
          Sizing the table alone leaves the surface it sits on stretched, and a
          1072px table inside a 1360px bordered box is a table that looks like it
          failed to fill its container — exactly the impression this is fixing.
          The cap is what keeps `.scroll-x` able to scroll: below the sum the
          panel is bounded by the band and the table scrolls inside it. */}
      <div className="scroll-x w-max max-w-full rounded-[5px] border border-border-default bg-surface">
        {/* `tbl-fit`, so the table is the sum of its columns rather than the
            width of whatever holds it. Every column below carries a token, which
            is the condition that class states — the two prose columns had none
            until this, and were where a full-bleed band's leftover width went.

            `min-w` is gone with the stretch. It existed to stop a 100%-width
            table from crushing its own columns on a narrow screen; a table sized
            to its columns cannot do that, and `.scroll-x` above still scrolls it
            when the viewport is narrower than the sum. */}
        <table className="tbl tbl-fit">
          <thead>
            <tr>
              <th scope="col" className="col-verdict">
                verdict
              </th>
              <th scope="col" className="col-axis">
                axis
              </th>
              <th scope="col" className="col-attempt">
                attempt
              </th>
              <th scope="col" className="col-error">
                refused by
              </th>
              <th scope="col" className="col-hash">
                on ledger
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              // The recording distinguishes an error decoded from the submitted
              // transaction's diagnostics from a note explaining that it could
              // not be. An error code contains a `#`; the note does not.
              const decoded = row.ledger.includes('#');
              return (
                <tr key={row.axis}>
                  <td className="col-verdict">
                    <Verdict state="denied" />
                  </td>
                  <td className="col-axis value">{row.axis}</td>
                  <td className="col-attempt text-[12.5px] text-muted">{row.attempt}</td>
                  <td className="col-error text-[12.5px]">
                    <span className="value text-deny">{decoded ? row.ledger : row.sim}</span>
                    {!decoded && (
                      <span className="mt-0.5 block text-[11.5px] leading-relaxed text-unproven">
                        simulation only — {row.ledger}
                      </span>
                    )}
                  </td>
                  <td className="col-hash">
                    {row.hash === undefined ? (
                      <span className="text-[12px] text-unproven">never reached a ledger</span>
                    ) : (
                      <TxHash hash={row.hash} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="measure text-[12px] leading-relaxed text-muted-dim">{caption}</p>
    </div>
  );
}
