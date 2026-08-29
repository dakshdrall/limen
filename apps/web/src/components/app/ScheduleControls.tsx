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

const when = (iso: string | null): string => (iso === null ? 'never' : new Date(iso).toLocaleString());

export function ScheduleControls({ agentId, status, schedule }: Props) {
  const [current, setCurrent] = useState(status);
  const [view, setView] = useState(schedule);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const paused = current === 'PAUSED';
  // Only these two can be pressed. Anything else — mid-deploy, errored, not yet
  // deployed — is not a schedule somebody can start or stop, and a button that
  // returned 409 on every press would be a control that lies about what it does.
  const controllable = current === 'ACTIVE' || paused;
  const trippedAt = view?.disabledAt ?? null;

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
              {trippedAt !== null ? 'STOPPED BY LIMEN' : paused ? 'PAUSED' : view.enabled ? 'RUNNING' : 'OFF'}
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

      {trippedAt !== null ? (
        <div className="panel" data-tone="unproven">
          <span className="col-head text-muted">Limen stopped this schedule</span>
          <p className="measure text-[12.5px] leading-relaxed text-muted">
            {view!.consecutiveFailures} consecutive cycles ended as something other than a success
            — the last as <span className="value">{view!.disabledReason ?? 'unknown'}</span> — so
            the schedule was stopped at {when(trippedAt)}. Each of those cycles reached a ledger
            and paid a fee to be refused, which is what the count is protecting against.
          </p>
          <p className="measure text-[12.5px] leading-relaxed text-muted">
            The agent itself was not touched. It is still deployed, its boundary is still
            installed, and you can still run a cycle by hand — which is the way to find out
            whether the cause has gone before the schedule starts paying for it again.
          </p>
        </div>
      ) : null}

      {paused ? (
        <p className="measure text-[12.5px] leading-relaxed text-muted">
          Paused, so the scheduler does not see this agent at all. A cycle that was already queued
          or running when you paused was left alone — a turn that may have submitted is never
          treated as cancelled.
        </p>
      ) : null}

      {controllable ? (
        <button type="button" className="btn" onClick={() => void toggle()} disabled={busy}>
          {busy ? 'working…' : paused ? 'Resume schedule' : 'Pause schedule'}
        </button>
      ) : (
        <p className="text-[12px] leading-relaxed text-faint">
          Only a deployed, active agent can be paused. This one is {current}.
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
