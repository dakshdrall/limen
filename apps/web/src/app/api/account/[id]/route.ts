/**
 * A smart account's installed boundary, read off the chain.
 *
 * Every value this returns is a fact about the ledger at a stated sequence
 * number. Nothing is restored from storage, nothing is cached, and nothing is
 * carried over from a previous read — a reload recomputes. What legitimately
 * lives in the browser is in `lib/store.ts`: which accounts this browser has
 * seen, and how a policy was derived. Never what is installed.
 *
 * This runs on the server for the same reason `/api/ingest` does: the RPC
 * endpoint is not exposed to the browser, and the Stellar SDK is kept out of the
 * client bundle.
 *
 * Reads are by simulation, so they cost no fee and need no signature. That is
 * what lets this screen show an account's boundary to someone who cannot sign
 * for it — a reviewer pasting the address from the README, for instance.
 */

import { StrKey } from '@stellar/stellar-sdk';
import {
  ContractReadError,
  isLive,
  readAllContextRules,
  readSpendingLimit,
  type ReadOptions,
} from '@limen/chain';
import type {
  AccountReadError,
  AccountReadErrorCode,
  AccountSnapshot,
  SnapshotPolicy,
  SnapshotRule,
} from '@/lib/account-contract';
import { clientIp, createRateLimit } from '@/lib/rate-limit';

// Required: the Stellar SDK does not run on the Edge runtime.
export const runtime = 'nodejs';

/**
 * A boundary read is many simulations — one per rule, plus one per policy — so
 * it is metered more tightly than ingest. The ceiling is per address rather
 * than global so one reviewer refreshing cannot lock out another.
 */
const limit = createRateLimit({ max: 30, windowMs: 10 * 60 * 1000, namespace: 'account' });

function fail(code: AccountReadErrorCode, message: string, status: number, detail?: string): Response {
  const body: AccountReadError = {
    error: detail === undefined ? { code, message } : { code, message, detail },
  };
  return Response.json(body, { status });
}

/**
 * The account reads are simulated from.
 *
 * It never signs and is never charged; simulation only needs an account that
 * exists so the transaction it builds has a sequence number. Any funded testnet
 * account does, which is why this falls back to the demo destination rather
 * than requiring its own configuration. It is emphatically not a signer, and
 * nothing about it reaches the browser.
 */
function simulationSource(): string | undefined {
  const explicit = process.env.LIMEN_SIMULATION_SOURCE;
  if (explicit !== undefined && explicit.length > 0) return explicit;
  const fallback = process.env.LIMEN_DEMO_DESTINATION;
  return fallback !== undefined && fallback.length > 0 ? fallback : undefined;
}

/**
 * Reads what a rule's policies currently hold.
 *
 * Per policy rather than per rule: one policy contract refusing to answer must
 * not blank the caps of the others, and must not be reported as "no limit".
 * `unreadable` carries the reason so the screen can say which of the two
 * happened.
 */
async function readPolicies(
  options: ReadOptions,
  smartAccount: string,
  ruleId: number,
  contracts: string[],
): Promise<SnapshotPolicy[]> {
  return Promise.all(
    contracts.map(async (contract): Promise<SnapshotPolicy> => {
      try {
        const held = await readSpendingLimit(options, contract, smartAccount, ruleId);
        return {
          contract,
          limit: {
            limit: held.limit,
            periodLedgers: held.periodLedgers,
            spentInWindow: held.spentInWindow,
          },
          unreadable: null,
        };
      } catch (error) {
        // Not every policy contract is a spending limit, and a future one may
        // hold something this app has no reader for. Saying so beats rendering
        // an unconstrained rule.
        return {
          contract,
          limit: null,
          unreadable:
            error instanceof ContractReadError
              ? 'this policy did not answer a spending-limit read'
              : error instanceof Error
                ? error.message
                : String(error),
        };
      }
    }),
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  // A `C…` address is the only thing a smart account can be. Checking it here
  // means a typo is a stated refusal rather than an opaque RPC failure.
  if (!StrKey.isValidContract(id)) {
    return fail(
      'bad_address',
      'a smart account address is a 56-character `C…` contract address; this is not one',
      400,
    );
  }

  const rpcUrl = process.env.SOROBAN_RPC_URL;
  if (rpcUrl === undefined || rpcUrl.length === 0) {
    return fail(
      'rpc_unconfigured',
      'this deployment has no Soroban RPC endpoint configured, so no account can be read',
      503,
    );
  }

  const source = simulationSource();
  if (source === undefined) {
    return fail(
      'simulation_source_unconfigured',
      'this deployment has no account to simulate reads from, so no account can be read',
      503,
    );
  }

  if (await limit.check(clientIp(request))) {
    return fail('rate_limited', 'too many account reads from this address; try again shortly', 429);
  }

  const options: ReadOptions = { rpcUrl, simulationSource: source };

  // The ledger is read first and every liveness judgement below is made against
  // it. Reading it afterwards would date the snapshot later than the reads it
  // describes, which is the direction that turns an expired rule live.
  let ledger: number;
  try {
    const { rpc } = await import('@stellar/stellar-sdk');
    ledger = (await new rpc.Server(rpcUrl).getLatestLedger()).sequence;
  } catch (error) {
    return fail(
      'rpc_failed',
      'the Soroban RPC request failed',
      502,
      error instanceof Error ? error.message : String(error),
    );
  }

  let rules: SnapshotRule[];
  try {
    const installed = await readAllContextRules(options, id);
    rules = await Promise.all(
      installed.map(async (rule): Promise<SnapshotRule> => ({
        id: rule.id,
        name: rule.name,
        contextType: rule.contextType,
        contract: rule.contract,
        validUntilLedger: rule.validUntilLedger,
        live: isLive(rule, ledger),
        signers: rule.signers,
        policies: await readPolicies(options, id, rule.id, rule.policies),
      })),
    );
  } catch (error) {
    if (error instanceof ContractReadError) {
      // The address is a contract, but not one that answers
      // `get_context_rules_count`. Almost always a token or an unrelated
      // contract pasted by mistake.
      return fail(
        'not_a_smart_account',
        'this contract did not answer as an OpenZeppelin smart account; check the address',
        422,
        error.message,
      );
    }
    return fail(
      'rpc_failed',
      'reading the account failed',
      502,
      error instanceof Error ? error.message : String(error),
    );
  }

  const snapshot: AccountSnapshot = {
    contractId: id,
    ledger,
    readAt: new Date().toISOString(),
    rules,
  };

  // Never cached. A boundary is exactly the thing that must not be served from
  // a previous answer: a rule revoked on another device, or expired while this
  // tab was closed, would still render as live.
  return Response.json(snapshot, { headers: { 'cache-control': 'no-store' } });
}
