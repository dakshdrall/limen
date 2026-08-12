/**
 * The palette, in TypeScript, because one consumer cannot read CSS.
 *
 * Every colour in this application is a custom property in `globals.css`, and
 * that was true of every consumer but one. `opengraph-image.tsx` renders through
 * satori as an `ImageResponse`: inline styles, no stylesheet, no cascade, so
 * `var(--permit)` resolves to nothing. Its eleven colours were therefore
 * literals, and its own docstring claimed they were "the same palette as the
 * page".
 *
 * They were not. Every single one had drifted, against the dark palette that
 * stood here until §2.1 replaced it:
 *
 *     ground      #0a0b0d  vs  --background     #060a11
 *     eyebrow     #6c747e  vs  --muted-dim      #68758a
 *     wordmark    #e7eaee  vs  --foreground     #e3e9f2
 *     description #9aa2ac  vs  --muted          #97a4b8
 *     permit      #4ac95e  vs  --permit         #45c86a
 *     permit fill #0d2413  vs  --permit-dim     #08210f
 *     permit rule #1f5c2c  vs  --permit-line    #1c5730
 *     deny        #ff6b62  vs  --deny           #f9695f
 *     deny fill   #2a0f0f  vs  --deny-dim       #250c0c
 *     deny rule   #7a2b27  vs  --deny-line      #762824
 *     note        #464d56  vs  --faint          #414d60
 *
 * Close enough that nobody would catch it in review, far enough that the share
 * card is a picture of a slightly different product. That is the ordinary fate
 * of a value written down twice, and it is the same failure the column-width
 * tokens and `lib/explorer.ts` already exist to prevent, in the one place step 11
 * could not reach.
 *
 * So this module is the palette, and `globals.css` and the OG card are both
 * consumers. `design-system.test.ts` asserts three things about it, and the
 * three together are what make it a source of truth rather than a second copy:
 *
 *   1. every token here appears in `globals.css` with exactly this value;
 *   2. every colour custom property in `globals.css` appears here, so a new
 *      token cannot be added to the stylesheet alone and escape the pin;
 *   3. `opengraph-image.tsx` contains no colour literal at all.
 *
 * CSS cannot import TypeScript, so (1) and (2) are a pinned agreement rather
 * than a generated file. That is deliberate: a generated `:root` block would put
 * the palette's documentation — the reasoning in `globals.css` about why the
 * ground is blue-black and why the ramp has four steps — behind a build step,
 * and that reasoning is the most valuable thing in the file.
 *
 * PLAN-V5 F4 built this module; §2.1 then used it to invert the palette to light
 * in a single edit, which is what it was extracted first in order to make
 * possible. Every value below is measured — against the ground, against the
 * surface a thing actually sits on, and in greyscale — and `contrast.test.ts`
 * pins the measurements so that the next edit to a colour has to re-measure or
 * go red.
 *
 * The register did not change with the palette. This is still an instrument:
 * ink on paper rather than light on glass, the same ruled grid, the same four
 * steps, no shadow, no gradient, no glass, and every caveat exactly where it was.
 */

/**
 * A hex colour, lowercase, as written in `globals.css`.
 *
 * The test compares strings, so case and format are load-bearing: `#FFF` and
 * `#ffffff` are the same colour and would read as a drift.
 */
export type Hex = `#${string}`;

/**
 * The ground, and the surfaces that sit on it.
 *
 * Depth is a value step plus a rule, never a shadow. `sunken` is opaque and one
 * step from `surface` rather than `surface` at reduced alpha — alpha lets the
 * ground's grid through, and a card the floor shows through does not read as
 * sitting on anything.
 *
 * ## The one place the inversion changed a direction rather than a value
 *
 * On dark, all four non-ground surfaces sat *above* the ground, and "distinguish
 * this band from the surface it is on" and "lift this above the floor" were the
 * same operation: lighten. Light has a ceiling. The ground is at L=0.956 and
 * white is at 1.0, so there are four steps to fit into five percent of the
 * luminance range, and a table header lighter than the white card it sits on is
 * not a table header.
 *
 * So the two jobs split, which they were always doing and dark let us ignore:
 *
 *   - `surface` and `sunken` sit **above** the ground, toward white, exactly as
 *     before. A card is brighter paper. An unreached step is paper that has not
 *     brightened yet — still above the ground, not yet at the surface, which is
 *     the same position it held on dark.
 *   - `raised` and `hover` are **tints**, below the ground. On light a header
 *     band and a row under the cursor are grey, because that is the only
 *     direction with room in it and because it is what ink on paper does.
 *
 * The names still mean what they meant — `raised` is the band that stands out,
 * `sunken` is the panel that recedes — but `raised` now achieves it by darkening.
 * Written down here because it is invisible in a diff of hex values and it is the
 * first thing that will confuse someone adding a sixth surface.
 *
 * Magnitudes are matched to the dark theme's own separations rather than picked:
 * raised 1.11:1 against the surface where dark was 1.06, hover 1.08 where dark
 * was 1.03, sunken 1.03 where dark was 1.03, ground 1.04 where dark was 1.05.
 * The two tints run slightly stronger than their dark counterparts because each
 * has to stay visible against two backgrounds — a white card and the ground —
 * where on dark every surface only ever sat on one.
 */
export const GROUND = {
  background: '#fbfaf7',
  surface: '#ffffff',
  surfaceRaised: '#f6f3ec',
  surfaceHover: '#f8f6f1',
  surfaceSunken: '#fdfcfa',
} as const satisfies Record<string, Hex>;

/**
 * Three rule weights, all thin. Depth comes from which one you use.
 *
 * Measured against the ground at 1.22:1, 1.42:1 and 1.80:1, which is the dark
 * theme's 1.21 / 1.41 / 1.75 held to within a rounding step. Faintly warm rather
 * than neutral, so a hairline on warm paper reads as ink and not as a grey line
 * laid over it.
 */
export const RULES = {
  borderSubtle: '#e7e4dd',
  border: '#d8d4ca',
  borderBright: '#c2bdb1',
} as const satisfies Record<string, Hex>;

/**
 * Four deliberate contrast steps against the ground.
 *
 *     foreground  16.37:1   primary data and headings   (dark was 16.24)
 *     muted        7.85:1   supporting prose, table headers        (7.85)
 *     muted-dim    4.62:1   secondary annotations, captions        (4.25)
 *     faint        2.60:1   decorative only — numerals, rule marks (2.32)
 *
 * Solved for these targets and then measured, not inverted. PLAN-V5 F1 is the
 * reason: inverting the dark values channel-wise and re-measuring gives 16.52 /
 * 6.08 / **3.11** / 1.92 — `mutedDim` under AA for body text, from an operation
 * that looks lossless, and the four steps no longer evenly spaced, which is the
 * part that makes hierarchy read at all.
 *
 * `contrast.test.ts` pins every ratio here, so a value edited without
 * re-measuring is a red build rather than a comment that has quietly stopped
 * being true. Both of the steps the dark theme was loosest at — `mutedDim` at
 * 4.25 and `faint` at 2.32, each short of its target — are now on target, so
 * this ramp is the better of the two rather than a faithful copy of the worse.
 */
export const TEXT = {
  foreground: '#191c21',
  muted: '#45505e',
  mutedDim: '#69737f',
  faint: '#9b9e99',
} as const satisfies Record<string, Hex>;

/**
 * The verdicts. Hue AND glyph AND border, never hue alone.
 *
 * `unproven` is deliberately the neutral ramp rather than a fourth hue: a
 * boundary refusal that never reached a ledger is a weaker claim than one that
 * did, and it is drawn as visibly-a-weaker-refusal rather than as a new kind of
 * one.
 *
 * ## Why PERMIT and DENY are not the same weight as each other
 *
 * PLAN-V5 F2, and the check the brief called most likely to silently break in an
 * inversion. It was right, and the failure is sharper than "check it afterwards"
 * suggests.
 *
 * Reduced to greyscale — a monochrome printout, a colour-blind reviewer's
 * simulation — the dark theme's PERMIT and DENY sit 25 apart out of 255. Not
 * much, and it works only because hue is never the sole carrier here.
 *
 * The obvious light pair, a dark green and a dark red both around 5:1, sits
 * **5 apart**. Effectively identical. A greyscale print of the refusal table
 * would distinguish its two verdicts by glyph alone.
 *
 * A search over both hue families, constrained to AA against the white surface
 * and the ground, says no comfortable symmetric pair exists: separation is only
 * bought by making one verdict markedly darker than the other. So the asymmetry
 * is taken deliberately rather than compromised into. DENY is 9.11:1 and PERMIT
 * 5.41:1, giving 32 of 255 — better than the dark theme it replaces. A refusal
 * reading heavier than a permission is correct on its own terms; it is the
 * verdict a reader must not miss.
 *
 * The glyph and the border treatment remain the primary carriers, exactly as
 * before. The hue separation is a second line, not the first, and
 * `design-system.test.ts` still pins the glyphs.
 *
 * Fills and rules are matched to the dark theme's own separations: a fill about
 * 1.1:1 from the surface it sits on, a rule about 1.9:1 from its fill.
 */
export const VERDICT = {
  permit: '#0f7a43',
  permitDim: '#e9f6ed',
  permitLine: '#86bd99',

  deny: '#8c1d18',
  denyDim: '#fbf1f0',
  denyLine: '#dda9a3',

  unproven: '#45505e',
  unprovenDim: '#f7f6f3',
  unprovenLine: '#bab4a3',
} as const satisfies Record<string, Hex>;

/**
 * One accent. Active navigation, focus, and the copy affordance.
 *
 * Reconsidered rather than darkened, as §2 requires: `#58b0e8` is a light blue
 * that reads as active against near-black and disappears against off-white. This
 * is a mid ink blue at 6.83:1 on the surface and 6.55:1 on the ground, close to
 * the 7.92:1 the dark accent held.
 *
 * Checked in all three of its jobs rather than only as text, because they are
 * judged against different things: the focus ring is judged against the rule it
 * replaces (3.65:1 against `--border-bright`, so it visibly is not a border), and
 * the active-nav fill against the ground (1.10:1, where dark was 1.12).
 */
export const ACCENT = {
  accent: '#155e96',
  accentDim: '#e9f0f7',
} as const satisfies Record<string, Hex>;

/**
 * The two grid pitches, as drawn.
 *
 * Not hex: these are the only palette values carrying alpha, because the grid is
 * a texture over the ground rather than a colour on it. Kept in the module all
 * the same — they are palette, and leaving them out is how the one token nobody
 * pinned becomes the one token that drifts.
 *
 * The pitches themselves (`--grid-pitch`, `--grid-pitch-major`) are lengths, not
 * colours, and stay in `globals.css` alone.
 *
 * The alphas roughly **halve** in the inversion — 0.026 and 0.048 become 0.014
 * and 0.027 — and that is the whole point of measuring rather than swapping the
 * ink colour and leaving the numbers. Dark ink on light paper reads far stronger
 * than light ink on dark at the same alpha; carrying the dark alphas across would
 * have doubled the grid's contrast and produced exactly the failure the original
 * comment warns about, where you notice the grid instead of the depth.
 *
 * Solved by compositing each line over its ground and matching the resulting
 * contrast: dark's minor rule sits at 1.0262:1 against its ground and this one
 * at 1.0267:1; dark's major at 1.0526 and this one at 1.0504.
 */
export const GRID = {
  gridMinor: 'rgb(26 34 48 / 0.014)',
  gridMajor: 'rgb(26 34 48 / 0.027)',
} as const satisfies Record<string, string>;

/**
 * Every colour token, keyed by its CSS custom property name.
 *
 * The key is the property as `globals.css` spells it, so the test's comparison
 * is a lookup rather than a name transformation — a camelCase-to-kebab mapping
 * in the test would be a third place for the names to disagree.
 */
export const THEME = {
  '--background': GROUND.background,
  '--surface': GROUND.surface,
  '--surface-raised': GROUND.surfaceRaised,
  '--surface-hover': GROUND.surfaceHover,
  '--surface-sunken': GROUND.surfaceSunken,

  '--border-subtle': RULES.borderSubtle,
  '--border': RULES.border,
  '--border-bright': RULES.borderBright,

  '--foreground': TEXT.foreground,
  '--muted': TEXT.muted,
  '--muted-dim': TEXT.mutedDim,
  '--faint': TEXT.faint,

  '--permit': VERDICT.permit,
  '--permit-dim': VERDICT.permitDim,
  '--permit-line': VERDICT.permitLine,

  '--deny': VERDICT.deny,
  '--deny-dim': VERDICT.denyDim,
  '--deny-line': VERDICT.denyLine,

  '--unproven': VERDICT.unproven,
  '--unproven-dim': VERDICT.unprovenDim,
  '--unproven-line': VERDICT.unprovenLine,

  '--accent': ACCENT.accent,
  '--accent-dim': ACCENT.accentDim,

  '--grid-minor': GRID.gridMinor,
  '--grid-major': GRID.gridMajor,
} as const;
