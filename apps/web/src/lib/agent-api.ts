'use client';

/**
 * Every call this application makes to `/api/agents`, written once.
 *
 * The same rule `identity.ts` states for `/api/auth`: there is one client half,
 * and a screen does not write its own `fetch`. The reason is the same too —
 * these endpoints have failure modes that must be rendered rather than thrown
 * (not signed in, no database, rate limited), and a second call site is where
 * one of them starts being handled differently from the other.
 *
 * ## Degradation is a value, not an exception
 *
 * {@link generateDraft} resolves with a draft whether or not Claude answered.
 * With no `ANTHROPIC_API_KEY` the route returns an empty draft and a sentence
 * saying so, and this function passes both on unchanged. A caller that had to
 * catch an error to discover the ordinary unconfigured case would end up
 * treating "fill this in yourself" as a failure.
 */

import type { PolicyProposal } from '@limen/core';
import type { AgentConfig, AgentConfigDraft, FieldProblem } from '@/lib/agent-config';
import type { InstallPlan } from '@/lib/lower-contract';
import type { AgentRecord } from '@/lib/agents';
import type { GenerationNote } from '@/lib/agent-generation';

/** A route said no, in a way a screen should render rather than log. */
export class AgentApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AgentApiError';
    this.code = code;
  }
}

/** The sentence a person should read for each way a route refuses. */
const REFUSALS: Record<string, string> = {
  unauthenticated: 'Your session has ended. Sign in again from the header.',
  wrong_status: 'This agent is not in a state that can be deployed.',
  not_configured: 'This agent has no reviewed boundary yet. Accept the limits first.',
  rpc_unconfigured:
    'This deployment cannot read the chain, so it will not record a deployment it has not checked.',
  unavailable: 'This deployment has no database, so agents cannot be stored.',
  rate_limited: 'That is more requests than this endpoint allows for now. Wait a minute.',
  not_found: 'That agent no longer exists, or it is not yours.',
};

async function refusalFrom(response: Response): Promise<AgentApiError> {
  let code = 'unknown';
  let message = '';
  try {
    const body = (await response.json()) as { error?: unknown; message?: unknown };
    if (typeof body.error === 'string') code = body.error;
    if (typeof body.message === 'string') message = body.message;
  } catch {
    // A body that is not JSON is a proxy or a crash, not a route. The status is
    // all there is to report, and inventing detail would be worse than saying so.
  }
  return new AgentApiError(
    code,
    REFUSALS[code] ?? (message.length > 0 ? message : `The request failed (${response.status}).`),
  );
}

export interface GeneratedDraftResult {
  generated: boolean;
  draft: AgentConfigDraft;
  notes: GenerationNote[];
  degraded?: string;
}

/** A description to a proposed draft. Never throws for the unconfigured case. */
export async function generateDraft(description: string): Promise<GeneratedDraftResult> {
  const response = await fetch('/api/agents/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ description }),
  });
  if (!response.ok) throw await refusalFrom(response);
  return (await response.json()) as GeneratedDraftResult;
}

/**
 * Writes the `DRAFT` row, or updates the one this flow already made.
 *
 * The branch is on `agentId` rather than on a flag, so there is no way to call
 * this in "create" mode with an id in hand.
 */
export async function saveDraft({
  agentId,
  name,
  description,
  draft,
}: {
  agentId: string | null;
  name: string;
  description: string;
  /**
   * The proposal, stored alongside the row so the review screen can read it.
   *
   * Sent because the builder is one screen per step now: without this the
   * generated numbers live only in the tab that generated them and are gone
   * the moment the flow navigates. It is stored untrusted — see the column's
   * comment in the schema — and re-validated server-side on the way to a
   * policy, so sending it grants it nothing.
   */
  draft?: unknown;
}): Promise<AgentRecord> {
  const response = await fetch(agentId === null ? '/api/agents' : `/api/agents/${agentId}`, {
    method: agentId === null ? 'POST' : 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, description, draft }),
  });
  if (!response.ok) throw await refusalFrom(response);
  const body = (await response.json()) as { agent: AgentRecord };
  return body.agent;
}

/**
 * What `CONFIGURED` came back with: the boundary, and what it lowers to.
 *
 * `plan` is typed off `lower-contract.ts` rather than `@limen/chain` for the
 * reason that module exists — `@limen/chain`'s index pulls the Stellar SDK, and
 * a client component naming the type must not pull a signing library with it.
 */
export interface ConfiguredAgent {
  agent: AgentRecord;
  proposal: PolicyProposal;
  plan: InstallPlan;
  /**
   * The server's own validated config, not the draft that was sent.
   *
   * The review screen renders the off-chain half from this so that what appears
   * under "Enforced by Limen" is what reached `policies.enforced_offchain_json`
   * — not what the form believed it was sending.
   */
  config: AgentConfig;
}

/** A refusal that belongs on the fields rather than in a banner. */
export class ConfigRejected extends Error {
  readonly problems: FieldProblem[];

  constructor(problems: FieldProblem[]) {
    super('The configuration was refused.');
    this.name = 'ConfigRejected';
    this.problems = problems;
  }
}

/** Limen understood it completely and declined — see `lower.ts`. */
export class NotEnforceableRefusal extends Error {
  readonly constraint: string;

  constructor(constraint: string, message: string) {
    super(message);
    this.name = 'NotEnforceableRefusal';
    this.constraint = constraint;
  }
}

/**
 * The reviewed draft becomes a stored boundary.
 *
 * The server re-validates and re-derives; this function does not send a config,
 * it sends the draft. Anything the form computed is a convenience that stops at
 * the network boundary.
 */
export async function configureAgent(
  agentId: string,
  draft: AgentConfigDraft,
): Promise<ConfiguredAgent> {
  const response = await fetch(`/api/agents/${agentId}/configure`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ draft }),
  });

  if (response.status === 422) {
    const body = (await response.json()) as {
      error?: string;
      problems?: FieldProblem[];
      refusal?: { constraint: string; message: string };
      message?: string;
    };
    if (body.error === 'invalid_config' && Array.isArray(body.problems)) {
      throw new ConfigRejected(body.problems);
    }
    if (body.error === 'not_enforceable' && body.refusal !== undefined) {
      throw new NotEnforceableRefusal(body.refusal.constraint, body.refusal.message);
    }
    throw new AgentApiError(
      body.error ?? 'invalid_config',
      body.message ?? 'These limits could not be turned into a boundary.',
    );
  }

  if (!response.ok) throw await refusalFrom(response);
  return (await response.json()) as ConfiguredAgent;
}

/** What `/api/agents/[id]/deploy` hands back: the boundary to install. */
export interface DeploymentStart {
  agent: AgentRecord;
  policyId: string;
  /**
   * The reviewed plan, read out of `policies.install_plan_json`.
   *
   * The client does not send a plan and cannot influence one. It asks for the
   * plan belonging to the agent it is deploying and installs that, so the rule
   * that reaches `add_context_rule` is the rule that was on the review screen.
   */
  plan: InstallPlan;
  /**
   * The agent's `G…`, generated on a Limen server and held there.
   *
   * The browser is told the address and never the key. It funds this account so
   * the agent can pay its own fees, and installs the boundary naming it as the
   * rule's signer — both things it can do with a public address alone.
   *
   * Not a value this client may substitute: `/api/agents/[id]/deployed` re-reads
   * the installed rule and refuses to record a deployment whose agent is not the
   * key Limen holds. See that route's header for what substituting it would
   * cost.
   */
  agentPublicKey: string;
  /** True on a first deploy, false when a retry reused an existing key. */
  agentKeyGenerated: boolean;
}

export async function beginDeployment(agentId: string): Promise<DeploymentStart> {
  const response = await fetch(`/api/agents/${agentId}/deploy`, { method: 'POST' });
  if (!response.ok) throw await refusalFrom(response);
  return (await response.json()) as DeploymentStart;
}

/** What the ledger said when the deployment was checked against it. */
export interface VerifiedDeployment {
  contextRuleId: number;
  contract: string | null;
  limit: string;
  periodLedgers: number;
  validUntilLedger: number | null;
}

export interface DeploymentRecorded {
  agent: AgentRecord;
  verified: VerifiedDeployment;
}

/**
 * Report the deployment, and have the server check it against the chain.
 *
 * Every field here is a claim this browser is making. The route re-reads the
 * account's context rules over RPC and refuses to write the row if the rule id,
 * its contract, its cap, its window or its expiry disagree with the boundary
 * that was reviewed — so a 422 from here is the ledger contradicting this
 * browser, not a validation error.
 */
export async function recordDeployment(
  agentId: string,
  facts: {
    smartAccountContractId: string;
    deployTxHash: string;
    installTxHash: string;
    contextRuleId: number;
    ownerPublicKey: string;
    agentPublicKey: string;
  },
): Promise<DeploymentRecorded> {
  const response = await fetch(`/api/agents/${agentId}/deployed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ok: true, ...facts }),
  });
  if (!response.ok) throw await refusalFrom(response);
  return (await response.json()) as DeploymentRecorded;
}

/**
 * The deployment did not finish, and the agent should say so.
 *
 * Deliberately best-effort at the call site: this is reported after something
 * has already gone wrong, and a failure to report a failure must not replace
 * the original message with its own.
 */
export async function recordDeploymentFailed(agentId: string): Promise<void> {
  await fetch(`/api/agents/${agentId}/deployed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ok: false }),
  });
}
