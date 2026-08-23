/**
 * The collection: listing this user's agents, and creating the row an agent is.
 *
 * ## `GET` reads the cap from the chain, once per agent, and never from a table
 *
 * This is the expensive decision in the file and it is deliberate. A list view
 * is where a denormalised `current_cap` column looks most reasonable — N ledger
 * reads for N rows — and `schema.ts` rule 2 refuses it in the sentence this
 * screen is most at risk of disproving: *every boundary looks perfectly obeyed
 * if you are reading yesterday's copy of it*. A cached list would render an
 * agent whose rule was revoked on another device as still bounded, which is the
 * worst available failure for a permissions tool.
 *
 * So each deployed agent costs two RPC reads — the account's context rules, and
 * the spending limit attached to the one this agent was deployed with — and the
 * answer carries the ledger it was true at. `LIST_READ_LIMIT` bounds how many
 * agents are read per request so a user with many agents cannot turn one page
 * load into an unbounded fan-out; the rest are returned with their pointers and
 * no cap, which the screen renders as *not read* rather than as *no boundary*.
 *
 * A read that fails is reported per agent rather than failing the request. One
 * unreadable account should not blank a list of working ones, and the row says
 * which of the two it is.
 *
 * `POST` writes a `DRAFT`. That happens the moment a description has been
 * turned into a proposed draft — before anything is configured, before an asset
 * has been chosen, and long before anything reaches a chain — because the row
 * is what gives the rest of the flow something to attach to and what makes an
 * abandoned attempt visible rather than lost.
 *
 * **No policy row is written here, and the absence is deliberate.** A described
 * agent has no installable boundary until a person supplies the token contract,
 * which the model is structurally unable to propose. Writing a `policies` row
 * now would mean writing one whose `proposal_json` is null and whose meaning is
 * "we had not finished asking" — which is what `DRAFT` on the agent already
 * says, in the column built to say it. The policy lands at `CONFIGURED`.
 */

import { readAllContextRules, readSpendingLimit } from '@limen/chain';
import { cleanAgentName } from '@/lib/agents';
import { MAX_DESCRIPTION_LENGTH, MAX_NAME_LENGTH } from '@/lib/agent-config';
import { clientIp, createRateLimit } from '@/lib/rate-limit';
import { requireUser } from '@/lib/route-session';
import { simulationSource } from '@/lib/simulation-source';
import { drizzleAgentStore } from '@/lib/stores';
import type { AgentSummary } from '@/lib/agents';

export const runtime = 'nodejs';

/**
 * How many agents get their boundary read per request.
 *
 * Not a page size — every agent is listed. It bounds the *fan-out*: a user with
 * forty deployed agents would otherwise turn one page load into eighty RPC
 * calls against a public endpoint. Agents past the limit are returned with
 * `cap: null` and `capState: 'not_read'`, which the screen must render as "not
 * read" and never as "no boundary" — the two are different facts and only one
 * of them is alarming.
 */
const LIST_READ_LIMIT = 12;

/** What one row's boundary read turned out to be. */
type CapState = 'read' | 'no_rule' | 'unconfigured' | 'failed' | 'not_read' | 'not_deployed';

interface ListedAgent extends AgentSummary {
  capState: CapState;
  cap: {
    limit: string;
    spentInWindow: string;
    periodLedgers: number;
    validUntilLedger: number | null;
    /** The ledger every number above was true at. Rendered, never dropped. */
    ledger: number;
  } | null;
  capDetail: string | null;
}

/**
 * This user's agents, with each deployed one's boundary read from the ledger.
 *
 * Scoped by `user_id` inside the query — `listForUser`, not a filter applied
 * afterwards. `lib/agents.ts` explains why there is no unscoped lookup at all,
 * and a list is where the omission would be least visible and most expensive.
 */
export async function GET(): Promise<Response> {
  const gate = await requireUser();
  if ('refusal' in gate) return gate.refusal;

  let summaries: AgentSummary[];
  try {
    summaries = await drizzleAgentStore().listForUser(gate.user.id);
  } catch (error) {
    console.error('limen agents: could not list agents', error);
    return Response.json({ error: 'unavailable' }, { status: 503 });
  }

  const rpcUrl = process.env.SOROBAN_RPC_URL;
  const source = simulationSource();
  const canRead = rpcUrl !== undefined && rpcUrl.length > 0 && source !== undefined;

  let read = 0;
  const agentList: ListedAgent[] = [];

  for (const summary of summaries) {
    // A draft has no account and no rule. Distinct from "deployed and we could
    // not read it", because one of those is a normal state and the other is a
    // problem, and a single null would make them look the same.
    if (summary.smartAccount === null || summary.contextRuleId === null) {
      agentList.push({ ...summary, capState: 'not_deployed', cap: null, capDetail: null });
      continue;
    }

    if (!canRead) {
      agentList.push({
        ...summary,
        capState: 'unconfigured',
        cap: null,
        capDetail:
          'This deployment has no SOROBAN_RPC_URL, so it cannot read what is installed on the account.',
      });
      continue;
    }

    if (read >= LIST_READ_LIMIT) {
      agentList.push({ ...summary, capState: 'not_read', cap: null, capDetail: null });
      continue;
    }
    read += 1;

    const options = { rpcUrl, simulationSource: source };
    try {
      const rules = await readAllContextRules(options, summary.smartAccount);
      const rule = rules.find((candidate) => candidate.id === summary.contextRuleId);

      // Absent, not empty. `remove_context_rule` leaves a gap, so a revoked
      // rule simply is not there — and that is the answer, not a failure.
      if (rule === undefined) {
        agentList.push({
          ...summary,
          capState: 'no_rule',
          cap: null,
          capDetail: `Context rule ${summary.contextRuleId} is not on this account. It was revoked, or the deploy never finished.`,
        });
        continue;
      }

      const policyContract = rule.policies[0];
      if (policyContract === undefined) {
        agentList.push({
          ...summary,
          capState: 'no_rule',
          cap: null,
          capDetail: `Context rule ${summary.contextRuleId} carries no spending limit.`,
        });
        continue;
      }

      const spend = await readSpendingLimit(
        options,
        policyContract,
        summary.smartAccount,
        summary.contextRuleId,
      );
      const ledger = await latestLedger(rpcUrl);

      agentList.push({
        ...summary,
        capState: 'read',
        cap: {
          limit: spend.limit,
          spentInWindow: spend.spentInWindow,
          periodLedgers: spend.periodLedgers,
          validUntilLedger: rule.validUntilLedger,
          ledger,
        },
        capDetail: null,
      });
    } catch (error) {
      // Per agent, not per request. One unreadable account must not blank a
      // list of working ones.
      agentList.push({
        ...summary,
        capState: 'failed',
        cap: null,
        capDetail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return Response.json(
    { agents: agentList, readLimit: LIST_READ_LIMIT },
    { headers: { 'cache-control': 'no-store' } },
  );
}

/** The sequence every number in a row was true at. Stated, never inferred. */
async function latestLedger(rpcUrl: string): Promise<number> {
  const { rpc } = await import('@stellar/stellar-sdk');
  return (await new rpc.Server(rpcUrl).getLatestLedger()).sequence;
}

/** Writes a row per call, so it is bounded the way `/api/auth/register` is. */
const limit = createRateLimit({ max: 20, windowMs: 5 * 60 * 1000, namespace: 'agents-create' });

export async function POST(request: Request): Promise<Response> {
  const gate = await requireUser();
  if ('refusal' in gate) return gate.refusal;

  if (await limit.check(clientIp(request))) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }

  let body: { name?: unknown; description?: unknown };
  try {
    body = (await request.json()) as { name?: unknown; description?: unknown };
  } catch {
    return Response.json({ error: 'request body must be JSON' }, { status: 400 });
  }

  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (description.length === 0) {
    return Response.json({ error: 'description must not be empty' }, { status: 400 });
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return Response.json(
      { error: `description must be at most ${MAX_DESCRIPTION_LENGTH} characters` },
      { status: 400 },
    );
  }

  try {
    const agent = await drizzleAgentStore().createDraft({
      userId: gate.user.id,
      // The model is told to leave a name empty rather than invent one, and
      // `agents.name` is NOT NULL. Naming the row for what it is keeps the
      // draft and its description; the review step requires a real name before
      // anything deploys.
      name: cleanAgentName(body.name, MAX_NAME_LENGTH),
      description,
    });
    return Response.json({ agent }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    // Not returned to the caller: the text of an unexpected database error is
    // one of the few places a connection string turns up. Same rule as
    // `auth-route.ts`'s `failure`.
    console.error('limen agents: could not create a draft', error);
    return Response.json({ error: 'unavailable' }, { status: 503 });
  }
}
