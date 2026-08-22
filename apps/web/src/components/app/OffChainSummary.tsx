'use client';

import { Address } from '@/components/Address';
import { StatusLabel } from '@/components/StatusLabel';
import { fromSmallestUnits } from '@/lib/agent-config';

/**
 * The half of a reviewed agent that no ledger asserts.
 *
 * It sits beneath {@link InstallPlanTable} on the review step and must not look
 * like it. That table is *"exactly what would be written to the chain, nothing
 * else"*; this is the opposite — nothing here is written to any chain, and
 * every rule below exists to stop the two reading as one list of limits.
 *
 * ## What this deliberately does not have
 *
 * **No hash column, and no empty one.** There is nothing to link to, and an
 * empty hash cell reads as *pending* rather than as *inapplicable* — which
 * would be the worst available outcome, because it implies a transaction is
 * coming.
 *
 * **No explorer link**, for the same reason.
 *
 * **No shared heading with the install plan.** The two are separate sections
 * with separate headings, and this one carries `COMPUTED LOCALLY` — the label
 * that already means *nothing on chain asserts it, and no network enforced it*
 * everywhere else in this application.
 *
 * **No footnote.** The reason a constraint is not enforced by the network is
 * stated in the section that contains it, where somebody reading that
 * constraint cannot miss it.
 *
 * The precedent for keeping two kinds of refusal visually apart is already in
 * the codebase: `errors.ts` keeps `REVOKED_RULE_CODES` out of
 * `BOUNDARY_REFUSAL_CODES` so *"the boundary refused you"* and *"the boundary
 * is gone"* cannot render identically.
 *
 * ## The empty case is a claim, not a gap
 *
 * No approved recipients is not "unrestricted" — it is Limen refusing every
 * payment the agent proposes. That is worth more words than a dash, because a
 * blank list in a permissions screen reads as *no limit* to almost everybody.
 */
export function OffChainSummary({
  perTransactionCap,
  recipients,
  assetLabel,
  assetDecimals,
}: {
  perTransactionCap: string | null;
  recipients: readonly string[];
  assetLabel: string;
  assetDecimals: number;
}) {
  const asset = assetLabel.length > 0 ? assetLabel : 'tokens';

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-[14px] font-semibold tracking-[-0.01em] text-foreground">
            Enforced by Limen
          </h3>
          <StatusLabel name="COMPUTED LOCALLY" weight="loud" />
        </div>
        <p className="measure text-[12.5px] leading-relaxed text-muted">
          <strong className="font-semibold text-foreground">
            Unlike everything above, the ledger does not enforce these.
          </strong>{' '}
          No audited policy contract constrains a transfer&rsquo;s destination or the size of a
          single call — OpenZeppelin&rsquo;s spending limit takes an amount and a period and sees
          nothing else. Limen&rsquo;s server refuses a payment that breaks these. Someone holding
          the agent&rsquo;s key could ignore Limen and send to any address, up to the cap above.
          Lower the cap if that matters more than convenience.
        </p>
      </div>

      <div className="panel" data-tone="unproven">
        <dl className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <dt className="col-head text-muted-dim">per-payment ceiling</dt>
            <dd className="text-[13px] text-foreground">
              {perTransactionCap === null ? (
                <span className="text-muted">
                  None. Any single payment may be as large as the remaining cap allows.
                </span>
              ) : (
                <span className="value">
                  {fromSmallestUnits(perTransactionCap, assetDecimals)} {asset}
                </span>
              )}
            </dd>
          </div>

          <div className="flex flex-col gap-1">
            <dt className="col-head text-muted-dim">
              approved recipients {recipients.length > 0 && `(${recipients.length})`}
            </dt>
            <dd className="text-[13px]">
              {recipients.length === 0 ? (
                // Not a dash. A blank list in a permissions screen reads as
                // "no limit" to almost everybody, and it means the opposite.
                <span className="text-muted">
                  None approved, so Limen refuses every payment this agent proposes until you add
                  one. This is a stop, not an absence of one.
                </span>
              ) : (
                <ul className="flex flex-col gap-1">
                  {recipients.map((recipient) => (
                    <li key={recipient}>
                      <Address value={recipient} />
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
