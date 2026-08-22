/**
 * An agent, as this application's server half sees one.
 *
 * The interface here and the Drizzle implementation in `stores.ts`, for the
 * reason `session.ts` gives about its own pair: `apps/web` reaches Postgres
 * over `neon-http`, which speaks Neon's HTTP protocol, so no local Postgres can
 * exercise that path. Everything above this interface is provable against a
 * fake; the part below it is written to be boring.
 *
 * ## Every lookup is scoped by owner, and there is no unscoped one
 *
 * {@link AgentStore} has no `findById(id)`. It has `findForUser(id, userId)`,
 * and that is not a convenience — an agent id is a UUID in a URL, and a lookup
 * that took the id alone would let any signed-in user read, configure and
 * deploy any other user's agent by pasting one. The scoping belongs in the
 * query rather than in a check the caller performs afterwards, for the same
 * reason `session.ts` puts expiry in the `where` clause: *"a row that has
 * expired must not be returned and then discarded by the caller, because that
 * is one `if` away from"* the bug.
 *
 * ## What is deliberately not in this module
 *
 * **Anything about the chain.** No cap, no remaining spend, no whether a rule
 * is live. `schema.ts` forbids caching those and gives the reason —
 * *"every boundary looks perfectly obeyed if you are reading yesterday's copy
 * of it"* — and the rule applies with more force here than in the browser,
 * because a server-side copy looks authoritative.
 *
 * The agent's **status** is not an exception to that and is worth saying so.
 * `ACTIVE` means Limen deployed this agent and believes nothing has revoked it;
 * it does not mean the context rule is live on the ledger this second. Anything
 * rendering a status beside a claim about permission has to read the rule.
 */

import 'server-only';

/** The lifecycle, as `agent_status` names it. A subset — this flow uses five. */
export type AgentStatus = 'DRAFT' | 'CONFIGURED' | 'DEPLOYING' | 'ACTIVE' | 'ERROR';

export interface AgentRecord {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  status: AgentStatus;
}

/**
 * What a described agent needs, and nothing else.
 *
 * `createDraft` is deliberately not `create(everything)`. At the moment an
 * agent is first written there is no configuration to write with it: the model
 * proposes a name, a cap and a window, but it cannot propose the token contract
 * — a person has to paste that — so nothing yet compiles to a policy. A row
 * carrying half a policy would be a row whose `proposal_json` meant "we had not
 * finished asking", which is exactly what `DRAFT` already means.
 *
 * So the policy row lands at `CONFIGURED`, when there is one, and this
 * interface stops here until then.
 */
export interface AgentStore {
  createDraft(input: { userId: string; name: string; description: string }): Promise<AgentRecord>;
  updateDraft(input: {
    id: string;
    userId: string;
    name: string;
    description: string;
  }): Promise<AgentRecord | undefined>;
  findForUser(id: string, userId: string): Promise<AgentRecord | undefined>;
}

/**
 * A name for an agent whose draft has not got one yet.
 *
 * `agents.name` is `NOT NULL`, and the model is allowed to return an empty
 * name — it is told to leave things empty rather than guess. Naming the row
 * after what it is, rather than refusing to write it, keeps the DRAFT row and
 * the description it carries; the review step then makes a real name required
 * before anything is deployed.
 */
export const UNNAMED_AGENT = 'Untitled agent';

/** Trimmed, bounded, and never empty, because the column is `NOT NULL`. */
export function cleanAgentName(value: unknown, max: number): string {
  if (typeof value !== 'string') return UNNAMED_AGENT;
  const trimmed = value.trim().slice(0, max);
  return trimmed.length === 0 ? UNNAMED_AGENT : trimmed;
}
