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
import { NETWORK } from '@/lib/network';

const BASE = 'https://stellar.expert/explorer';

/** The explorer's path segment for each network this build can talk to. */
const SEGMENT: Record<typeof NETWORK, string> = { TESTNET: 'testnet' };

export function explorerTxUrl(observed: Pick<ObservedTransaction, 'network' | 'hash'>): string | undefined {
  if (observed.network === 'testnet') return `${BASE}/testnet/tx/${observed.hash}`;
  // TODO(roadmap): mainnet. The ingest route refuses it, so this is unreachable
  // today and exists for shape stability only.
  if (observed.network === 'mainnet') return `${BASE}/public/tx/${observed.hash}`;
  return undefined;
}

/**
 * For a hash the chain layer produced, where the network is not a property of
 * the observation but of this build.
 *
 * `explorerTxUrl` above answers a different question — it takes an
 * `ObservedTransaction`, which carries its own network and may carry one this
 * build cannot link — so it returns `string | undefined`. A hash that came back
 * from the RPC this build is configured against is on that network by
 * construction, so this is total.
 *
 * It exists because three screens had `https://stellar.expert/explorer/testnet`
 * written into them, which is the second place for the same fact to be wrong in
 * that `lib/network.ts` warns about. `NETWORK` is a union with one member
 * today; when mainnet is added, `SEGMENT` fails to typecheck until the segment
 * is supplied, and the three screens follow automatically instead of continuing
 * to link testnet with confidence.
 */
export function chainTxUrl(hash: string): string {
  return `${BASE}/${SEGMENT[NETWORK]}/tx/${hash}`;
}
