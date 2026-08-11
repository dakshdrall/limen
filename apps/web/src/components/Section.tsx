/**
 * A numbered section within a screen.
 *
 * Sections are separated by space rather than rules. The eyebrow numeral is
 * faint and small; the title carries the weight. Hierarchy comes from weight and
 * colour, not from size alone — which is the instrument's rule, and the reason
 * the emphasised title tops out at 22px rather than reaching for the narrative's
 * scale.
 *
 * ## What V6 dropped: `id` and `bleed`
 *
 * Both existed for the V5 landing. `id` set an anchor and a scroll margin for
 * `landing/SectionNav`, and `bleed` spanned the viewport for the one table wide
 * enough to want it. The landing is gone — the argument is told in `Scene` now,
 * which owns its own anchoring and its own full-bleed band.
 *
 * That leaves `/app` as the only consumer, and `/app` passes neither. They are
 * dropped rather than carried: a prop with no call site is a prop that drifts,
 * and the scroll-margin value in particular encoded the height of a sticky nav
 * that no longer exists. A screen that needs to be anchored again should get the
 * margin measured against the chrome of the day.
 */
export function Section({
  index,
  title,
  subtitle,
  children,
  emphasis = false,
}: {
  index: number;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  /** The step a screen is actually about gets more air and a heavier title. */
  emphasis?: boolean;
}) {
  return (
    <section className={emphasis ? 'flex flex-col gap-6' : 'flex flex-col gap-4'}>
      <header className="flex flex-col gap-1.5">
        <span className="eyebrow text-faint">{String(index).padStart(2, '0')}</span>
        <h2
          className={
            emphasis
              ? 'text-[22px] leading-tight font-semibold tracking-[-0.01em] text-foreground'
              : 'text-[17px] leading-tight font-semibold tracking-[-0.01em] text-foreground'
          }
        >
          {title}
        </h2>
        {subtitle !== undefined && (
          <p className="measure text-[13px] leading-relaxed text-muted">{subtitle}</p>
        )}
      </header>
      {children}
    </section>
  );
}
