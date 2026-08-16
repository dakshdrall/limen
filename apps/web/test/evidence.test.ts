/**
 * The generated numbers, checked against what they claim to be derived from.
 *
 * `scripts/evidence.mjs` writes `src/generated/evidence.json`, and
 * `npm run evidence:check` — a CI step — proves the committed copy still
 * matches a regeneration. That guarantees freshness and nothing else: a
 * generator with a wrong definition of "transactions recorded" would pass its
 * own check forever, because it would be comparing itself to itself.
 *
 * So these tests re-derive the chain figures here, independently and from the
 * deployments file, and assert the two agree. The definitions are deliberately
 * spelled differently from the generator's — counted against a `grep`-able
 * regular expression, or against a hand-listed set of keys — because two
 * implementations that agree are evidence and one implementation quoted twice
 * is not. It is the same argument that keeps `evaluate` separate from
 * `synthesize`.
 *
 * What is not checked here is the test totals, and the reason is worth
 * recording: a suite cannot count itself without changing the number it is
 * counting. Those come from the run, and `--check` is what keeps them current.
 */

import { type Dirent, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EVIDENCE } from '../src/lib/evidence';

const recordedText = readFileSync(
  fileURLToPath(new URL('../../../packages/chain/deployments/testnet.json', import.meta.url)),
  'utf8',
);
const recorded = JSON.parse(recordedText) as {
  network: string;
  recordedAt: string;
  uploads: Record<string, string>;
  walkthrough: { smartAccount: string; installTx: string; firstRun: { installTx: string } };
  v4ChainRun: { smartAccount: string; installTx: string };
  browserRun: { runs: { smartAccount: string; installTx: string }[] };
  webauthnRun: {
    smartAccount: string;
    browserRun: { smartAccount: string; installTx: string };
  };
  denyAxisSurvey: {
    liveRuleInstallTx: string;
    shortRuleInstallTx: string;
    axes: { ledger: string; hash?: string }[];
  };
};

describe('the chain figures are what the deployments file says', () => {
  it('counts every distinct transaction hash in the recording', () => {
    // Independently derived: a match over the file's raw text for a 64-hex
    // value in quotes, rather than a walk of the parsed tree. A reviewer can
    // run the equivalent `grep -o` and get the same number, which is the point
    // of publishing it.
    const hashes = new Set(recordedText.match(/"[0-9a-f]{64}"/g) ?? []);
    expect(EVIDENCE.chain.transactions).toBe(hashes.size);
  });

  it('counts the WASM uploads and names the tag they were built from', () => {
    expect(EVIDENCE.chain.wasmUploads).toBe(Object.keys(recorded.uploads).length);
    expect(EVIDENCE.chain.wasmSource).toContain('OpenZeppelin/stellar-contracts');
  });

  it('counts every install transaction, including the two the survey ran against', () => {
    // Hand-listed rather than pattern-matched, because the generator's pattern
    // is exactly what went wrong the first time: `/installTx$/` is
    // case-sensitive, it missed `liveRuleInstallTx` and `shortRuleInstallTx`,
    // and it reported half the installs with no sign it had missed any.
    const installs = new Set([
      recorded.walkthrough.installTx,
      recorded.walkthrough.firstRun.installTx,
      recorded.denyAxisSurvey.liveRuleInstallTx,
      recorded.denyAxisSurvey.shortRuleInstallTx,
      recorded.v4ChainRun.installTx,
      // The browser runs, added by hand for the same reason as the rest: two
      // completions means two installs, and a list that grew by pattern would
      // have absorbed them without anyone confirming there were two.
      ...recorded.browserRun.runs.map((run) => run.installTx),
      // The passkey browser run's install, which a passkey authorized rather
      // than a local key. Listed separately because it is the one install here
      // whose owner signature came from an authenticator.
      recorded.webauthnRun.browserRun.installTx,
    ]);
    expect(EVIDENCE.chain.contextRulesInstalled).toBe(installs.size);
  });

  it('counts every smart account written to, not only the first one', () => {
    // Also hand-listed, and for the same reason the installs are. The
    // generator used to read this off the walkthrough alone, which was correct
    // for exactly as long as there was one account: the V4 chain run deployed
    // its own and the figure would have kept saying "1" with nothing to show it
    // had stopped looking.
    const accounts = new Set([
      recorded.walkthrough.smartAccount,
      recorded.v4ChainRun.smartAccount,
      // Each browser run created its own, from its own key, in its own clean
      // profile. That they are two different addresses is the evidence that the
      // second run was cold rather than a repeat against the first's account.
      ...recorded.browserRun.runs.map((run) => run.smartAccount),
      // The passkey run's account, whose owner is a secp256r1 key behind the
      // WebAuthn verifier rather than an ed25519 key. Listed separately because
      // it is the one account here no local key can sign for.
      recorded.webauthnRun.smartAccount,
      // …and the one the passkey run created through the shipped UI. A
      // different account from the script's, from a different owner key, so it
      // is a second passkey-owned account rather than a re-run against the
      // first.
      recorded.webauthnRun.browserRun.smartAccount,
    ]);
    expect(EVIDENCE.chain.smartAccounts).toBe(accounts.size);
    expect(accounts.size).toBeGreaterThan(1);
  });

  it('does not round a refusal without a decoded code up to one with', () => {
    // The load-bearing one. `onLedger` and `errorDecodedOnLedger` are different
    // claims — "the network refused it" and "the network refused it with this
    // code" — and the expiry axis is the difference between them. Folding the
    // two into one headline is exactly the flattering error this project keeps
    // refusing to make.
    const axes = recorded.denyAxisSurvey.axes;
    expect(EVIDENCE.chain.denyAxes.total).toBe(axes.length);
    expect(EVIDENCE.chain.denyAxes.onLedger).toBe(
      axes.filter((axis) => typeof axis.hash === 'string').length,
    );
    expect(EVIDENCE.chain.denyAxes.errorDecodedOnLedger).toBe(
      axes.filter((axis) => axis.ledger.includes('#')).length,
    );
    expect(EVIDENCE.chain.denyAxes.errorDecodedOnLedger).toBeLessThanOrEqual(
      EVIDENCE.chain.denyAxes.onLedger,
    );
  });

  it('states composition-only as a count of Rust files, and the count is zero', () => {
    // If this ever fails, the fix is not to change the number. It is to stop
    // saying COMPOSITION ONLY on every screen that says it.
    expect(EVIDENCE.chain.rustSourceFiles).toBe(0);
  });

  it('carries the network and the recording date from the file it derives from', () => {
    expect(EVIDENCE.chain.network).toBe(recorded.network);
    expect(EVIDENCE.chain.recordedAt).toBe(recorded.recordedAt);
  });
});

describe('the test totals are internally consistent', () => {
  it('sums the per-suite counts', () => {
    const summed = EVIDENCE.tests.suites.reduce((total, suite) => total + suite.tests, 0);
    expect(EVIDENCE.tests.total).toBe(summed);
    expect(EVIDENCE.tests.suites).toHaveLength(4);
  });

  it('covers all four workspaces, so a suite cannot be dropped and go unnoticed', () => {
    // Three until V8 M1 added `@limen/db`. The count and the names are both
    // written out on purpose: the count alone would let a suite be swapped for
    // another, and the names alone would let one be added without anybody
    // deciding to. This test going red when a workspace gains a suite is the
    // intended behaviour — the landing states these numbers, and a new suite
    // arriving in them should be a decision rather than a side effect.
    const workspaces = EVIDENCE.tests.suites.map((suite) => suite.workspace);
    expect(new Set(workspaces)).toEqual(
      new Set(['@limen/core', '@limen/chain', '@limen/db', '@limen/web']),
    );
  });
});

/**
 * Every file the README points at exists.
 *
 * This check exists because the fault it catches had already happened and had
 * survived three plans.
 *
 * `apps/web/test/caveats.test.ts` was deleted in `c034cb8`, with the rendering
 * layer whose sentences it pinned. `README.md` went on citing it in two places
 * as *"pinned in both directions by apps/web/test/caveats.test.ts"* — naming a
 * nonexistent test as the guarantee for two of the project's caveats. Every
 * suite stayed green for the whole of V6 and V7, because nothing anywhere
 * asserted that a file the README cites is a file that exists.
 *
 * `scripts/evidence.mjs` noticed the same deletion in a comment of its own and
 * the README was not updated with it, which is the detail worth keeping: the
 * information existed in the repository and did not reach the claim.
 *
 * The scan is deliberately general rather than a special case for one path. It
 * is scoped to this repository's own top-level directories, because the README
 * also cites OpenZeppelin sources — `packages/accounts/src/...` — which
 * correctly do not exist here.
 *
 * This lives in `evidence.test.ts` rather than in `caveats.test.ts` on purpose.
 * A suite cannot assert its own existence, and the specific failure being
 * guarded against is that suite being deleted again.
 */
describe('every file the README cites is a file that exists', () => {
  const README_PATH = fileURLToPath(new URL('../../../README.md', import.meta.url));
  const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

  /**
   * Backticked paths under this repository's own directories, with any trailing
   * `:12` or `:12-34` line reference stripped.
   *
   * `packages/(core|chain)` rather than `packages/`: the README quotes
   * `packages/accounts/src/smart_account/storage.rs:353` from the OpenZeppelin
   * sources to show what runs inside `__check_auth`, and that file is not in
   * this tree and is not supposed to be.
   */
  const CITATION =
    /`((?:apps|scripts)\/[A-Za-z0-9._/-]+|packages\/(?:core|chain)\/[A-Za-z0-9._/-]+)`/g;

  const cited = (): string[] => {
    const readme = readFileSync(README_PATH, 'utf8');
    const found = new Set<string>();
    for (const match of readme.matchAll(CITATION)) {
      found.add(match[1]!.replace(/:\d+(?:-\d+)?$/, ''));
    }
    return [...found].sort();
  };

  it('finds citations, so an empty scan cannot pass as a clean one', () => {
    // The same two-sided shape every negative check in `ci.yml` uses. A regex
    // that silently stopped matching would report a clean bill of health
    // forever.
    const paths = cited();
    expect(paths.length).toBeGreaterThan(5);
    expect(
      paths.some((path) => path.endsWith('.test.ts')),
      'the README cites no test file, so this check cannot catch the fault it exists for',
    ).toBe(true);
  });

  it('can fire, proven against a path that is not there', () => {
    // And that the existence check itself works, rather than being a `some()`
    // over an empty list or an `existsSync` on a path that is always true.
    expect(existsSync(join(REPO_ROOT, 'apps/web/test/caveats.test.ts'))).toBe(true);
    expect(existsSync(join(REPO_ROOT, 'apps/web/test/no-such-suite.test.ts'))).toBe(false);
  });

  it('points at nothing that has been deleted or renamed', () => {
    const missing = cited().filter((path) => !existsSync(join(REPO_ROOT, path)));

    // If this fails: the README describes a file that is not there. Either
    // restore the file or correct the sentence — but do not delete the citation
    // and leave the claim, which is how this went unnoticed for two versions.
    expect(missing).toEqual([]);
  });
});

describe('no rendered surface restates a chain value', () => {
  /**
   * The V5 form of this pinned two selector names — `RECORDED_RUN` and
   * `RECORDED_DERIVATION` — against `app/page.tsx` specifically. That coupled a
   * real guarantee to one page's structure, and PLAN-V6 deletes that structure:
   * `RECORDED_DERIVATION` was shaped to serve one worked example and does not
   * survive the rebuild.
   *
   * The guarantee is worth more than the coupling, so it is restated the way it
   * should always have been — as a property of everything that renders, not of
   * the file that happened to render it first. This is strictly stronger: it
   * held for one file before and holds for every page and component now,
   * including the V6 scenes as they arrive. A scene that types a hash in fails
   * here the commit it is written, rather than the commit somebody notices.
   *
   * What it cannot catch is a *wrong* figure read correctly from the recording.
   * That is what re-deriving the chain counts above is for.
   */
  function rendered(dir: string): [string, string][] {
    const root = new URL(`../src/${dir}/`, import.meta.url);
    let entries: Dirent[];
    try {
      entries = readdirSync(root, { withFileTypes: true });
    } catch {
      return []; // The directory need not exist yet mid-rebuild.
    }
    return entries.flatMap((entry) => {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return rendered(path);
      if (!entry.name.endsWith('.tsx')) return [];
      return [[path, readFileSync(fileURLToPath(new URL(`../src/${path}`, import.meta.url)), 'utf8')]];
    });
  }

  const surfaces = [...rendered('app'), ...rendered('components')];

  it('has surfaces to check, so an empty sweep cannot pass as a clean one', () => {
    // Without this, deleting every page would turn the two tests below green.
    expect(surfaces.length).toBeGreaterThan(0);
  });

  it.each(surfaces)('%s types in no transaction hash', (path, source) => {
    const typed = source.match(/[0-9a-f]{64}/g) ?? [];
    expect(typed, `hashes typed into ${path} rather than read: ${typed.join(' | ')}`).toEqual([]);
  });

  it.each(surfaces)('%s types in no contract or account address', (path, source) => {
    const typed = source.match(/\b[CG][A-Z2-7]{55}\b/g) ?? [];
    expect(typed, `addresses typed into ${path} rather than read: ${typed.join(' | ')}`).toEqual([]);
  });
});
