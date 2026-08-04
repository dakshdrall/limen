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

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../src/${relative}`, import.meta.url)), 'utf8');

const css = read('app/globals.css');
const layout = read('app/layout.tsx');
const verdict = read('components/Verdict.tsx');
const topBar = read('components/TopBar.tsx');

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
  const tokens = ['--col-addr', '--col-hash', '--col-amount', '--col-ledger', '--col-verdict', '--col-label'];

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

  it('sizes the verdict column to the badge it holds, not to the word', () => {
    // `DENY` is four characters; the badge is `min-w-[6.25rem]`.
    const verdict = /--col-verdict:\s*(\d+)ch/.exec(css)?.[1];
    expect(Number(verdict)).toBeGreaterThanOrEqual(13);
  });
});

describe('verdicts survive greyscale', () => {
  it('has exactly three states', () => {
    const states = [...verdict.matchAll(/^\s{2}(?:'[\w-]+'|\w+): \{$/gm)];
    expect(states).toHaveLength(3);
  });

  it('keeps REFUSED AT SIMULATION distinct from DENY', () => {
    expect(verdict).toContain('refused-at-simulation');
    expect(verdict).toContain('never reached a ledger');
  });

  it('pairs every state with a glyph, so hue is never the only signal', () => {
    // Colour-blind reviewers and greyscale printouts both depend on this.
    for (const glyph of ['✓', '✕', '⊘']) expect(verdict).toContain(glyph);
  });

  it('distinguishes the third state by border treatment, not a fourth hue', () => {
    expect(verdict).toContain('border-dashed');
    expect(verdict).toContain('text-unproven');
  });

  it('does not claim on-chain provenance from the badge alone', () => {
    // Limen's own evaluator produces DENY rows. If the badge asserted the
    // network refused them, every simulator screen would be lying.
    expect(verdict).toMatch(/aria: 'denied',/);
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
