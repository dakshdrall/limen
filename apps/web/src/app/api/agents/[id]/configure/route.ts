/**
 * The reviewed configuration becomes a boundary, and the agent becomes
 * `CONFIGURED`.
 *
 * This is the step the whole screen exists for. Everything before it is a
 * model's suggestion and a person's corrections; this is where those become a
 * `PolicyProposal` derived by the same deterministic synthesizer that derives
 * one from an observed transaction, lowered by the same `lower` that decides
 * what an OpenZeppelin smart account can actually hold, and written down.
 *
 * ## The client's validation does not count, and this is why it is repeated
 *
 * `AgentConfigForm` validates as you type, and that validation is for showing
 * messages against fields. It is not a gate. This route re-runs `validate` on
 * the body it receives and derives everything from the result — the client's
 * idea of the cap never reaches `synthesize`.
 *
 * Brief §15 is the general rule and B8.1 states it for exactly this shape of
 * check: *a constraint that exists only in the frontend is not a boundary, it
 * is a hint that anyone calling the API directly skips.* The form is a
 * convenience. This is the check.
 *
 * ## Deriving here rather than at deploy
 *
 * The proposal is derived once, now, and stored. The deploy step installs
 * **that** proposal rather than deriving a second one, so the boundary a person
 * read on the review screen is the boundary that reaches `add_context_rule` —
 * every field, every value.
 *
 * **Not "byte for byte", and the difference is worth knowing.** `proposal_json`
 * is `jsonb`, and Postgres `jsonb` does not preserve key order — it stores a
 * decomposed representation and hands back keys in its own order. Measured, not
 * assumed: a proposal written and read back has identical fields and identical
 * values, and `JSON.stringify` of the two differs. Nothing downstream cares,
 * because `lower` and `installFunctions` read fields by name. What *would* care
 * is anybody who hashes the stored proposal and compares it to a hash of the
 * in-memory one, and that is the reason this paragraph exists rather than a
 * looser sentence.
 *
 * Deriving once is only sound because the derivation does not depend on the
 * smart account — which does not exist yet at this point — and `agent-config.ts`
 * makes that a claim checked by test rather than an assumption: `synthesize`
 * reads `source` solely to decide which movements are outflows and never copies
 * it into the result.
 *
 * The consequence, stated because it is a real edge: the rule's `valid_until`
 * is counted from **the ledger at configure time**. Sit on the review screen
 * for a week with a seven-day expiry and the deploy step will refuse, loudly,
 * rather than installing a rule that is already expired.
 */

import { rpc } from '@stellar/stellar-sdk';
import { SynthesisError, synthesize } from '@limen/core';
import { NotEnforceableError, lower } from '@limen/chain';
import { MAX_NAME_LENGTH } from '@/lib/agent-config';
import {
  compileToObservation,
  synthesisOptionsFor,
  validate,
  type AgentConfigDraft,
  type FieldProblem,
} from '@/lib/agent-config';
import { cleanAgentName } from '@/lib/agents';
import { clientIp, createRateLimit } from '@/lib/rate-limit';
import { requireUser } from '@/lib/route-session';
import { AgentNotFound, drizzleAgentStore } from '@/lib/stores';

// The Stellar SDK does not run on the Edge runtime.
export const runtime = 'nodejs';

const limit = createRateLimit({ max: 30, windowMs: 5 * 60 * 1000, namespace: 'agents-configure' });

/** A refusal that names the field it is about, so the form can place it. */
function invalid(problems: FieldProblem[]): Response {
  return Response.json({ error: 'invalid_config', problems }, { status: 422 });
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

  let draft: AgentConfigDraft;
  try {
    const body = (await request.json()) as { draft?: unknown };
    if (typeof body.draft !== 'object' || body.draft === null) throw new Error('missing draft');
    draft = body.draft as AgentConfigDraft;
    // `validate` reads every field off this object and copes with rubbish in
    // any of them, but it assumes `recipients` is iterable.
    if (!Array.isArray(draft.recipients)) draft = { ...draft, recipients: [] };
  } catch (error) {
    return Response.json(
      {
        error: `request body must be {"draft": AgentConfigDraft}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
      { status: 400 },
    );
  }

  // The gate. Not the form's copy of it.
  const checked = validate(draft);
  if (!checked.ok) return invalid(checked.problems);
  const config = checked.config;

  // A real name becomes required here rather than at DRAFT. `cleanAgentName`
  // would substitute a placeholder, which is right for a row recording an
  // attempt and wrong for one about to own a boundary.
  const name = cleanAgentName(config.name, MAX_NAME_LENGTH);
  if (name !== config.name) {
    return invalid([{ field: 'name', message: 'Give this agent a name before deploying it.' }]);
  }

  // Server-side only — the RPC endpoint is never exposed to the browser.
  const rpcUrl = process.env.SOROBAN_RPC_URL;
  if (rpcUrl === undefined || rpcUrl.length === 0) {
    return Response.json(
      {
        error: 'rpc_unconfigured',
        message:
          'This deployment has no Soroban RPC endpoint, so the current ledger cannot be read — and a rule’s expiry is counted from a ledger. Nothing was written.',
      },
      { status: 503 },
    );
  }

  let atLedger: number;
  try {
    atLedger = (await new rpc.Server(rpcUrl).getLatestLedger()).sequence;
  } catch (error) {
    return Response.json(
      {
        error: 'rpc_failed',
        message: 'The current ledger could not be read, so nothing was written.',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }

  // Derivation and lowering, both deterministic, both the same functions the
  // demonstrated mode uses. Neither knows which mode produced its input.
  let proposal;
  let plan;
  try {
    proposal = synthesize(compileToObservation(config, { atLedger }), synthesisOptionsFor(config));
    plan = lower(proposal);
  } catch (error) {
    if (error instanceof SynthesisError) {
      return Response.json(
        { error: 'not_derivable', code: error.code, message: error.message },
        { status: 422 },
      );
    }
    if (error instanceof NotEnforceableError) {
      // 422 and not 500, for the reason `/api/lower` gives: the request was
      // well-formed and Limen understood it completely; it declined. Reporting
      // a refusal as a server error would make the composition-only rule look
      // like a bug.
      return Response.json(
        {
          error: 'not_enforceable',
          refusal: { code: error.code, constraint: error.constraint, message: error.message },
        },
        { status: 422 },
      );
    }
    throw error;
  }

  try {
    const agent = await drizzleAgentStore().configure({
      agentId: id,
      userId: gate.user.id,
      name,
      proposal,
      installPlan: plan,
      enforcedOffChain: config.enforcedOffChain,
      headroomBps: synthesisOptionsFor(config).headroomBps,
      windowLedgers: config.onChain.windowLedgers,
      validUntilLedger: proposal.contextRule.validUntilLedger,
      observedLedger: proposal.contextRule.validFromLedger,
    });

    // `config` is the server's own validated result, not the body it was sent.
    // The review screen renders the off-chain half from this, so what a person
    // sees under "Enforced by Limen" is what was actually written to
    // `policies.enforced_offchain_json` rather than what their form computed.
    return Response.json(
      { agent, proposal, plan, config },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof AgentNotFound) {
      return Response.json({ error: 'not_found' }, { status: 404 });
    }
    console.error('limen agents: could not configure', error);
    return Response.json({ error: 'unavailable' }, { status: 503 });
  }
}
