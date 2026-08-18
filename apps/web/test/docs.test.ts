/**
 * The documentation's claims about itself.
 *
 * A reference page is trusted more than a marketing page and checked less, which
 * is the worst combination a document can have. These cases pin the three things
 * about `/docs` that would rot silently:
 *
 *   1. the sidebar links only to pages that exist;
 *   2. each page's contents rail and its sections agree, in both directions;
 *   3. the environment-variable table matches what the code actually reads.
 *
 * The third is the one with real teeth. `DocPage` takes its contents as a
 * declaration rather than scraping headings from the DOM — which buys a server
 * component and a rail that is correct in the HTML, at the cost of a second
 * place to forget. This is that cost being paid.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DOCS_NAV } from '../src/lib/docs-nav';

const src = (relative: string) => fileURLToPath(new URL(`../src/${relative}`, import.meta.url));
const read = (relative: string) => readFileSync(src(relative), 'utf8');

/**
 * Where the application reads environment variables from.
 *
 * `apps/web/src` is not the whole of it any more. V8 M1 moved the rate limiter
 * and the transaction cache into `@limen/kv`, which reads two variables the
 * production deployment refuses to start without — and a fence that only
 * scanned this app would have called that table complete while the two entries
 * an operator most needs were missing from it.
 *
 * Only packages the *web app* imports belong here. `@limen/db` and
 * `@limen/custody` read their own variables, but nothing in `apps/web` imports
 * either yet, so documenting them on this page would describe a deployment that
 * does not exist. They join this list in the milestone that wires them up.
 */
const ENV_ROOTS = [
  fileURLToPath(new URL('../src/', import.meta.url)),
  fileURLToPath(new URL('../../../packages/kv/src/', import.meta.url)),
];

/** Every documentation page, as `[route, source]`. */
const PAGES = DOCS_NAV.flatMap((group) => group.entries).map((entry) => {
  const segments = entry.href.split('/').filter(Boolean);
  return [entry.href, `app/${segments.join('/')}/page.tsx`] as const;
});

describe('the sidebar is a map of pages that exist', () => {
  it('has entries', () => {
    // Without this, deleting the nav would turn the case below green.
    expect(PAGES.length).toBeGreaterThan(0);
  });

  it.each(PAGES)('%s is a page on disk', (href, path) => {
    expect(existsSync(src(path)), `${href} is in the sidebar but ${path} does not exist`).toBe(true);
  });

  it('lists every documentation page that exists, so none is unreachable', () => {
    // The other direction. A page nobody links to is a page nobody reads, and
    // it will drift because nothing brings a reader to it.
    // `Set<string>` explicitly. `PAGES` carries Next's typed-route shape —
    // `app/${string}/page.tsx` — and `found` below is built by walking the
    // filesystem, so it is plain `string`. Left inferred, `routed` narrows to
    // the template literal and `routed.has(path)` is a type error: the check
    // this test exists to make cannot be expressed against the values it has.
    const routed = new Set<string>(PAGES.map(([, path]) => path));
    const found: string[] = [];

    function walk(dir: string) {
      for (const entry of readdirSync(src(dir), { withFileTypes: true })) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(path);
        else if (entry.name === 'page.tsx') found.push(path);
      }
    }
    walk('app/docs');

    for (const path of found) {
      expect(routed.has(path), `${path} exists but is not in the sidebar`).toBe(true);
    }
  });
});

describe('each page’s contents rail matches its sections', () => {
  it.each(PAGES)('%s declares exactly the sections it renders', (href, path) => {
    const source = read(path);

    const declared = [...source.matchAll(/\{\s*id:\s*'([\w-]+)'\s*,\s*title:/g)].map(([, id]) => id);
    const rendered = [...source.matchAll(/<DocSectionBlock\s+id="([\w-]+)"/g)].map(([, id]) => id);

    expect(declared.length, `${href} declares no contents`).toBeGreaterThan(0);

    // Both directions. A section with no entry is invisible in the rail; an
    // entry with no section is a link to nowhere on the page it describes.
    expect(new Set(declared), `${href}: rail and sections disagree`).toEqual(new Set(rendered));
    // Order matters too — a rail that lists sections in a different order than
    // the page presents them is worse than no rail.
    expect(declared, `${href}: rail order does not match section order`).toEqual(rendered);
  });
});

describe('the environment table matches what the code reads', () => {
  const reference = read('app/docs/reference/page.tsx');

  /** Names appearing in the reference table. */
  const documented = new Set(
    [...reference.matchAll(/name:\s*'([A-Z0-9_]+)'/g)].map(([, name]) => name),
  );

  /** Names the application actually reads, scanned out of every root above. */
  function scan(root: string, dir = ''): string[] {
    return readdirSync(`${root}${dir}`, { withFileTypes: true }).flatMap((entry) => {
      const path = dir === '' ? entry.name : `${dir}/${entry.name}`;
      if (entry.isDirectory()) return scan(root, path);
      if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) return [];
      // The reference page names every variable in prose and in the table, so
      // scanning it would make this test compare the page to itself.
      if (path === 'app/docs/reference/page.tsx') return [];
      // Comments stripped, so a docstring explaining `process.env.X` is not
      // mistaken for a read. The same argument `local-key-label.test.ts` makes:
      // prose must not be able to accuse a file of something it does not do.
      const code = readFileSync(`${root}${path}`, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      return [
        // `process.env.X`, and the bare `env.X` a module takes as a parameter
        // so it can be handed a fake in a test.
        ...[...code.matchAll(/(?:process\.)?\benv\.([A-Z0-9_]+)/g)].map(([, name]) => name),
        // `env[UPSTASH_URL_ENV]`, where the name is an exported constant so
        // callers can refer to it without spelling it twice. The indirection is
        // deliberate in `@limen/kv`; without this the scan would read that file
        // and conclude it touches no environment at all.
        ...[...code.matchAll(/_ENV = '([A-Z0-9_]+)'/g)].map(([, name]) => name),
      ];
    });
  }

  const read_ = new Set(ENV_ROOTS.flatMap((root) => scan(root)));

  it('finds variables to check', () => {
    expect(read_.size).toBeGreaterThan(0);
    expect(documented.size).toBeGreaterThan(0);
  });

  it('documents every variable the application reads', () => {
    // A variable an operator must set, absent from the table, is a deployment
    // that half works for a reason nobody can look up.
    const undocumented = [...read_].filter((name) => !documented.has(name)).sort();
    expect(undocumented, `read by the code but missing from /docs/reference: ${undocumented}`).toEqual(
      [],
    );
  });

  it('reads every variable it documents', () => {
    // The other direction, which catches the table outliving the feature. An
    // entry for a variable nothing reads is an instruction to configure
    // something that does nothing.
    //
    // There is no exemption list here on purpose. VERCEL_PROJECT_PRODUCTION_URL
    // is platform-supplied rather than operator-set and was briefly excluded
    // instead of documented — but "the code reads it and the table does not
    // mention it" is exactly the state this pair of cases exists to forbid, and
    // an exemption is how a table starts drifting one justified omission at a
    // time. It is in the table, marked `platform`.
    const stale = [...documented].filter((name) => !read_.has(name)).sort();
    expect(stale, `documented in /docs/reference but read nowhere: ${stale}`).toEqual([]);
  });
});
