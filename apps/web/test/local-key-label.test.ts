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
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * Every workspace, discovered — not a list somebody has to remember to extend.
 *
 * This was two hand-written entries, `apps/web/src` and `packages/chain/src`,
 * and the second was added only because PLAN-V3 happened to say where the agent
 * signer would land. That is the shape of a fence that fails by omission: it
 * catches a key generated in a directory somebody thought of, and says nothing
 * about one generated in a directory somebody added later.
 *
 * PLAN-V8 makes that concrete rather than hypothetical. Its §3 answer puts a
 * server-side keygen in a **new** package — `packages/custody` — which under
 * the old list would have landed outside every fence in this repository with
 * nothing going red. The generation scan, the storage scan and the import scan
 * would all have passed by not looking.
 *
 * So the roots are read off the filesystem: every `apps/*​/src` and every
 * `packages/*​/src` that exists. A new workspace is scanned the day it is
 * created, by nobody doing anything. `the scan covers every workspace` below
 * asserts the discovery is non-empty and still finds the two that were listed
 * by hand, so a broken glob fails loudly instead of quietly scanning nothing.
 */
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

/**
 * Making or using a passkey.
 *
 * V7 §5.4 adds a second owner path, and the rule above does not reach it: a
 * passkey's private half never exists in this application, so nothing in
 * `lib/passkey.ts` calls `Keypair.random()` or puts key material in storage.
 * `GENERATES_A_KEY` would have passed it in silence.
 *
 * The plan is explicit that this is not good enough — the tripwire is "extended
 * deliberately to cover the new module rather than being satisfied by the
 * passkey path simply not matching its detectors". A rule that holds because
 * the thing it watches does not resemble it is not a rule.
 *
 * So the passkey gets its own detector, written against its own API. The
 * obligation is the same in shape and different in content: a passkey is not
 * the design-rule-3 narrowing a local key is, so its label is not a warning —
 * it is the answer to *which* owner path this account took, which a person must
 * be able to see rather than infer.
 *
 * `subtle.importKey` and `subtle.exportKey` are deliberately absent: reading a
 * public key back into a usable shape is not creating or using a credential,
 * and `GENERATES_A_KEY` already covers `subtle.generateKey`.
 */
const USES_A_PASSKEY = /navigator\.credentials\.(?:create|get)\s*\(|PublicKeyCredential\b/;

/** The passkey's label, as the literal or as the shared constant. */
const CARRIES_THE_PASSKEY_LABEL = /TESTNET ONLY · PASSKEY|PASSKEY_LABEL/;

/**
 * The agent key's label, for a key that does not exist yet.
 *
 * PLAN-V8 B4, part two. Part one — discovering the scan roots instead of
 * listing them — landed in M0, and closed the half of the hole where a new
 * `packages/custody/src` would simply not be looked at. This is the other half:
 * when that directory does get written, the label it must carry has to already
 * exist, or the first server-side keygen has nothing to name.
 *
 * **Carrying the wrong one is a failure, not a near miss.** A server-held key
 * that satisfied the tripwire by rendering `TESTNET ONLY · LOCAL KEY` would
 * make this fence the source of a false statement about where a key lives —
 * the safety mechanism producing the lie — which is strictly worse than the key
 * being unlabelled, because an unlabelled key is caught here and a mislabelled
 * one is caught by nobody.
 *
 * So the two detectors are written not to overlap, and that is asserted in both
 * directions below against synthetic samples. The samples are the whole point
 * at M1: nothing in the tree carries this label yet, so a rule tested only
 * against real files would be vacuous and would stay vacuous until the day it
 * mattered. Same argument the local key's detectors were written under when
 * they matched nothing either.
 */
const CARRIES_THE_AGENT_KEY_LABEL = /TESTNET ONLY · AGENT KEY \(LIMEN-HELD\)|AGENT_KEY_LABEL/;

/**
 * A label constant reached under a name that is not its own.
 *
 * Every detector in this file is a regex over source, so none of them can
 * resolve an import. That is usually fine — a string literal and a constant name
 * are equally good evidence that a file names its label — and it has exactly one
 * hole, which was found by mutating `agent-key.ts` rather than by reasoning:
 *
 *     import { LOCAL_KEY_LABEL as AGENT_KEY_LABEL } from '@limen/shared/status-labels';
 *
 * That line satisfies `CARRIES_THE_AGENT_KEY_LABEL`, because the identifier
 * `AGENT_KEY_LABEL` is right there, while every use of it renders
 * `TESTNET ONLY · LOCAL KEY`. It is the precise failure the partition exists to
 * prevent — a server-held key announcing itself as a browser key — reintroduced
 * through the one construct the partition could not see. The whole file passed
 * with that mutation in place.
 *
 * So aliasing *onto* any of the three label names is refused outright. Not
 * "aliasing onto the wrong one", which would need the import resolved to judge:
 * a label constant has one correct name and there is no legitimate reason to
 * reach it under another. Refusing the construct rather than the specific misuse
 * is what makes this checkable by a scan at all.
 */
const RENAMES_ONTO_A_LABEL =
  /\b\w+\s+as\s+(?:LOCAL_KEY_LABEL|PASSKEY_LABEL|AGENT_KEY_LABEL)\b/;

/**
 * An import of any module on the passkey path, by alias or relative path.
 *
 * Four names, not two. `identity.ts` and `use-identity.ts` landed with the
 * client wiring of `/api/auth`, and they are on this path in the way that
 * matters: `identity.ts` runs both ceremonies, through `createCredential` and
 * `assertCredential`, and a screen reaches them through the hook without ever
 * naming `passkey`. A pattern that only knew the two original spellings would
 * have let exactly the component that registers a credential — the header
 * control — carry no label, and it would have passed by not matching, which is
 * the failure this file exists to refuse.
 *
 * The direct detectors still cover `identity.ts` itself either way, since it
 * imports `@/lib/passkey`. What this extension adds is the *next* hop: whatever
 * renders the ceremony.
 */
const IMPORTS_THE_PASSKEY_MODULE =
  /(?:from|import)\s*\(?\s*'(?:@\/lib\/(?:use-)?(?:passkey|identity)|(?:\.\.?\/)+(?:lib\/)?(?:use-)?(?:passkey|identity))'/;

/**
 * An import of the local key module, by alias or by relative path.
 *
 * Both spellings, because the write screens have a reason to prefer the second:
 * `local-key.ts` reaches the Stellar SDK, so a screen that wants to keep it out
 * of its initial chunk loads it with `import()` at the moment a person acts. A
 * pattern that only understood `from '…'` would have let exactly the screens
 * that generate keys slip past the label requirement — the tripwire failing
 * open on the path most likely to take it.
 */
const IMPORTS_THE_LOCAL_KEY_MODULE =
  /(?:from|import)\s*\(?\s*'(?:@\/lib\/local-key|(?:\.\.?\/)+(?:lib\/)?local-key)'/;

/** The label reaching a screen, rather than sitting in a string somewhere. */
const RENDERS_THE_LABEL = /<StatusLabel\b[\s\S]{0,80}?(?:LOCAL_KEY_LABEL|TESTNET ONLY · LOCAL KEY)/;

describe('the scan covers every workspace, and is not scanning nothing', () => {
  it('discovers the two roots that used to be listed by hand', () => {
    const names = ROOTS.map((root) => root.name);
    expect(names).toContain('apps/web/src');
    expect(names).toContain('packages/chain/src');
  });

  it('discovers every workspace that has a src directory, including new ones', () => {
    // Read independently of `discoverRoots`, so a bug in the discovery cannot
    // agree with itself — the same argument that keeps `evaluate` separate from
    // `synthesize`.
    const expected: string[] = [];
    for (const group of ['apps', 'packages']) {
      const groupDir = join(REPO_ROOT, group);
      if (!existsSync(groupDir)) continue;
      for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
        if (entry.isDirectory() && existsSync(join(groupDir, entry.name, 'src'))) {
          expected.push(`${group}/${entry.name}/src`);
        }
      }
    }

    // If this fails after adding a workspace: nothing to fix here. It means the
    // new workspace is now scanned, which is the point — go and label whatever
    // in it generates or stores a key.
    expect(ROOTS.map((root) => root.name).sort()).toEqual(expected.sort());
  });

  it('is reading files, so an empty sweep cannot pass as a clean one', () => {
    // Every assertion below is of the form "no file matches X and fails Y". All
    // of them pass trivially against zero files, which is exactly how a fence
    // whose roots stopped resolving would report a clean bill of health.
    const scanned = sources();
    expect(scanned.length).toBeGreaterThan(50);
    expect(scanned.some(({ path }) => path === `apps/web/src/${LOCAL_KEY_MODULE}`)).toBe(true);
  });
});

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
      // Deferred, which is how a write screen keeps the SDK out of its initial
      // chunk — and would have been the way around this rule.
      "const keys = await import('@/lib/local-key');",
      "void import('../lib/local-key');",
    ]) {
      expect(IMPORTS_THE_LOCAL_KEY_MODULE.test(sample), sample).toBe(true);
    }
    expect(IMPORTS_THE_LOCAL_KEY_MODULE.test("import { NETWORK } from '@/lib/network';")).toBe(false);
    expect(IMPORTS_THE_LOCAL_KEY_MODULE.test("await import('@/lib/chain-write');")).toBe(false);
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

  it('recognises a passkey being created or used', () => {
    for (const sample of [
      'const credential = await navigator.credentials.create({ publicKey: options });',
      'await navigator.credentials.get({ publicKey: { challenge } })',
      'typeof window.PublicKeyCredential === "function"',
    ]) {
      expect(USES_A_PASSKEY.test(sample), sample).toBe(true);
    }
  });

  it('does not fire on reading a public key back, which creates no credential', () => {
    for (const sample of [
      "await crypto.subtle.importKey('spki', spki, { name: 'ECDSA' }, true, ['verify'])",
      "await crypto.subtle.exportKey('raw', key)",
      'const point = uncompressedPoint(spki);',
    ]) {
      expect(USES_A_PASSKEY.test(sample), sample).toBe(false);
    }
  });

  it('recognises the passkey label in both forms, and does not confuse the two labels', () => {
    expect(CARRIES_THE_PASSKEY_LABEL.test('<StatusLabel name={PASSKEY_LABEL} />')).toBe(true);
    expect(CARRIES_THE_PASSKEY_LABEL.test("<StatusLabel name='TESTNET ONLY · PASSKEY' />")).toBe(true);
    // The load-bearing half: the local key's label must not satisfy the
    // passkey's obligation, or a file could carry one and be credited for both.
    expect(CARRIES_THE_PASSKEY_LABEL.test('<StatusLabel name={LOCAL_KEY_LABEL} />')).toBe(false);
    expect(CARRIES_THE_LABEL.test('<StatusLabel name={PASSKEY_LABEL} />')).toBe(false);
  });

  it('keeps the three key labels from satisfying one another', () => {
    // The partition, proved before there is anything to partition. Each label
    // answers "where does this key live", and they give three different
    // answers: this browser, your device, a Limen server. A file that carried
    // one and was credited for another would be stating the wrong one of those
    // three, which is the failure mode a label is supposed to remove.
    expect(CARRIES_THE_AGENT_KEY_LABEL.test('<StatusLabel name={AGENT_KEY_LABEL} weight="loud" />')).toBe(
      true,
    );
    expect(
      CARRIES_THE_AGENT_KEY_LABEL.test("<StatusLabel name='TESTNET ONLY · AGENT KEY (LIMEN-HELD)' />"),
    ).toBe(true);

    // Neither of the two existing labels satisfies the agent key's obligation.
    expect(CARRIES_THE_AGENT_KEY_LABEL.test('<StatusLabel name={LOCAL_KEY_LABEL} />')).toBe(false);
    expect(CARRIES_THE_AGENT_KEY_LABEL.test('<StatusLabel name={PASSKEY_LABEL} />')).toBe(false);
    expect(CARRIES_THE_AGENT_KEY_LABEL.test("<StatusLabel name='TESTNET ONLY · LOCAL KEY' />")).toBe(false);

    // And the agent key's label satisfies neither of theirs. This is the
    // direction that matters most: it is the one that would let a server-held
    // key pass as a browser key.
    expect(CARRIES_THE_LABEL.test('<StatusLabel name={AGENT_KEY_LABEL} />')).toBe(false);
    expect(CARRIES_THE_PASSKEY_LABEL.test('<StatusLabel name={AGENT_KEY_LABEL} />')).toBe(false);
    expect(CARRIES_THE_LABEL.test("<StatusLabel name='TESTNET ONLY · AGENT KEY (LIMEN-HELD)' />")).toBe(
      false,
    );
  });

  it('recognises an import of any passkey-path module however it is spelled', () => {
    for (const sample of [
      "import { createPasskey } from '@/lib/passkey';",
      "import { usePasskeySigner } from '@/lib/use-passkey';",
      "import { getPasskey } from '../lib/passkey';",
      "const mod = await import('@/lib/passkey');",
      // The ceremony modules. A screen reaches the passkey through these
      // without ever spelling the word, which is the hole this closes.
      "import { registerIdentity } from '@/lib/identity';",
      "import { useIdentity } from '@/lib/use-identity';",
      "import { signIn } from '../lib/identity';",
    ]) {
      expect(IMPORTS_THE_PASSKEY_MODULE.test(sample), sample).toBe(true);
    }
    expect(IMPORTS_THE_PASSKEY_MODULE.test("import { NETWORK } from '@/lib/network';")).toBe(false);
    // Not every module whose name contains the word: the rule is about the two
    // ceremony modules, not about anything a future file might call identity.
    expect(IMPORTS_THE_PASSKEY_MODULE.test("import { x } from '@/lib/identity-provider';")).toBe(false);
  });

  it('recognises a label constant being reached under a name that is not its own', () => {
    // The mutation that got through. Each of these renders one label while
    // satisfying another label's detector by identifier alone.
    for (const sample of [
      "import { LOCAL_KEY_LABEL as AGENT_KEY_LABEL } from '@limen/shared/status-labels';",
      "import { AGENT_KEY_LABEL as LOCAL_KEY_LABEL } from '@limen/shared/status-labels';",
      'import { PASSKEY_LABEL as LOCAL_KEY_LABEL } from "@limen/shared/status-labels";',
    ]) {
      expect(RENAMES_ONTO_A_LABEL.test(sample), sample).toBe(true);
    }
    // And does not fire on the honest import, or on aliasing something that is
    // not a label.
    for (const sample of [
      "import { AGENT_KEY_LABEL } from '@limen/shared/status-labels';",
      "import { LOCAL_KEY_LABEL, PASSKEY_LABEL } from '@limen/shared/status-labels';",
      "import { Keypair as StellarKeypair } from '@stellar/stellar-sdk';",
    ]) {
      expect(RENAMES_ONTO_A_LABEL.test(sample), sample).toBe(false);
    }
  });

  it('recognises the label being rendered rather than only mentioned', () => {
    expect(RENDERS_THE_LABEL.test('<StatusLabel name={LOCAL_KEY_LABEL} weight="loud" />')).toBe(true);
    // A constant assigned and never rendered is the failure this distinguishes.
    expect(RENDERS_THE_LABEL.test('const label = LOCAL_KEY_LABEL;')).toBe(false);
  });
});

describe('the label exists once, in the closed set', () => {
  // The closed set has moved twice, and the rule has not changed either time —
  // only the file it reads.
  //
  // V6 moved it from `components/StatusLabel.tsx` to `lib/status-labels.ts`,
  // because `lib/local-key.ts` imported the constant from the component layer
  // and this safety rule was therefore resting on a component file continuing
  // to exist — which the rebuild disproved on its first build.
  //
  // V8 M1 moved it again, out of `apps/web` and into `packages/shared`. The
  // reason is the same shape one level up: `apps/web` is about to stop being
  // the only surface that states a limit to a person, and a closed set living
  // inside one of the things it constrains is closed by convention rather than
  // by construction. Reading it from outside `SRC` is the point — this test is
  // in `apps/web` and the vocabulary no longer is.
  const SHARED = fileURLToPath(new URL('../../../packages/shared/src/', import.meta.url));
  const statusLabel = readFileSync(join(SHARED, 'status-labels.ts'), 'utf8');

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

  it('has the passkey label in the same closed set, with its own constant', () => {
    expect(statusLabel).toContain("'TESTNET ONLY · PASSKEY'");
    expect(statusLabel).toContain('export const PASSKEY_LABEL');
    const occurrences = [...statusLabel.matchAll(/TESTNET ONLY · PASSKEY/g)];
    expect(occurrences).toHaveLength(2); // the set's key, and the constant
  });

  it('has the agent key label in the same closed set, with its own constant', () => {
    expect(statusLabel).toContain("'TESTNET ONLY · AGENT KEY (LIMEN-HELD)'");
    expect(statusLabel).toContain('export const AGENT_KEY_LABEL');
    const occurrences = [...statusLabel.matchAll(/TESTNET ONLY · AGENT KEY \(LIMEN-HELD\)/g)];
    expect(occurrences).toHaveLength(2); // the set's key, and the constant
  });

  it('says where the agent key lives, which is the only thing it is for', () => {
    // This label's entire job is to not be mistaken for the local key's. Drop
    // "on a Limen server and kept there" and it becomes a label that could
    // describe either, at which point there was no reason to have two.
    const description =
      /'TESTNET ONLY · AGENT KEY \(LIMEN-HELD\)':\s*\n?\s*'([^']*)'/.exec(statusLabel)?.[1] ?? '';
    expect(description).toContain('generated on a Limen server and kept there, encrypted');
    expect(description).toContain('It is not in your browser and you never see it');
    expect(description).toContain('rather than by Limen');
  });

  it('is carried by the module that generates the server-held key, and only there', () => {
    // This assertion was inverted by hand at M2, which is what its M1 form
    // asked for in as many words: *"The day `packages/custody` lands, this
    // assertion is what has to be changed by hand — which is the point. It
    // cannot be satisfied by nobody looking."*
    //
    // At M1 it read `expect(carriers).toEqual([])` — the label was in the
    // closed set and nothing carried it, and that emptiness was asserted rather
    // than tolerated so the vacuous state was visible. The key now exists, so
    // the same question has a different correct answer and the test states it
    // positively: `agent-key.ts` carries the label, because that is the file
    // that calls `Keypair.random()` on a server.
    //
    // Kept as an exact list rather than a `toContain`. A second carrier is a
    // second place a server-held key is made or handled, and it should have to
    // be added here deliberately — the same reason the closed set is closed.
    // The definition is excluded because it *defines* the label and necessarily
    // contains it, and the assertion below proves the exclusion is not covering
    // an empty scan.
    const definition = 'packages/shared/src/status-labels.ts';
    const carriers = sources()
      .filter(({ text }) => CARRIES_THE_AGENT_KEY_LABEL.test(text))
      .map(({ path }) => path)
      .filter((path) => path !== definition);
    expect(carriers).toEqual(['packages/custody/src/agent-key.ts']);

    // And the exclusion is not silently covering an empty scan: the definition
    // really is there to be excluded.
    expect(sources().map(({ path }) => path)).toContain(definition);
  });

  it('is not satisfied by aliasing another label onto its name, anywhere', () => {
    // The scan-wide form of the hole above. A file that renames any binding onto
    // a label's name is credited for a label it does not render, and that is
    // true in both directions and for all three labels — so the construct is
    // refused everywhere rather than only in `packages/custody`.
    const aliased = sources()
      .filter(({ text }) => RENAMES_ONTO_A_LABEL.test(text))
      .map(({ path }) => path);

    // If this fails: import the label under its own name. There is no case
    // where reaching one of these three constants under a different name is
    // correct, and the one that motivated this test made a server-held key
    // announce itself as a browser key while every other assertion passed.
    expect(aliased).toEqual([]);
  });

  it('is carried in code rather than in the prose explaining it', () => {
    // The excusing half, checked against the real file rather than a sample.
    // `agent-key.ts` has a long header that names the label repeatedly, and a
    // scan that credited a file for its comments would be satisfied by that
    // header alone — which would let the actual `Keypair.random()` call sit in
    // an unlabelled file.
    const raw = readFileSync(
      join(REPO_ROOT, 'packages/custody/src/agent-key.ts'),
      'utf8',
    );
    expect(CARRIES_THE_AGENT_KEY_LABEL.test(code(raw))).toBe(true);
  });

  it('says what a passkey does not do, not only what it does', () => {
    // The whole risk of this label is that it reads as "your keys are safe
    // now". A passkey cannot pay a Stellar fee and cannot be handed to an
    // agent, so a passkey account still has local keys doing both — and the
    // description has to carry that or it is reassurance.
    const description = /'TESTNET ONLY · PASSKEY':\s*\n?\s*'([^']*)'/.exec(statusLabel)?.[1] ?? '';
    expect(description).toContain('testnet');
    expect(description).toContain('never by this browser');
    expect(description).toContain('survives clearing site data');
    expect(description).toContain('cannot pay a fee or act as the agent');
  });
});

describe('the passkey announces itself too', () => {
  it('labels every file that creates or uses a passkey', () => {
    const unlabelled = sources()
      .filter(({ text }) => USES_A_PASSKEY.test(text) && !CARRIES_THE_PASSKEY_LABEL.test(text))
      .map(({ path }) => path);

    // If this fails: the passkey path landed without its label. Import
    // `PASSKEY_LABEL` from `@limen/shared/status-labels` and name it where the credential
    // is created or used. Deleting this test is not the fix.
    expect(unlabelled).toEqual([]);
  });

  it('labels every file that imports a passkey module', () => {
    const unlabelled = sources()
      .filter(({ text }) => IMPORTS_THE_PASSKEY_MODULE.test(text) && !CARRIES_THE_PASSKEY_LABEL.test(text))
      .map(({ path }) => path);

    expect(unlabelled).toEqual([]);
  });

  it('is not vacuous: something under src/ actually uses a passkey', () => {
    // The `browserRun`-style guard. A scan that matches nothing passes forever
    // and proves nothing, and the day the passkey path is deleted or renamed is
    // exactly the day this must say so rather than stay quiet.
    const users = sources().filter(({ text }) => USES_A_PASSKEY.test(text));
    expect(users.length).toBeGreaterThan(0);
  });

  it('says both halves of the caveat wherever the passkey is offered', () => {
    // PLAN-V7 §5.4: the gain goes on screen and so does its limit, in the same
    // words in both places. The first sentence without the second is the
    // reassurance this project exists not to give, so the constants are checked
    // to travel together rather than one being rendered alone.
    const offering = sources().filter(({ text }) => /PASSKEY_KEEPS_ACCOUNT/.test(text));
    expect(offering.length).toBeGreaterThan(0);
    for (const { path, text } of offering) {
      expect(/PASSKEY_STILL_LOCAL/.test(text), `${path} states the gain without the limit`).toBe(
        true,
      );
    }
  });
});

/**
 * Where a key is generated decides which label it must carry.
 *
 * Through M1 this scan asked one question — does a file that makes a keypair
 * carry `LOCAL_KEY_LABEL` — and that was right while every key in the
 * repository was made in a browser. M2 makes one that is not: `packages/custody`
 * generates an ed25519 key on a Limen server and keeps it there.
 *
 * The old rule could not be satisfied by that file without stating something
 * false. `CARRIES_THE_LABEL` matches only the local key's label, and the
 * partition asserted above is explicit that the agent key's label must not
 * satisfy it — so `agent-key.ts` had exactly two options: carry
 * `TESTNET ONLY · LOCAL KEY` for a key that is not in anybody's browser, or
 * fail. The first is the failure this whole file exists to prevent, described
 * in `status-labels.ts` as the fence producing the lie.
 *
 * So the scan asks the location first and the label second. `packages/custody`
 * is where a server-held key is generated and it owes `AGENT_KEY_LABEL`;
 * everywhere else is a browser tree and owes `LOCAL_KEY_LABEL`. Neither
 * satisfies the other, which is asserted above against synthetic samples and is
 * what makes this a partition rather than a widening.
 *
 * A third location will need a third entry, and it will fail loudly here rather
 * than defaulting: an unlisted tree falls through to the browser rule, which a
 * server-side key cannot satisfy.
 */
const SERVER_KEY_TREE = 'packages/custody/src/';

/** The obligation a file incurs by generating a key, given where it lives. */
function labelOwedBy(path: string): {
  carries: RegExp;
  owed: string;
  because: string;
} {
  return path.startsWith(SERVER_KEY_TREE)
    ? {
        carries: CARRIES_THE_AGENT_KEY_LABEL,
        owed: 'AGENT_KEY_LABEL',
        because: 'it generates a key on a Limen server',
      }
    : {
        carries: CARRIES_THE_LABEL,
        owed: 'LOCAL_KEY_LABEL',
        because: 'it generates a key in a browser',
      };
}

describe('nothing generates or stores a key without saying what it is', () => {
  it('labels every file under src/ that generates a keypair, with the label its location owes', () => {
    const unlabelled = sources()
      .filter(({ text }) => GENERATES_A_KEY.test(text))
      .filter(({ path, text }) => !labelOwedBy(path).carries.test(text))
      .map(({ path }) => {
        const { owed, because } = labelOwedBy(path);
        return `${path} (owes ${owed}, because ${because})`;
      });

    // If this fails: the key generation landed without its label, or with the
    // wrong one. Import the label named in the failure from
    // `@limen/shared/status-labels` and name it where the key is created.
    // Carrying the other one is not a near miss — it is a false statement about
    // where the key lives. Deleting this test is not the fix.
    expect(unlabelled).toEqual([]);
  });

  it('is not vacuous in either location: both kinds of keygen exist and are scanned', () => {
    // The `browserRun`-style guard, and it has to name both halves now. A scan
    // that had quietly stopped matching the server tree would pass forever and
    // would do it on the day somebody moved `agent-key.ts`.
    const generators = sources().filter(({ text }) => GENERATES_A_KEY.test(text));
    const inBrowser = generators.filter(({ path }) => !path.startsWith(SERVER_KEY_TREE));
    const onServer = generators.filter(({ path }) => path.startsWith(SERVER_KEY_TREE));

    expect(inBrowser.length).toBeGreaterThan(0);
    expect(onServer.length).toBeGreaterThan(0);
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

  it('puts the label on a screen once a screen can create a key', () => {
    expect(moduleLanded).toBe(true);

    /**
     * The obligation attaches to the rendering surface that can create a key,
     * and during the V6 rebuild there is not one yet — every screen was deleted
     * in step 1 and the key-creating screen returns in step 5.
     *
     * The V5 form of this keyed off the *module* existing, which made it fail
     * for the whole rebuild. Keying off a screen that imports the module is the
     * same rule stated against the thing that actually incurs the obligation:
     * it is vacuous only while no screen can create a key, and it goes live by
     * itself the moment one does. It is not weaker in the end state.
     *
     * The count is asserted rather than the emptiness tolerated silently, so
     * the transition from "no such screen" to "a screen that must be labelled"
     * is visible in the diff of this file's expectations rather than invisible.
     */
    const keyCreatingScreens = sources().filter(
      ({ path, text }) => path.endsWith('.tsx') && IMPORTS_THE_LOCAL_KEY_MODULE.test(text),
    );

    if (keyCreatingScreens.length === 0) return;

    const rendered = sources().filter(({ text }) => RENDERS_THE_LABEL.test(text));
    // A label that only ever exists as a constant is the README failure mode
    // wearing a different hat.
    expect(rendered.length).toBeGreaterThan(0);
  });
});
