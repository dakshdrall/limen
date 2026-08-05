/**
 * Nothing reachable from `browser.ts` may need Node.
 *
 * A source scan, and the cheaper half of a pair. The other half is
 * `browser-bundle.test.ts`, which runs the same modules against the SDK's
 * browser build with `globalThis.Buffer` deleted. Neither subsumes the other:
 * this one catches a reference that is never executed by a test, and that one
 * catches a dependency that does not look like one — a helper that reaches for
 * `Buffer` through an alias, or an SDK call that only happens to work in Node.
 *
 * The reachable set is computed from the import graph rather than listed, so a
 * module that becomes reachable is covered the moment it is imported. Listing
 * the files by hand is how a scan like this quietly stops covering the thing it
 * was written for.
 *
 * `index.ts` deliberately carries no such promise. It is the Node entry point,
 * `events.ts` hangs off it, and the split between the two entry points is what
 * makes this test meaningful rather than a constraint on the whole package.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

/** Comments stripped, so prose about `Buffer` neither accuses nor excuses. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Every module reachable from an entry point, by following relative imports.
 *
 * Package imports are not followed on purpose: `@stellar/stellar-sdk` is a
 * dependency whose browser build is the thing `browser-bundle.test.ts` pins,
 * and `@limen/core` is dependency-free by its own suite's rules.
 */
function reachableFrom(entry: string): Map<string, string> {
  const seen = new Map<string, string>();
  const queue = [resolve(SRC, entry)];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    const text = readFileSync(file, 'utf8');
    seen.set(file, text);

    for (const match of text.matchAll(/from\s+'(\.[^']+)'/g)) {
      const spec = match[1]!.replace(/\.js$/, '.ts');
      queue.push(resolve(dirname(file), spec));
    }
  }
  return seen;
}

const BROWSER_GRAPH = reachableFrom('browser.ts');
const relative = (file: string) => file.slice(SRC.length);

describe('the reachable set is what it should be', () => {
  it('reaches the write path', () => {
    const names = [...BROWSER_GRAPH.keys()].map(relative).sort();
    // If this list surprises you, that is the point of asserting it: the two
    // scans below are only as good as the set they run over, and a graph that
    // silently shrank would pass them while proving nothing.
    expect(names).toContain('deploy.ts');
    expect(names).toContain('install.ts');
    expect(names).toContain('revoke.ts');
    expect(names).toContain('submit.ts');
    expect(names).toContain('sign.ts');
    expect(names).toContain('bytes.ts');
  });

  it('does not reach the Node-only entry point', () => {
    const names = [...BROWSER_GRAPH.keys()].map(relative);
    expect(names).not.toContain('index.ts');
  });
});

describe('nothing in the browser graph needs Node', () => {
  const offenders = (pattern: RegExp): string[] =>
    [...BROWSER_GRAPH]
      .filter(([, text]) => pattern.test(code(text)))
      .map(([file]) => relative(file))
      .sort();

  /**
   * `Buffer` where it would run: a call, a construction, a property read.
   *
   * Deliberately not every occurrence of the word. `Buffer` also appears in
   * *type* position — the Stellar SDK declares parameters as `Buffer` because
   * it was written for Node first — and a type annotation is erased before
   * anything ships. Flagging those would force the exception to be silenced
   * with a comment, which is how a scan stops meaning anything.
   *
   * The type-position uses are not unwatched. They are pinned to one file
   * below, so a second file cannot quietly acquire one.
   */
  const BUFFER_AT_RUNTIME = /\bnew\s+Buffer\b|\bBuffer\s*[.(]/;
  const BUFFER_ANYWHERE = /\bBuffer\b/;

  it('the detectors can fire', () => {
    // Same argument as `SIGNER_SENTINEL` and the local-key label: prove the
    // check can match before trusting that it did not.
    expect(BUFFER_AT_RUNTIME.test(code('const b = Buffer.from(x);'))).toBe(true);
    expect(BUFFER_AT_RUNTIME.test(code('const b = new Buffer(8);'))).toBe(true);
    expect(BUFFER_AT_RUNTIME.test(code('Buffer.concat([a, b])'))).toBe(true);
    expect(/from\s+'node:/.test(code("import { readFileSync } from 'node:fs';"))).toBe(true);
    expect(/\bprocess\s*\./.test(code('const url = process.env.RPC;'))).toBe(true);

    // …and that a type annotation is not a runtime use, which is the whole
    // reason the two patterns are different.
    expect(BUFFER_AT_RUNTIME.test(code('return value as unknown as Buffer;'))).toBe(false);
    expect(BUFFER_ANYWHERE.test(code('return value as unknown as Buffer;'))).toBe(true);

    // …and that a comment is not code.
    expect(BUFFER_ANYWHERE.test(code('// there is no Buffer global in the browser'))).toBe(false);
  });

  it('calls no Buffer', () => {
    // If this fails: use `bytes.ts`. `scvBytes`, `sha256`, `concatBytes`,
    // `toHex` and `fromHex` exist for exactly the four call sites that used to
    // be here. Adding a Buffer polyfill to the client bundle is not the fix.
    expect(offenders(BUFFER_AT_RUNTIME)).toEqual([]);
  });

  it('names Buffer as a type in exactly one file, where the cast is explained', () => {
    // The SDK's declarations say `Buffer` and its runtime accepts a
    // `Uint8Array`. That discrepancy is absorbed in one place so there is one
    // line to point at if the SDK ever stops accepting one — and so a second
    // file cannot acquire the same cast without this failing.
    expect(offenders(BUFFER_ANYWHERE)).toEqual(['bytes.ts']);
  });

  it('imports no node: module', () => {
    expect(offenders(/from\s+'node:/)).toEqual([]);
  });

  it('references no process', () => {
    expect(offenders(/\bprocess\s*\./)).toEqual([]);
  });
});

describe('the acceptance script observes the same constraints', () => {
  // It is the closest thing to the browser flow that can be run before the
  // screens exist, so a `node:fs` import sneaking into it would quietly turn
  // the rehearsal into something the browser could not perform.
  const script = code(readFileSync(join(SRC, '..', 'scripts', 'acceptance.mjs'), 'utf8'));

  it('imports no node: module', () => {
    expect(/from\s+'node:/.test(script)).toBe(false);
  });

  it('reads no secret from the environment', () => {
    expect(/process\.env/.test(script)).toBe(false);
  });

  it('references no Buffer', () => {
    expect(/\bBuffer\b/.test(script)).toBe(false);
  });

  it('imports the browser entry point rather than the Node one', () => {
    expect(script).toContain("from '../dist/browser.js'");
    expect(script).not.toContain("from '../dist/index.js'");
  });
});
