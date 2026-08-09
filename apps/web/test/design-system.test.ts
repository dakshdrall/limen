/**
 * The design system's load-bearing rules, pinned.
 *
 * Not a substitute for looking at the page — these read source, not pixels.
 * What they catch is the specific class of regression that is invisible in
 * review and fatal to the system: a font fallback stack creeping back in, a
 * table inventing its own column width, a fourth verdict colour, a verdict
 * that stops being legible in greyscale, a scroll reveal that ships a blank
 * page to anyone whose JavaScript is slow.
 *
 * The brief calls these non-negotiables. A non-negotiable with no test is a
 * preference.
 *
 * ## What PLAN-V6 changed here
 *
 * Most of this file is carried across unchanged, because most of it pins
 * properties of the system rather than properties of the page that happened to
 * use it — the palette agreement, the column tokens, the greyscale rule, the
 * keyframe ban.
 *
 * What is new is the motion contract in `the reveal fails visible`, which is
 * the one genuinely new primitive V6 introduces and the one with a failure mode
 * bad enough to deserve four cases of its own.
 *
 * What is deferred is anything naming a component that has not been rebuilt
 * yet. Those cases are guarded on the file existing and assert the guard, so a
 * deferred check is visible rather than silently absent — the same argument
 * `local-key-label.test.ts` makes about tripwires that match nothing.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MARK_RECTS } from '../src/lib/mark';
import { THEME } from '../src/lib/theme';

const src = (relative: string) => fileURLToPath(new URL(`../src/${relative}`, import.meta.url));
const read = (relative: string) => readFileSync(src(relative), 'utf8');
const present = (relative: string) => existsSync(src(relative));

const css = read('app/globals.css');
const layout = read('app/layout.tsx');
const verdict = read('components/Verdict.tsx');
const reveal = read('components/Reveal.tsx');

/** `globals.css` with comments removed, for rules that forbid a construct the file documents. */
const declarations = css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every `.tsx` under `src/`, as `[path relative to src, contents]`. */
function sources(dir = ''): [string, string][] {
  return readdirSync(src(dir), { withFileTypes: true }).flatMap((entry) => {
    const path = dir === '' ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.tsx') ? [[path, read(path)] as [string, string]] : [];
  });
}

const tsx = sources();

describe('typeface', () => {
  it('is IBM Plex, self-hosted, sans and mono', () => {
    expect(layout).toContain('IBM_Plex_Sans');
    expect(layout).toContain('IBM_Plex_Mono');
  });

  it('is not the Next.js default typeface', () => {
    // Geist loaded from next/font/google is the single clearest tell that a
    // page was generated rather than designed.
    //
    // Matched on the call and the import rather than on the word, so the
    // comment in `layout.tsx` explaining why it was dropped does not fail the
    // build — a test that forbids naming the thing it forbids also forbids
    // documenting the decision.
    expect(layout).not.toMatch(/\bGeist(_Mono)?\s*\(/);
    expect(layout).not.toMatch(/import\s*\{[^}]*\bGeist\b[^}]*\}\s*from/);
    expect(css).not.toContain('--font-geist');
  });

  it('never falls back to a system-font stack', () => {
    // The brief forbids this outright. `ui-sans-serif, system-ui, sans-serif`
    // means the typeface is whatever the machine happened to have.
    for (const banned of ['system-ui', 'ui-sans-serif', 'ui-monospace', '-apple-system', 'BlinkMacSystemFont']) {
      expect(css).not.toContain(banned);
    }
  });
});

describe('numerals', () => {
  it('are tabular globally, set on body rather than per component', () => {
    // Per-component is how a new table forgets, and a table whose digits shift
    // width between rows is not an instrument.
    const body = /body\s*\{[^}]*\}/s.exec(css)?.[0] ?? '';
    expect(body).toContain('font-variant-numeric: tabular-nums');
  });
});

describe('two rhythms, one grid', () => {
  // The V6 change, stated as a property rather than as a look.
  //
  // The site gets air and the app stays dense, and the risk in splitting them
  // is that they drift into two layout systems with two sets of bugs. They
  // share the grid technique — which is what the no-sideways-scroll guarantee
  // is proved against — and differ only in spacing and type size.

  it('gives the instrument and the argument their own spacing scales', () => {
    expect(declarations).toMatch(/--screen-gap:/);
    expect(declarations).toMatch(/--scene-gap:/);
    expect(declarations).toMatch(/--scene-pad:/);
  });

  it('builds both shells from the same named grid lines', () => {
    // A second grid technique is a second place for the break-out bug below to
    // reappear, and only one of them would have a test.
    for (const shell of ['.screen', '.scene']) {
      const block = new RegExp(`\\${shell}\\s*\\{[^}]*\\}`, 's').exec(declarations)?.[0] ?? '';
      expect(block, `${shell} does not define the full/content grid`).toContain('[full-start]');
      expect(block, `${shell} does not define the content column`).toContain('[content-start]');
    }
  });

  it('lets both shells hold a full-bleed band', () => {
    expect(declarations).toMatch(/\.screen\s*>\s*\.bleed/);
    expect(declarations).toMatch(/\.scene\s*>\s*\.bleed/);
  });

  it('keeps the base size at the instrument’s density, so the app pays nothing', () => {
    // The narrative raises its own size. Raising `body` instead would have made
    // every table, label and column token in the application a size it was not
    // designed at, which is the change that looks smallest and breaks most.
    const body = /body\s*\{[^}]*\}/s.exec(css)?.[0] ?? '';
    expect(body).toContain('font-size: 13.5px');
    expect(/\.scene\s*\{[^}]*\}/s.exec(declarations)?.[0] ?? '').toMatch(/font-size:\s*16\.5px/);
  });

  it('gives narrative prose its own measure', () => {
    // 78ch at 16.5px is a 1290px line. The app's measure is correct at the
    // app's size and wrong at this one.
    expect(declarations).toMatch(/--measure-scene:/);
  });
});

describe('the reveal fails visible', () => {
  // The one new primitive in V6, and the one whose failure mode is worst.
  //
  // The natural way to write a scroll reveal is `opacity: 0` in the stylesheet
  // and `opacity: 1` once an observer fires. That page is blank until
  // JavaScript runs — so a slow connection, a parse error, a stripped bundle or
  // a crawler all get a site with no content on it. PLAN-V6 requires the page
  // be usable with JavaScript slow, and blank is the opposite of usable.
  //
  // These four cases are what make "fails visible" a property rather than an
  // intention.

  it('declares no hidden state on the class itself', () => {
    // The whole guarantee. `.reveal` unqualified must not touch opacity or
    // transform: an element that is never armed is an element at its final
    // position.
    const bare = /\.reveal\s*\{([^}]*)\}/.exec(declarations)?.[1] ?? '';
    expect(bare, '.reveal was not found in globals.css').not.toBe('');
    expect(bare).not.toMatch(/opacity/);
    expect(bare).not.toMatch(/transform/);
  });

  it('hides only what an attribute has armed', () => {
    // Every hidden state is behind `[data-reveal='out']`, which only the
    // component sets, and which it only sets once it can bring the element back.
    const hidden = [...declarations.matchAll(/([^{}]*)\{[^}]*opacity:\s*0[;\s}]/g)].map(([, sel]) =>
      sel.trim(),
    );
    for (const selector of hidden) {
      if (!selector.includes('.reveal')) continue;
      expect(selector, `${selector} hides a reveal without requiring the armed attribute`).toContain(
        "data-reveal='out'",
      );
    }
  });

  it('renders the same page under reduced motion — present, and still', () => {
    // Not a degraded page. Content at final position, no transition.
    const reduced = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n  \}/.exec(
      declarations.slice(declarations.indexOf('.reveal')),
    )?.[1];
    expect(reduced, 'no reduced-motion block follows the reveal rules').toBeDefined();
    expect(reduced).toContain('opacity: 1');
    expect(reduced).toContain('transform: none');
  });

  it('declines to arm when it cannot observe or must not move', () => {
    // The component's half of the same contract. A reveal that cannot observe
    // is a reveal that must not hide, and reduced motion is checked in script
    // as well as in CSS so the attribute is normally never set at all.
    expect(reveal).toContain("typeof IntersectionObserver === 'undefined'");
    expect(reveal).toContain('prefers-reduced-motion: reduce');
    // Arming is a state change after mount, never a render-time decision — a
    // server-rendered `data-reveal` would put the blank page back.
    expect(reveal).toMatch(/useState\(false\)/);
  });

  it('moves only what compositing can move', () => {
    // A scene that animates height or top costs layout on every frame of a
    // scroll. Transform and opacity are the two properties that do not.
    const armed = declarations.slice(declarations.indexOf(".reveal[data-reveal='out']"));
    const transitioned = /transition:\s*([^;]*);/.exec(armed)?.[1] ?? '';
    expect(transitioned).toContain('opacity');
    expect(transitioned).toContain('transform');
    for (const expensive of ['height', 'width', 'top', 'left', 'margin']) {
      expect(transitioned, `the reveal transitions ${expensive}`).not.toContain(expensive);
    }
  });
});

describe('the grid is a token set, not a judgement call', () => {
  const tokens = ['--col-addr', '--col-hash', '--col-amount', '--col-ledger', '--col-verdict', '--col-label', '--col-signer', '--col-error'];

  it('defines every column width once', () => {
    for (const token of tokens) expect(css).toContain(`${token}:`);
  });

  it('exposes each as a class, so a table applies it rather than restating it', () => {
    for (const token of tokens) {
      const cls = token.replace('--', '.');
      expect(css).toContain(`${cls} {`);
    }
  });

  it('sizes columns in ch, which under a mono face is a statement about content', () => {
    expect(css).toMatch(/--col-addr:\s*\d+ch/);
    expect(css).toMatch(/--col-hash:\s*\d+ch/);
  });

  it('adds the cell padding to every column rather than folding it into the tokens', () => {
    // This shipped wrong twice on the first two tables to use these tokens. The
    // tokens state content width; `.tbl` cells add 0.75rem of padding on each
    // side; and under `table-layout: fixed` the shortfall does not shrink the
    // content or scroll it — it overlaps the next column.
    expect(css).toContain('--col-pad:');
    for (const token of tokens) {
      const cls = token.replace('--', '.');
      expect(css).toMatch(new RegExp(`\\${cls} \\{ width: calc\\(var\\(${token}\\) \\+ var\\(--col-pad\\)\\)`));
    }
  });

  it('lets a long unbreakable value wrap rather than paint over its neighbour', () => {
    // `anywhere` and not `break-word`, because only `anywhere` also reduces the
    // min-content width a fixed layout distributes.
    expect(css).toMatch(/\.tbl tbody td \{[^}]*overflow-wrap: anywhere/s);
  });

  it('sizes the verdict column to the badge it holds, not to the word', () => {
    // `DENY` is four characters; the badge is `min-w-[6.25rem]`.
    const width = /--col-verdict:\s*(\d+)ch/.exec(css)?.[1];
    expect(Number(width)).toBeGreaterThanOrEqual(13);
  });
});

describe('verdicts survive greyscale', () => {
  it('has exactly four states', () => {
    // Four since PLAN-V4 F3. The count is asserted rather than left open
    // because every addition here is a claim that some outcome is genuinely
    // unlike the three already present — and the cost of getting that wrong is
    // a table that looks more decisive than the evidence behind it.
    const states = [...verdict.matchAll(/^\s{2}(?:'[\w-]+'|\w+): \{$/gm)];
    expect(states).toHaveLength(4);
  });

  it('keeps REFUSED AT SIMULATION distinct from DENY', () => {
    expect(verdict).toContain('refused-at-simulation');
    expect(verdict).toContain('never reached a ledger');
  });

  it('keeps a revoked rule distinct from a boundary refusal', () => {
    // After a revoke, the call that used to be permitted fails
    // ContextRuleNotFound#3000, which `errors.ts` deliberately keeps out of
    // BOUNDARY_REFUSAL_CODES. "The boundary refused you" and "the boundary is
    // gone" are different claims, and only one is evidence the boundary works.
    expect(verdict).toContain('rule-revoked');
    expect(verdict).toMatch(/aria: 'the context rule was revoked/);
  });

  it('pairs every state with a glyph, so hue is never the only signal', () => {
    for (const glyph of ['✓', '✕', '⊘', '∅']) expect(verdict).toContain(glyph);
  });

  it('distinguishes the third and fourth states by treatment, not by new hues', () => {
    expect(verdict).toContain('border-dashed');
    expect(verdict).toContain('text-unproven');
    expect(verdict).toContain('border-dotted');
    expect(verdict).toMatch(/'rule-revoked': \{[^}]*text-muted/s);
  });

  it('does not claim on-chain provenance from the badge alone', () => {
    // Limen's own evaluator produces DENY rows. If the badge asserted the
    // network refused them, every simulator screen would be lying.
    expect(verdict).toMatch(/aria: 'denied',/);
  });
});

describe('a fact is stated in one place', () => {
  it('builds every explorer URL in lib/explorer.ts', () => {
    // `lib/network.ts` says it outright: a second place for the network to be
    // written down is a second place for it to be wrong.
    for (const [path, source] of tsx) {
      expect(source, `${path} builds an explorer URL itself`).not.toContain('stellar.expert/explorer');
    }
    expect(read('lib/explorer.ts')).toContain('https://stellar.expert/explorer');
  });

  it('truncates an address or a hash only in lib/format.ts', () => {
    for (const [path, source] of tsx) {
      expect(source, `${path} truncates a value inline`).not.toMatch(/\.slice\(0,\s*\d+\)\s*}?…/);
    }
  });

  it('declares the focus ring once, globally', () => {
    // An earlier version of `ExplorerLink` overrode the ring to the permit hue,
    // so a keyboard user who had learned the accent ring met a green one.
    for (const [path, source] of tsx) {
      expect(source, `${path} restates the global focus ring`).not.toContain('focus-visible:outline-accent');
    }
  });

  it('gives every page one of the two shells', () => {
    // V5 required `.screen` on every page including the landing, on the
    // argument that a reader should not feel the application resize itself.
    // V6 keeps the argument and widens it by exactly one: a page is either the
    // instrument or the argument, and nothing is allowed to be neither. A page
    // that invents its own width is the failure both shells exist to prevent.
    for (const [path, source] of tsx) {
      if (!path.endsWith('/page.tsx')) continue;
      expect(
        /className="(?:screen|scene)"/.test(source) || source.includes('<Scene'),
        `${path} uses neither shell`,
      ).toBe(true);
    }
  });
});

describe('controls are a closed set', () => {
  it('keeps three variants, and no more', () => {
    const variants = [...css.matchAll(/\.btn\[data-variant='([\w-]+)'\]/g)].map(([, name]) => name);
    expect(new Set(variants)).toEqual(new Set(['primary', 'secondary', 'quiet']));
  });

  it('separates the register from the variant', () => {
    // The variants say how much weight a control carries; a register says which
    // voice it speaks in. Making `label` a fourth variant is how a closed set
    // stops being closed: it would need `label-secondary` and `label-quiet`,
    // and registers multiply with variants rather than extending them. V6 adds
    // `scene` for the same reason and by the same route.
    const registers = [...css.matchAll(/\.btn\[data-register='([\w-]+)'\]/g)].map(([, name]) => name);
    expect(new Set(registers)).toEqual(new Set(['label', 'scene']));
  });

  it('states disabled once, and not as opacity', () => {
    // One inline button dimmed while keeping its border — which still reads as
    // an available control, just dimmer. This application's whole argument is
    // that it does not present controls for things it cannot do.
    expect(css).toMatch(/\.btn:disabled\s*\{[^}]*\}/);
    expect(/\.btn:disabled\s*\{([^}]*)\}/.exec(css)?.[1]).not.toContain('opacity');
  });
});

describe('the palette has one definition, and every consumer reads it', () => {
  // PLAN-V5 F4. `opengraph-image.tsx` renders through satori with inline styles
  // and no cascade, so `var(--permit)` resolves to nothing and its eleven
  // colours were literals — all eleven drifted from the tokens they were copied
  // from, while its docstring said "same palette as the page".
  //
  // `lib/theme.ts` is now the palette and both are consumers. Without the second
  // case in particular, a token added to the stylesheet alone would never be
  // pinned, and the module would decay back into a partial copy.

  /** `--name: value;` declarations whose value is a colour, from `:root` blocks. */
  const declared = new Map(
    [...css.matchAll(/^\s*(--[\w-]+):\s*(#[0-9a-fA-F]{3,8}|rgb\([^)]*\));/gm)].map(
      ([, name, value]) => [name, value],
    ),
  );

  it('agrees with globals.css on every token it defines', () => {
    for (const [name, value] of Object.entries(THEME)) {
      expect(declared.get(name), `${name} is in lib/theme.ts but not in globals.css`).toBeDefined();
      expect(declared.get(name), `${name} disagrees between lib/theme.ts and globals.css`).toBe(value);
    }
  });

  it('carries every colour token globals.css defines, so none escapes the pin', () => {
    for (const name of declared.keys()) {
      expect(name in THEME, `${name} is in globals.css but not in lib/theme.ts`).toBe(true);
    }
  });

  it('leaves no colour literal in the card that cannot read a custom property', () => {
    // Deferred while the share card is unbuilt — it is a rendering surface and
    // returns with the narrative in step 3. The guard is asserted rather than
    // silently skipped, so this reads as "not yet" and not as "passing".
    if (!present('app/opengraph-image.tsx')) {
      expect(present('app/opengraph-image.tsx')).toBe(false);
      return;
    }
    const card = read('app/opengraph-image.tsx').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(card).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(card).not.toMatch(/\brgba?\(/);
    expect(card).toContain("from '@/lib/theme'");
  });
});

describe('the full-bleed band', () => {
  // PLAN-V5 F5. `margin-inline: calc(50% - 50vw)` is what everyone reaches for,
  // and `100vw` includes the scrollbar: on any page long enough to scroll, the
  // "full-bleed" section ends up about 15px wider than the viewport and the
  // document scrolls sideways.
  //
  // The e2e suite catches the symptom at five widths. This catches the cause, in
  // the suite that runs on every commit.

  it('never breaks out with a viewport unit in a margin', () => {
    // Scoped to margins on purpose. `vw` is fine for a font size and fine for a
    // width that subtracts more than a scrollbar; it is breaking *out* with one
    // that reintroduces the overflow.
    expect(declarations).not.toMatch(/margin[a-z-]*:[^;}]*\bvw\b/);
  });

  it('is scoped to where a grid line can actually be addressed', () => {
    expect(declarations).toMatch(/\.screen\s*>\s*\.bleed/);
    expect(declarations).toMatch(/\[full-start\]/);
    expect(declarations).toMatch(/\[content-start\]/);
  });

  it('caps how wide a band may get', () => {
    expect(declarations).toMatch(/--bleed-max:/);
    expect(declarations).toMatch(/max-width:\s*var\(--bleed-max\)/);
  });
});

describe('the mark has one definition, and every consumer reads it', () => {
  // PLAN-V5 §3.2. The mark appears in four places and three of them cannot
  // import a React component. `lib/mark.ts` holds the geometry and
  // `scripts/mark.mjs` builds the artefacts from it, so the committed files are
  // output rather than input.

  it('regenerates the committed icon.svg exactly', async () => {
    const { iconSvg } = await import('../../../scripts/mark.mjs');
    expect(read('app/icon.svg')).toBe(iconSvg());
  });

  it('regenerates the committed favicon.ico exactly', async () => {
    const { iconIco } = await import('../../../scripts/mark.mjs');
    const committed = readFileSync(src('app/favicon.ico'));
    // Also the assertion that the Next.js default is gone. That file is 25,931
    // bytes of someone else's icon, and shipping it is the clearest possible
    // signal that nobody looked at the tab.
    expect(committed.equals(iconIco())).toBe(true);
  });

  it('keeps the geometry on the grid that makes every icon size crisp', () => {
    // Multiples of 1.5 on a 24 grid land on whole pixels at 16, 32 and 48px.
    for (const rect of MARK_RECTS) {
      for (const value of [rect.x, rect.y, rect.width, rect.height]) {
        expect((value * 2) % 3, `${value} is not a multiple of 1.5`).toBe(0);
      }
    }
  });

  it('keeps the rectangles from overlapping, which the rasteriser assumes', () => {
    // `scripts/mark.mjs` sums per-pixel coverage instead of unioning it, which
    // is only correct while no two rectangles share area.
    for (const [i, a] of MARK_RECTS.entries()) {
      for (const b of MARK_RECTS.slice(i + 1)) {
        const overlaps =
          a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
        expect(overlaps, `${JSON.stringify(a)} overlaps ${JSON.stringify(b)}`).toBe(false);
      }
    }
  });

  it('names no colour in the component, so the mark is whatever the text is', () => {
    const mark = read('components/Mark.tsx');
    expect(mark).toContain('currentColor');
    expect(mark).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(mark).not.toMatch(/\brgba?\(/);
  });
});

describe('colour is restrained', () => {
  it('defines one accent', () => {
    const accents = [...css.matchAll(/^\s*--accent:/gm)];
    expect(accents).toHaveLength(1);
  });

  it('has no gradient fills, glass, glow, or shadow depth', () => {
    // `repeating-linear-gradient` is the hairline-rule technique the grid is
    // drawn with, so it is excluded before checking for decorative fills.
    const withoutRules = css.replace(/repeating-linear-gradient/g, '');
    for (const tell of ['linear-gradient', 'radial-gradient', 'box-shadow', 'backdrop-filter: blur', 'filter: blur']) {
      expect(withoutRules).not.toContain(tell);
    }
  });
});

describe('accessibility is a constraint, not a pass', () => {
  it('makes focus visible globally', () => {
    expect(css).toContain(':focus-visible');
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:[^}]*var\(--accent\)/s);
  });

  it('respects prefers-reduced-motion as the default rather than the exception', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\*,/);
  });

  it('has no keyframe animation, and is not allowed to grow one', () => {
    // PLAN-V4 §8, and the rule V6's scroll motion could most easily have
    // broken. Every motion this system permits is a transition on a state
    // change: the ground's heartbeat moves because a ledger sequence arrived, a
    // scene moves because it entered the viewport, and both stop when the thing
    // driving them stops. A keyframe loop runs on its own authority — it would
    // keep going with the network unreachable, which is this project's
    // definition of decoration.
    //
    // Read with comments stripped, so the block in `globals.css` that explains
    // this rule at length does not fail it.
    expect(declarations).not.toContain('@keyframes');
    expect(declarations).not.toMatch(/animation-name\s*:/);
    expect(declarations).not.toMatch(/\banimation\s*:(?!\s*none)/);
  });
});
