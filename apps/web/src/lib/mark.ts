/**
 * The mark, as geometry rather than as a drawing.
 *
 * PLAN-V5 §3.2 asks for a geometric glyph reading as a threshold or boundary,
 * monochrome, legible at 24px and as a favicon. This module is the one place it
 * is defined; the component, `app/icon.svg`, the share card and `favicon.ico`
 * are all consumers, exactly as `lib/theme.ts` is the one place the palette is
 * defined. A mark drawn twice is a mark that will disagree with itself, and the
 * OG card's eleven drifted colours are what that looks like when it happens.
 *
 * ## What it draws
 *
 * A doorway standing on its threshold stone. *Limen* is that stone — the raised
 * sill at the base of a doorway, the thing you cross — so the mark is the
 * product's name rendered literally rather than an abstraction of it. The sill
 * runs wider than the jambs it carries, which is what makes it read as a
 * threshold being stood upon rather than as a box with a thick bottom edge.
 *
 * Five other candidates were drawn and rendered at 16, 20, 24, 32 and 64px
 * before this one was chosen, on light and on dark: a contained square, a frame
 * with a core, a bar with a shape held behind it, a step in section, and a
 * narrower doorway. The first three lost at 16px, where they read as a dot in a
 * box or as a typographic accident; the step read as a chart. A variant with the
 * sill detached by a hairline gap read as a broken glyph rather than as two
 * elements, so the jambs sit directly on the stone.
 *
 * ## Why rectangles only, and why every number is a multiple of 1.5
 *
 * Two reasons, and the second is the load-bearing one.
 *
 * The register: this system is a ruled drawing — hairlines, right angles, no
 * curve anywhere in it — and a mark with a radius or a diagonal would be the
 * only such shape in the product.
 *
 * The mechanics: axis-aligned rectangles on a 24 grid, with every coordinate a
 * multiple of 1.5, put every edge on a whole pixel at 16px (scale 2/3), 24px
 * (1:1), 32px (4/3) and 48px (2:1) — the sizes a favicon is actually rasterised
 * at. Nothing is anti-aliased, so the glyph is as crisp in a tab strip as it is
 * on the page. It also means `favicon.ico` can be rasterised exactly, by
 * arithmetic, without a browser or an image library — see `scripts/mark.mjs`,
 * which is why that file can be regenerated and byte-compared in an ordinary
 * unit test rather than needing a check of its own.
 *
 * The rectangles are deliberately non-overlapping — the lintel spans the gap
 * between the jambs rather than the full width — so a rasteriser may sum
 * coverage rather than having to union it. Overlap would make that sum wrong at
 * any size where an edge did not land on a pixel boundary.
 */

/** The grid the mark is drawn on. Square, and the SVG `viewBox` both ways. */
export const MARK_GRID = 24;

/** One rectangle of ink. */
export interface MarkRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The mark. Four rectangles: two jambs, a lintel across the opening, and the
 * sill they stand on.
 *
 * Drawn 21 wide and 18 tall inside the 24 grid, centred, so it carries its own
 * margin and can be placed flush against text without a wrapper.
 */
export const MARK_RECTS: readonly MarkRect[] = [
  { x: 4.5, y: 3, width: 3, height: 15 },
  { x: 7.5, y: 3, width: 9, height: 3 },
  { x: 16.5, y: 3, width: 3, height: 15 },
  { x: 1.5, y: 18, width: 21, height: 3 },
];

/**
 * The margin the mark carries inside its own box, as a fraction of that box.
 *
 * Derived from the rectangles rather than written down, so it cannot fall out of
 * step with them. Subtract it when the mark's ink has to line up with an edge
 * something else is setting — the share card pulls the mark left by `x` so the
 * sill starts exactly where the wordmark's L does, which is the difference
 * between a mark placed above a word and a mark aligned to it.
 */
export const MARK_INSET = {
  x: Math.min(...MARK_RECTS.map((rect) => rect.x)) / MARK_GRID,
  y: Math.min(...MARK_RECTS.map((rect) => rect.y)) / MARK_GRID,
};

/**
 * The mark as a standalone SVG document, for the consumers that cannot render a
 * React element: `app/icon.svg` on disk, and the share card, which reaches it
 * through a data URI because satori has no stylesheet to read `currentColor`
 * from.
 *
 * `inkOnDark` emits a `prefers-color-scheme` rule, and only `app/icon.svg` asks
 * for one. This is not the second theme F3 rules out: that decision is about the
 * product's own surfaces, which stay light throughout and have exactly one
 * definition per token. A favicon is not drawn on one of our surfaces — it is
 * drawn on the browser's tab strip, whose colour is the operating system's
 * business, and near-black ink on a dark tab strip is not restraint, it is an
 * invisible mark. Both values still come from `lib/theme.ts`.
 *
 * The output is a single line with no trailing newline, because it is compared
 * byte-for-byte against the committed file by `design-system.test.ts` and
 * whitespace is not worth a red build.
 */
export function markSvg({
  ink,
  inkOnDark,
  size = MARK_GRID,
}: {
  ink: string;
  inkOnDark?: string;
  size?: number;
}): string {
  const rects = MARK_RECTS.map(
    ({ x, y, width, height }) =>
      `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="currentColor"/>`,
  ).join('');
  const dark =
    inkOnDark === undefined
      ? ''
      : `<style>@media (prefers-color-scheme:dark){svg{color:${inkOnDark}}}</style>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MARK_GRID} ${MARK_GRID}" ` +
    `width="${size}" height="${size}" style="color:${ink}">` +
    `${dark}<title>Limen</title>${rects}</svg>`
  );
}
