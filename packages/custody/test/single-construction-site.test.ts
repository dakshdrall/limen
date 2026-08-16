/**
 * Exactly one module constructs a `KeyProvider`.
 *
 * §7.5.3's third condition is that swapping the provider is *a module, not a
 * refactor*. That is not a property of the interface — an interface with six
 * construction sites is still an interface — it is a property of the call
 * graph, and the only way to keep it is to assert it.
 *
 * The scan is over every workspace, discovered from the filesystem rather than
 * listed. `packages/policy`, `packages/tools` and `apps/runtime` will each have
 * a reason to want a provider before this plan is finished, and each of them
 * will be scanned on the day its directory exists, by nobody doing anything.
 * That is B4's lesson applied a second time: a fence whose coverage is a
 * hand-maintained list fails by omission, which is the quietest way for a fence
 * to fail.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

function discoverRoots(): { name: string; dir: string }[] {
  const found: { name: string; dir: string }[] = [];
  for (const group of ['apps', 'packages']) {
    const groupDir = join(REPO_ROOT, group);
    if (!existsSync(groupDir)) continue;
    for (const workspace of readdirSync(groupDir, { withFileTypes: true })) {
      if (!workspace.isDirectory()) continue;
      const dir = join(groupDir, workspace.name, 'src');
      if (!existsSync(dir)) continue;
      found.push({ name: `${group}/${workspace.name}/src`, dir });
    }
  }
  return found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

const ROOTS = discoverRoots();

/** Comments stripped: this file's own prose names every pattern below. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function sources(): { path: string; text: string }[] {
  return ROOTS.flatMap(({ name, dir }) =>
    readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .filter((rel) => rel.endsWith('.ts') || rel.endsWith('.tsx'))
      .map((rel) => ({ path: `${name}/${rel}`, text: code(readFileSync(join(dir, rel), 'utf8')) })),
  );
}

/**
 * Constructing a provider, in the shapes it could be written.
 *
 * `new EnvMasterKeyProvider(` is the one that exists. `new KmsKeyProvider(` and
 * the generic `KeyProvider(` form are matched now, before either is written,
 * for the same reason the agent-key label is in the closed set before there is
 * a key: a detector added after the thing it detects has already let one
 * through.
 */
const CONSTRUCTS_A_PROVIDER = /new\s+\w*(?:MasterKey|Kms|Key)Provider\s*\(/;

/** The one module permitted to. */
const CONSTRUCTION_SITE = 'packages/custody/src/provider.ts';

/**
 * The class's own definition file, which necessarily contains its name.
 *
 * Excluded by path, and the assertion below proves it is really there so the
 * exclusion cannot be quietly covering an empty scan.
 */
const DEFINITION = 'packages/custody/src/env-master-key.ts';

describe('the scan is looking at something', () => {
  it('discovered every workspace that exists today', () => {
    const names = ROOTS.map(({ name }) => name);
    expect(names).toContain('apps/web/src');
    expect(names).toContain('packages/custody/src');
    expect(names).toContain('packages/chain/src');
    expect(names.length).toBeGreaterThanOrEqual(5);
  });

  it('reads the construction site and the definition', () => {
    const paths = sources().map(({ path }) => path);
    expect(paths).toContain(CONSTRUCTION_SITE);
    expect(paths).toContain(DEFINITION);
  });
});

describe('exactly one module constructs a KeyProvider', () => {
  it('finds it, and finds only it', () => {
    const sites = sources()
      .filter(({ path }) => path !== DEFINITION)
      .filter(({ text }) => CONSTRUCTS_A_PROVIDER.test(text))
      .map(({ path }) => path);

    // If this fails with a second entry: take the provider as a parameter
    // instead. A module that constructs one has an opinion about which one, and
    // §7.5.3's promise that swapping it is a module rather than a refactor is
    // only true while there is one place to change.
    expect(sites).toEqual([CONSTRUCTION_SITE]);
  });

  it('is not passing because the pattern matches nothing', () => {
    // The non-vacuity half. A regex that had quietly stopped matching would
    // make the assertion above pass forever, and would do it on the day someone
    // renamed the class.
    for (const sample of [
      'return new EnvMasterKeyProvider({ masterKeyBase64 });',
      'const p = new KmsKeyProvider(config)',
      'new  KeyProvider ()',
    ]) {
      expect(CONSTRUCTS_A_PROVIDER.test(sample), sample).toBe(true);
    }
    // And does not fire on using one, which is what every other module does.
    for (const sample of [
      'function sign(provider: KeyProvider) {}',
      'await provider.unwrapDataKey(wrapped)',
      'import type { KeyProvider } from "@limen/custody";',
    ]) {
      expect(CONSTRUCTS_A_PROVIDER.test(sample), sample).toBe(false);
    }
  });
});

describe('the environment is read in one place too', () => {
  it('has no other module reading the master key variable', () => {
    // The same argument one level down. A provider constructed in one place but
    // configured from three is not a module you can swap either — and this is
    // the variable whose disclosure is the one row in §7.5.3's threat table
    // where the env-var provider loses.
    const readers = sources()
      .filter(({ text }) => /LIMEN_MASTER_KEY/.test(text))
      .map(({ path }) => path);
    expect(readers).toEqual([CONSTRUCTION_SITE]);
  });
});
