/**
 * The palette's measurements, pinned.
 *
 * PLAN-V5 §2 asks for every contrast ratio in the ramp to be re-measured after
 * the inversion rather than assumed, and for PERMIT and DENY to be re-checked in
 * full greyscale rather than trusted to have survived. A measurement recorded
 * only in a comment is a measurement that stops being true the first time
 * somebody nudges a hex value by eye, and nobody finds out.
 *
 * So the numbers are here. Every assertion below is a claim the design system
 * makes about itself, expressed as arithmetic on `lib/theme.ts`:
 *
 *   - the four-step text ramp hits its four targets against the ground;
 *   - the two steps that carry body text clear WCAG AA;
 *   - the surface ladder is ordered, and each surface is actually visible
 *     against what it sits on;
 *   - PERMIT and DENY are separable with the hue removed entirely;
 *   - the accent works in all three of its jobs, which are judged against three
 *     different backgrounds.
 *
 * What this cannot do is tell you the page looks right — that is what the
 * screen-by-screen pass in §2.3 is for. What it does is make a change to a
 * colour that breaks a stated property fail here rather than in front of a
 * reviewer, which is the class of regression an inversion produces most.
 */

import { describe, expect, it } from 'vitest';
import {
  ACCENT,
  APP_ACCENT,
  APP_GRID,
  APP_GROUND,
  APP_RULES,
  APP_TEXT,
  APP_VERDICT,
  GROUND,
  GRID,
  RULES,
  TEXT,
  VERDICT,
} from '../src/lib/theme';

/** sRGB channel to linear light. WCAG 2.x. */
function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function rgb(hex: string): [number, number, number] {
  const n = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16)) as [number, number, number];
}

/** Relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, order-independent. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * What a colour collapses to when the hue is removed — a greyscale printout, or
 * a reviewer who cannot distinguish red from green.
 *
 * Gamma-encoded back to 0–255 rather than left in linear light, because the
 * question being asked is "how far apart do these look", and perceived
 * lightness is the encoded value.
 */
function greyscale(hex: string): number {
  return Math.round(luminance(hex) ** (1 / 2.2) * 255);
}

/** Composites `rgb(r g b / a)` over an opaque backdrop. */
function composite(rule: string, over: string): string {
  const parsed = /rgb\((\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\)/.exec(rule);
  if (parsed === null) throw new Error(`not an rgb() with alpha: ${rule}`);
  const [, r, g, b, a] = parsed;
  const alpha = Number(a);
  const ink = [Number(r), Number(g), Number(b)];
  const back = rgb(over);
  const mixed = ink.map((c, i) => Math.round(alpha * c + (1 - alpha) * back[i]));
  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

const ground = GROUND.background;
const surface = GROUND.surface;

/** Ratios are asserted to one decimal, so a rounding step is not a red build. */
const near = (value: number, target: number, tolerance = 0.15) =>
  expect(Math.abs(value - target)).toBeLessThanOrEqual(tolerance);

describe('the four-step text ramp', () => {
  // The targets `globals.css` has stated since step 8. They are the reason
  // hierarchy here is carried by value and weight rather than by size.
  it('hits its four targets against the ground', () => {
    near(contrast(TEXT.foreground, ground), 16.37);
    near(contrast(TEXT.muted, ground), 7.85);
    near(contrast(TEXT.mutedDim, ground), 4.62);
    near(contrast(TEXT.faint, ground), 2.6);
  });

  it('keeps the four steps ordered and distinct', () => {
    // A ramp whose steps cross or converge is not a ramp. This is the assertion
    // that would have caught the naive inversion: it compresses `muted` and
    // `muted-dim` toward each other while leaving `foreground` where it was.
    const ratios = [TEXT.foreground, TEXT.muted, TEXT.mutedDim, TEXT.faint].map((c) =>
      contrast(c, ground),
    );
    for (let i = 1; i < ratios.length; i++) {
      expect(ratios[i], `step ${i} is not below step ${i - 1}`).toBeLessThan(ratios[i - 1]);
      expect(ratios[i - 1] / ratios[i], `steps ${i - 1} and ${i} are too close`).toBeGreaterThan(1.4);
    }
  });

  it('clears AA on both steps that carry body text', () => {
    // PLAN-V5 F1: inverting the dark ramp arithmetically lands `muted-dim` at
    // 3.11:1 — under AA — from an operation that looks lossless. This is the
    // assertion that makes that a red build.
    expect(contrast(TEXT.muted, ground)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(TEXT.mutedDim, ground)).toBeGreaterThanOrEqual(4.5);
    // And on the white surface, where most of it is actually read.
    expect(contrast(TEXT.mutedDim, surface)).toBeGreaterThanOrEqual(4.5);
  });

  it('measures the ramp against the ground, which is the conservative surface', () => {
    // Text sits on both the ground and on white cards. On light, white gives the
    // higher ratio, so measuring against the ground is the honest direction —
    // the same discipline the dark theme used, where the ground was also the
    // worse case.
    for (const step of [TEXT.foreground, TEXT.muted, TEXT.mutedDim, TEXT.faint]) {
      expect(contrast(step, ground)).toBeLessThanOrEqual(contrast(step, surface));
    }
  });
});

describe('the surface ladder', () => {
  it('puts the surface and the unreached step above the ground, and the tints below', () => {
    // The one direction the inversion changed, asserted so it cannot be
    // "corrected" back by someone who reads it as a mistake. Light has a ceiling
    // at white; a header band lighter than the white card it sits on is not a
    // header band.
    expect(luminance(GROUND.surface)).toBeGreaterThan(luminance(ground));
    expect(luminance(GROUND.surfaceSunken)).toBeGreaterThan(luminance(ground));
    expect(luminance(GROUND.surfaceSunken)).toBeLessThan(luminance(GROUND.surface));

    expect(luminance(GROUND.surfaceRaised)).toBeLessThan(luminance(ground));
    expect(luminance(GROUND.surfaceHover)).toBeLessThan(luminance(ground));
    // The band is the stronger tint of the two; the cursor's trail is lighter.
    expect(luminance(GROUND.surfaceRaised)).toBeLessThan(luminance(GROUND.surfaceHover));
  });

  it('keeps every surface visible against both things it can sit on', () => {
    // "A hover state one value step from white is a hover state nobody sees",
    // PLAN-V5 §2.3. These tables sit on white cards on some screens and directly
    // on the ground on others, so both have to clear.
    for (const tint of [GROUND.surfaceRaised, GROUND.surfaceHover]) {
      expect(contrast(tint, surface)).toBeGreaterThan(1.05);
      expect(contrast(tint, ground)).toBeGreaterThan(1.02);
    }
  });
});

describe('the rules', () => {
  it('keeps three ordered weights, at the dark theme’s separations', () => {
    near(contrast(RULES.borderSubtle, ground), 1.22, 0.05);
    near(contrast(RULES.border, ground), 1.42, 0.05);
    near(contrast(RULES.borderBright, ground), 1.8, 0.05);
  });
});

describe('verdicts survive greyscale', () => {
  // `design-system.test.ts` pins the glyphs and the border treatments, which are
  // the primary carriers. This is the second line: that the hues themselves do
  // not collapse into each other when the colour is taken away.

  it('keeps PERMIT and DENY apart with the hue removed entirely', () => {
    const separation = Math.abs(greyscale(VERDICT.permit) - greyscale(VERDICT.deny));
    // The dark theme managed 25. The obvious light pair — a dark green and a
    // dark red both around 5:1 — manages 5, which is why the two are
    // deliberately not the same weight as each other. See `lib/theme.ts`.
    expect(separation).toBeGreaterThanOrEqual(30);
  });

  it('takes that separation as a deliberate asymmetry rather than by accident', () => {
    // DENY is the heavier of the two, and it is meant to be: it is the verdict a
    // reader must not miss. Asserting the direction stops the pair being
    // "balanced" back into illegibility by a later edit that only looks at hue.
    expect(contrast(VERDICT.deny, surface)).toBeGreaterThan(contrast(VERDICT.permit, surface));
  });

  it('keeps all three verdict hues legible on the surface and on their own fill', () => {
    for (const [name, text, fill] of [
      ['permit', VERDICT.permit, VERDICT.permitDim],
      ['deny', VERDICT.deny, VERDICT.denyDim],
      ['unproven', VERDICT.unproven, VERDICT.unprovenDim],
    ] as const) {
      expect(contrast(text, surface), `${name} on the surface`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(text, fill), `${name} on its own fill`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('draws every verdict rule visibly against its own fill', () => {
    for (const [name, fill, line] of [
      ['permit', VERDICT.permitDim, VERDICT.permitLine],
      ['deny', VERDICT.denyDim, VERDICT.denyLine],
      ['unproven', VERDICT.unprovenDim, VERDICT.unprovenLine],
    ] as const) {
      // The dark theme sat at 1.85–1.99 here. A border that vanishes into its
      // fill takes one of the two non-colour carriers with it.
      expect(contrast(line, fill), `${name}'s rule against its fill`).toBeGreaterThan(1.7);
    }
  });

  it('keeps the third verdict in the neutral ramp rather than as a fourth hue', () => {
    expect(VERDICT.unproven).toBe(TEXT.muted);
  });
});

describe('the accent, in all three of its jobs', () => {
  it('reads as text on both the surface and the ground', () => {
    expect(contrast(ACCENT.accent, surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(ACCENT.accent, ground)).toBeGreaterThanOrEqual(4.5);
  });

  it('is distinguishable from the rule a focus ring replaces', () => {
    // A focus ring judged only against the ground can still be invisible in
    // practice, because what it actually replaces at the edge of a control is
    // the border. If those two are close the ring reads as the control simply
    // having a border.
    expect(contrast(ACCENT.accent, RULES.borderBright)).toBeGreaterThan(2.5);
  });

  it('carries an active-nav fill that is visible but not a second surface', () => {
    const fill = contrast(ACCENT.accentDim, ground);
    expect(fill).toBeGreaterThan(1.03);
    expect(fill).toBeLessThan(1.3);
    expect(contrast(ACCENT.accent, ACCENT.accentDim)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the grid stays below the threshold of distraction', () => {
  it('draws both pitches at the contrast the dark theme drew them', () => {
    // The alphas roughly halve in the inversion — dark ink on light paper reads
    // far stronger than light ink on dark at the same alpha. Carrying the dark
    // values across would have doubled the grid's contrast, which is the exact
    // failure `globals.css` warns about: noticing the grid instead of the depth.
    near(contrast(composite(GRID.gridMinor, ground), ground), 1.0262, 0.005);
    near(contrast(composite(GRID.gridMajor, ground), ground), 1.0526, 0.005);
  });

  it('keeps the minor rule quieter than the major one', () => {
    // Texture below structure. If they cross, the pitch a reader takes as the
    // layout's is the wrong one.
    expect(contrast(composite(GRID.gridMinor, ground), ground)).toBeLessThan(
      contrast(composite(GRID.gridMajor, ground), ground),
    );
  });
});

/* ───────────────────────────────────────────────────────── the console palette
 *
 * `/app/*` runs on a second, darker palette. The site and the docs do not, and
 * every assertion above still measures the light tokens they use — so this
 * section adds a ramp rather than relaxing one.
 *
 * The properties asserted are the same properties, because they are properties
 * of a palette rather than of a colour scheme: a four-step ramp that stays
 * ordered and separated, an AA floor on the two steps that carry body text,
 * a surface ladder that goes somewhere, verdicts that survive greyscale, an
 * accent that works in three jobs, and a grid below the threshold of
 * distraction.
 *
 * ## The one thing that genuinely inverts
 *
 * Which surface is the conservative one. On light, text is measured against the
 * ground because a white card only ever raises contrast — measuring there is
 * the honest direction. On dark that reverses: light text on a *lighter*
 * surface loses contrast, so the worst case is `surfaceRaised`, the lightest
 * thing text ever sits on. The AA floor is therefore enforced there, which is a
 * stricter measurement than the ground would have given, not a weaker one.
 *
 * If a value here ever fails, the ramp is what changes. These numbers are the
 * requirement.
 */

const appGround = APP_GROUND.background;
const appSurface = APP_GROUND.surface;
/** The lightest surface text sits on — the conservative one on dark. */
const appRaised = APP_GROUND.surfaceRaised;

describe('the console text ramp', () => {
  it('hits its four targets against the console ground', () => {
    near(contrast(APP_TEXT.foreground, appGround), 16.9);
    near(contrast(APP_TEXT.muted, appGround), 9.6);
    near(contrast(APP_TEXT.mutedDim, appGround), 6.4);
    near(contrast(APP_TEXT.faint, appGround), 2.85);
  });

  it('keeps the four steps ordered and distinct', () => {
    const ratios = [APP_TEXT.foreground, APP_TEXT.muted, APP_TEXT.mutedDim, APP_TEXT.faint].map(
      (c) => contrast(c, appGround),
    );
    for (let i = 1; i < ratios.length; i++) {
      expect(ratios[i], `step ${i} is not below step ${i - 1}`).toBeLessThan(ratios[i - 1]);
      expect(ratios[i - 1] / ratios[i], `steps ${i - 1} and ${i} are too close`).toBeGreaterThan(1.4);
    }
  });

  it('clears AA on both body steps against the LIGHTEST surface, not the ground', () => {
    // The dark mirror of the light theme's rule. Against the ground these two
    // sit at 9.6 and 6.4 and would pass trivially; the measurement that means
    // something is the one taken where the contrast is worst.
    expect(contrast(APP_TEXT.muted, appRaised)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(APP_TEXT.mutedDim, appRaised)).toBeGreaterThanOrEqual(4.5);
  });

  it('measures against the raised surface, which is the conservative one here', () => {
    // Asserted as a direction so nobody "corrects" the AA check above back to
    // the ground on the grounds that the light suite measures there.
    for (const step of [APP_TEXT.foreground, APP_TEXT.muted, APP_TEXT.mutedDim, APP_TEXT.faint]) {
      expect(contrast(step, appRaised)).toBeLessThanOrEqual(contrast(step, appGround));
    }
  });
});

describe('the console surface ladder', () => {
  it('lifts every surface above the ground, which is what dark allows', () => {
    // The light palette had to split this in two — surfaces up, tints down —
    // because white is a ceiling. Dark has room in one direction, so `raised`
    // and `sunken` mean what their names say and both are reached by lightening.
    for (const surfaceTint of [
      APP_GROUND.surface,
      APP_GROUND.surfaceSunken,
      APP_GROUND.surfaceRaised,
      APP_GROUND.surfaceHover,
    ]) {
      expect(luminance(surfaceTint)).toBeGreaterThan(luminance(appGround));
    }
  });

  it('orders sunken below the surface and raised above it', () => {
    expect(luminance(APP_GROUND.surfaceSunken)).toBeLessThan(luminance(APP_GROUND.surface));
    expect(luminance(APP_GROUND.surfaceRaised)).toBeGreaterThan(luminance(APP_GROUND.surface));
    // The cursor's trail sits between the card and the band: visible, but never
    // mistaken for a header.
    expect(luminance(APP_GROUND.surfaceHover)).toBeGreaterThan(luminance(APP_GROUND.surface));
    expect(luminance(APP_GROUND.surfaceHover)).toBeLessThan(luminance(APP_GROUND.surfaceRaised));
  });

  it('keeps every surface visible against the ground', () => {
    for (const tint of [APP_GROUND.surfaceRaised, APP_GROUND.surfaceHover, APP_GROUND.surface]) {
      expect(contrast(tint, appGround)).toBeGreaterThan(1.05);
    }
  });
});

describe('the console rules', () => {
  it('keeps three ordered weights, at the light theme’s separations', () => {
    near(contrast(APP_RULES.borderSubtle, appGround), 1.22, 0.05);
    near(contrast(APP_RULES.border, appGround), 1.42, 0.05);
    near(contrast(APP_RULES.borderBright, appGround), 1.8, 0.05);
  });
});

describe('console verdicts survive greyscale', () => {
  it('keeps PERMIT and DENY apart with the hue removed entirely', () => {
    const separation = Math.abs(greyscale(APP_VERDICT.permit) - greyscale(APP_VERDICT.deny));
    expect(separation).toBeGreaterThanOrEqual(30);
  });

  it('takes that separation as a deliberate asymmetry rather than by accident', () => {
    // On dark, heavier means brighter. DENY is still the one a reader must not
    // miss, and the direction is asserted so a later "balancing" edit goes red.
    expect(contrast(APP_VERDICT.deny, appSurface)).toBeGreaterThan(
      contrast(APP_VERDICT.permit, appSurface),
    );
  });

  it('keeps all three verdict hues legible on the surface and on their own fill', () => {
    for (const [name, text, fill] of [
      ['permit', APP_VERDICT.permit, APP_VERDICT.permitDim],
      ['deny', APP_VERDICT.deny, APP_VERDICT.denyDim],
      ['unproven', APP_VERDICT.unproven, APP_VERDICT.unprovenDim],
    ] as const) {
      expect(contrast(text, appSurface), `${name} on the console surface`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(text, fill), `${name} on its own fill`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('draws every verdict rule visibly against its own fill', () => {
    for (const [name, fill, line] of [
      ['permit', APP_VERDICT.permitDim, APP_VERDICT.permitLine],
      ['deny', APP_VERDICT.denyDim, APP_VERDICT.denyLine],
      ['unproven', APP_VERDICT.unprovenDim, APP_VERDICT.unprovenLine],
    ] as const) {
      expect(contrast(line, fill), `${name}'s rule against its fill`).toBeGreaterThan(1.7);
    }
  });

  it('keeps the third verdict in the neutral ramp rather than as a fourth hue', () => {
    expect(APP_VERDICT.unproven).toBe(APP_TEXT.muted);
  });
});

describe('the console accent, in all three of its jobs', () => {
  it('reads as text on both the surface and the ground', () => {
    expect(contrast(APP_ACCENT.accent, appSurface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(APP_ACCENT.accent, appGround)).toBeGreaterThanOrEqual(4.5);
  });

  it('is distinguishable from the rule a focus ring replaces', () => {
    expect(contrast(APP_ACCENT.accent, APP_RULES.borderBright)).toBeGreaterThan(2.5);
  });

  it('carries an active-nav fill that is visible but not a second surface', () => {
    const fill = contrast(APP_ACCENT.accentDim, appGround);
    expect(fill).toBeGreaterThan(1.03);
    expect(fill).toBeLessThan(1.3);
    expect(contrast(APP_ACCENT.accent, APP_ACCENT.accentDim)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the console grid stays below the threshold of distraction', () => {
  it('draws both pitches at the light theme’s contrasts, not its alphas', () => {
    // Copying the light alphas across would roughly halve the grid's presence,
    // because light ink on a dark ground reads differently from dark on light.
    // These are solved for the resulting contrast instead.
    near(contrast(composite(APP_GRID.gridMinor, appGround), appGround), 1.0235, 0.005);
    near(contrast(composite(APP_GRID.gridMajor, appGround), appGround), 1.0557, 0.005);
  });

  it('keeps the minor rule quieter than the major one', () => {
    expect(contrast(composite(APP_GRID.gridMinor, appGround), appGround)).toBeLessThan(
      contrast(composite(APP_GRID.gridMajor, appGround), appGround),
    );
  });
});

describe('the two palettes stay separate', () => {
  it('shares no ground with the site, so neither can drift into the other', () => {
    // The site is light and the console is dark; if these ever met, one of the
    // two surfaces has been repainted by an edit meant for the other.
    expect(luminance(APP_GROUND.background)).toBeLessThan(luminance(GROUND.background));
    expect(APP_GROUND.background).not.toBe(GROUND.background);
  });

  it('leaves every site token exactly as it was', () => {
    // The console was added by declaring new tokens, never by editing one the
    // narrative site reads. These are the values the site assertions above are
    // written against, restated here as the thing the console must not touch.
    expect(GROUND.background).toBe('#fbfaf7');
    expect(GROUND.surface).toBe('#ffffff');
    expect(TEXT.foreground).toBe('#191c21');
    expect(VERDICT.permit).toBe('#0f7a43');
    expect(VERDICT.deny).toBe('#8c1d18');
    expect(ACCENT.accent).toBe('#155e96');
    expect(RULES.border).toBe('#d8d4ca');
    expect(GRID.gridMinor).toBe('rgb(26 34 48 / 0.014)');
  });
});
