'use client';

import { useState } from 'react';

/**
 * The schedule, said out loud, and the button that stops it.
 *
 * This component exists because of one failure mode: **a schedule that stopped
 * looking exactly like one that is running.** An agent whose breaker tripped is
 * still `ACTIVE`, still deployed, still bounded, and still runnable by hand —
 * every one of which is true and none of which means it is trading. Somebody
 * discovers that a week later, and by then the answer to "why did nothing
 * happen" is a database query.
 *
 * So the two states are rendered as two separate facts side by side: what the
 * *agent* is, and what its *schedule* is. Neither is inferred from the other.
 *
 * ## Three ways a schedule can be stopped, and they are not the same thing
 *
 *   - **Paused.** A person did it. `agents.status` is `PAUSED`, the due query
 *     stops seeing the agent, and pressing Resume undoes it exactly.
 *   - **Disabled by the breaker.** Three consecutive cycles ended as something
 *     other than succeeded. `disabled_at` and `disabled_reason` say when and
 *     why, and resuming does not clear them — they are history, and the count
 *     is cleared by a cycle that succeeds rather than by a button.
 *   - **No schedule at all.** Nothing is wrong; nothing was configured. Said in
 *     words, because a blank panel in this position reads as "stopped".
 */

/** `AgentSchedule` from `lib/agents`, as it crosses to the client. */
export interface ScheduleView {
  taskId: string;
  intervalSeconds: number | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  enabled: boolean;
  consecutiveFailures: number;
  disabledAt: string | null;
  disabledReason: string | null;
}

interface Props {
  agentId: string;
  status: string;
  schedule: ScheduleView | null;
}

const everyPhrase = (seconds: number | null): string => {
  if (seconds === null) return 'on a schedule';
  if (seconds % 3600 === 0) return `every ${seconds / 3600} hour${seconds === 3600 ? '' : 's'}`;
  if (seconds % 60 === 0) return `every ${seconds / 60} minute${seconds === 60 ? '' : 's'}`;
  return `every ${seconds} seconds`;
};

/**
 * The intervals offered, and nothing between them.
 *
 * A free-text seconds box invites 30, which the tick cannot honour and which
 * would silently become 60. These are the values the scheduler can actually
 * keep, and the shortest is a minute for that reason.
 */
const INTERVALS = [60, 300, 900, 1800, 3600, 21_600, 86_400];

const when = (iso: string | null): string => (iso === null ? 'never' : new Date(iso).toLocaleString());

export function ScheduleControls({ agentId, status, schedule }: Props) {
  const [current, setCurrent] = useState(status);
  const [view, setView] = useState(schedule);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [interval, setIntervalSeconds] = useState(view?.intervalSeconds ?? 900);

  const paused = current === 'PAUSED';
  // `disabledAt` is history and is deliberately never cleared, so it alone
  // cannot mean "stopped now" — a re-armed schedule would then render as
  // STOPPED BY LIMEN forever, which is the same lie as a stopped one rendering
  // as running, running the other way. The stop is `enabled === false`; the
  // columns say who stopped it.
  const stoppedByBreaker = view !== null && !view.enabled && view.disabledAt !== null;
  const stoppedByHand = view !== null && !view.enabled && view.disabledAt === null;
  // Only these two can be pressed. Anything else — mid-deploy, errored, not yet
  // deployed — is not a schedule somebody can start or stop, and a button that
  // returned 409 on every press would be a control that lies about what it does.
  const controllable = current === 'ACTIVE' || paused;

  const toggle = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/agents/${agentId}/pause`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paused: !paused }),
      });
      const body = (await response.json()) as {
        status?: string;
        schedule?: ScheduleView | null;
        detail?: string;
        error?: string;
      };
      if (!response.ok) {
        setError(body.detail ?? body.error ?? 'The pause could not be applied.');
        return;
      }
      if (body.status !== undefined) setCurrent(body.status);
      setView(body.schedule ?? null);
    } catch {
      setError('The pause did not reach the server, so nothing changed.');
    } finally {
      setBusy(false);
    }
  };

  const call = async (
    input: RequestInit & { url: string },
  ): Promise<{ status?: string; schedule?: ScheduleView | null } | undefined> => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(input.url, input);
      const body = (await response.json()) as {
        status?: string;
        schedule?: ScheduleView | null;
        detail?: string;
        error?: string;
      };
      if (!response.ok) {
        setError(body.detail ?? body.error ?? 'That did not apply, so nothing changed.');
        return undefined;
      }
      return body;
    } catch {
      setError('That did not reach the server, so nothing changed.');
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  const arm = async (): Promise<void> => {
    const body = await call({
      url: `/api/agents/${agentId}/schedule`,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ intervalSeconds: interval }),
    });
    if (body !== undefined) setView(body.schedule ?? null);
  };

  const disarm = async (): Promise<void> => {
    const body = await call({ url: `/api/agents/${agentId}/schedule`, method: 'DELETE' });
    if (body !== undefined) setView(null);
  };

  return (
    <div className="panel flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="col-head text-muted-dim">the schedule</span>
        {view === null ? (
          <p className="measure text-[12.5px] leading-relaxed text-muted">
            No schedule is configured, so this agent acts only when somebody presses Run. That is
            not a fault and nothing is stopped — there is simply nothing set to run on its own.
          </p>
        ) : (
          <p className="measure text-[12.5px] leading-relaxed text-muted">
            This agent runs one cycle {everyPhrase(view.intervalSeconds)}. A slot missed while the
            scheduler is down is not made up: a cycle that may have submitted must never be run
            twice, so the schedule moves forward rather than catching up.
          </p>
        )}
      </div>

      {view !== null ? (
        <dl className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <dt className="col-head text-muted-dim">agent status</dt>
            <dd className="font-mono text-[13px] text-foreground">{current}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="col-head text-muted-dim">schedule</dt>
            {/* Its own line, never inferred from the status beside it. A tripped
                breaker leaves the agent ACTIVE, and reading one from the other
                is the mistake this whole panel exists to prevent. */}
            <dd
              className="font-mono text-[13px]"
              data-tone={view.enabled && !paused ? undefined : 'unproven'}
            >
              {stoppedByBreaker
                ? 'STOPPED BY LIMEN'
                : paused
                  ? 'PAUSED'
                  : stoppedByHand
                    ? 'OFF'
                    : 'RUNNING'}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="col-head text-muted-dim">next run</dt>
            <dd className="font-mono text-[13px] text-foreground">
              {view.enabled && !paused ? when(view.nextRunAt) : '—'}
            </dd>
            <dd className="text-[11.5px] text-faint">last ran {when(view.lastRunAt)}</dd>
          </div>
        </dl>
      ) : null}

      {stoppedByBreaker ? (
        <div className="panel" data-tone="unproven">
          <span className="col-head text-muted">Limen stopped this schedule</span>
          <p className="measure text-[12.5px] leading-relaxed text-muted">
            {view!.consecutiveFailures} consecutive cycles ended as something other than a success
            — the last as <span className="value">{view!.disabledReason ?? 'unknown'}</span> — so
            the schedule was stopped at {when(view!.disabledAt)}. Each of those cycles reached a ledger
            and paid a fee to be refused, which is what the count is protecting against.
          </p>
          <p className="measure text-[12.5px] leading-relaxed text-muted">
            The agent itself was not touched. It is still deployed, its boundary is still
            installed, and you can still run a cycle by hand — which is the way to find out
            whether the cause has gone before the schedule starts paying for it again.
          </p>
        </div>
      ) : null}

      {view !== null && view.enabled && view.disabledAt !== null ? (
        <p className="measure text-[12px] leading-relaxed text-faint">
          Limen stopped this schedule once, at {when(view.disabledAt)}, after a run of{' '}
          <span className="value">{view.disabledReason ?? 'unknown'}</span>. It is running again
          because somebody armed it. That record is kept rather than cleared.
        </p>
      ) : null}

      {paused ? (
        <p className="measure text-[12.5px] leading-relaxed text-muted">
          Paused, so the scheduler does not see this agent at all. A cycle that was already queued
          or running when you paused was left alone — a turn that may have submitted is never
          treated as cancelled.
        </p>
      ) : null}

      {current === 'ACTIVE' || paused ? (
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="col-head text-muted-dim" htmlFor="schedule-interval">
              run one cycle every
            </label>
            <select
              id="schedule-interval"
              className="field"
              value={interval}
              disabled={busy}
              onChange={(event) => setIntervalSeconds(Number(event.target.value))}
            >
              {INTERVALS.map((option) => (
                <option key={option} value={option}>
                  {everyPhrase(option).replace('every ', '')}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="btn" onClick={() => void arm()} disabled={busy}>
            {busy ? 'working…' : view === null ? 'Enable schedule' : 'Apply'}
          </button>
          {view !== null ? (
            <button type="button" className="btn" onClick={() => void disarm()} disabled={busy}>
              Remove schedule
            </button>
          ) : null}
        </div>
      ) : null}

      {controllable && view !== null ? (
        <button type="button" className="btn" onClick={() => void toggle()} disabled={busy}>
          {busy ? 'working…' : paused ? 'Resume schedule' : 'Pause schedule'}
        </button>
      ) : controllable ? null : (
        <p className="text-[12px] leading-relaxed text-faint">
          Only a deployed, active agent can be scheduled or paused. This one is {current}.
        </p>
      )}

      {error !== null ? (
        <p role="alert" className="measure text-[12.5px] leading-relaxed text-deny">
          {error}
        </p>
      ) : null}
    </div>
  );
}
