/**
 * tx hash -> ObservedTransaction.
 *
 * This is the ONLY file in the repo that opens a network connection.
 * `packages/core` stays pure; everything downstream of this route operates on
 * plain data.
 */

import { rpc } from '@stellar/stellar-sdk';
import type { ObservedTransaction } from '@limen/core';
import { DEFAULT_FIXTURE_KEY, resolveFixture } from '@/fixtures';
import { extractObservedTransaction } from '@/lib/extract';

// Required: the Stellar SDK does not run on the Edge runtime.
export const runtime = 'nodejs';

interface IngestRequest {
  hash?: unknown;
  network?: unknown;
}

function bad(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request): Promise<Response> {
  let body: IngestRequest;
  try {
    body = (await request.json()) as IngestRequest;
  } catch {
    return bad('request body must be JSON');
  }

  const reference = typeof body.hash === 'string' && body.hash.length > 0 ? body.hash : DEFAULT_FIXTURE_KEY;
  const network = typeof body.network === 'string' ? body.network : 'simulated';

  // Fixtures resolve with no network call, so the whole demo runs with no RPC
  // access and no credentials.
  const fixture = resolveFixture(reference);
  if (fixture !== undefined) {
    return Response.json(fixture satisfies ObservedTransaction);
  }

  if (network === 'mainnet') {
    // TODO(roadmap): mainnet. Deliberately refused rather than silently
    // treated as testnet.
    return bad('mainnet is out of scope for this MVP; use testnet or a shipped fixture');
  }
  if (network !== 'testnet') {
    return bad(`unknown network ${JSON.stringify(network)}; expected "testnet", or a fixture key`);
  }
  if (!/^[0-9a-f]{64}$/i.test(reference)) {
    return bad('hash must be 64 hex characters, or the key of a shipped fixture');
  }

  // Server-side only — the RPC endpoint is never exposed to the browser.
  const rpcUrl = process.env.SOROBAN_RPC_URL;
  if (rpcUrl === undefined || rpcUrl.length === 0) {
    return bad(
      'SOROBAN_RPC_URL is not configured; set it to ingest live testnet transactions, or use a shipped fixture',
      503,
    );
  }

  let response: rpc.Api.GetTransactionResponse;
  try {
    const server = new rpc.Server(rpcUrl);
    response = await server.getTransaction(reference);
  } catch (error) {
    return bad(`Soroban RPC request failed: ${error instanceof Error ? error.message : String(error)}`, 502);
  }

  if (response.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
    return bad(`transaction ${reference} not found on testnet`, 404);
  }
  if (response.status === rpc.Api.GetTransactionStatus.FAILED) {
    // A failed transaction did not perform the flow, so there is nothing to
    // derive a permission boundary from.
    return bad(`transaction ${reference} failed on-chain; a policy can only be derived from a flow that succeeded`);
  }

  try {
    return Response.json(extractObservedTransaction(reference, 'testnet', response));
  } catch (error) {
    return bad(error instanceof Error ? error.message : String(error), 422);
  }
}
