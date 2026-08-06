#!/usr/bin/env node
/**
 * The numbers on the landing page, generated rather than typed.
 *
 *     node scripts/evidence.mjs           # write apps/web/src/generated/evidence.json
 *     node scripts/evidence.mjs --check   # regenerate and fail if the file is stale
 *
 * A hand-typed count is a number that rots, and a rotted number on a page whose
 * whole subject is honesty is worse than no number at all. So every figure the
 * landing states comes from one of exactly two places, and this script is the
 * only thing that puts them in a file:
 *
 *   - the test run, by actually running the three suites; and
 *   - `packages/chain/deployments/testnet.json`, the recording of what the
 *     scripts did against live testnet.
 *
 * Nothing here counts something it cannot see. `transactions` is the number of
 * distinct 64-hex values in the deployments file, which is a definition a
 * reviewer can check with `grep` rather than a claim they have to take. Where a
 * figure has a caveat — one of the six refusals has no on-ledger error code
 * decoded — the caveat is carried in the data as its own field, not rounded
 * away into the headline.
 *
 * `--check` is what makes the file un-rottable: it regenerates into memory and
 * exits non-zero if the committed file differs, so adding a test without
 * regenerating is a red build rather than a page that quietly understates
 * itself. It re-runs the suites to do that, which costs CI a second test run.
 * That is the price of the number being true, and it is a low price.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const OUTPUT = join(root, 'apps/web/src/generated/evidence.json');
const DEPLOYMENTS = join(root, 'packages/chain/deployments/testnet.json');
const MANIFEST = join(root, 'packages/chain/src/wasm/manifest.json');

/**
 * The suites, in the order CI runs them.
 *
 * `@limen/web`'s `pretest` builds `@limen/core` and `@limen/chain` first, which
 * is why no build step appears here: running the workspaces in this order
 * compiles what the later ones import.
 */
const SUITES = [
  { workspace: '@limen/core', directory: 'packages/core', covers: 'synthesis and the deny-case harness' },
  { workspace: '@limen/chain', directory: 'packages/chain', covers: 'lowering, refusal decoding, and the auth encoding' },
  { workspace: '@limen/web', directory: 'apps/web', covers: 'extraction, ingest refusals, caveats, and the design system' },
];

const checkOnly = process.argv.includes('--check');

/**
 * Regenerate the chain figures only, keeping the committed test counts.
 *
 * This exists because the pipeline has a genuine circularity, and the choice is
 * between naming it and working around it by hand. `evidence.test.ts` re-derives
 * the chain figures independently and fails when they drift — which is exactly
 * what it is for. But a full regeneration runs the suites to count them, so the
 * moment `deployments/testnet.json` gains a run, the web suite is red and the
 * regeneration that would fix it refuses to record a count from a red suite.
 *
 * The bootstrap: `--chain-only` updates the derived chain block, the suites go
 * green, and a normal `npm run evidence` then records the counts. Editing the
 * generated file by hand would do the same thing while discarding the guarantee
 * that nothing in it is typed.
 *
 * It cannot be used to fake a test count: it never touches `tests`, and
 * `--check` still compares the whole file.
 */
const chainOnly = process.argv.includes('--chain-only');

/** Runs one workspace's suite and returns its counts. Throws if it is red. */
function runSuite({ workspace, directory, covers }, reportDirectory) {
  const report = join(reportDirectory, `${directory.replace('/', '-')}.json`);
  process.stderr.write(`evidence: running ${workspace}\n`);

  // Inherited stderr, piped stdout: vitest's own progress stays visible, and
  // the report is read from the file rather than parsed out of the stream.
  execFileSync('npm', ['run', 'test', '-w', workspace, '--', '--reporter=json', `--outputFile=${report}`], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  const result = JSON.parse(readFileSync(report, 'utf8'));
  if (result.success !== true || result.numFailedTests > 0) {
    throw new Error(`${workspace} is not green; refusing to record a passing count`);
  }
  return {
    workspace,
    covers,
    files: result.testResults.length,
    tests: result.numTotalTests,
  };
}

/** Every distinct 64-hex value anywhere in a JSON tree. */
function hashesIn(value, found = new Set()) {
  if (typeof value === 'string') {
    if (/^[0-9a-f]{64}$/.test(value)) found.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) hashesIn(item, found);
  } else if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) hashesIn(item, found);
  }
  return found;
}

/**
 * Every value under a key ending in `installTx`, at any depth.
 *
 * Case-insensitive on the first letter, because the recording spells it four
 * ways — `installTx`, and `liveRuleInstallTx` / `shortRuleInstallTx` for the
 * two rules the deny-axis survey ran against. A case-sensitive match found two
 * of the four and reported half the installs with no sign that it had missed
 * any, which is the failure mode a derived number is supposed to avoid.
 */
function installTransactions(value, found = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) installTransactions(item, found);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (/[Ii]nstallTx$/.test(key) && typeof item === 'string') found.add(item);
      else installTransactions(item, found);
    }
  }
  return found;
}

/** Every `smartAccount` value in the recording, wherever it is nested. */
function smartAccountsIn(value, found = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) smartAccountsIn(item, found);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === 'smartAccount' && typeof item === 'string') found.add(item);
      else smartAccountsIn(item, found);
    }
  }
  return found;
}

/**
 * Rust source files tracked in this repository.
 *
 * Zero, and the landing page says so — which is the composition-only claim as a
 * number rather than as an adjective. It is derived rather than typed for the
 * same reason as every other figure here: an absence is the easiest claim in
 * the world to keep stating after it stops being true, and the day someone adds
 * a `.rs` file is exactly the day the page must stop saying this.
 *
 * `git ls-files` rather than a filesystem walk, so a stray build artifact or an
 * unstaged scratch file is not counted as something this project ships.
 */
function rustSourceFiles() {
  const tracked = execFileSync('git', ['ls-files', '--', '*.rs'], { cwd: root, encoding: 'utf8' });
  return tracked.split('\n').filter((line) => line.length > 0).length;
}

function chainEvidence() {
  const recorded = JSON.parse(readFileSync(DEPLOYMENTS, 'utf8'));
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const axes = recorded.denyAxisSurvey.axes;

  return {
    network: recorded.network,
    recordedAt: recorded.recordedAt,

    /**
     * Distinct 64-hex values in the deployments file. Every one of them is a
     * transaction this repository submitted to testnet and can be opened in an
     * explorer; the contract ids and account addresses beside them are strkeys
     * and do not match, so nothing is double-counted.
     */
    transactions: hashesIn(recorded).size,

    /** Uploads of the pinned OpenZeppelin WASMs, one transaction each. */
    wasmUploads: Object.keys(recorded.uploads).length,
    wasmSource: `${manifest.source.repository.split('/').slice(-2).join('/')} ${manifest.source.tag}`,

    /** See `rustSourceFiles`. The composition-only claim, counted. */
    rustSourceFiles: rustSourceFiles(),

    /**
     * Smart accounts this repository has deployed and written to.
     *
     * Collected from every `smartAccount` key in the recording rather than read
     * off the walkthrough. It used to be the latter, which was correct for
     * exactly as long as there was one account: the V4 chain run deploys its
     * own, and a count that names one field would have kept saying "1" with
     * nothing to indicate it had stopped looking. Same argument as
     * `installTransactions`, which learned it the same way.
     */
    smartAccounts: smartAccountsIn(recorded).size,

    /** Context rules installed on chain, counted by their install transactions. */
    contextRulesInstalled: installTransactions(recorded).size,

    denyAxes: {
      total: axes.length,
      /** Reached a ledger and failed there, rather than being refused at simulation. */
      onLedger: axes.filter((axis) => typeof axis.hash === 'string').length,
      /**
       * Of those, the ones whose contract error code was decoded from the
       * submitted transaction's own diagnostic events. The expiry axis is the
       * difference: it failed on-ledger, but that run's scan did not recover a
       * code, so only its simulation error is attributable. Carried as its own
       * number rather than folded into `onLedger`, because "the network refused
       * it" and "the network refused it with this code" are different claims.
       */
      errorDecodedOnLedger: axes.filter((axis) => axis.ledger.includes('#')).length,
    },
  };
}

function build() {
  const reportDirectory = mkdtempSync(join(tmpdir(), 'limen-evidence-'));
  try {
    const suites = SUITES.map((suite) => runSuite(suite, reportDirectory));
    return {
      note: 'Generated by scripts/evidence.mjs. Test counts come from running the suites; every chain figure is derived from packages/chain/deployments/testnet.json. Nothing in this file is typed by hand, and `npm run evidence:check` fails the build if it drifts.',
      tests: {
        total: suites.reduce((sum, suite) => sum + suite.tests, 0),
        files: suites.reduce((sum, suite) => sum + suite.files, 0),
        suites,
      },
      chain: chainEvidence(),
    };
  } finally {
    rmSync(reportDirectory, { recursive: true, force: true });
  }
}

/**
 * No `generatedAt`. A timestamp changes on every run, so `--check` would fail on
 * a clean tree and the only way to keep CI green would be to commit a new file
 * on every push — which trains everyone to regenerate without reading, and that
 * is exactly the habit that lets a wrong number through. The freshness
 * guarantee comes from the check itself, not from a date the file states about
 * itself.
 */
const evidence = chainOnly
  ? { ...JSON.parse(readFileSync(OUTPUT, 'utf8')), chain: chainEvidence() }
  : build();
const serialized = `${JSON.stringify(evidence, null, 2)}\n`;

if (chainOnly && checkOnly) {
  console.error('evidence: --chain-only and --check together would check a file this run only half regenerated');
  process.exit(2);
}

if (checkOnly) {
  let committed = '';
  try {
    committed = readFileSync(OUTPUT, 'utf8');
  } catch {
    console.error('evidence: no generated file; run `npm run evidence`');
    process.exit(1);
  }
  if (committed !== serialized) {
    console.error('evidence: apps/web/src/generated/evidence.json is stale. Run `npm run evidence` and commit the result.');
    console.error('committed:', committed.replace(/\s+/g, ' ').slice(0, 400));
    console.error('regenerated:', serialized.replace(/\s+/g, ' ').slice(0, 400));
    process.exit(1);
  }
  process.stderr.write('evidence: up to date\n');
} else {
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, serialized);
  process.stderr.write(`evidence: wrote ${OUTPUT}\n`);
  process.stderr.write(`${serialized}`);
}
