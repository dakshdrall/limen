/**
 * `swap_tokens` — the second tool that moves money, and the second that signs.
 *
 * Built from `payment.ts` rather than beside it. The two share the shape that
 * matters: read the boundary from the chain, gate, mark the turn as submitting,
 * open the key for exactly this call, submit, classify into §4.4's five
 * outcomes. What differs is the call being authorized and the fact that it takes
 * two context rules instead of one.
 *
 * `send_payment` is untouched and still exists. An agent that pays and an agent
 * that trades are the same machinery pointed at different contracts.
 *
 * ## Why a swap is bounded at all, which is measured rather than assumed
 *
 * PLAN-V8 C0, on live testnet. A router call raises **two** auth contexts under
 * the smart account's credentials:
 *
 * ```
 * CCJUD55A… :: swap_exact_tokens_for_tokens
 *   └─ CDLZFC3S… :: transfer   (from = the smart account)
 * ```
 *
 * `AuthPayload` carries one `context_rule_id` per context, so both rules are
 * named here: the venue rule for the router leg, the token rule for the
 * transfer. The token context can only be validated by a rule whose contract is
 * that token — pointing it at the venue rule fails `UnvalidatedContext#3002` —
 * so the spending limit is unavoidable for the leg that moves money.
 *
 * That is the whole safety argument, and it was checked end to end: an over-cap
 * swap was refused on a ledger with `SpendingLimitExceeded#3221`, hash
 * `f50d843159121842d8084be0d0827b4021fef4a1455f3a15900c81d0a09fe995`.
 *
 * **There is no Limen-side amount check in this file, deliberately.** The cap is
 * the network's and it enforces it. `gate.ts` adds only what the account cannot
 * see: which pair, and how large one position may be.
 *
 * ## Routing is not done here, and that is a decision rather than a gap
 *
 * The path is the direct input→output pair. Choosing a route across pools —
 * splitting, multi-hop, comparing venues — is the Soroswap Route API's job
 * (`POST /quote` at `api.soroswap.finance`, which needs a registered key). This
 * tool authorizes and submits a swap; it does not claim to find the best price,
 * and a `minimumOut` of zero says plainly that it is not protecting one either.
 * `TODO(roadmap)`: take the path and the minimum from a quote.
 */

import { z } from 'zod';
import { Address, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import {
  assertDistinctSigners,
  describeContractError,
  enforcingFootprint,
  i128,
  invokeContract,
  isBoundaryRefusal,
  isRevokedRule,
  rawEd25519FromAddress,
  recordAuthEntries,
  signAs,
  submitAuthorized,
  submitWithBorrowedFootprint,
  type SubmitResult,
} from '@limen/chain';
import { TESTNET_PASSPHRASE } from '@limen/chain/network';
import { withAgentKey, type OpenAgentKey } from '@limen/custody';
import { decideSwap, readBoundary, signerFor, type Boundary } from '../policy/gate.js';
import type { Tool, ToolContext } from './registry.js';
import type { ToolResult } from './types.js';
import type { TransactionFacts } from './payment.js';

/** The same lifetime a payment's signature gets, and for the same reason. */
const AUTH_ENTRY_LEDGERS = 60;

/** The smallest swap that can stand in for a permitted one when borrowing a footprint. */
const SMALL_SWAP = 1_000n;

/**
 * Soroswap's testnet router.
 *
 * Read from `soroswap/core`'s `public/testnet.contracts.json` and confirmed
 * against their own live `GET /api/testnet/router`, then probed on testnet —
 * recorded in PLAN-V8 C0. Not recalled.
 */
export const SOROSWAP_TESTNET_ROUTER = 'CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD';

/** How long a swap may sit unexecuted, in seconds. The router takes a deadline. */
const DEADLINE_SECONDS = 300;

export interface SwapArgs {
  inputAsset: string;
  outputAsset: string;
  stroops: string;
}

export const swapTokens: Tool<SwapArgs> = {
  name: 'swap_tokens',
  kind: 'write',
  description:
    'Swap one token for another through Soroswap, from the agent’s smart account. The amount is the ' +
    'input asset’s smallest unit, as a string of digits, never a decimal. Both assets are contract ' +
    'addresses. The route is the direct pair; this does not shop for a price.',
  schema: z.strictObject({
    inputAsset: z
      .string()
      .regex(/^C[A-Z2-7]{55}$/, 'must be a token contract address: 56 characters starting with C'),
    outputAsset: z
      .string()
      .regex(/^C[A-Z2-7]{55}$/, 'must be a token contract address: 56 characters starting with C'),
    // A string of digits for the reason `send_payment` gives: the value can
    // exceed 2^53 and a JSON number would have lost precision before this ran.
    stroops: z
      .string()
      .regex(/^[1-9][0-9]{0,38}$/, 'must be a positive whole amount of the input asset, as a string of digits'),
  }),

  async run(args, ctx) {
    const amount = BigInt(args.stroops);
    const request = { token: args.inputAsset, outputAsset: args.outputAsset, amount };

    if (args.inputAsset === args.outputAsset) {
      return {
        outcome: 'agent_error',
        summary: 'A swap needs two different assets.',
        detail: `Both sides of this swap are ${args.inputAsset}.`,
      };
    }

    if (ctx.agent.contextRuleId === null) {
      return refusedByLimen(ctx, {
        constraint: 'rule_not_installed',
        reason:
          'This agent has no recorded context rule, so there is no boundary to act within. Deploy it first.',
        ledgerWould: 'unknown',
      });
    }

    let boundary: Boundary | undefined;
    try {
      boundary = await readBoundary(ctx.read, {
        smartAccount: ctx.agent.smartAccount,
        contextRuleId: ctx.agent.contextRuleId,
      });
    } catch (error) {
      return {
        outcome: 'infra_error',
        summary:
          'Limen could not read this agent’s boundary from the network, so it did not sign anything.',
        stage: error instanceof Error ? error.message : String(error),
      };
    }

    const decision = decideSwap({
      agentStatus: ctx.agent.status,
      agentPublicKey: ctx.agent.agentPublicKey,
      request,
      enforcedOffchain: ctx.agent.enforcedOffchain,
      boundary,
      venueRuleId: ctx.agent.venueContextRuleId,
    });

    if (decision.decision === 'refuse') return refusedByLimen(ctx, decision);

    // Narrowed rather than asserted: `decideSwap` refuses a null venue rule
    // above, so this cannot be null here, and a check is cheaper than an
    // assertion that outlives the reason it was safe.
    const venueRuleId = ctx.agent.venueContextRuleId;
    if (venueRuleId === null) {
      throw new Error('swap_tokens: the gate permitted a swap with no venue rule.');
    }

    return await execute(ctx, decision.boundary, request, venueRuleId);
  },
};

async function refusedByLimen(
  ctx: ToolContext,
  refusal: { constraint: string; reason: string; ledgerWould: 'refuse' | 'permit' | 'unknown' },
): Promise<ToolResult> {
  await ctx.store.setToolDecision({ id: ctx.executionId, decision: 'refuse', reason: refusal.reason });
  await ctx.store.audit({
    actor: 'system',
    actorId: ctx.agent.id,
    action: 'policy.refuse',
    target: ctx.agent.smartAccount,
    result: refusal.constraint,
    metadata: { turnId: ctx.turnId, ledgerWould: refusal.ledgerWould, reachedLedger: false },
  });

  return {
    outcome: 'refused_by_limen',
    summary: refusal.reason,
    constraint: refusal.constraint,
    ledgerWould: refusal.ledgerWould,
    reachedLedger: false,
  };
}

export interface SwapRequestFacts {
  token: string;
  outputAsset: string;
  amount: bigint;
}

async function execute(
  ctx: ToolContext,
  boundary: Boundary,
  request: SwapRequestFacts,
  venueRuleId: number,
): Promise<ToolResult> {
  const signer = signerFor(boundary, ctx.agent.agentPublicKey);
  if (signer === undefined) {
    throw new Error('swap_tokens: the boundary names no verifier for the agent key.');
  }

  // The same guard the payment path and `install.ts` both make, for the reason
  // that travels with the pair: a boundary the bounded party could have
  // installed itself proves nothing.
  if (ctx.agent.ownerSignerKind === 'ed25519') {
    assertDistinctSigners(
      rawEd25519FromAddress(ctx.agent.ownerPublicKey),
      rawEd25519FromAddress(ctx.agent.agentPublicKey),
    );
  }

  await ctx.store.setToolDecision({ id: ctx.executionId, decision: 'permit', reason: null });

  await ctx.store.markSubmitting(ctx.turnId, {
    stage: 'submitting',
    toolExecutionId: ctx.executionId,
    destination: SOROSWAP_TESTNET_ROUTER,
    stroops: request.amount.toString(),
    boundaryReadAtLedger: boundary.ledger,
  });

  const result = await withAgentKey(
    { provider: ctx.provider, agentId: ctx.agent.id, sealed: ctx.agent.sealedKey },
    async (key) => await submitSwap(ctx, boundary, request, venueRuleId, signer.verifier, key),
  );

  return await classify(ctx, boundary, request, result);
}

/**
 * The swap call, as a host function.
 *
 * `swap_exact_tokens_for_tokens(amount_in, amount_out_min, path, to, deadline)`.
 *
 * `amount_out_min` is zero, and that is a statement rather than an oversight:
 * this tool does not have a quote, so it has no number to insist on. Slippage
 * protection belongs with the Route API's quote and arrives with it. A non-zero
 * value invented here would be a protection nothing computed.
 */
function swapFunction(request: SwapRequestFacts, to: string, amount: bigint): xdr.HostFunction {
  return invokeContract(SOROSWAP_TESTNET_ROUTER, 'swap_exact_tokens_for_tokens', [
    i128(amount),
    i128(0n),
    nativeToScVal([new Address(request.token), new Address(request.outputAsset)], { type: 'address' }),
    new Address(to).toScVal(),
    nativeToScVal(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS, { type: 'u64' }),
  ]);
}

/**
 * Submit, and get a refusal onto a ledger when the boundary is what refused.
 *
 * The same two-step as `send_payment`: try it, and if the enforcing simulation
 * refuses with a contract error code, rebuild the *requested* swap against a
 * footprint borrowed from a small one that does simulate. A refusal that never
 * reached a ledger is Limen's word for what would have happened; a refusal with
 * a hash is the network's.
 *
 * The borrowed entry needs **both** amounts rewritten. A swap's auth tree is the
 * router call with the token transfer beneath it, and each carries the amount
 * independently — argument one of the root, argument three of the sub-invocation.
 * Rewriting only the root produces a tree the host rejects as malformed rather
 * than a swap the boundary refuses, which would be an infrastructure error
 * wearing a refusal's clothes.
 */
async function submitSwap(
  ctx: ToolContext,
  boundary: Boundary,
  request: SwapRequestFacts,
  venueRuleId: number,
  verifier: string,
  key: OpenAgentKey,
): Promise<SubmitResult> {
  const signAuthEntry = signAs({
    signer: key,
    verifier,
    // Order matters and matches the auth tree: the router context first, the
    // token context second. One id per context — a mismatch is
    // `ContextRuleIdsLengthMismatch#3014`, measured in C0.
    contextRuleIds: [venueRuleId, boundary.ruleId],
    expirationLedger: boundary.ledger + AUTH_ENTRY_LEDGERS,
    passphrase: TESTNET_PASSPHRASE,
  });

  const account = ctx.agent.smartAccount;
  const common = {
    rpcUrl: ctx.rpcUrl,
    passphrase: TESTNET_PASSPHRASE,
    feeSource: ctx.agent.feeAccount,
    signEnvelope: key.signEnvelope,
    label: 'swap_tokens',
  } as const;

  const attempt = await submitAuthorized({
    ...common,
    func: swapFunction(request, account, request.amount),
    signAuthEntry,
  });

  if (attempt.stage === 'ledger' || attempt.code === null) return attempt;

  const ontoLedger = async (): Promise<SubmitResult> => {
    const borrowed = swapFunction(request, account, SMALL_SWAP);
    const transactionData = await enforcingFootprint({ ...common, func: borrowed, signAuthEntry });

    const [recorded] = await recordAuthEntries({ ...common, func: borrowed });
    if (recorded === undefined) throw new Error('no auth entry to borrow');

    const entry = xdr.SorobanAuthorizationEntry.fromXDR(recorded.toXDR());
    const root = entry.rootInvocation();
    // `swap_exact_tokens_for_tokens(amount_in, …)` — argument one.
    root.function().contractFn().args()[0] = i128(request.amount);
    const transfer = root.subInvocations()[0];
    if (transfer === undefined) throw new Error('the borrowed swap raised no transfer to rewrite');
    // `transfer(from, to, amount)` — argument three.
    transfer.function().contractFn().args()[2] = i128(request.amount);

    return await submitWithBorrowedFootprint({
      ...common,
      func: swapFunction(request, account, request.amount),
      transactionData,
      auth: [await signAuthEntry(entry)],
      label: 'swap_tokens-refused',
    });
  };

  try {
    return await ontoLedger();
  } catch {
    return attempt;
  }
}

/**
 * A `SubmitResult` in §4.4's vocabulary, for a swap.
 *
 * Pure, and separate from the writing for the same reason `classifySubmit` is:
 * this is where a failure becomes a refusal or does not, and every branch of it
 * should be testable without a network.
 */
export function classifySwap(
  result: SubmitResult,
  request: SwapRequestFacts,
  contextRuleIds: { token: number; venue: number },
): { result: ToolResult; transaction: TransactionFacts | null } {
  if (result.stage === 'ledger') {
    const codes = result.codes;
    const transaction: TransactionFacts = {
      hash: result.hash,
      reachedLedger: true,
      ledger: result.ledger,
      opResultName: result.opResult,
      contractErrorCodes: codes,
      isBoundaryRefusal: isBoundaryRefusal(codes),
      isRevokedRule: isRevokedRule(codes),
    };
    const evidence = { hash: result.hash, status: result.status, opResult: result.opResult };

    if (result.ok) {
      return {
        transaction,
        result: {
          outcome: 'succeeded',
          summary:
            `Swapped ${request.amount} of ${request.token} for ${request.outputAsset}. ` +
            `Transaction ${result.hash} closed${result.ledger === null ? '' : ` in ledger ${result.ledger}`}.`,
          data: {
            stroops: request.amount.toString(),
            inputAsset: request.token,
            outputAsset: request.outputAsset,
            venue: SOROSWAP_TESTNET_ROUTER,
            contextRuleId: contextRuleIds.token,
            venueContextRuleId: contextRuleIds.venue,
          },
          evidence,
        },
      };
    }

    return {
      transaction,
      result: {
        outcome: 'refused_by_network',
        summary: refusalSummary(codes, request),
        codes,
        boundaryRefusal: isBoundaryRefusal(codes),
        revokedRule: isRevokedRule(codes),
        evidence,
      },
    };
  }

  if (result.code !== null) {
    const codes = [result.code];
    return {
      transaction: {
        hash: null,
        reachedLedger: false,
        ledger: null,
        opResultName: null,
        contractErrorCodes: codes,
        isBoundaryRefusal: isBoundaryRefusal(codes),
        isRevokedRule: isRevokedRule(codes),
      },
      result: {
        outcome: 'refused_by_network',
        summary: refusalSummary(codes, request),
        codes,
        boundaryRefusal: isBoundaryRefusal(codes),
        revokedRule: isRevokedRule(codes),
        evidence: null,
        whyNoEvidence:
          'The contract refused this swap in simulation, so no transaction was submitted and there is no ' +
          'hash. Limen tried to put the attempt on a ledger anyway, by borrowing a footprint from a ' +
          'smaller swap the boundary permits, and that swap could not be simulated either.',
      },
    };
  }

  return {
    transaction: null,
    result: {
      outcome: 'infra_error',
      summary: 'This did not reach the network. Nothing was signed onto a ledger and nothing moved.',
      stage: `${result.stage}: ${result.error}`,
    },
  };
}

async function classify(
  ctx: ToolContext,
  boundary: Boundary,
  request: SwapRequestFacts,
  submitted: SubmitResult,
): Promise<ToolResult> {
  const { result, transaction } = classifySwap(submitted, request, {
    token: boundary.ruleId,
    venue: ctx.agent.venueContextRuleId ?? -1,
  });

  if (transaction !== null) {
    await ctx.store.recordTransaction({
      agentId: ctx.agent.id,
      toolExecutionId: ctx.executionId,
      amount: request.amount,
      asset: request.token,
      // The router, not a payee. A swap has no recipient the caller chose —
      // the pool is the router's to pick — so the venue is the honest value
      // for a column that records where the money went.
      destination: SOROSWAP_TESTNET_ROUTER,
      ...transaction,
    });
  }

  return result;
}

function refusalSummary(codes: number[], request: SwapRequestFacts): string {
  const described = codes.map((code) => `${describeContractError(code)} (#${code})`).join(', ');
  const axis = isRevokedRule(codes)
    ? 'The rule that authorized this agent is no longer on the account.'
    : isBoundaryRefusal(codes)
      ? 'The boundary installed on the account refused it.'
      : 'The contract refused it.';
  return (
    `The network refused to swap ${request.amount} of ${request.token} for ${request.outputAsset}. ` +
    `${axis} ${described}`
  );
}
