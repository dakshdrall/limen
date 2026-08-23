/**
 * `send_payment` — the only tool in the MVP that moves money, and the only one
 * that signs.
 *
 * Everything here is assembled from `@limen/chain`; nothing is reimplemented.
 * §44.1's table, followed line by line: `transferFunction` builds the call,
 * `signAs` signs the auth entry, `submitAuthorized` does the two-simulation
 * dance, `submitWithBorrowedFootprint` gets a refusal onto a ledger, and
 * `isBoundaryRefusal` / `isRevokedRule` say what a failure was.
 *
 * ## The order, and what each step is for
 *
 * 1. **Read the boundary from the chain.** Every turn, never from a table.
 * 2. **Gate.** `decide` refuses only what the network cannot see — a paused
 *    agent, a recipient outside the allowlist. It does not pre-empt the cap;
 *    `gate.ts` explains at length why.
 * 3. **Mark the turn as submitting**, before anything is sent. This is the row
 *    that lets a crashed turn be reported as *may have submitted* rather than
 *    guessed at.
 * 4. **Open the key for exactly this turn** and sign inside the callback.
 * 5. **Classify**, into §4.4's vocabulary, and record the transaction.
 *
 * ## Why a refused payment costs a fee
 *
 * A call the boundary refuses fails the enforcing simulation, which produces no
 * transaction — and an attempt with no hash is this repository's word for what
 * would have happened. So when the refusal is the network's, the attempt is
 * rebuilt with a footprint borrowed from a call that does simulate, submitted,
 * and refused *on a ledger* with a hash anyone can look up. The fee is spent to
 * be told no, which is the point. `submitWithBorrowedFootprint`'s own header
 * says the same thing, and `/app/try` has done this in a browser since V4.
 *
 * The borrowed attempt is the **requested** call, not the small one it borrowed
 * a footprint from. If the window happened to roll between the simulation and
 * the submission, that call can succeed — and it is classified as a success,
 * because it is one. A path that assumed its own failure would report a
 * completed payment as a refusal.
 */

import { z } from 'zod';
import { xdr } from '@stellar/stellar-sdk';
import {
  assertDistinctSigners,
  describeContractError,
  enforcingFootprint,
  i128,
  isBoundaryRefusal,
  isRevokedRule,
  nativeTokenId,
  rawEd25519FromAddress,
  recordAuthEntries,
  signAs,
  submitAuthorized,
  submitWithBorrowedFootprint,
  transferFunction,
  type SubmitResult,
} from '@limen/chain';
import { TESTNET_PASSPHRASE } from '@limen/chain/network';
import { withAgentKey, type OpenAgentKey } from '@limen/custody';
import { decide, readBoundary, signerFor, type Boundary } from '../policy/gate.js';
import type { Tool, ToolContext } from './registry.js';
import type { ToolResult } from './types.js';

/**
 * How long a signed auth entry stays valid, in ledgers.
 *
 * ~5 minutes at a 5-second close. Long enough that a slow simulation and a
 * retried send both fit inside it, short enough that an entry captured off the
 * wire is not a signature with a long future. It is not a boundary — the rule's
 * own `valid_until` is — it is the lifetime of one signature.
 */
const AUTH_ENTRY_LEDGERS = 60;

/** The smallest transfer that can stand in for a permitted one. */
const ONE_STROOP = 1n;

export interface PaymentArgs {
  destination: string;
  stroops: string;
}

export const sendPayment: Tool<PaymentArgs> = {
  name: 'send_payment',
  kind: 'write',
  description:
    'Send XLM from the agent’s smart account to an address. The amount is in stroops — the smallest ' +
    'unit, 1 XLM = 10,000,000 stroops — as a string of digits, never a decimal.',
  schema: z.strictObject({
    destination: z
      .string()
      .regex(
        /^[GC][A-Z2-7]{55}$/,
        'must be a Stellar address: 56 characters starting with G (an account) or C (a contract)',
      ),
    // A string of digits, not a number: `stroops` can exceed 2^53 and a JSON
    // number would have already lost precision by the time this ran. Design
    // rule 5 begins at the edge of the system, not at the database.
    stroops: z
      .string()
      .regex(/^[1-9][0-9]{0,38}$/, 'must be a positive whole number of stroops, as a string of digits'),
  }),

  async run(args, ctx) {
    const token = nativeTokenId(TESTNET_PASSPHRASE);
    const amount = BigInt(args.stroops);
    const request = { token, destination: args.destination, amount };

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
      // Could not ask. Distinct from being told no — `read.ts` makes the same
      // distinction and for the same reason: "this account has no rules" and
      // "we could not ask" are different screens.
      return {
        outcome: 'infra_error',
        summary:
          'Limen could not read this agent’s boundary from the network, so it did not sign anything.',
        stage: error instanceof Error ? error.message : String(error),
      };
    }

    const decision = decide({
      agentStatus: ctx.agent.status,
      agentPublicKey: ctx.agent.agentPublicKey,
      request,
      enforcedOffchain: ctx.agent.enforcedOffchain,
      boundary,
    });

    if (decision.decision === 'refuse') {
      return refusedByLimen(ctx, decision);
    }

    return await execute(ctx, decision.boundary, request);
  },
};

/**
 * A Limen refusal, recorded and returned.
 *
 * There is no transaction row, because there is no transaction. Writing one
 * with a null hash would put a Limen refusal in the same table a person reads
 * for network refusals, one column away from looking like one.
 */
async function refusedByLimen(
  ctx: ToolContext,
  refusal: { constraint: string; reason: string; ledgerWould: 'refuse' | 'permit' | 'unknown' },
): Promise<ToolResult> {
  await ctx.store.setToolDecision({
    id: ctx.executionId,
    decision: 'refuse',
    reason: refusal.reason,
  });
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

/** The permitted path: open the key, sign, submit, classify. */
async function execute(
  ctx: ToolContext,
  boundary: Boundary,
  request: { token: string; destination: string; amount: bigint },
): Promise<ToolResult> {
  const signer = signerFor(boundary, ctx.agent.agentPublicKey);
  if (signer === undefined) {
    // `decide` already refused this case; reaching it here would mean the two
    // disagreed. Treated as an error rather than a refusal, because a
    // disagreement between the gate and the signer is a bug, not a policy.
    throw new Error('send_payment: the boundary names no verifier for the agent key.');
  }

  // The same guard `install.ts` calls before it builds a rule, for the same
  // reason: a boundary the bounded party could have installed itself proves
  // nothing. Only meaningful when the owner is an ed25519 key — a passkey owner
  // is a 65-byte SEC1 point and cannot collide with a 32-byte ed25519 key — so
  // the comparison is made where it can actually be true.
  if (ctx.agent.ownerSignerKind === 'ed25519') {
    assertDistinctSigners(
      rawEd25519FromAddress(ctx.agent.ownerPublicKey),
      rawEd25519FromAddress(ctx.agent.agentPublicKey),
    );
  }

  await ctx.store.setToolDecision({
    id: ctx.executionId,
    decision: 'permit',
    reason: null,
  });

  // Before anything is sent. See `store.ts`: this is what makes "died before
  // submitting" and "died after submitting" different facts rather than one
  // guess.
  await ctx.store.markSubmitting(ctx.turnId, {
    stage: 'submitting',
    toolExecutionId: ctx.executionId,
    destination: request.destination,
    stroops: request.amount.toString(),
    boundaryReadAtLedger: boundary.ledger,
  });

  const result = await withAgentKey(
    { provider: ctx.provider, agentId: ctx.agent.id, sealed: ctx.agent.sealedKey },
    async (key) => await submitPayment(ctx, boundary, request, signer.verifier, key),
  );

  return await classify(ctx, boundary, request, result);
}

/**
 * The submission, inside the one turn the key is open for.
 *
 * When the enforcing simulation refuses with a contract error code, the attempt
 * is rebuilt against a borrowed footprint so the refusal reaches a ledger. Both
 * paths return a `SubmitResult`, so the classification below does not need to
 * know which one produced it.
 */
async function submitPayment(
  ctx: ToolContext,
  boundary: Boundary,
  request: { token: string; destination: string; amount: bigint },
  verifier: string,
  key: OpenAgentKey,
): Promise<SubmitResult> {
  const signAuthEntry = signAs({
    signer: key,
    verifier,
    contextRuleIds: [boundary.ruleId],
    expirationLedger: boundary.ledger + AUTH_ENTRY_LEDGERS,
    passphrase: TESTNET_PASSPHRASE,
  });

  const transfer = (amount: bigint): xdr.HostFunction =>
    transferFunction({
      token: request.token,
      from: ctx.agent.smartAccount,
      to: request.destination,
      amount,
    });

  const common = {
    rpcUrl: ctx.rpcUrl,
    passphrase: TESTNET_PASSPHRASE,
    feeSource: ctx.agent.feeAccount,
    signEnvelope: key.signEnvelope,
    label: 'send_payment',
  } as const;

  const attempt = await submitAuthorized({
    ...common,
    func: transfer(request.amount),
    signAuthEntry,
  });

  // Reached a ledger, or failed for a reason no footprint can fix.
  if (attempt.stage === 'ledger' || attempt.code === null) return attempt;

  const ontoLedger = async (): Promise<SubmitResult> => {
    const borrowed = transfer(ONE_STROOP);
    const transactionData = await enforcingFootprint({ ...common, func: borrowed, signAuthEntry });

    const [recorded] = await recordAuthEntries({ ...common, func: borrowed });
    if (recorded === undefined) throw new Error('no auth entry to borrow');

    // The entry the permitted call produces, with the amount changed and signed
    // again — a real attempt by the agent's key, not a malformed transaction.
    // `transfer(from, to, amount)`: the amount is argument three.
    const entry = xdr.SorobanAuthorizationEntry.fromXDR(recorded.toXDR());
    entry.rootInvocation().function().contractFn().args()[2] = i128(request.amount);

    return await submitWithBorrowedFootprint({
      ...common,
      func: transfer(request.amount),
      transactionData,
      auth: [await signAuthEntry(entry)],
      label: 'send_payment-refused',
    });
  };

  try {
    return await ontoLedger();
  } catch {
    // The borrow failed — usually because nothing this agent can do simulates
    // cleanly right now, which is itself the refusal. The original result is
    // returned, and `classify` reports a network refusal with no hash and says
    // why, which the type requires it to.
    return attempt;
  }
}

/**
 * A `SubmitResult` in §4.4's vocabulary, with the transaction row that goes
 * with it.
 *
 * Pure, and separated from the writing for that reason: this mapping is the
 * most consequential decision in the file — it is where a failure becomes a
 * refusal, or does not — and it is worth being able to test every branch of it
 * without a network or a database.
 *
 * The rule the README states and this function implements: **a failure is not a
 * refusal until its error code says so**. Anything that did not reach a ledger
 * and carries no contract error code is an infrastructure error, and is never
 * rendered as a boundary doing its job.
 */
export function classifySubmit(
  result: SubmitResult,
  request: { token: string; destination: string; amount: bigint },
  contextRuleId: number,
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
            `Sent ${request.amount} stroops to ${request.destination}. ` +
            `Transaction ${result.hash} closed${result.ledger === null ? '' : ` in ledger ${result.ledger}`}.`,
          data: {
            stroops: request.amount.toString(),
            destination: request.destination,
            token: request.token,
            contextRuleId,
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

  // Never reached a ledger. Two very different reasons.
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
          'The contract refused this in simulation, so no transaction was submitted and there is no hash. ' +
          'Limen tried to put the attempt on a ledger anyway, by borrowing a footprint from a call the ' +
          'boundary permits, and that call could not be simulated either.',
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

/** The columns a `transactions` row carries about one attempt. */
export interface TransactionFacts {
  hash: string | null;
  reachedLedger: boolean;
  ledger: number | null;
  opResultName: string | null;
  contractErrorCodes: number[] | null;
  isBoundaryRefusal: boolean | null;
  isRevokedRule: boolean | null;
}

/** Classify, then record. The recording is the only impure half. */
async function classify(
  ctx: ToolContext,
  boundary: Boundary,
  request: { token: string; destination: string; amount: bigint },
  submitted: SubmitResult,
): Promise<ToolResult> {
  const { result, transaction } = classifySubmit(submitted, request, boundary.ruleId);

  if (transaction !== null) {
    await ctx.store.recordTransaction({
      agentId: ctx.agent.id,
      toolExecutionId: ctx.executionId,
      amount: request.amount,
      asset: request.token,
      destination: request.destination,
      ...transaction,
    });
  }

  return result;
}

function refusalSummary(
  codes: number[],
  request: { destination: string; amount: bigint },
): string {
  const described = codes.map((code) => `${describeContractError(code)} (#${code})`).join(', ');
  const axis = isRevokedRule(codes)
    ? 'The rule that authorized this agent is no longer on the account.'
    : isBoundaryRefusal(codes)
      ? 'The boundary installed on the account refused it.'
      : 'The contract refused it.';
  return (
    `The network refused to send ${request.amount} stroops to ${request.destination}. ` +
    `${axis} ${described}`
  );
}
