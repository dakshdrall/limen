import { MARK_GRID, MARK_RECTS } from '@/lib/mark';

/**
 * The mark, wherever it appears inside the application.
 *
 * Inline SVG rather than an `<img>`, and `currentColor` rather than a fill, so
 * the glyph is the colour of the text beside it in every context it is ever
 * placed in — the top bar, a footer column, a disabled control — and cannot
 * drift from the palette the way a second copy of a colour always eventually
 * does. There is nothing to keep in sync: the geometry comes from `lib/mark.ts`
 * and the colour comes from whatever is inheriting.
 *
 * Decorative by default. The mark sits beside the LIMEN wordmark in the top bar,
 * and a screen reader announcing "Limen, link, Limen" is the classic redundant
 * alt text. `title` is for the one case where it appears alone and has to carry
 * the name itself.
 */
export function Mark({
  size = 24,
  className,
  title,
}: {
  size?: number;
  className?: string;
  /** Names the mark for assistive technology. Omit when text beside it already does. */
  title?: string;
}) {
  return (
    <svg
      viewBox={`0 0 ${MARK_GRID} ${MARK_GRID}`}
      width={size}
      height={size}
      className={className}
      role={title === undefined ? undefined : 'img'}
      aria-hidden={title === undefined ? true : undefined}
      // Keeps IE-era focus behaviour out of the tab order in browsers that still
      // make inline SVG focusable inside a link.
      focusable="false"
    >
      {title === undefined ? null : <title>{title}</title>}
      {MARK_RECTS.map(({ x, y, width, height }) => (
        <rect
          key={`${x}-${y}`}
          x={x}
          y={y}
          width={width}
          height={height}
          fill="currentColor"
        />
      ))}
    </svg>
  );
}
