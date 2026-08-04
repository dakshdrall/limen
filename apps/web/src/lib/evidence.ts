/**
 * The generated numbers, typed.
 *
 * `src/generated/evidence.json` is written by `scripts/evidence.mjs` from two
 * sources and no others: the three test suites, actually run, and
 * `packages/chain/deployments/testnet.json`. `npm run evidence:check` — a CI
 * step — regenerates it and fails the build if the committed copy has drifted,
 * so the counts on the landing page cannot quietly fall behind the repository
 * they describe.
 *
 * This module types the file and adds nothing to it, for the same reason
 * `recorded-runs.ts` adds nothing to the deployments file. A helper here that
 * summed, rounded, or filled in a figure would be a number with no generator
 * behind it, wearing the same typeface as the ones that have one.
 */

import evidence from '../generated/evidence.json';

export interface SuiteEvidence {
  workspace: string;
  /** What the suite is about, in the generator's words. */
  covers: string;
  files: number;
  tests: number;
}

export interface Evidence {
  note: string;
  tests: {
    total: number;
    files: number;
    suites: SuiteEvidence[];
  };
  chain: {
    network: string;
    recordedAt: string;
    transactions: number;
    wasmUploads: number;
    wasmSource: string;
    /** Zero. The composition-only claim as a derived number; see the generator. */
    rustSourceFiles: number;
    smartAccounts: number;
    contextRulesInstalled: number;
    denyAxes: {
      total: number;
      onLedger: number;
      errorDecodedOnLedger: number;
    };
  };
}

export const EVIDENCE: Evidence = evidence;
