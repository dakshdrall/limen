/**
 * What an account has actually done, from contract events.
 *
 * Two things this endpoint is careful about, both inherited from `events.ts`
 * and both invisible if you only look at a successful response:
 *
 * 1. **This is permitted activity only.** Contract events are emitted on
 *    success, so a refused transaction appears nowhere in this feed. The
 *    response carries no refusals and the screen must not imply it is a
 *    complete history.
 * 2. **The scan window is part of the answer.** Soroban RPC forgets events past
 *    a retention floor, and a single `getEvents` call covers only a fraction of
 *    that window. `window` says what was actually looked at, so "nothing
 *    happened" can be told apart from "we did not look that far".
 *
 * The policy contracts to scan are read from the account itself rather than
 * configured. A hardcoded list would go stale the moment an account installed a
 * policy this build has never heard of, and silently omit its activity.
 */

import { StrKey } from '@stellar/stellar-sdk';
import { ContractReadError, readActivity, readAllContextRules } from '@limen/chain';
import type { AccountReadError, AccountReadErrorCode } from '@/lib/account-contract';
import type { ActivityResponse } from '@/lib/activity-contract';
import { clientIp, createRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

/**
 * Far tighter than the boundary read, because it costs far more: a full
 * retention-window scan is over twenty upstream calls. This is the most
 * expensive endpoint in the application and is metered like it.
 */
const limit = createRateLimit({ max: 8, windowMs: 10 * 60 * 1000 });

function fail(code: AccountReadErrorCode, message: string, status: number, detail?: string): Response {
  const body: AccountReadError = {
    error: detail === undefined ? { code, message } : { code, message, detail },
  };
  return Response.json(body, { status });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  if (!StrKey.isValidContract(id)) {
    return fail('bad_address', 'a smart account address is a 56-character `C…` contract address', 400);
  }

  const rpcUrl = process.env.SOROBAN_RPC_URL;
  if (rpcUrl === undefined || rpcUrl.length === 0) {
    return fail('rpc_unconfigured', 'this deployment has no Soroban RPC endpoint configured', 503);
  }

  const simulationSource = process.env.LIMEN_SIMULATION_SOURCE ?? process.env.LIMEN_DEMO_DESTINATION;
  if (simulationSource === undefined || simulationSource.length === 0) {
    return fail(
      'simulation_source_unconfigured',
      'this deployment has no account to simulate reads from',
      503,
    );
  }

  if (limit.check(clientIp(request))) {
    return fail('rate_limited', 'too many activity scans from this address; try again shortly', 429);
  }

  try {
    const rules = await readAllContextRules({ rpcUrl, simulationSource }, id);
    const policyContracts = [...new Set(rules.flatMap((rule) => rule.policies))];

    const { events, window } = await readActivity({ rpcUrl, smartAccount: id, policyContracts });

    const body: ActivityResponse = { contractId: id, events, window, policyContracts };
    return Response.json(body, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    if (error instanceof ContractReadError) {
      return fail(
        'not_a_smart_account',
        'this contract did not answer as an OpenZeppelin smart account; check the address',
        422,
        error.message,
      );
    }
    return fail(
      'rpc_failed',
      'reading this account’s activity failed',
      502,
      error instanceof Error ? error.message : String(error),
    );
  }
}
