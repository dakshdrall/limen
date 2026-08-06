/**
 * The wire contract for `/api/ingest`, kept out of the route itself.
 *
 * The route imports the Stellar SDK. The page needs to know which error codes
 * mean "Limen declined to guess" so it can render a refusal rather than a
 * transport failure — and it must be able to learn that without importing the
 * route, and through it the SDK, into the browser bundle.
 */

import type { ObservedTransaction } from '@limen/core';

export type IngestErrorCode =
  // the caller sent something this route cannot act on
  | 'bad_request'
  | 'unknown_network'
  | 'mainnet_out_of_scope'
  // the deployment is not configured for live ingest
  | 'rpc_unconfigured'
  // the upstream failed or had nothing to give
  | 'rpc_failed'
  | 'not_found'
  | 'tx_failed'
  // Limen read the transaction and declined to derive a policy from it
  | 'no_invocations'
  | 'unreadable_movement'
  | 'unreadable_meta'
  | 'ambiguous_subject'
  // this caller is asking too often
  | 'rate_limited';

export interface IngestError {
  error: { code: IngestErrorCode; message: string; detail?: string };
}

/**
 * Codes where Limen understood the transaction and refused it, as opposed to
 * failing to reach or parse anything.
 *
 * The distinction is load-bearing for the UI: a refusal is the system
 * exercising judgement and is presented as a result, while a transport failure
 * is the system never having looked. Presenting the second as the first would
 * claim judgement that was never exercised.
 */
export const REFUSAL_CODES: ReadonlySet<IngestErrorCode> = new Set<IngestErrorCode>([
  'no_invocations',
  'unreadable_movement',
  'unreadable_meta',
  // Limen read the authorization and found more than one account in it, so it
  // declined to pick which one a boundary is for. Judgement exercised, not a
  // failure to look.
  'ambiguous_subject',
  'mainnet_out_of_scope',
]);

/**
 * Whether a response body is a usable `ObservedTransaction`.
 *
 * A wire guard, not a typechecker: it checks the fields the page actually
 * reads. The alternative — trusting a cast — turns a server bug into a white
 * screen mid-render: `{}` passes `body as ObservedTransaction` and fails here.
 */
export function isObservedTransaction(value: unknown): value is ObservedTransaction {
  if (typeof value !== 'object' || value === null) return false;
  const tx = value as Record<string, unknown>;
  return (
    typeof tx.hash === 'string' &&
    typeof tx.network === 'string' &&
    typeof tx.ledger === 'number' &&
    typeof tx.source === 'string' &&
    Array.isArray(tx.invocations) &&
    Array.isArray(tx.movements) &&
    (tx.attribution === 'exact' || tx.attribution === 'transaction-level')
  );
}

export type IngestResponse =
  | { kind: 'observed'; observed: ObservedTransaction }
  | { kind: 'error'; error: IngestError['error'] }
  | { kind: 'malformed'; status: number };

/**
 * Parses a `/api/ingest` response into one of three outcomes.
 *
 * The route's contract is `ObservedTransaction | IngestError`. A body that is
 * neither is not a refusal — presenting it as one would claim judgement the
 * server never exercised — so it becomes `malformed` and the page says the
 * lookup failed rather than that Limen declined.
 */
export async function parseIngestResponse(response: Response): Promise<IngestResponse> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: 'malformed', status: response.status };
  }
  if (!response.ok) {
    const error = (body as IngestError | null | undefined)?.error;
    if (typeof error?.code === 'string' && typeof error.message === 'string') {
      return { kind: 'error', error };
    }
    return { kind: 'malformed', status: response.status };
  }
  if (isObservedTransaction(body)) return { kind: 'observed', observed: body };
  return { kind: 'malformed', status: response.status };
}
