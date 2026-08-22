/**
 * The account the server simulates reads from.
 *
 * Reading a smart account's context rules costs no fee and needs no signature,
 * but a Soroban simulation still needs *some* source account to be simulated
 * from. This is that account, and it never signs anything.
 *
 * One definition, because there are now two routes that read the chain on the
 * server — `/api/account/[id]`, which has done since V4, and
 * `/api/agents/[id]/deployed`, which verifies a deployment against the ledger
 * rather than believing what a browser reported. Two copies of a fallback chain
 * is two places for the fallback to differ, and the way that failure shows up
 * is one route reading accounts fine while another reports the deployment
 * unverifiable.
 *
 * `LIMEN_SIMULATION_SOURCE` first, then `LIMEN_DEMO_DESTINATION`. The fallback
 * is deliberate and is not a default: the demo destination is a real funded
 * testnet account this deployment already knows about, so a build configured
 * for the demo can read accounts without a second variable being set. Both are
 * public addresses; neither is a secret, and neither can sign.
 *
 * It never signs and is never charged: simulation only needs an account that
 * exists, so the transaction it builds has a sequence number. Any funded
 * testnet account does. It is emphatically not a signer, and nothing about it
 * reaches the browser.
 *
 * `undefined` rather than a thrown error, so a caller can report *"this
 * deployment cannot read the chain"* as the configuration state it is instead
 * of as a failure.
 */

import 'server-only';

export function simulationSource(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const explicit = env.LIMEN_SIMULATION_SOURCE;
  if (explicit !== undefined && explicit.length > 0) return explicit;
  const fallback = env.LIMEN_DEMO_DESTINATION;
  return fallback !== undefined && fallback.length > 0 ? fallback : undefined;
}
