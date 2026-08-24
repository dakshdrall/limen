/**
 * The deployment is recorded only after the ledger has been asked about it.
 *
 * A browser reports back: here is the smart account I created, here is the rule
 * id `add_context_rule` returned, here are the two transaction hashes. Every
 * one of those is a claim, and `agent_accounts` is the one table in this flow
 * that stores facts *about a chain*. So the claims are checked before they are
 * written, by re-reading the account's context rules over RPC — the same
 * `readAllContextRules` that `/api/account/[id]` has used since V4, which needs
 * no fee and no signature because reads are simulations.
 *
 * Three things are checked, and each of them is a different lie:
 *
 *   1. **The rule exists on that account, at that id.** Catches an account that
 *      was never created, and a rule id invented or read from the wrong return
 *      value.
 *   2. **Its contract is the token the reviewed plan named.** Catches a
 *      boundary installed against a different asset from the one on the review
 *      screen — the failure that would otherwise let an agent spend something
 *      nobody approved.
 *   3. **Its spending limit equals the reviewed cap.** Catches the cap being
 *      widened between review and install.
 *
 * `valid_until` is checked too, since it is on the rule and free to compare.
 *
 * ## …and a fourth, added at M2: the rule bounds the key Limen actually holds
 *
 * `agentPublicKey` used to be a fact about the browser — it generated the agent
 * key, so its report was the only source there was. Since §3 moved that key
 * server-side, the reported address is a claim the client makes about a key
 * *Limen* generated, and it is checkable against the `agent_keys` row.
 *
 * Checking it is not pedantry. A client naming some other key — its own, or one
 * it invented — would install a perfectly valid boundary around a key Limen
 * cannot sign with. The deployment would verify on all three of the checks
 * above, the row would be written, and the agent would be recorded as `ACTIVE`
 * and be permanently unable to act: every turn refused by its own account, for
 * a reason nothing on any screen could explain. That is the most expensive
 * failure this route can let through, because it looks like success.
 *
 * ## What this does not do, and must not be read as doing
 *
 * It does not make `agents.status = 'ACTIVE'` a claim about the chain *now*.
 * `agents.ts` is explicit that it never is: a rule can be revoked a second
 * later and this row will not know. What the verification buys is narrower and
 * real — the row records a deployment that **did** happen, as the ledger
 * described it at the moment it was written, rather than as a browser reported
 * it.
 *
 * It also does not verify the two transaction hashes. They are recorded for
 * provenance and are checkable in an explorer by anybody; the rule being
 * present and correct is the property that matters, and it is checked directly
 * rather than inferred from a hash.
 *
 * ## A failed deployment says so
 *
 * `{ ok: false }` marks the agent `ERROR` and writes nothing else. That is a
 * state a person can act on — the deploy button comes back — and it is
 * distinguishable from `DEPLOYING`, which means Limen does not know.
 */

import { StrKey } from '@stellar/stellar-sdk';
import { readAllContextRules, readSpendingLimit } from '@limen/chain';
import { clientIp, createRateLimit } from '@/lib/rate-limit';
import { requireUser } from '@/lib/route-session';
import { simulationSource } from '@/lib/simulation-source';
import { AgentNotFound, drizzleAgentStore } from '@/lib/stores';

export const runtime = 'nodejs';

const limit = createRateLimit({ max: 20, windowMs: 10 * 60 * 1000, namespace: 'agents-deployed' });

/** A 64-character hex transaction hash, or nothing. */
const TX_HASH = /^[0-9a-f]{64}$/i;

function bad(message: string): Response {
  return Response.json({ error: 'bad_request', message }, { status: 400 });
}

function unverified(message: string): Response {
  // 422: the request was well-formed and the ledger disagreed with it. Not a
  // 500 — nothing here failed — and not a 200, because the row is not written.
  return Response.json({ error: 'unverified', message }, { status: 422 });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const gate = await requireUser();
  if ('refusal' in gate) return gate.refusal;

  if (await limit.check(clientIp(request))) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }

  const { id } = await params;
  const store = drizzleAgentStore();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return bad('The request body is not JSON.');
  }

  try {
    if (body.ok === false) {
      const agent = await store.markStatus({ agentId: id, userId: gate.user.id, status: 'ERROR' });
      return Response.json({ agent }, { headers: { 'cache-control': 'no-store' } });
    }

    const smartAccountContractId = String(body.smartAccountContractId ?? '');
    const deployTxHash = String(body.deployTxHash ?? '');
    const installTxHash = String(body.installTxHash ?? '');
    const ownerPublicKey = String(body.ownerPublicKey ?? '');
    const agentPublicKey = String(body.agentPublicKey ?? '');
    const contextRuleId = body.contextRuleId;
    const venueContextRuleId = body.venueContextRuleId ?? null;

    if (!StrKey.isValidContract(smartAccountContractId)) {
      return bad('smartAccountContractId is not a contract address.');
    }
    if (!StrKey.isValidEd25519PublicKey(ownerPublicKey)) {
      return bad('ownerPublicKey is not a Stellar account address.');
    }
    if (!StrKey.isValidEd25519PublicKey(agentPublicKey)) {
      return bad('agentPublicKey is not a Stellar account address.');
    }
    const heldAgentKey = await store.agentKeyPublic(id, gate.user.id);
    if (heldAgentKey === undefined) {
      return Response.json(
        {
          error: 'no_agent_key',
          message:
            'This agent has no server-held key, so a deployment naming one cannot be recorded. Begin the deploy again.',
        },
        { status: 409 },
      );
    }
    if (agentPublicKey !== heldAgentKey) {
      // 422 like the other verification failures: the request is well-formed
      // and disagrees with what Limen holds. Both keys are public, so naming
      // them costs nothing and is what makes this diagnosable.
      return unverified(
        `The boundary was installed against ${agentPublicKey}, and the key Limen holds for this agent is ${heldAgentKey}. ` +
          'An agent bounded around a key Limen cannot sign with would be recorded as active and never able to act. Nothing was recorded.',
      );
    }
    if (ownerPublicKey === agentPublicKey) {
      // The same check `assertDistinctSigners` makes on the way in, made again
      // on the way back: an agent bounded by a rule its own key installed is
      // not bounded, and a row recording that pair would be recording a
      // demonstration of nothing.
      return bad('The owner and agent keys are the same, so nothing was bounded.');
    }
    if (!TX_HASH.test(deployTxHash) || !TX_HASH.test(installTxHash)) {
      return bad('deployTxHash and installTxHash must each be a 64-character hex hash.');
    }
    if (typeof contextRuleId !== 'number' || !Number.isInteger(contextRuleId) || contextRuleId < 0) {
      return bad('contextRuleId must be a non-negative integer.');
    }
    // Null is legitimate — a payment agent has no venue rule — so only a
    // present value is checked, and it is checked the same way.
    if (
      venueContextRuleId !== null &&
      (typeof venueContextRuleId !== 'number' ||
        !Number.isInteger(venueContextRuleId) ||
        venueContextRuleId < 0)
    ) {
      return bad('venueContextRuleId must be a non-negative integer, or absent.');
    }

    const policy = await store.proposedPolicy(id, gate.user.id);
    if (policy === undefined) {
      return Response.json(
        { error: 'not_configured', message: 'This agent has no reviewed boundary to record.' },
        { status: 409 },
      );
    }

    const planned = policy.installPlan.rules[0];
    if (planned === undefined || policy.installPlan.rules.length !== 1) {
      return unverified('The reviewed plan does not describe exactly one context rule.');
    }

    const rpcUrl = process.env.SOROBAN_RPC_URL;
    const source = simulationSource();
    if (rpcUrl === undefined || rpcUrl.length === 0 || source === undefined) {
      return Response.json(
        {
          error: 'rpc_unconfigured',
          message:
            'This deployment cannot read the chain, so it cannot verify what was installed — and it will not record a deployment it has not checked.',
        },
        { status: 503 },
      );
    }

    const options = { rpcUrl, simulationSource: source };

    let installed;
    try {
      installed = await readAllContextRules(options, smartAccountContractId);
    } catch (error) {
      return Response.json(
        {
          error: 'rpc_failed',
          message: 'The account could not be read back, so the deployment was not recorded.',
          detail: error instanceof Error ? error.message : String(error),
        },
        { status: 502 },
      );
    }

    const rule = installed.find((candidate) => candidate.id === contextRuleId);
    if (rule === undefined) {
      return unverified(
        `The account does not carry a context rule ${contextRuleId}. Nothing was recorded.`,
      );
    }
    if (rule.contract !== planned.contract) {
      return unverified(
        `Context rule ${contextRuleId} authorizes ${rule.contract ?? 'no contract'}, and the reviewed boundary named ${planned.contract}. Nothing was recorded.`,
      );
    }
    if (rule.validUntilLedger !== planned.validUntilLedger) {
      return unverified(
        `Context rule ${contextRuleId} expires at ${rule.validUntilLedger ?? 'never'}, and the reviewed boundary expires at ${planned.validUntilLedger ?? 'never'}. Nothing was recorded.`,
      );
    }

    /*
     * The venue rule, verified the same way the boundary was.
     *
     * A browser reports both ids and the server trusts neither. This one is
     * checked against the plan as well as the ledger, because a venue rule is
     * an unconstrained rule — it authorizes every function on its contract —
     * and recording one the reviewed plan did not contain would be recording
     * authority nobody approved.
     *
     * The plan's venue rules are the ones with no policies. That is what
     * `lower.ts` builds and what makes them venues.
     */
    if (venueContextRuleId !== null) {
      const venue = installed.find((candidate) => candidate.id === venueContextRuleId);
      if (venue === undefined) {
        return unverified(
          `The account does not carry a context rule ${venueContextRuleId}. Nothing was recorded.`,
        );
      }
      const plannedVenue = policy.installPlan.rules.find(
        (candidate) => candidate.policies.length === 0 && candidate.contract === venue.contract,
      );
      if (plannedVenue === undefined) {
        return unverified(
          `Context rule ${venueContextRuleId} authorizes ${venue.contract ?? 'no contract'}, which the ` +
            'reviewed boundary did not name as a venue. Nothing was recorded.',
        );
      }
      if (venue.policies.length > 0) {
        // A rule reported as a venue that carries a policy is not the rule the
        // plan described, whatever its id says.
        return unverified(
          `Context rule ${venueContextRuleId} carries ${venue.policies.length} policies, and a venue rule ` +
            'carries none. Nothing was recorded.',
        );
      }
    }

    const plannedLimit = planned.policies[0];
    const policyContract = rule.policies[0];
    if (plannedLimit === undefined || policyContract === undefined) {
      return unverified('The installed rule carries no spending limit. Nothing was recorded.');
    }

    let onChainLimit;
    try {
      onChainLimit = await readSpendingLimit(
        options,
        policyContract,
        smartAccountContractId,
        contextRuleId,
      );
    } catch (error) {
      return Response.json(
        {
          error: 'rpc_failed',
          message: 'The spending limit could not be read back, so the deployment was not recorded.',
          detail: error instanceof Error ? error.message : String(error),
        },
        { status: 502 },
      );
    }

    // String comparison of two decimal integers, which is what both sides are.
    // Neither is parsed into a number on the way — see `@limen/core`'s rule
    // about the amount path.
    if (onChainLimit.limit !== plannedLimit.limit) {
      return unverified(
        `The installed cap is ${onChainLimit.limit} and the reviewed cap was ${plannedLimit.limit}. Nothing was recorded.`,
      );
    }
    if (onChainLimit.periodLedgers !== plannedLimit.windowLedgers) {
      return unverified(
        `The installed window is ${onChainLimit.periodLedgers} ledgers and the reviewed window was ${plannedLimit.windowLedgers}. Nothing was recorded.`,
      );
    }

    const agent = await store.recordDeployment({
      agentId: id,
      userId: gate.user.id,
      policyId: policy.id,
      smartAccountContractId,
      deployTxHash,
      installTxHash,
      contextRuleId,
      // Verified above against both the ledger and the reviewed plan: a venue
      // rule this browser claims but the account does not carry, or that the
      // plan did not name, is refused rather than recorded.
      venueContextRuleId,
      ownerPublicKey,
      agentPublicKey,
    });

    return Response.json(
      {
        agent,
        verified: {
          contextRuleId,
          contract: rule.contract,
          limit: onChainLimit.limit,
          periodLedgers: onChainLimit.periodLedgers,
          validUntilLedger: rule.validUntilLedger,
        },
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof AgentNotFound) return Response.json({ error: 'not_found' }, { status: 404 });
    console.error('limen agents: could not record a deployment', error);
    return Response.json({ error: 'unavailable' }, { status: 503 });
  }
}
