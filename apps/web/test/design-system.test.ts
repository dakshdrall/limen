/**
 * The design system's load-bearing rules, pinned.
 *
 * Not a substitute for looking at the page — these read source, not pixels.
 * What they catch is the specific class of regression that is invisible in
 * review and fatal to the system: a font fallback stack creeping back in, a
 * table inventing its own column width, a fourth verdict colour, a verdict
 * that stops being legible in greyscale.
 *
 * The brief calls these non-negotiables. A non-negotiable with no test is a
 * preference.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MARK_RECTS } from '../src/lib/mark';
import { THEME } from '../src/lib/theme';

const src = (relative: string) => fileURLToPath(new URL(`../src/${relative}`, import.meta.url));
const read = (relative: string) => readFileSync(src(relative), 'utf8');

const css = read('app/globals.css');
const layout = read('app/layout.tsx');
const verdict = read('components/Verdict.tsx');
const topBar = read('components/TopBar.tsx');

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
    // content or scroll it — it overlaps the next column. A verdict badge sat
    // on top of the adjacent cell's text, and a 9-character ledger number ran
    // straight into the row description beside it.
    expect(css).toContain('--col-pad:');
    for (const token of tokens) {
      const cls = token.replace('--', '.');
      expect(css).toMatch(new RegExp(`\\${cls} \\{ width: calc\\(var\\(${token}\\) \\+ var\\(--col-pad\\)\\)`));
    }
  });

  it('lets a long unbreakable value wrap rather than paint over its neighbour', () => {
    // The same bug four times now, in four flavours: a verdict badge, a ledger
    // number, a 33-character contract error code, and a signer badge beside an
    // address. Under `table-layout: fixed` a cell that cannot fit its contents
    // does not shrink them and does not scroll them — it paints them across the
    // next column, which looks like a spacing problem and is not one.
    //
    // Two of the four were column widths and are covered above. This is the
    // other half: content that no reasonable column width contains, which has
    // to be allowed to break. `anywhere` and not `break-word`, because only
    // `anywhere` also reduces the min-content width a fixed layout distributes.
    expect(css).toMatch(/\.tbl tbody td \{[^}]*overflow-wrap: anywhere/s);
  });

  it('sizes the verdict column to the badge it holds, not to the word', () => {
    // `DENY` is four characters; the badge is `min-w-[6.25rem]`.
    const verdict = /--col-verdict:\s*(\d+)ch/.exec(css)?.[1];
    expect(Number(verdict)).toBeGreaterThanOrEqual(13);
  });
});

describe('verdicts survive greyscale', () => {
  it('has exactly four states', () => {
    // Four since PLAN-V4 F3. The count is asserted rather than left open
    // because every addition here is a claim that some outcome is genuinely
    // unlike the three already present — and the cost of getting that wrong is
    // a table that looks more decisive than the evidence behind it. A fifth
    // needs the same argument made again, in a diff someone reads.
    const states = [...verdict.matchAll(/^\s{2}(?:'[\w-]+'|\w+): \{$/gm)];
    expect(states).toHaveLength(4);
  });

  it('keeps REFUSED AT SIMULATION distinct from DENY', () => {
    expect(verdict).toContain('refused-at-simulation');
    expect(verdict).toContain('never reached a ledger');
  });

  it('keeps a revoked rule distinct from a boundary refusal', () => {
    // The F3 distinction, and the reason it is a state rather than a footnote:
    // after a revoke, the call that used to be permitted fails
    // ContextRuleNotFound#3000, which `errors.ts` deliberately keeps out of
    // BOUNDARY_REFUSAL_CODES. "The boundary refused you" and "the boundary is
    // gone" are different claims, and only one of them is evidence the boundary
    // works.
    expect(verdict).toContain('rule-revoked');
    expect(verdict).toMatch(/aria: 'the context rule was revoked/);
  });

  it('pairs every state with a glyph, so hue is never the only signal', () => {
    // Colour-blind reviewers and greyscale printouts both depend on this.
    for (const glyph of ['✓', '✕', '⊘', '∅']) expect(verdict).toContain(glyph);
  });

  it('distinguishes the third and fourth states by treatment, not by new hues', () => {
    expect(verdict).toContain('border-dashed');
    expect(verdict).toContain('text-unproven');
    // The fourth reuses the neutral ramp — `text-muted` and the default border
    // — so it is visibly not a verdict rather than visibly a new kind of one.
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
  // Step 11's whole subject. Step 8 tokenised the boxes — column widths, type,
  // verdicts — and left what goes in them to each screen, so seven screens each
  // decided how much of a hash to show, how to draw a link out to an explorer,
  // and what a control looks like. None of those is wrong on its own; what is
  // wrong is that they disagree, and disagreement is what makes an interface
  // read as assembled rather than designed.
  //
  // These read source, so they catch the next screen restating the decision
  // rather than the drift that already happened.

  it('builds every explorer URL in lib/explorer.ts', () => {
    // `lib/network.ts` says it outright: a second place for the network to be
    // written down is a second place for it to be wrong. Three screens had the
    // testnet explorer path typed into them, which would have kept linking
    // testnet with total confidence on the day a mainnet build shipped.
    for (const [path, source] of tsx) {
      expect(source, `${path} builds an explorer URL itself`).not.toContain('stellar.expert/explorer');
    }
    expect(read('lib/explorer.ts')).toContain('https://stellar.expert/explorer');
  });

  it('truncates an address or a hash only in lib/format.ts', () => {
    // There were four truncations of a transaction hash and two of an address,
    // all rendering into columns whose widths are shared tokens. The token
    // fixes the box; this fixes what goes in it.
    for (const [path, source] of tsx) {
      expect(source, `${path} truncates a value inline`).not.toMatch(/\.slice\(0,\s*\d+\)\s*}?…/);
    }
  });

  it('declares the focus ring once, globally', () => {
    // Nine components restated `focus-visible:outline-accent`, which is the
    // base rule spelled out again at the call site. Restating it is how one of
    // them ends up disagreeing — an earlier version of `ExplorerLink` overrode
    // the ring to the permit hue, so a keyboard user who had learned the accent
    // ring met a green one on one screen.
    for (const [path, source] of tsx) {
      expect(source, `${path} restates the global focus ring`).not.toContain('focus-visible:outline-accent');
    }
  });

  it('gives every app screen the same shell', () => {
    // Seven pages chose three maximum widths and four section gaps between
    // them. Navigating between two screens must not feel like the application
    // resized itself.
    for (const [path, source] of tsx) {
      if (!path.endsWith('/page.tsx')) continue;
      // No exemption for the landing any more. It had one — it ran at its own
      // scale, one sentence per viewport, with its own type ramp and its own
      // maximum width — and step 12 ended that: it is now made of the same
      // shell, the same `Section`, the same column tokens and the same tables
      // as every screen it links to. Someone arriving on the landing and
      // clicking into the application should not feel the application resize
      // itself, and that is the same argument that produced `.screen` in the
      // first place, applied to the one page that was excused from it.
      expect(source, `${path} does not use the screen shell`).toContain('className="screen"');
    }
  });
});

describe('controls are a closed set', () => {
  it('keeps three variants, and no more', () => {
    const variants = [...css.matchAll(/\.btn\[data-variant='([\w-]+)'\]/g)].map(([, name]) => name);
    expect(new Set(variants)).toEqual(new Set(['primary', 'secondary', 'quiet']));
  });

  it('separates the register from the variant', () => {
    // The app screens' controls speak in the mono label voice — `SCAN AGAIN`,
    // `FORGET` — beside `.col-head` and `.status-label`. Making that a fourth
    // and fifth variant (`label-secondary`, `label-quiet`) is how a closed set
    // stops being closed: the variants say how much weight a control carries,
    // the register says which voice it speaks in, and they multiply rather than
    // extend.
    expect(css).toContain(".btn[data-register='label']");
  });

  it('states disabled once, and not as opacity', () => {
    // Five inline buttons disagreed about this, and one of them dimmed while
    // keeping its border — which still reads as an available control, just
    // dimmer. This application's whole argument is that it does not present
    // controls for things it cannot do.
    expect(css).toMatch(/\.btn:disabled\s*\{[^}]*\}/);
    expect(/\.btn:disabled\s*\{([^}]*)\}/.exec(css)?.[1]).not.toContain('opacity');
  });
});

describe('the palette has one definition, and every consumer reads it', () => {
  // PLAN-V5 F4. Step 11 centralised every colour into custom properties, and it
  // reached every consumer but one: `opengraph-image.tsx` renders through satori
  // with inline styles and no cascade, so `var(--permit)` resolves to nothing
  // and its eleven colours were literals.
  //
  // All eleven had drifted from the tokens they were copied from — `#0a0b0d`
  // against `--background: #060a11`, `#4ac95e` against `--permit: #45c86a`, and
  // so on through the file — while its docstring said "same palette as the
  // page". Close enough to survive review, far enough that the share card was a
  // picture of a slightly different product.
  //
  // `lib/theme.ts` is now the palette and both are consumers. These three cases
  // are what make that true rather than aspirational: without the second one in
  // particular, a token added to the stylesheet alone would never be pinned, and
  // the module would decay back into a partial copy.

  /** `--name: value;` declarations whose value is a colour, from `:root` blocks. */
  const declared = new Map(
    [...css.matchAll(/^\s*(--[\w-]+):\s*(#[0-9a-fA-F]{3,8}|rgb\([^)]*\));/gm)].map(
      ([, name, value]) => [name, value],
    ),
  );

  it('agrees with globals.css on every token it defines', () => {
    for (const [name, value] of Object.entries(THEME)) {
      expect(declared.get(name), `${name} is in lib/theme.ts but not in globals.css`).toBeDefined();
      expect(declared.get(name), `${name} disagrees between lib/theme.ts and globals.css`).toBe(
        value,
      );
    }
  });

  it('carries every colour token globals.css defines, so none escapes the pin', () => {
    // The direction that keeps the module honest as the system grows. A new
    // `--warning` added to the stylesheet alone is unpinned, and unpinned is
    // exactly the state the OG card's eleven literals were in.
    for (const name of declared.keys()) {
      expect(name in THEME, `${name} is in globals.css but not in lib/theme.ts`).toBe(true);
    }
  });

  it('leaves no colour literal in the card that cannot read a custom property', () => {
    // The specific escape, closed. Comments are stripped first: the docstring
    // lists the eleven values that had drifted, and a test forbidding a file from
    // naming what it forbids also forbids documenting the decision.
    const card = read('app/opengraph-image.tsx').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(card).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(card).not.toMatch(/\brgba?\(/);
    expect(card).toContain("from '@/lib/theme'");
  });

  it('keeps the X card a re-export rather than a second card to keep correct', () => {
    expect(read('app/twitter-image.tsx')).toContain("from './opengraph-image'");
  });
});

describe('the full-bleed band', () => {
  // PLAN-V5 F5. One section spans the viewport and every other stays in the
  // measure, which is a break-out — and the usual break-out is the bug.
  //
  // `margin-inline: calc(50% - 50vw)` is what everyone reaches for, and `100vw`
  // includes the scrollbar: on any page long enough to scroll, the "full-bleed"
  // section ends up about 15px wider than the viewport and the document scrolls
  // sideways. That is the regression `f91d854` fixed at 390px and the reason
  // `e2e/viewports.spec.ts` exists. The grid in `globals.css` resolves its
  // percentages against the element's own width instead, which already excludes
  // the scrollbar.
  //
  // The e2e suite catches the symptom at four widths. This catches the cause, in
  // the suite that runs on every commit, because the fix is easy to undo by
  // someone adding a second full-width thing in a hurry.
  const declarations = css.replace(/\/\*[\s\S]*?\*\//g, '');

  it('never breaks out with a viewport unit in a margin', () => {
    // Scoped to margins on purpose. `vw` is fine for a font size and fine for a
    // width that subtracts more than a scrollbar; it is breaking *out* with one
    // that reintroduces the overflow.
    expect(declarations).not.toMatch(/margin[a-z-]*:[^;}]*\bvw\b/);
  });

  it('is scoped to where a grid line can actually be addressed', () => {
    // `grid-column: full` means nothing except on a direct child of the element
    // that defines the tracks. The selector says so, rather than letting it fail
    // silently two levels down.
    expect(declarations).toMatch(/\.screen\s*>\s*\.bleed\s*\{/);
    expect(declarations).toMatch(/\[full-start\]/);
    expect(declarations).toMatch(/\[content-start\]/);
  });

  it('caps how wide a band may get', () => {
    // A band that spans a 2560px monitor stretches seven columns across two
    // metres of paper. The cap is what keeps "wider than the page" from becoming
    // "as wide as the desk".
    expect(declarations).toMatch(/--bleed-max:/);
    expect(declarations).toMatch(/max-width:\s*var\(--bleed-max\)/);
  });
});

describe('the mark has one definition, and every consumer reads it', () => {
  // PLAN-V5 §3.2. The mark appears in four places — the component, `icon.svg`,
  // `favicon.ico` and the share card — and three of them are files or formats
  // that cannot import a React component. That is the same shape of problem the
  // palette had, and it ends the same way if left alone: four drawings of the
  // mark, drifting apart one edit at a time, with nobody able to see it because
  // an icon is not read in review.
  //
  // So `lib/mark.ts` holds the geometry and `scripts/mark.mjs` builds the two
  // artefacts from it. These cases are what make the committed files output
  // rather than input — they rebuild both and compare bytes, so an edit to the
  // mark that is not regenerated is a red suite rather than a favicon quietly
  // showing last month's glyph.
  //
  // It costs nothing in CI, which is only true because the build is exact: the
  // geometry sits on a grid that lands on whole pixels at every icon size, and
  // the PNGs are written with stored deflate blocks so no zlib version can
  // change a byte. See the script's own docstring.

  it('regenerates the committed icon.svg exactly', async () => {
    const { iconSvg } = await import('../../../scripts/mark.mjs');
    expect(readFileSync(src('app/icon.svg'), 'utf8')).toBe(iconSvg());
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
    // Multiples of 1.5 on a 24 grid land on whole pixels at 16, 32 and 48px —
    // the three sizes packed into the `.ico`. Break this and the favicon starts
    // being anti-aliased at exactly the size where it can least afford it.
    for (const rect of MARK_RECTS) {
      for (const value of [rect.x, rect.y, rect.width, rect.height]) {
        expect((value * 2) % 3, `${value} is not a multiple of 1.5`).toBe(0);
      }
    }
  });

  it('keeps the rectangles from overlapping, which the rasteriser assumes', () => {
    // `scripts/mark.mjs` sums per-pixel coverage instead of unioning it, which
    // is only correct while no two rectangles share area. An overlap would
    // over-cover the pixels along the seam — invisible at these sizes, wrong at
    // any other, and the kind of bug that surfaces years later as "the icon
    // looks slightly bold at 20px".
    for (const [i, a] of MARK_RECTS.entries()) {
      for (const b of MARK_RECTS.slice(i + 1)) {
        const overlaps =
          a.x < b.x + b.width &&
          b.x < a.x + a.width &&
          a.y < b.y + b.height &&
          b.y < a.y + a.height;
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
    // PLAN-V4 §8, and the one design rule step 7 could most easily have broken.
    // Every motion this system permits is a transition on a data change: the
    // ground's heartbeat and a policy's closing window both move because a
    // ledger sequence arrived, and both stop when one stops arriving. A
    // keyframe loop runs on its own authority — it would keep going with the
    // network unreachable, which is this project's definition of decoration.
    //
    // Read with comments stripped, so the block in `globals.css` that explains
    // this rule at length does not fail it.
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(withoutComments).not.toContain('@keyframes');
    expect(withoutComments).not.toMatch(/animation-name\s*:/);
    expect(withoutComments).not.toMatch(/\banimation\s*:(?!\s*none)/);
  });
});

describe('the network indicator cannot disagree with the network', () => {
  it('reads the shared constant rather than hardcoding a string', () => {
    expect(topBar).toContain("from '@/lib/network'");
    expect(topBar).toContain('{NETWORK}');
    // The literal must not appear as a bare string in the component.
    expect(topBar).not.toMatch(/>\s*TESTNET\s*</);
  });

  it('marks the current section for assistive technology, not only visually', () => {
    expect(topBar).toContain("aria-current={active ? 'page' : undefined}");
  });

  it('keeps the unbuilt state available for the next section that needs it', () => {
    // A nav item that 404s reads as a broken application. One that says "not
    // built yet" is just true.
    //
    // Every section is built as of step 10, so this can no longer assert that
    // some section carries `built: false` — that assertion would now only be
    // satisfiable by leaving a screen unfinished. What has to survive is the
    // *branch*: the flag, and the state it renders. Deleting it because nothing
    // currently uses it is how the next planned-before-written section becomes
    // a 404 instead of a placeholder.
    expect(topBar).toContain('built: boolean');
    expect(topBar).toContain('Not built yet');
    expect(topBar).toContain('aria-disabled="true"');
  });

  it('links only sections this application actually serves', () => {
    // The other half, and the one that catches a typo: a `built: true` entry
    // pointing at a route with no page is exactly the 404 the flag exists to
    // prevent, and it is invisible in review.
    const routes = topBar.matchAll(/href: '([^']+)', built: true/g);
    const hrefs = [...routes].map(([, href]) => href);
    expect(hrefs.length).toBeGreaterThan(0);

    for (const href of hrefs) {
      const segments = href === '/' ? [] : href.split('/').filter(Boolean);
      const page = fileURLToPath(new URL(`../src/app/${[...segments, 'page.tsx'].join('/')}`, import.meta.url));
      expect(existsSync(page), `${href} is linked as built but ${page} does not exist`).toBe(true);
    }
  });
});
