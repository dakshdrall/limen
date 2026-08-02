/**
 * Explorer links. [V2-D4] stellar.expert.
 *
 * Only ever built for a transaction that was actually observed on a network.
 * A fixture's hash does not exist anywhere, so linking one would send a
 * reviewer to a 404 that looks like the demo being broken rather than like the
 * fixture being simulated — which is exactly the confusion the `simulated`
 * caveat exists to prevent.
 */

import type { ObservedTransaction } from '@limen/core';

const BASE = 'https://stellar.expert/explorer';

export function explorerTxUrl(observed: Pick<ObservedTransaction, 'network' | 'hash'>): string | undefined {
  if (observed.network === 'testnet') return `${BASE}/testnet/tx/${observed.hash}`;
  // TODO(roadmap): mainnet. The ingest route refuses it, so this is unreachable
  // today and exists for shape stability only.
  if (observed.network === 'mainnet') return `${BASE}/public/tx/${observed.hash}`;
  return undefined;
}
