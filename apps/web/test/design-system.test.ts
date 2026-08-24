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
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MARK_GRID, MARK_RECTS } from '../src/lib/mark';
import { THEME } from '../src/lib/theme';

const src = (relative: string) => fileURLToPath(new URL(`../src/${relative}`, import.meta.url));
const read = (relative: string) => readFileSync(src(relative), 'utf8');
const present = (relative: string) => existsSync(src(relative));
/** `public/`, which is beside `src/` rather than inside it — the avatars live there. */
const pub = (relative: string) => fileURLToPath(new URL(`../public/${relative}`, import.meta.url));

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

describe('prose does not lose the space beside an inline value', () => {
  /**
   * A word joined to the value before it, in rendered output, from source that
   * looks correct.
   *
   * JSX drops the leading whitespace of a text node when that node runs on past
   * a newline. So this source:
   *
   *     The network invokes <span className="value">__check_auth</span> on the
   *     smart account, and the account's own code decides.
   *
   * renders as `__check_authon the smart account`. The space is there in the
   * file, on the same line as the tag, and it is gone in the HTML.
   *
   * This is the worst kind of defect this project can ship: it is invisible in
   * a diff, invisible in review, survives every type check and every build, and
   * lands in the one register the page uses for values a reader is meant to
   * copy — a contract address welded to the next word. Twenty-three instances
   * existed across the site and the docs when it was first noticed, all from
   * the same writing habit, and the only reason any of them were found is that
   * somebody looked at a screenshot.
   *
   * The fix at each site is an explicit `{' '}`. The rule here is what stops the
   * habit coming back, and it is deliberately narrow: it fires only when a text
   * run both begins immediately after an inline closing tag *and* continues past
   * a line break, which is exactly the shape that loses the space. A tag
   * followed by text that stays on one line is fine and is not flagged.
   */
  const INLINE_CLOSE = /<\/(?:span|code|em|strong|a|Link|ExplorerLink|Address|TxHash)>[ \t]+(?=[A-Za-z(])/g;

  const offenders = tsx.flatMap(([path, source]) =>
    [...source.matchAll(INLINE_CLOSE)].flatMap((match) => {
      const after = source.slice(match.index + match[0].length);
      const nextMarkup = after.search(/[<{]/);
      const run = nextMarkup === -1 ? after : after.slice(0, nextMarkup);
      if (!run.includes('\n')) return [];
      const line = source.slice(0, match.index).split('\n').length;
      return [`${path}:${line}`];
    }),
  );

  it('never relies on a literal space that JSX will swallow', () => {
    expect(
      offenders,
      `these will render with the space missing — use {' '} instead:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});

describe('prose does not lose the space beside an inline value, second shape', () => {
  /**
   * The same defect, a different trigger, and a rule built on a measurement
   * rather than on a guess about the compiler.
   *
   * It came back on `/app/try` step 2 as `0.1 XLMfrom this account`, and on
   * `/app/accounts/[id]` as `100 XLMfrom the owner's classic account`. The
   * describe above did not catch either, and the obvious widening — treat a
   * JSX expression's closing `}` like an inline closing tag — is **wrong**. It
   * was tried and measured first:
   *
   *   - a naive `\}[ \t]+` scan over `src/` produced 398 hits, almost all of
   *     them `} from '…';` in import statements. A regex over raw source cannot
   *     tell a JSX expression's brace from an import's.
   *   - a parser-based version of that rule produced 20 hits, of which most
   *     were checked against the shipped bundle and found to render correctly.
   *     Fixing them would have inserted a second space into working prose.
   *
   * So the compiler was asked directly, through Next's own SWC binding, rather
   * than reasoned about. What actually loses the space is this, and only this:
   *
   *   > A JSX text node **spanning more than one line** that **contains an HTML
   *   > entity** loses its leading whitespace.
   *
   * Measured across `&rsquo;`, `&mdash;`, `&amp;`, `&nbsp;` and `&#8217;` — all
   * five lose it; the same text with no entity keeps it, and the same text with
   * an entity on a single line keeps it. The closing brace is a coincidence of
   * the three sites that had it: what they have in common is `&rsquo;` and a
   * line break, not a brace. A tag would do it too.
   *
   * That is why this rule is written against the parse tree and not a regular
   * expression. The trigger is a property of a text node — its line span and
   * its content — which no amount of pattern-matching on the surrounding
   * characters can see.
   *
   * The fix at each site is the same as before: an explicit `{' '}`.
   */
  const ENTITY = /&(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#[xX][0-9a-fA-F]+);/;

  const swallowed = tsx.flatMap(([path, source]) => {
    const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const found: string[] = [];

    const visit = (node: ts.Node): void => {
      if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
        node.children.forEach((child, index) => {
          if (!ts.isJsxText(child)) return;
          const raw = child.getFullText();
          // Leading whitespace is what is at risk; without it there is nothing
          // to lose. A first child has no sibling in front of it, so its
          // leading whitespace is indentation and is meant to go.
          if (!/^[ \t]/.test(raw)) return;
          if (!raw.includes('\n')) return;
          if (!ENTITY.test(raw)) return;
          if (node.children[index - 1] === undefined) return;
          const line = file.getLineAndCharacterOfPosition(child.getStart(file)).line + 1;
          found.push(`${path}:${line}`);
        });
      }
      ts.forEachChild(node, visit);
    };

    visit(file);
    return found;
  });

  it('keeps the space when a multi-line run contains an HTML entity', () => {
    expect(
      swallowed,
      `these lose their leading space to the entity in them — use {' '} instead:\n${swallowed.join('\n')}`,
    ).toEqual([]);
  });

  it('can fire, proven on the three shapes rather than assumed', () => {
    // The tripwire's own tripwire. A rule this specific is worthless if a
    // future refactor makes it stop matching, and "no offenders" and "no longer
    // looks for anything" are indistinguishable from the outside.
    const parse = (code: string) =>
      ts.createSourceFile('probe.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

    const flags = (code: string): boolean => {
      const file = parse(code);
      let hit = false;
      const visit = (node: ts.Node): void => {
        if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
          node.children.forEach((child, index) => {
            if (!ts.isJsxText(child)) return;
            const raw = child.getFullText();
            if (!/^[ \t]/.test(raw) || !raw.includes('\n') || !ENTITY.test(raw)) return;
            if (node.children[index - 1] === undefined) return;
            hit = true;
          });
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
      return hit;
    };

    // The shape that shipped: an expression, a space, prose with an entity,
    // running past a line break.
    expect(flags('const A = <p>{v} the owner&rsquo;s account\n  {o}\n</p>;')).toBe(true);
    // The same after an inline tag, which the brace-shaped reading would miss.
    expect(flags('const B = <p><span>x</span> the owner&rsquo;s account\n  {o}\n</p>;')).toBe(true);
    // And the three shapes that are fine, each of which a coarser rule flags.
    expect(flags('const C = <p>{v} the owner&rsquo;s account</p>;')).toBe(false);
    expect(flags('const D = <p>{v} the owner account\n  {o}\n</p>;')).toBe(false);
    expect(flags('const E = <p> the owner&rsquo;s account\n  {o}\n</p>;')).toBe(false);
  });
});

describe('a browser-only capability is not read during render', () => {
  /**
   * `passkeysAvailable()` reads `window` and `navigator`. On the server it is
   * `false`; in a browser it is usually `true`. A component that calls it while
   * rendering therefore renders one thing on the server and another on the
   * client, and React fails hydration with #418 — silently, in production, with
   * a minified error code and no indication which element disagreed.
   *
   * That shipped on `/app/accounts/new` in V7 §5.4 and was found by watching for
   * page errors while checking something else. The server sent the "this browser
   * does not offer passkeys" sentence with the control disabled; the client
   * rendered neither.
   *
   * The fix is `usePasskeysAvailable()`, which answers `undefined` until the
   * browser has been asked — the same not-known-yet shape `useLocalKeyPublics`
   * uses, and hydration-safe because React renders `getServerSnapshot` first.
   * This rule keeps the direct call out of components so the next person cannot
   * reintroduce it by reaching for the obvious function.
   */
  const componentsCallingItDirectly = tsx.filter(([, source]) =>
    /(?<!use)[Pp]asskeysAvailable\s*\(/.test(source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')),
  );

  it('goes through the hook, so the server and the first client render agree', () => {
    expect(
      componentsCallingItDirectly.map(([path]) => path),
      'call usePasskeysAvailable() instead — a direct call renders differently on the server',
    ).toEqual([]);
  });

  it('can fire, so it is not passing because the name changed', () => {
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const rule = (s: string) => /(?<!use)[Pp]asskeysAvailable\s*\(/.test(strip(s));
    expect(rule('const available = passkeysAvailable();')).toBe(true);
    expect(rule('if (!passkeysAvailable()) return null;')).toBe(true);
    // The hook is the sanctioned form and must not be flagged.
    expect(rule('const available = usePasskeysAvailable();')).toBe(false);
    // …and a mention in prose is not a call.
    expect(rule('// passkeysAvailable() reads window')).toBe(false);
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

  it('gives every page one of the two shells, itself or through a layout', () => {
    // V5 required `.screen` on every page including the landing, on the
    // argument that a reader should not feel the application resize itself.
    // V6 keeps the argument and widens it by exactly one: a page is either the
    // instrument or the argument, and nothing is allowed to be neither. A page
    // that invents its own width is the failure both shells exist to prevent.
    //
    // A page may satisfy this through an enclosing layout rather than directly,
    // which is how `/docs` works — four pages sharing one `.screen` and one
    // sidebar. Requiring the shell on the page itself would have forced four
    // copies of the shell, which is the duplication the rule exists to stop.
    const shell = (source: string) =>
      /className="(?:screen|scene)"/.test(source) || source.includes('<Scene');

    /** Layout sources enclosing a page, nearest first. */
    function enclosing(path: string): string[] {
      const parts = path.split('/');
      const layouts: string[] = [];
      for (let i = parts.length - 1; i > 0; i--) {
        const candidate = [...parts.slice(0, i), 'layout.tsx'].join('/');
        const found = tsx.find(([other]) => other === candidate);
        if (found !== undefined) layouts.push(found[1]);
      }
      return layouts;
    }

    for (const [path, source] of tsx) {
      if (!path.endsWith('/page.tsx')) continue;
      const satisfied = shell(source) || enclosing(path).some(shell);
      expect(satisfied, `${path} uses neither shell, and no layout above it does`).toBe(true);
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

describe('the section nav points at routes that exist', () => {
  /**
   * `SiteHeader.tsx` has claimed since V6 that this check existed. It did not.
   *
   * The claim is in its own header — "`design-system.test.ts` pins both the flag
   * and the state it renders, and separately checks that every `built: true`
   * entry points at a route that exists — the typo case, which is invisible in
   * review". The first half was true. The second half described a test nobody
   * had written, which is worse than an unguarded nav: the comment is what a
   * reviewer reads instead of checking, so the gap was documented as closed.
   *
   * Found while adding the `Try` entry PLAN-V7 §3 asks for, on the strength of
   * that sentence.
   */
  const header = read('components/site/SiteHeader.tsx');

  /** `{ href: '…', label: '…', built: true|false }`, as the file writes them. */
  const entries = [...header.matchAll(/\{\s*href:\s*'([^']+)',\s*label:\s*'([^']+)',\s*built:\s*(true|false)\s*\}/g)].map(
    ([, href, label, built]) => ({ href, label, built: built === 'true' }),
  );

  it('finds the sections, so the checks below are about something', () => {
    // The regex is the whole test's reach. A reformat that breaks it would take
    // every assertion below with it and report a clean run over an empty list —
    // the same hollowing `TABLES_EXPECTED_ANYWHERE` refuses in the e2e suite.
    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect(entries.map((e) => e.label)).toContain('Docs');
  });

  it('has a page.tsx behind every built section', () => {
    const missing = entries
      .filter((entry) => entry.built)
      // App Router: `/app/try` is `app/app/try/page.tsx`. Route groups and
      // dynamic segments are deliberately not resolved — no nav entry uses one,
      // and a resolver that guessed would be the thing going quietly wrong.
      .filter((entry) => !present(`app${entry.href}/page.tsx`))
      .map((entry) => `${entry.label} → ${entry.href}`);

    // If this fails: either the route was never built and `built` should be
    // false, or the href has a typo. Both ship as a 404 from the top bar of
    // every page on the site.
    expect(missing).toEqual([]);
  });

  it('does not mark a section unbuilt while its route exists', () => {
    // The other direction, which fails quietly rather than loudly: a route that
    // works, rendered as greyed-out text nobody can click.
    const stale = entries
      .filter((entry) => !entry.built && present(`app${entry.href}/page.tsx`))
      .map((entry) => `${entry.label} → ${entry.href}`);

    expect(stale).toEqual([]);
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

  it('regenerates the committed avatars exactly', async () => {
    const { avatarPngs } = await import('../../../scripts/mark.mjs');
    for (const { name, bytes } of avatarPngs()) {
      expect(readFileSync(pub(name)).equals(bytes), `${name} has drifted`).toBe(true);
    }
  });

  it('keeps the avatar mark clear of the circular crop', async () => {
    // The reason the avatars are not just bigger favicons. Every platform that
    // shows an avatar crops it to a circle, so the check that matters is not
    // whether the mark fits the square — it is how much of the inscribed
    // circle's radius the farthest ink reaches.
    //
    // Measured from `MARK_RECTS` rather than written down, so redrawing the
    // mark or changing a scale re-runs the arithmetic instead of leaving a
    // stale number here. 83% is what was looked at, at 48px and at 24px.
    const { AVATARS } = await import('../../../scripts/mark.mjs');
    for (const { size, scale } of AVATARS) {
      const centre = size / 2;
      const offset = (size - MARK_GRID * scale) / 2;
      let farthest = 0;
      for (const rect of MARK_RECTS) {
        for (const x of [rect.x, rect.x + rect.width]) {
          for (const y of [rect.y, rect.y + rect.height]) {
            farthest = Math.max(
              farthest,
              Math.hypot(x * scale + offset - centre, y * scale + offset - centre),
            );
          }
        }
      }
      expect(farthest / centre, `avatar-${size}.png reaches too far into the crop`).toBeLessThan(
        0.86,
      );
      // And a floor, because an avatar that is mostly margin reads as a dot.
      expect(farthest / centre).toBeGreaterThan(0.75);
    }
  });

  it('refuses to anti-alias an avatar rather than rounding it', async () => {
    // One bit per pixel is lossless only while every edge lands on a whole
    // pixel. That is an assumption, so it is a fence: a scale that breaks it
    // throws instead of quietly producing a soft mark, which would be invisible
    // in a byte comparison against a file built by the same broken arithmetic.
    const { avatarBits } = await import('../../../scripts/mark.mjs');
    // A scale that is not a multiple of 2/3: the jambs start at x = 4.5, which
    // lands on a half pixel at 11 and would need an anti-aliased edge.
    expect(() => avatarBits(400, 11)).toThrow(/multiple of 2\/3/);
    // A legal scale in a box that cannot be centred on a whole pixel.
    expect(() => avatarBits(401, 12)).toThrow(/half-pixel/);
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
  it('defines one accent per palette, and aliases are not second accents', () => {
    // The rule is "one accent hue", not "one line mentioning --accent", and the
    // console made the difference matter. `.console` re-points `--accent` at
    // `var(--app-accent)`: that is the same slot resolving to the palette in
    // scope, not a new colour. Counting declarations would have called it a
    // second accent, and the fix for a mis-stated rule is to state it properly.
    //
    // So the check is on *definitions* — a token given a literal value — and it
    // is now two assertions where it was one, because the console has to obey
    // the restraint too. A third accent hue in either palette still fails.
    /** Every declaration of `name`, as its value with whitespace trimmed. */
    const valuesOf = (name: string) =>
      [...css.matchAll(new RegExp(`^[ \\t]*${name}:[ \\t]*([^;]+);`, 'gm'))].map(([, value]) =>
        value.trim(),
      );

    /** A definition names a colour. An alias points at another token. */
    const defines = (name: string) => valuesOf(name).filter((value) => !value.startsWith('var('));

    expect(defines('--accent'), 'the site defines more than one accent').toHaveLength(1);
    expect(defines('--app-accent'), 'the console defines more than one accent').toHaveLength(1);

    // And every remaining `--accent` declaration is an alias, so a literal
    // cannot be slipped in under a selector that is not `:root`.
    const aliases = valuesOf('--accent').filter((value) => value.startsWith('var('));
    expect(aliases.length + 1, 'an --accent declaration is neither a definition nor an alias').toBe(
      valuesOf('--accent').length,
    );
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

  it('does not let a utility class smuggle a keyframe loop past the stylesheet', () => {
    // The case above reads `globals.css`, and for four versions that was the
    // whole surface. It is not: Tailwind's `animate-*` utilities generate their
    // own `@keyframes` into the compiled output, so a component could — and one
    // did — ship a loop the rule never saw.
    //
    // `ScreenState`'s pending marker carried `animate-pulse` from V4 until the
    // V6 rebuild. It pulsed at the same rate whether the read was in flight, had
    // died in a dropped connection, or had resolved into a component that failed
    // to re-render: motion running on its own authority, which is this
    // project's definition of decoration, in the one place a reader is actually
    // waiting on the signal.
    //
    // Scoped to `animate-` rather than to the word "animation" so a comment
    // explaining the rule does not fail it, and so `transition-*` — which is
    // exactly what this system does permit — is untouched.
    const offenders = tsx.flatMap(([path, source]) => {
      const markup = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      return [...markup.matchAll(/\banimate-\[?[\w.-]+/g)].map(
        ([match]) => `${path}: ${match}`,
      );
    });
    expect(
      offenders,
      `these ship a keyframe loop through a utility class:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});

describe('the console is scoped to the app surface', () => {
  /**
   * The risk this file exists to catch, in its newest form.
   *
   * The site and the app now run on two palettes out of one stylesheet. The way
   * that goes wrong is not a bad colour — `contrast.test.ts` measures those —
   * it is a console class appearing where the narrative lives, or an app screen
   * quietly losing it. Both are invisible in a diff and obvious on the page,
   * which is the combination worth a test.
   */

  it('declares the console on the app layout, and nowhere else', () => {
    const wearing = tsx.filter(([, source]) => /className="[^"]*\bconsole\b/.test(source));
    expect(
      wearing.map(([path]) => path),
      'the console class is applied outside app/app/layout.tsx',
    ).toEqual(['app/app/layout.tsx']);
  });

  it('puts every app screen under that layout, so none can miss it', () => {
    // A page under `/app` is a console screen by virtue of where it sits. This
    // asserts the tree rather than the class, because the class is applied once
    // and inherited — the failure mode is a page that escapes the subtree, not
    // one that forgets an attribute.
    const appPages = tsx.filter(([path]) => path.startsWith('app/app/') && path.endsWith('/page.tsx'));
    expect(appPages.length, 'no app pages found, so this check is about nothing').toBeGreaterThan(0);
    expect(present('app/app/layout.tsx')).toBe(true);
  });

  it('leaves the narrative and the docs outside it', () => {
    // The landing page and the four docs pages must not be under a console
    // layout, and no layout above them may introduce one.
    for (const path of ['app/layout.tsx', 'app/docs/layout.tsx']) {
      if (!present(path)) continue;
      expect(read(path), `${path} puts the console above the narrative`).not.toMatch(
        /className="[^"]*\bconsole\b/,
      );
    }
  });

  it('paints the chrome from the same declaration rather than a second copy', () => {
    // The header and footer are siblings of the app subtree, so they follow by
    // cascade. If someone splits these selectors apart to "fix" the chrome, the
    // two blocks drift and the header ends up a palette behind the screen.
    expect(declarations).toMatch(/\.console,\s*body:has\(\.console\)\s*\{/);
  });

  it('aliases the palette without naming a colour, so nothing escapes the pin', () => {
    // Every declaration inside the console block must be a var() alias or a
    // non-colour property. A literal here would be a token that never reaches
    // lib/theme.ts and never gets measured.
    const block = /\.console,\s*body:has\(\.console\)\s*\{([^}]*)\}/.exec(declarations)?.[1] ?? '';
    expect(block.length, 'the console block was not found').toBeGreaterThan(0);
    expect(block, 'a colour literal is declared inside the console block').not.toMatch(
      /:\s*#[0-9a-fA-F]{3,8}\s*;/,
    );
    expect(block, 'an rgb() literal is declared inside the console block').not.toMatch(
      /:\s*rgba?\([^)]*\)\s*;/,
    );
  });
});
