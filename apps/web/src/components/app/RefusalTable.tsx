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

export function PermittedRow({ run }: { run: RecordedWalkthrough }) {
  return (
    <div className="flex flex-col gap-4 rounded-[5px] border border-permit-line bg-surface px-5 py-4">
      <div className="flex flex-wrap items-center gap-4">
        <Verdict state="permitted" size="lg" />
        <p className="text-[13px] leading-relaxed text-foreground/90">
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
      <div className="scroll-x rounded-[5px] border border-border-default bg-surface">
        <table className="tbl w-full min-w-[54rem]">
          <thead>
            <tr>
              <th scope="col" className="col-verdict">
                verdict
              </th>
              <th scope="col">axis</th>
              <th scope="col">attempt</th>
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
                  <td className="value">{row.axis}</td>
                  <td className="text-[12.5px] text-muted">{row.attempt}</td>
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
