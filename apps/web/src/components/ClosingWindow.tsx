import { closingWindow } from '@/lib/ledger';
import { ledgersToDuration } from '@/lib/format';

/**
 * How much of an installed boundary's validity is left, as a shortening
 * hairline.
 *
 * Both ends of this are real, which is the whole reason it is allowed to move.
 * The current ledger comes from the RPC poll; `validUntilLedger` comes from
 * `read.ts`, off the context rule itself. The denominator — the span the window
 * was given — comes from this browser's provenance record, because the contract
 * stores the ledger it expires at and never the length it was granted.
 *
 * When any of the three is missing the component renders **nothing**. A full-
 * width hairline would be the obvious fallback and it is the wrong one: it says
 * the window has barely started, which is a claim about the rule rather than an
 * admission that this browser cannot compute one.
 *
 * The caption is text, so the reading survives for anyone the hairline does not
 * reach — a screen reader, a printout, reduced motion, or a person who simply
 * does not read a bar as a quantity.
 */
export function ClosingWindow({
  sequence,
  validUntilLedger,
  windowLedgers,
}: {
  sequence: number | null;
  validUntilLedger: number | null;
  /** The rule's original validity span, from local provenance. */
  windowLedgers: number | null;
}) {
  const window = closingWindow({ sequence, validUntilLedger, windowLedgers });
  if (window === null) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <span className="col-head text-muted-dim">validity remaining</span>
        <span className="text-[12.5px] text-muted">
          {window.expired ? (
            'expired'
          ) : (
            <>
              <span className="value">{window.ledgersRemaining.toLocaleString('en-US')}</span>{' '}
              ledgers, {ledgersToDuration(window.ledgersRemaining)}
            </>
          )}
        </span>
      </div>

      {/* The bar is a second rendering of the sentence above it, not the only
          one. `aria-hidden` because a screen reader has already been told the
          number, and a progressbar role would announce the same fact twice in
          a less precise unit. */}
      <div className="closing-window" aria-hidden="true">
        <span style={{ width: `${(window.fraction * 100).toFixed(3)}%` }} />
      </div>

      <p className="measure text-[12px] leading-relaxed text-muted-dim">
        The expiry is on the rule; the current ledger is read from RPC; the window&rsquo;s original
        span is this browser&rsquo;s own record of the install. If the endpoint stops answering, this
        stops rather than continuing to shorten.
      </p>
    </div>
  );
}
