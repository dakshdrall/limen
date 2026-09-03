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


/* ─────────────────────────────────────────────────────── the console palette
 *
 * A second, darker palette for `/app/*` only. The narrative site and the docs
 * keep every token above, byte for byte.
 *
 * ## This scopes the light decision rather than overturning it
 *
 * Limen is light on purpose, and the reason is differentiation: the nearest
 * adjacent product is dark, and a permissions tool that looks like every other
 * crypto dashboard argues for itself less well than one that looks like paper.
 * That reasoning is about the **public surface** — the landing page and the
 * docs are what somebody compares — and it is unchanged. Nothing below touches
 * them.
 *
 * `/app/*` is a different audience in a different posture. Nobody arrives at
 * `/app/agents/new` to be persuaded; they are already inside, doing work, and
 * the work is watching limits and reading numbers. That is a console, and the
 * register a console reads best in is dark. So the decision is **scoped, not
 * reversed**, and this comment exists so the next person reads a reason here
 * rather than assuming the palette drifted.
 *
 * ## Every value is measured, and measured against the harder surface
 *
 * `contrast.test.ts` pins these to the same exactness as the light ramp. One
 * thing genuinely inverts and it is worth stating, because it is the mirror of
 * the note on `GROUND` above: on light, the **ground** is the conservative
 * surface, because a white card only ever raises contrast. On dark it is the
 * opposite — light text on a *lighter* surface loses contrast — so the honest
 * place to measure the AA floor is `surfaceRaised`, the lightest thing text
 * ever sits on. That is where `muted` and `mutedDim` are held to 4.5, and it is
 * a stricter test than measuring against the ground would have been.
 *
 * The four surfaces therefore all lift *above* the ground, which is what dark
 * lets you do and what the light palette had to split in two. `raised` is again
 * the band that stands out and `sunken` the panel that recedes, and here both
 * are achieved by lightening — the names mean what they say.
 */

/** The console ground, and the surfaces that lift off it. */
export const APP_GROUND = {
  background: '#0b0f14',
  surface: '#1b212a',
  surfaceRaised: '#272e39',
  surfaceHover: '#202731',
  surfaceSunken: '#141a20',
} as const satisfies Record<string, Hex>;

/** Three ordered rule weights, at the same separations the light theme uses. */
export const APP_RULES = {
  borderSubtle: '#1f2329',
  border: '#2a2f34',
  borderBright: '#3a3f44',
} as const satisfies Record<string, Hex>;

/**
 * The four-step ramp. Targets are stated against the ground, so the ladder
 * keeps its shape; the AA floor is enforced against `surfaceRaised`.
 */
export const APP_TEXT = {
  foreground: '#eaf1fa',
  muted: '#b2b8c0',
  mutedDim: '#90959d',
  faint: '#575c62',
} as const satisfies Record<string, Hex>;

/**
 * The three verdicts.
 *
 * The asymmetry is deliberate and is the greyscale carrier, exactly as on
 * light: DENY is far the brighter of the two, because it is the verdict a
 * reader must not miss and because hue alone must never be the signal. They sit
 * 46 greyscale steps apart, where the rule asks for 30.
 *
 * On dark the direction of "heavier" flips — brighter, not darker — so the
 * assertion is still `deny > permit` in contrast, and still means the same
 * thing about which one shouts.
 */
export const APP_VERDICT = {
  permit: '#41a566',
  permitDim: '#12231f',
  permitLine: '#24543a',

  deny: '#ffab99',
  denyDim: '#2b2325',
  denyLine: '#7b5751',

  // The third verdict stays in the neutral ramp rather than becoming a fourth
  // hue, so it must be exactly the muted step. `contrast.test.ts` pins that.
  unproven: '#b2b8c0',
  unprovenDim: '#21252a',
  unprovenLine: '#585d63',
} as const satisfies Record<string, Hex>;

/** The accent, in the same three jobs: text, focus ring, active-nav fill. */
export const APP_ACCENT = {
  accent: '#6cb8ff',
  accentDim: '#182533',
} as const satisfies Record<string, Hex>;

/**
 * The ruled ground, at the light theme's own contrasts rather than its alphas.
 *
 * Carrying the light alphas across would be the same mistake in the other
 * direction that `GRID` records: light ink on a dark ground reads differently
 * from dark ink on light at equal alpha. So these are solved for the resulting
 * contrast — 1.0235 and 1.0557 against the console ground — which is the same
 * depth cue, not the same number.
 */
export const APP_GRID = {
  gridMinor: 'rgb(150 180 220 / 0.018)',
  gridMajor: 'rgb(150 180 220 / 0.0394)',
} as const satisfies Record<string, string>;

/* ===========================================================================
   THE NARRATIVE SURFACE — black, gold, grainy silver

   A third scoped set, added the way `APP_*` was: the site and the console keep
   the tokens they had, and this one is aliased over them by `.landing` in
   `globals.css`. Nothing here is a new *kind* of token — the shape is exactly
   the four ground steps, three rules, four text steps, an accent and the grid,
   so the shared chrome (header, footer, status labels) re-points wholesale and
   none of it learns that a third surface exists.

   ## Why a third set rather than a repaint

   `globals.css` records, at length, that the site is light on purpose: PLAN-V6
   reaffirmed it because a dark Limen with a scroll narrative would resemble
   markov.fyi, its nearest conceptual neighbour, visually as well as
   conceptually. That argument is untouched here. This set does not replace the
   light one and is not proposed as a replacement — it paints one route, so the
   two can be compared side by side before anything is decided.

   ## The one value that is not the prototype's

   `mutedDim` is `#837b68` where the prototype's `--body-dim` was `#6f6858`.
   That original measures 3.80:1 on black — under AA — and it carries real
   prose: the aside under the cap demonstration, the transaction meta row, and
   the footer. Lifted along its own hue until it clears 4.5 against the
   lightest ground it can sit on (4.51 against `surfaceRaised`, 5.00 against the
   page), which is the floor `APP_TEXT` is held to and the same discipline.
   Every other value is the prototype's, unchanged.
   =========================================================================== */

/** The narrative ground. True black, and four warm surfaces that lift off it. */
export const LANDING_GROUND = {
  background: '#000000',
  surface: '#0d0a05',
  surfaceRaised: '#151007',
  surfaceHover: '#120e06',
  surfaceSunken: '#060402',
} as const satisfies Record<string, Hex>;

/** Three ordered rule weights: 1.18:1, 1.33:1 and 1.60:1 against the ground. */
export const LANDING_RULES = {
  borderSubtle: '#1c1710',
  border: '#2a2113',
  borderBright: '#3a2f1c',
} as const satisfies Record<string, Hex>;

/**
 * The four-step ramp, measured against the ground rather than inverted.
 *
 *     foreground  19.59:1   display headings, amounts
 *     muted        7.71:1   running prose
 *     muted-dim    5.00:1   annotations, meta rows, the footer
 *     faint        2.25:1   decorative only — the unfilled form fields
 *
 * The AA floor is enforced against `surfaceRaised`, the lightest thing text
 * ever sits on here, exactly as `APP_TEXT` is.
 */
export const LANDING_TEXT = {
  foreground: '#f6f7f9',
  muted: '#a49c8c',
  mutedDim: '#837b68',
  faint: '#4e4636',
} as const satisfies Record<string, Hex>;

/**
 * Gold, in three weights.
 *
 * `gold` is the accent proper and the only one that carries text at size.
 * `goldLeaf` is the lit edge — the focus ring, a hovered link, the cap label.
 * `goldDeep` is structural: gradients, rules and the hatch, never text, which
 * is why it is allowed to sit at 4.21:1.
 */
export const LANDING_GOLD = {
  gold: '#c9a227',
  goldLeaf: '#f2d278',
  goldDeep: '#8c6a2b',
} as const satisfies Record<string, Hex>;

/**
 * Silver, in three weights, for the grain-filtered headings and the values
 * beside them. `silver1` is the gradient's highlight and the amount column;
 * `silver2` carries the refused verdict and the error's subject.
 */
export const LANDING_SILVER = {
  silver1: '#f6f7f9',
  silver2: '#9aa0a6',
  silver3: '#6f757c',
} as const satisfies Record<string, Hex>;

/** The accent in its three jobs: text, focus ring, active-nav fill. */
export const LANDING_ACCENT = {
  accent: '#c9a227',
  accentDim: '#1a1408',
} as const satisfies Record<string, Hex>;

/**
 * The ruled ground, at the same depth cue the other two sets carry rather than
 * the same alpha. Warm rather than blue, so the grid reads as part of the gold
 * ground and not as a cool film laid over it.
 */
export const LANDING_GRID = {
  gridMinor: 'rgb(201 162 39 / 0.020)',
  gridMajor: 'rgb(201 162 39 / 0.042)',
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

  // The console palette. Same pin, same rules — a token added to `globals.css`
  // under `--app-` and not listed here fails `design-system.test.ts` exactly as
  // a site token would.
  '--app-background': APP_GROUND.background,
  '--app-surface': APP_GROUND.surface,
  '--app-surface-raised': APP_GROUND.surfaceRaised,
  '--app-surface-hover': APP_GROUND.surfaceHover,
  '--app-surface-sunken': APP_GROUND.surfaceSunken,

  '--app-border-subtle': APP_RULES.borderSubtle,
  '--app-border': APP_RULES.border,
  '--app-border-bright': APP_RULES.borderBright,

  '--app-foreground': APP_TEXT.foreground,
  '--app-muted': APP_TEXT.muted,
  '--app-muted-dim': APP_TEXT.mutedDim,
  '--app-faint': APP_TEXT.faint,

  '--app-permit': APP_VERDICT.permit,
  '--app-permit-dim': APP_VERDICT.permitDim,
  '--app-permit-line': APP_VERDICT.permitLine,

  '--app-deny': APP_VERDICT.deny,
  '--app-deny-dim': APP_VERDICT.denyDim,
  '--app-deny-line': APP_VERDICT.denyLine,

  '--app-unproven': APP_VERDICT.unproven,
  '--app-unproven-dim': APP_VERDICT.unprovenDim,
  '--app-unproven-line': APP_VERDICT.unprovenLine,

  '--app-accent': APP_ACCENT.accent,
  '--app-accent-dim': APP_ACCENT.accentDim,

  '--app-grid-minor': APP_GRID.gridMinor,
  '--app-grid-major': APP_GRID.gridMajor,

  // The narrative palette. Same pin, same rules: a `--landing-` token added to
  // `globals.css` and not listed here fails `design-system.test.ts` exactly as
  // a site or console token would.
  '--landing-background': LANDING_GROUND.background,
  '--landing-surface': LANDING_GROUND.surface,
  '--landing-surface-raised': LANDING_GROUND.surfaceRaised,
  '--landing-surface-hover': LANDING_GROUND.surfaceHover,
  '--landing-surface-sunken': LANDING_GROUND.surfaceSunken,

  '--landing-border-subtle': LANDING_RULES.borderSubtle,
  '--landing-border': LANDING_RULES.border,
  '--landing-border-bright': LANDING_RULES.borderBright,

  '--landing-foreground': LANDING_TEXT.foreground,
  '--landing-muted': LANDING_TEXT.muted,
  '--landing-muted-dim': LANDING_TEXT.mutedDim,
  '--landing-faint': LANDING_TEXT.faint,

  '--landing-gold': LANDING_GOLD.gold,
  '--landing-gold-leaf': LANDING_GOLD.goldLeaf,
  '--landing-gold-deep': LANDING_GOLD.goldDeep,

  '--landing-silver-1': LANDING_SILVER.silver1,
  '--landing-silver-2': LANDING_SILVER.silver2,
  '--landing-silver-3': LANDING_SILVER.silver3,

  '--landing-accent': LANDING_ACCENT.accent,
  '--landing-accent-dim': LANDING_ACCENT.accentDim,

  '--landing-grid-minor': LANDING_GRID.gridMinor,
  '--landing-grid-major': LANDING_GRID.gridMajor,
} as const;
