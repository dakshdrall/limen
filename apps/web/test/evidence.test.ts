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

import { readFileSync } from 'node:fs';
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
  denyAxisSurvey: {
    liveRuleInstallTx: string;
    shortRuleInstallTx: string;
    axes: { ledger: string; hash?: string }[];
  };
};

const landing = readFileSync(fileURLToPath(new URL('../src/app/page.tsx', import.meta.url)), 'utf8');

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
    ]);
    expect(EVIDENCE.chain.contextRulesInstalled).toBe(installs.size);
  });

  it('counts every smart account written to, not only the first one', () => {
    // Also hand-listed, and for the same reason the installs are. The
    // generator used to read this off the walkthrough alone, which was correct
    // for exactly as long as there was one account: the V4 chain run deployed
    // its own and the figure would have kept saying "1" with nothing to show it
    // had stopped looking.
    const accounts = new Set([recorded.walkthrough.smartAccount, recorded.v4ChainRun.smartAccount]);
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
    expect(EVIDENCE.tests.suites).toHaveLength(3);
  });

  it('covers all three workspaces, so a suite cannot be dropped and go unnoticed', () => {
    const workspaces = EVIDENCE.tests.suites.map((suite) => suite.workspace);
    expect(new Set(workspaces)).toEqual(new Set(['@limen/core', '@limen/chain', '@limen/web']));
  });
});

describe('the landing reads the numbers rather than restating them', () => {
  it('renders every figure through EVIDENCE', () => {
    expect(landing).toContain("from '@/lib/evidence'");
    // The failure this guards is a single hand-typed digit appearing beside six
    // generated ones, wearing the same typeface and carrying none of the same
    // guarantee. Every `value` prop on this page — a stat tile's figure, an
    // address — is an expression, so a string literal in that slot is the
    // regression.
    const typed = [...landing.matchAll(/\bvalue="([^"]*)"/g)].map(([, literal]) => literal);
    expect(typed, `values typed into the landing rather than read: ${typed.join(' | ')}`).toEqual([]);
  });

  it('reads its hashes and caps from the recording', () => {
    expect(landing).toContain('RECORDED_RUN');
    expect(landing).toContain('RECORDED_DERIVATION');
    // Nothing that looks like a transaction hash or a strkey is typed in.
    expect(landing).not.toMatch(/[0-9a-f]{64}/);
    expect(landing).not.toMatch(/\b[CG][A-Z2-7]{55}\b/);
  });
});
