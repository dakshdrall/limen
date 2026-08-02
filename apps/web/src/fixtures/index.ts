import type { ObservedTransaction } from '@limen/core';
import simpleTransfer from './simple-transfer.json' with { type: 'json' };
import swapTwoCalls from './swap-two-calls.json' with { type: 'json' };
import overLimit from './over-limit.json' with { type: 'json' };

/**
 * Shipped fixtures. The whole pipeline — ingest → synthesize → deny table →
 * explain — is demoable from these with no RPC access and no credentials.
 *
 * Addresses are real StrKey-valid Stellar addresses so they render and validate
 * like production data, but the transactions themselves are illustrative; they
 * were not observed on a live network. `network` is `"simulated"` for exactly
 * that reason.
 */
export const FIXTURES: Record<string, ObservedTransaction> = {
  'simple-transfer': simpleTransfer as ObservedTransaction,
  'swap-two-calls': swapTwoCalls as ObservedTransaction,
  // Derives six policies against a five-policy context rule, so synthesis
  // refuses it. Shipped deliberately: watching Limen decline to guess is
  // evidence about whether to trust it, and a demo that can only succeed is
  // not evidence at all.
  'over-limit': overLimit as ObservedTransaction,
};

/**
 * Fixtures whose whole purpose is to be refused. The demo labels these so a
 * reviewer knows the refusal is the point rather than a broken preset.
 */
export const REFUSING_FIXTURES: ReadonlySet<string> = new Set(['over-limit']);

/** The transaction the demo screen loads on first paint. */
export const DEFAULT_FIXTURE_KEY = 'simple-transfer';

/**
 * Resolves a fixture by short key or by full transaction hash, so the demo can
 * be driven either way.
 */
export function resolveFixture(reference: string): ObservedTransaction | undefined {
  const byKey = FIXTURES[reference];
  if (byKey !== undefined) return byKey;
  return Object.values(FIXTURES).find((tx) => tx.hash === reference);
}
