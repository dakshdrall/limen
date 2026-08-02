/**
 * Beat 1 of the guided demo: perform a real testnet transaction.
 *
 * This is the only route in the repository that causes anything to be written
 * to a chain. It takes no parameters — the body is ignored entirely — because
 * the transaction it submits is a fixed template inside `demo-signer.ts` and
 * nothing a caller sends can influence it.
 *
 * The account it signs with is disposable and holds trivial funds. See the
 * README's "The demo account" heading for the honest accounting.
 */

import { DemoSignerError, demoSignerStatus, performDemoTransfer } from '@/lib/demo-signer';
import { clientIp, createRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

/**
 * Harder than the ingest limit: this beat spends real (testnet) funds and takes
 * the submission lock. One per address per five minutes, under a global
 * ceiling that bounds the account's burn rate regardless of how many addresses
 * are asking.
 */
const perAddress = createRateLimit({ max: 1, windowMs: 5 * 60 * 1000 });
const global = createRateLimit({ max: 30, windowMs: 5 * 60 * 1000 });

export interface DemoPerformResponse {
  hash: string;
  contractId: string;
  functionName: string;
  amount: string;
}

export interface DemoPerformError {
  error: { code: string; message: string };
}

function fail(code: string, message: string, status: number): Response {
  const body: DemoPerformError = { error: { code, message } };
  return Response.json(body, { status });
}

export async function GET(): Promise<Response> {
  // Whether the beat can run, with no detail about the account itself.
  const status = demoSignerStatus();
  return Response.json(status);
}

export async function POST(request: Request): Promise<Response> {
  if (perAddress.check(clientIp(request))) {
    return fail(
      'rate_limited',
      'the demo account is shared; wait a few minutes before performing another transaction',
      429,
    );
  }
  if (global.check('global')) {
    return fail(
      'rate_limited',
      'the demo account is busy right now; try again in a few minutes, or start from a shipped preset',
      429,
    );
  }

  try {
    const result = await performDemoTransfer();
    return Response.json(result satisfies DemoPerformResponse);
  } catch (error) {
    if (error instanceof DemoSignerError) {
      const status = error.reason === 'submit_failed' ? 502 : 503;
      return fail(error.reason, error.message, status);
    }
    // The message may name the RPC endpoint or a transaction hash; it can never
    // name the demo account's secret, which never leaves `demo-signer.ts`.
    return fail(
      'submit_failed',
      error instanceof Error ? error.message : 'the demo transaction could not be submitted',
      502,
    );
  }
}
