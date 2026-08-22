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

import type { AgentConfigDraft } from '@/lib/agent-config';
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
}: {
  agentId: string | null;
  name: string;
  description: string;
}): Promise<AgentRecord> {
  const response = await fetch(agentId === null ? '/api/agents' : `/api/agents/${agentId}`, {
    method: agentId === null ? 'POST' : 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, description }),
  });
  if (!response.ok) throw await refusalFrom(response);
  const body = (await response.json()) as { agent: AgentRecord };
  return body.agent;
}
