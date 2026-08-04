import { StatusLabels, type StatusLabelName } from '@/components/StatusLabel';

/**
 * The block every screen opens with: where you are, what this is, what it is
 * made of, and how far to trust it.
 *
 * Five copies of this existed, one per screen, and they had already begun to
 * drift — the lede was capped at 76ch on two screens and 78ch on three, for no
 * reason either of them recorded. That drift is cheap to ignore and it is
 * exactly what makes an interface read as assembled rather than designed: the
 * eye registers that two pages disagree about a measurement long before anyone
 * can say which one.
 *
 * `labels` is required rather than optional. Every screen in this application
 * is testnet-only and most are unaudited, and a screen that could omit its
 * labels is a screen that will omit them on the day someone is in a hurry.
 * `StatusLabels` takes a closed union, so the set cannot be widened here.
 */
export function ScreenHeader({
  eyebrow,
  title,
  lede,
  labels,
}: {
  /** Where this screen sits — lowercase, it is a location, not a heading. */
  eyebrow: string;
  title: string;
  /**
   * Usually one paragraph, passed as a string or a fragment. A screen with a
   * second thought to state passes `<><p>…</p><p>…</p></>`; the gap between
   * them is decided here rather than by whoever writes the second one.
   *
   * Inline markup inside a single paragraph — `<em>`, a link — stays inline.
   * That is not free: this was a flex column, and a flex column makes a block
   * out of every child it is given, so the activity screen's one sentence about
   * what a boundary <em>permitted</em> came out as three stacked fragments with
   * the emphasised word alone on the middle line. The failure is quiet in
   * exactly the wrong way, because the words are all still there and in the
   * right order.
   *
   * Optional only where the title is already the whole claim.
   */
  lede?: React.ReactNode;
  labels: readonly StatusLabelName[];
}) {
  return (
    <header className="flex flex-col gap-4">
      <span className="eyebrow-lead text-faint">{eyebrow}</span>
      <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.015em] text-foreground">
        {title}
      </h1>
      {/* `space-y` rather than a flex column: it puts the gap between sibling
          *elements* and leaves text and inline markup alone, so both shapes the
          `lede` prop accepts render the way they read in the source. */}
      {lede !== undefined && (
        <div className="measure space-y-3 text-[14px] leading-relaxed text-muted">
          {lede}
        </div>
      )}
      <StatusLabels names={labels} />
    </header>
  );
}
