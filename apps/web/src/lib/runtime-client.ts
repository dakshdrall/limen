/**
 * The web app's side of the call to `apps/runtime`.
 *
 * Two routes, both described by `apps/runtime/src/http.ts`, which is the
 * authority on their shapes:
 *
 *     POST /agents/:id/turns   → 202 { turnId }
 *     GET  /turns/:id          → 200 { status, outcome, result }
 *
 * ## Why the web app calls it at all, rather than doing the work
 *
 * §7.5.4: a turn takes 15–45 seconds and can move money. A Next.js route
 * handler is the wrong place for both — the platform will time it out, and a
 * payment in flight inside a handler that dies is a payment nobody can account
 * for. So the runtime owns execution and this file owns asking.
 *
 * ## The credential is the user's session token, presented as a bearer
 *
 * `apps/runtime/src/auth.ts` explains the direction at length: the session
 * cookie is `SameSite=lax`, so a browser cannot POST it to the runtime's origin
 * cross-site, and that is CSRF protection working rather than an obstacle. The
 * web app is the party that already authenticated the person, so it forwards
 * the same token as `Authorization: Bearer`. Nothing new is trusted — the token
 * still has to hash to a live `sessions` row on the other side.
 *
 * That means this module must never be reachable from the browser. `server-only`
 * is what enforces it: importing this into a client component is a build error,
 * not a review comment.
 */

import 'server-only';

/**
 * Where the runtime is. No default, and no `localhost` fallback.
 *
 * A fallback would make a misconfigured production deploy fail by quietly
 * trying to reach a runtime that is not there, which surfaces as a timeout
 * thirty seconds later on the money path. Unset is reported as unset.
 */
export const RUNTIME_URL_ENV = 'LIMEN_RUNTIME_URL';

/**
 * What the caller gets back. `unavailable` is separate from every HTTP failure
 * because it is the one an operator can fix, and telling a user their payment
 * failed when the runtime was never configured is a false report.
 */
export type RuntimeCall<T> =
  | { ok: true; value: T }
  | { ok: false; kind: 'unavailable'; detail: string }
  | { ok: false; kind: 'http'; status: number; error: string }
  | { ok: false; kind: 'unreachable'; detail: string };

export interface StartedTurn {
  turnId: string;
  status: 'queued' | 'running' | 'done';
  poll: string;
}

/**
 * The runtime's view of a turn, field for field as `getTurn` sends it.
 *
 * `status` and `outcome` are separate for the reason `0004_turns.sql` gives: a
 * turn that ended in a refusal is **done**, not failed. A renderer that folded
 * them into one state would have to invent a word for a refusal, and the word
 * it would reach for is "error".
 *
 * `result` stays `unknown`. It is a `ToolResult` — §4.4's five-way union — and
 * narrowing it is the interface's job, at the point where each arm is drawn
 * differently. Typing it loosely here and precisely there keeps the parsing in
 * the one place that has to distinguish the arms anyway.
 */
export interface TurnView {
  turnId: string;
  agentId: string;
  channel: 'web' | 'telegram' | 'api';
  status: 'queued' | 'running' | 'done';
  outcome: string | null;
  request: unknown;
  result: unknown;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

function baseUrl(): string | undefined {
  const raw = process.env[RUNTIME_URL_ENV];
  return raw === undefined || raw.trim().length === 0 ? undefined : raw.trim().replace(/\/+$/, '');
}

async function call<T>(
  path: string,
  token: string | undefined,
  init: RequestInit,
): Promise<RuntimeCall<T>> {
  const base = baseUrl();
  if (base === undefined) {
    return {
      ok: false,
      kind: 'unavailable',
      detail: `${RUNTIME_URL_ENV} is not set, so there is no runtime to run this turn.`,
    };
  }

  if (token === undefined || token.length === 0) {
    // Caught here rather than sent: an unauthenticated request would come back
    // 401 and read like an expired session, which is a different problem with
    // a different fix.
    return { ok: false, kind: 'unavailable', detail: 'No session token to present.' };
  }

  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      // A turn is accepted, not awaited — the POST returns as soon as the row
      // is written. Anything slower than this is the runtime being unwell.
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    });
  } catch (error) {
    return {
      ok: false,
      kind: 'unreachable',
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  const body: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    const error =
      typeof body === 'object' && body !== null && 'error' in body
        ? String((body as { error: unknown }).error)
        : 'unknown_error';
    return { ok: false, kind: 'http', status: response.status, error };
  }

  return { ok: true, value: body as T };
}

/** Enqueue a turn. Returns the id the caller polls, not the result. */
export function startTurn(
  agentId: string,
  token: string | undefined,
  request: { tool: string; arguments: Record<string, unknown>; channel: 'web' | 'telegram' | 'api' },
): Promise<RuntimeCall<StartedTurn>> {
  return call<StartedTurn>(`/agents/${agentId}/turns`, token, {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

/** What happened, or "not yet". The same route Telegram will poll. */
export function readTurn(turnId: string, token: string | undefined): Promise<RuntimeCall<TurnView>> {
  return call<TurnView>(`/turns/${turnId}`, token, { method: 'GET' });
}
