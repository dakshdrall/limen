/**
 * Sections are separated by space rather than rules. The eyebrow numeral is
 * faint and small; the title carries the weight. Hierarchy comes from weight
 * and colour, not from size alone.
 */
export function Section({
  index,
  title,
  subtitle,
  children,
  emphasis = false,
  bleed = false,
}: {
  index: number;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  /** The deny table gets more air and a heavier title than the rest. */
  emphasis?: boolean;
  /**
   * Span the viewport rather than the measure — see `.bleed` in `globals.css`.
   *
   * Only works where `.bleed` works: as a direct child of `.screen`. It is a
   * prop rather than a `className` escape hatch because there is exactly one
   * thing on this site wide enough to want it, and a general className would
   * invite the second and third.
   */
  bleed?: boolean;
}) {
  return (
    <section
      className={`${bleed ? 'bleed ' : ''}${emphasis ? 'flex flex-col gap-6' : 'flex flex-col gap-4'}`}
    >
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
