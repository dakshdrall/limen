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
 * They were not. Every single one had drifted:
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
 * PLAN-V5 F4. Values here are still the dark palette; §2.1 replaces them, and
 * the pin above is what makes that replacement a single edit that cannot land
 * halfway.
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
 * step below `surface` rather than `surface` at reduced alpha — alpha lets the
 * ground's grid through, and a card the floor shows through does not read as
 * sitting on anything.
 */
export const GROUND = {
  background: '#060a11',
  surface: '#0b111b',
  surfaceRaised: '#101826',
  surfaceHover: '#0e1521',
  surfaceSunken: '#080d15',
} as const satisfies Record<string, Hex>;

/** Three rule weights, all thin. Depth comes from which one you use. */
export const RULES = {
  borderSubtle: '#16202f',
  border: '#1f2c3f',
  borderBright: '#2b3b52',
} as const satisfies Record<string, Hex>;

/**
 * Four deliberate contrast steps against the ground.
 *
 * Currently ~16.2:1, ~7.9:1, ~4.3:1 and ~2.3:1 against `GROUND.background`.
 *
 * PLAN-V5 F1: this ramp does not survive being inverted arithmetically —
 * `mutedDim` lands at 3.11:1, under AA, from an operation that looks lossless.
 * §2.1 replaces these by measurement and pins the measured ratios in a test, so
 * that a value edited without re-measuring becomes a red build rather than a
 * comment that has quietly stopped being true.
 */
export const TEXT = {
  foreground: '#e3e9f2',
  muted: '#97a4b8',
  mutedDim: '#68758a',
  faint: '#414d60',
} as const satisfies Record<string, Hex>;

/**
 * The verdicts. Hue AND glyph AND border, never hue alone.
 *
 * `unproven` is deliberately the neutral ramp rather than a fourth hue: a
 * boundary refusal that never reached a ledger is a weaker claim than one that
 * did, and it is drawn as visibly-a-weaker-refusal rather than as a new kind of
 * one.
 */
export const VERDICT = {
  permit: '#45c86a',
  permitDim: '#08210f',
  permitLine: '#1c5730',

  deny: '#f9695f',
  denyDim: '#250c0c',
  denyLine: '#762824',

  unproven: '#97a4b8',
  unprovenDim: '#0e1521',
  unprovenLine: '#3b4859',
} as const satisfies Record<string, Hex>;

/** One accent. Active navigation, focus, and the copy affordance. */
export const ACCENT = {
  accent: '#58b0e8',
  accentDim: '#08192a',
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
 */
export const GRID = {
  gridMinor: 'rgb(120 170 220 / 0.026)',
  gridMajor: 'rgb(120 170 220 / 0.048)',
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
