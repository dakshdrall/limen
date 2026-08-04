/**
 * The local key announces itself, or the build fails.
 *
 * V3 hands a reviewer without a wallet an ed25519 keypair generated in their
 * own browser and kept in browser storage. That is a deliberate narrowing of
 * design rule 3, which used to forbid a user secret reaching browser storage at
 * all, and the whole justification for the narrowing is that the key is
 * disposable, testnet-only, and *known to be those things by the person holding
 * it*. `TESTNET ONLY · LOCAL KEY` therefore goes on screen at the point of
 * creation and everywhere the key is used — not only in the README, and not
 * only in a comment above the function.
 *
 * **That key has not landed yet.** The scans below currently match nothing in
 * either tree; they are a tripwire, not a description of existing code. Which
 * is exactly why the detectors are tested against synthetic samples first. A
 * tripwire whose pattern has quietly stopped matching anything is
 * indistinguishable from one with nothing to match, and the difference only
 * becomes visible on the day it matters. The same argument as
 * `SIGNER_SENTINEL`: prove the check can fire before trusting that it did not.
 *
 * Scope, stated plainly, as in `caveats.test.ts`: these read source, not
 * rendered DOM. They prove the label is in the code that creates and uses the
 * key. Whether it is visible rather than clipped is a thing to look at.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

/**
 * Both trees a key could be generated in.
 *
 * PLAN-V3 §3 puts the agent signer at `packages/chain/src/signers/agent.ts`, so
 * scanning only the web app would leave the most likely landing site unwatched.
 * A module in `packages/chain` cannot render anything, but it can name the
 * label — and requiring it to means the obligation is visible at the line that
 * makes the key rather than inferred by whoever wires up the screen later.
 */
const ROOTS = [
  { name: 'apps/web/src', dir: SRC },
  { name: 'packages/chain/src', dir: fileURLToPath(new URL('../../../packages/chain/src/', import.meta.url)) },
] as const;

/** The one module the local key is expected to live in when it lands. */
const LOCAL_KEY_MODULE = 'lib/local-key.ts';

interface Source {
  /** Path relative to `src/`, so failure messages are readable. */
  path: string;
  /** Comments removed. Every scan below runs on this, never on the raw file. */
  text: string;
}

/**
 * Strips comments.
 *
 * Both halves of this rule need it. A file must not be *accused* of holding key
 * material because a paragraph of prose happens to use the word "secret" —
 * `lib/store.ts` says exactly that about the thing it deliberately does not
 * store. And a file must not be *credited* with carrying the label because the
 * label appears in a comment above the function, which is the failure this
 * whole test exists to prevent.
 *
 * `//` is only treated as a comment when it is not preceded by a colon, so a
 * `https://` inside a string does not eat the rest of its line.
 */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function sources(): Source[] {
  return ROOTS.flatMap(({ name, dir }) =>
    readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .filter((rel) => rel.endsWith('.ts') || rel.endsWith('.tsx'))
      .map((rel) => ({ path: `${name}/${rel}`, text: code(readFileSync(join(dir, rel), 'utf8')) })),
  );
}

/**
 * Making a keypair, in the shapes this project could plausibly make one: the
 * Stellar SDK's own generator, a raw seed fed to it, WebCrypto's Ed25519, node
 * crypto, and tweetnacl. Deliberately not `Keypair.fromSecret` — reading a key
 * that was configured elsewhere is what the server-side demo signer does, and
 * it is not the act this rule is about.
 *
 * No `g` flag anywhere below: a global regex carries `lastIndex` between calls
 * and would skip files on alternate tests.
 */
const GENERATES_A_KEY =
  /Keypair\.random\s*\(|fromRawEd25519Seed\s*\(|subtle\.generateKey\s*\(|generateKeyPair(?:Sync)?\s*\(|sign\.keyPair\s*\(/;

/** Putting something in storage that survives a reload. */
const TOUCHES_BROWSER_STORAGE = /\b(?:localStorage|sessionStorage|indexedDB)\b/;

/** …and calling it something that means "key material". */
const NAMES_A_SECRET = /\b(?:secret|seed|privateKey|Keypair|signingKey)\b/i;

/** The label, either as the literal or as the shared constant. */
const CARRIES_THE_LABEL = /TESTNET ONLY · LOCAL KEY|LOCAL_KEY_LABEL/;

/** An import of the local key module, by alias or by relative path. */
const IMPORTS_THE_LOCAL_KEY_MODULE = /from\s+'(?:@\/lib\/local-key|(?:\.\.?\/)+(?:lib\/)?local-key)'/;

/** The label reaching a screen, rather than sitting in a string somewhere. */
const RENDERS_THE_LABEL = /<StatusLabel\b[\s\S]{0,80}?(?:LOCAL_KEY_LABEL|TESTNET ONLY · LOCAL KEY)/;

describe('the detectors can fire', () => {
  it('recognises the shapes browser keygen is likely to take', () => {
    for (const sample of [
      'const kp = Keypair.random();',
      'Keypair.fromRawEd25519Seed(crypto.getRandomValues(new Uint8Array(32)))',
      "await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign'])",
      "generateKeyPairSync('ed25519')",
      'const pair = nacl.sign.keyPair();',
    ]) {
      expect(GENERATES_A_KEY.test(sample), sample).toBe(true);
    }
  });

  it('does not fire on code that merely reads a key configured elsewhere', () => {
    for (const sample of [
      'keypair = Keypair.fromSecret(secret);',
      'const address = keypair.publicKey();',
      "nativeToScVal(destination, { type: 'address' })",
    ]) {
      expect(GENERATES_A_KEY.test(sample), sample).toBe(false);
    }
  });

  it('recognises key material going into browser storage', () => {
    const sample = "window.localStorage.setItem('limen.agent', keypair.secret());";
    expect(TOUCHES_BROWSER_STORAGE.test(sample) && NAMES_A_SECRET.test(sample)).toBe(true);
  });

  it('does not fire on storage that holds no key', () => {
    const sample = "localStorage.setItem('limen.theme', 'blueprint');";
    expect(TOUCHES_BROWSER_STORAGE.test(sample) && NAMES_A_SECRET.test(sample)).toBe(false);
  });

  it('recognises the label in both the forms a file may carry it', () => {
    expect(CARRIES_THE_LABEL.test("<StatusLabel name={LOCAL_KEY_LABEL} weight='loud' />")).toBe(true);
    expect(CARRIES_THE_LABEL.test("<StatusLabel name='TESTNET ONLY · LOCAL KEY' />")).toBe(true);
    expect(CARRIES_THE_LABEL.test("<StatusLabel name='TESTNET ONLY' />")).toBe(false);
  });

  it('recognises an import of the local key module however it is spelled', () => {
    for (const sample of [
      "import { createLocalKey } from '@/lib/local-key';",
      "import { createLocalKey } from '../lib/local-key';",
      "import { createLocalKey } from './local-key';",
    ]) {
      expect(IMPORTS_THE_LOCAL_KEY_MODULE.test(sample), sample).toBe(true);
    }
    expect(IMPORTS_THE_LOCAL_KEY_MODULE.test("import { NETWORK } from '@/lib/network';")).toBe(false);
  });

  it('reads code, so prose can neither accuse a file nor excuse one', () => {
    // The accusing half: `lib/store.ts` explains at length that it stores
    // nothing secret, and must not be read as storing something secret.
    expect(NAMES_A_SECRET.test(code('/* nothing secret is keyed by it */'))).toBe(false);
    // The excusing half: a label in a comment is the exact thing this file
    // exists to reject.
    expect(CARRIES_THE_LABEL.test(code('// labelled TESTNET ONLY · LOCAL KEY\nKeypair.random();'))).toBe(
      false,
    );
    expect(GENERATES_A_KEY.test(code('// never call Keypair.random() here'))).toBe(false);
    // And a URL is not a comment.
    expect(code("const u = 'https://stellar.expert/x';")).toContain('stellar.expert/x');
  });

  it('recognises the label being rendered rather than only mentioned', () => {
    expect(RENDERS_THE_LABEL.test('<StatusLabel name={LOCAL_KEY_LABEL} weight="loud" />')).toBe(true);
    // A constant assigned and never rendered is the failure this distinguishes.
    expect(RENDERS_THE_LABEL.test('const label = LOCAL_KEY_LABEL;')).toBe(false);
  });
});

describe('the label exists once, in the closed set', () => {
  const statusLabel = readFileSync(join(SRC, 'components/StatusLabel.tsx'), 'utf8');

  it('is a member of STATUS_LABELS, not a string a screen invented', () => {
    expect(statusLabel).toContain("'TESTNET ONLY · LOCAL KEY'");
    expect(statusLabel).toContain('export const LOCAL_KEY_LABEL');
    // The set stays closed; a label that can be widened at a call site is not a
    // guarantee about wording.
    expect(statusLabel).toContain('} as const;');
  });

  it('says the three things that make the narrowing defensible', () => {
    // Testnet, local-only, and disposable. Drop any one and the label stops
    // justifying a user secret sitting in browser storage.
    const description = /'TESTNET ONLY · LOCAL KEY':\s*\n?\s*'([^']*)'/.exec(statusLabel)?.[1] ?? '';
    expect(description).toContain('testnet');
    expect(description).toContain('generated in this browser and kept in this browser');
    expect(description).toContain('never reaches a Limen server');
    expect(description).toContain('clearing site data destroys it');
  });

  it('is exactly one label, not two spellings drifting apart', () => {
    const occurrences = [...statusLabel.matchAll(/TESTNET ONLY · LOCAL KEY/g)];
    expect(occurrences).toHaveLength(2); // the set's key, and the constant
  });
});

describe('nothing generates or stores a key without saying what it is', () => {
  it('labels every file under src/ that generates a keypair', () => {
    const unlabelled = sources()
      .filter(({ text }) => GENERATES_A_KEY.test(text) && !CARRIES_THE_LABEL.test(text))
      .map(({ path }) => path);

    // If this fails: the key generation landed without its label. Import
    // `LOCAL_KEY_LABEL` from `components/StatusLabel` and render it where the
    // key is created. Deleting this test is not the fix.
    expect(unlabelled).toEqual([]);
  });

  it('labels every file under src/ that puts key material in browser storage', () => {
    const unlabelled = sources()
      .filter(
        ({ text }) =>
          TOUCHES_BROWSER_STORAGE.test(text) && NAMES_A_SECRET.test(text) && !CARRIES_THE_LABEL.test(text),
      )
      .map(({ path }) => path);

    expect(unlabelled).toEqual([]);
  });
});

describe('the label follows the key wherever it is used', () => {
  const moduleLanded = existsSync(join(SRC, LOCAL_KEY_MODULE));

  it('labels every file that imports the local key module', () => {
    // Runs whether or not the module exists: an importer of a module at this
    // path is caught either way, and a module that lands at some other path is
    // still caught by the generation scan above.
    const unlabelled = sources()
      .filter(({ text }) => IMPORTS_THE_LOCAL_KEY_MODULE.test(text) && !CARRIES_THE_LABEL.test(text))
      .map(({ path }) => path);

    expect(unlabelled).toEqual([]);
  });

  it('puts the label on a screen once the key can be created', () => {
    if (!moduleLanded) {
      // Nothing to check yet, and saying so beats a silently skipped test.
      expect(moduleLanded).toBe(false);
      return;
    }

    const rendered = sources().filter(({ text }) => RENDERS_THE_LABEL.test(text));
    // A label that only ever exists as a constant is the README failure mode
    // wearing a different hat.
    expect(rendered.length).toBeGreaterThan(0);
  });
});
