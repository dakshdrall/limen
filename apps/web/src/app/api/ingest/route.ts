/**
 * tx hash -> ObservedTransaction.
 *
 * This is the ONLY file in the repo that opens a network connection to read
 * chain state. `packages/core` stays pure; everything downstream of this route
 * operates on plain data.
 *
 * Every refusal is structured. The page distinguishes "Limen declined to guess"
 * from "the network failed", and it can only do that if this route says which
 * happened — see `IngestErrorCode`.
 */

import { rpc } from '@stellar/stellar-sdk';
import type { ObservedTransaction } from '@limen/core';
import { DEFAULT_FIXTURE_KEY, resolveFixture } from '@/fixtures';
import { ExtractionError, extractObservedTransaction } from '@/lib/extract';
import type { IngestError, IngestErrorCode } from '@/lib/ingest-contract';
import { clientIp, createRateLimit } from '@/lib/rate-limit';
import { getCached, putCached } from '@/lib/tx-cache';

// Required: the Stellar SDK does not run on the Edge runtime.
export const runtime = 'nodejs';

function fail(code: IngestErrorCode, message: string, status: number, detail?: string): Response {
  const body: IngestError = { error: detail === undefined ? { code, message } : { code, message, detail } };
  return Response.json(body, { status });
}

/**
 * Live ingest costs an upstream RPC call, so it is metered. Cache hits and
 * fixtures skip the limiter — neither touches the network.
 */
const limit = createRateLimit({ max: 20, windowMs: 10 * 60 * 1000 });

interface IngestRequest {
  hash?: unknown;
  network?: unknown;
}

export async function POST(request: Request): Promise<Response> {
  let body: IngestRequest;
  try {
    body = (await request.json()) as IngestRequest;
  } catch {
    return fail('bad_request', 'request body must be JSON', 400);
  }

  const reference =
    typeof body.hash === 'string' && body.hash.trim().length > 0 ? body.hash.trim() : DEFAULT_FIXTURE_KEY;
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
    return fail(
      'mainnet_out_of_scope',
      'mainnet is out of scope for this MVP; use testnet or a shipped fixture',
      400,
    );
  }
  if (network !== 'testnet') {
    return fail(
      'unknown_network',
      `unknown network ${JSON.stringify(network)}; expected "testnet", or the key of a shipped fixture`,
      400,
    );
  }
  if (!/^[0-9a-f]{64}$/i.test(reference)) {
    return fail(
      'bad_request',
      'a transaction hash is 64 hexadecimal characters; this is neither that nor the key of a shipped fixture',
      400,
    );
  }

  const hash = reference.toLowerCase();

  // A confirmed transaction is immutable, so a hit is always as good as a
  // fresh fetch — and costs no upstream call, hence no rate-limit charge.
  const cached = getCached(hash);
  if (cached !== undefined) return Response.json(cached);

  if (limit.check(clientIp(request))) {
    return fail('rate_limited', 'too many live lookups from this address; try again shortly', 429);
  }

  // Server-side only — the RPC endpoint is never exposed to the browser.
  const rpcUrl = process.env.SOROBAN_RPC_URL;
  if (rpcUrl === undefined || rpcUrl.length === 0) {
    return fail(
      'rpc_unconfigured',
      'this deployment has no Soroban RPC endpoint configured, so live transactions cannot be looked up; the shipped fixtures still work',
      503,
    );
  }

  let response: rpc.Api.GetTransactionResponse;
  try {
    const server = new rpc.Server(rpcUrl);
    response = await server.getTransaction(hash);
  } catch (error) {
    return fail(
      'rpc_failed',
      'the Soroban RPC request failed',
      502,
      error instanceof Error ? error.message : String(error),
    );
  }

  if (response.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
    return fail(
      'not_found',
      `no transaction with hash ${hash} was found on testnet`,
      404,
    );
  }
  if (response.status === rpc.Api.GetTransactionStatus.FAILED) {
    // A failed transaction did not perform the flow, so there is nothing to
    // derive a permission boundary from.
    return fail(
      'tx_failed',
      `transaction ${hash} failed on-chain; a policy can only be derived from a flow that succeeded`,
      400,
    );
  }

  let observed: ObservedTransaction;
  try {
    observed = extractObservedTransaction(hash, 'testnet', response);
  } catch (error) {
    if (error instanceof ExtractionError) {
      // Accurate or absent: the extractor refused rather than narrowing the
      // flow to the parts it could read.
      return fail(error.code, error.message, 422, error.detail);
    }
    return fail(
      'unreadable_meta',
      'the transaction could not be read into an observable flow',
      422,
      error instanceof Error ? error.message : String(error),
    );
  }

  putCached(hash, observed);
  return Response.json(observed);
}
