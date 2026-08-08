import { Address } from '@/components/Address';
import { TxHash } from '@/components/ExplorerLink';
import { Verdict, type VerdictState } from '@/components/Verdict';
import { decimalise, ledgersToDuration } from '@/lib/format';
import { RECORDED_REVOCATION as RUN } from '@/lib/recorded-runs';

/**
 * The landing's fourth step: a boundary being taken back, and the call that
 * stopped working afterwards.
 *
 * PLAN-V5 §3.1. The other three steps in that sequence are screenshots. This one
 * is not, and the reason is the rule the screenshot script is built around: the
 * only screen that shows revoke — `/app/policies/[id]` — renders a live chain
 * read, so a photograph of it would freeze one account's rule at one ledger and
 * commit that as a product image. A second, unverifiable copy of chain state in
 * the repository is the exact thing `scripts/screenshots.mjs` exists to prevent,
 * and it would be reintroduced by the tool meant to prevent it.
 *
 * So the step is built from `deployments/testnet.json` instead, which makes it
 * the strongest of the four rather than the fallback. It is the only one that can
 * show the boundary being removed *and* the consequence — and being data rather
 * than a picture, it cannot go stale: re-record the run and these four rows
 * change with it.
 *
 * ## Why it is not framed like the screenshots beside it
 *
 * The images in this band carry a hairline border because they are pictures of
 * another surface and the frame says where that surface ends. This is not a
 * picture. It is the same live markup as the refusal table above it — same
 * verdicts, same explorer links, same mono values — so it gets the refusal
 * table's treatment: one surface, rows divided by the subtle rule.
 *
 * The distinction is worth the paragraph. A data panel sitting among photographs
 * reads as the page showing its working. The same content inside a screenshot
 * frame reads as a mock-up of a screen that does not exist — which would be the
 * one dishonest thing on a page whose whole argument is that its evidence is
 * checkable.
 *
 * ## Four rows, and why the first one is here
 *
 * Row 01 is a permitted call, which is not about revoking anything. It is the
 * referent: without it, row 04 is an agent failing to do something, and there is
 * nothing to say it ever succeeded. With it, row 04 is the *same call* — same
 * amount, still inside the cap — failing only because the rule is gone. That
 * pairing is the whole argument, and it is also why the recorded run deliberately
 * spent less than the cap in row 01.
 */

/**
 * The verdict for the last row, from the recording rather than from this file.
 *
 * `ContextRuleNotFound#3000` is deliberately absent from
 * `BOUNDARY_REFUSAL_CODES` — see `packages/chain/src/errors.ts`. "The boundary
 * refused you" and "the boundary is gone" are different claims, and the run
 * recorded which of the two this was, both ways round. Reading both flags rather
 * than one keeps this panel honest even if a future run records something else:
 * a row that is neither is drawn as neither.
 */
function postRevokeVerdict(): VerdictState {
  if (RUN.postRevokeIsBoundaryRefusal) return 'denied';
  return RUN.postRevokeIsRevokedRule ? 'rule-revoked' : 'refused-at-simulation';
}

export function RevokePanel() {
  return (
    <figure className="flex flex-col gap-2.5">
      {/* The refusal table's surface, not the screenshot frame. `overflow-hidden`
          so the first and last rows are clipped to the radius rather than
          squaring off the corners they sit in. */}
      <div className="overflow-hidden rounded-[5px] border border-border-default bg-surface">
        <ol>
          <Row
            index="01"
            state="permitted"
            title="Inside the boundary"
            hash={RUN.permittedTx}
          >
            The agent spends {decimalise(RUN.permittedAmount)} against a cap of{' '}
            {decimalise(RUN.derivedCap)}, signed by the agent&rsquo;s key and paid for by the
            agent&rsquo;s own account. Deliberately under the cap: if this call had exhausted it,
            row 04 would fail for two reasons at once and demonstrate neither.
          </Row>

          <Row
            index="02"
            state="denied"
            title="The agent tries to remove its own boundary"
            hash={RUN.agentRevokeTx}
            code={RUN.agentRevokeError}
            codeLabel="refused by"
          >
            Refused by the contract, not by this application withholding a button.{' '}
            <span className="value">remove_context_rule</span> requires the account to authorize
            itself, and this rule&rsquo;s context is a call to the token — which does not match a
            call to the account. The owner&rsquo;s Default rule does.
          </Row>

          <Row
            index="03"
            state="permitted"
            title="The owner takes it back"
            hash={RUN.revokeTx}
          >
            The same key that installed the boundary removes it. {RUN.rulesAfterRevokeNote}
          </Row>

          <Row
            index="04"
            state={postRevokeVerdict()}
            title="The same call, now"
            hash={RUN.postRevokeTx}
            code={RUN.postRevokeError}
            codeLabel="failed with"
          >
            Row 01 repeated, unchanged and still inside the cap that used to apply. It fails because
            the rule is gone, not because a limit was reached — which is a weaker result than a
            refusal and is drawn as one. This page does not count a rule that no longer exists as a
            rule that did its job.
          </Row>
        </ol>
      </div>

      <figcaption className="text-[11.5px] leading-relaxed text-muted-dim">
        A third run, on a third account — <Address value={RUN.smartAccount} />, not the one in the
        refusal table above. Produced by <span className="value">{RUN.producedBy}</span> on{' '}
        {RUN.ranAt}: context rule {RUN.contextRuleId}, derived and installed in that same pass, cap{' '}
        {decimalise(RUN.derivedCap)} per {RUN.windowLedgers} ledgers (
        {ledgersToDuration(RUN.windowLedgers)}). Every hash here reached a ledger and is openable in
        an explorer.
      </figcaption>
    </figure>
  );
}

/**
 * One transaction, its verdict, and what it means.
 *
 * The verdict badge and the explorer link are the same components the refusal
 * table uses, which is the point: a reader who has already learned what DENY and
 * NO RULE look like two sections above does not have to learn them again here.
 */
function Row({
  index,
  state,
  title,
  hash,
  code,
  codeLabel,
  children,
}: {
  index: string;
  state: VerdictState;
  title: string;
  hash: string;
  /** The contract error, when the attempt failed. Absent when it succeeded. */
  code?: string;
  /**
   * What the error was to this row. `refused by` for the boundary declining;
   * `failed with` for row 04, which is not a refusal and must not be labelled as
   * one — the label is where that distinction is visible at a glance.
   */
  codeLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex flex-col gap-2.5 border-t border-border-subtle px-5 py-4 first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="eyebrow shrink-0 text-faint">{index}</span>
        <Verdict state={state} />
        <h4 className="text-[13px] font-semibold tracking-[-0.01em] text-foreground">{title}</h4>
      </div>

      <p className="text-[12.5px] leading-relaxed text-muted">{children}</p>

      <dl className="flex flex-wrap items-baseline gap-x-8 gap-y-1.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <dt className="col-head">on ledger</dt>
          <dd className="min-w-0">
            <TxHash hash={hash} />
          </dd>
        </div>
        {code !== undefined && (
          <div className="flex min-w-0 items-baseline gap-2">
            <dt className="col-head">{codeLabel}</dt>
            {/* The deny hue only where a boundary actually refused. Row 04's code
                is drawn in the neutral ramp for the same reason it gets the
                neutral verdict: it is the absence of a rule, not a refusal by
                one, and colouring it red would merge the two claims the whole
                sequence exists to separate. */}
            <dd className={`value ${state === 'denied' ? 'text-deny' : 'text-muted'}`}>{code}</dd>
          </div>
        )}
      </dl>
    </li>
  );
}
