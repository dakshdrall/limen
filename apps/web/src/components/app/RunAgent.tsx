'use client';

import { useState } from 'react';
import { ExplorerLink } from '@/components/ExplorerLink';
import { chainTxUrl } from '@/lib/explorer';


/**
 * One cycle, on a button.
 *
 * The whole of Milestone 3 reachable from a screen: read the price, evaluate,
 * trade if it fires, and show what came back including the hash.
 *
 * There is a scheduler behind it now, and this button is deliberately not it.
 * A cycle a person starts carries no slot, is never counted against the
 * breaker, and is the way to find out whether a stopped schedule's cause has
 * gone before the schedule starts paying for it again. `ScheduleControls`
 * above is the control that starts and stops the unattended kind.
 *
 * ## The trigger is shown here and is no longer asked for here
 *
 * This screen used to carry three inputs — a reference price, a fall, a size —
 * because the builder collected no rule for *when* to trade and something had
 * to. That made the agent a one-shot with a form in front of it: two presses
 * could run two different strategies, and the rule a person thought they had
 * configured existed only in a text box.
 *
 * The rule now lives on the agent. What is left here is the rule, rendered so a
 * person can read what is about to be evaluated, and a button. Nothing on this
 * screen is sent — the runtime reads the trigger from storage — so what is
 * displayed and what runs cannot drift apart.
 *
 * ## What this control does not do
 *
 * It does not bound anything. Whatever the trigger says, `gate.ts` refuses what
 * only Limen can see and the installed cap refuses what exceeds it — on a
 * ledger, with a hash. A form that pre-checked an amount against the cap would
 * be the inversion this project exists to avoid, so it does not.
 */

interface CycleOutcome {
  outcome: string;
  summary: string;
  hash: string | null;
}

/**
 * The stored trigger, as much of it as a screen can trust.
 *
 * Narrowed from `agents.trigger_json` by the page, which is `unknown` there for
 * the reason the column gives. `null` covers both an agent with no trigger and
 * one whose stored trigger this build could not read; the two are told apart in
 * the prose below, because they are different facts.
 */
export interface StoredTrigger {
  referencePrice: string;
  referenceLedger: number;
  dropBps: number;
  amount: string;
}

/** The same cadence `AgentChat` polls at, and the same ceiling. */
const POLL_MS = 1_200;
const POLL_LIMIT = 60;

/**
 * Wait for the turn to finish, and report honestly when it does not.
 *
 * A dropped poll is not a failed cycle — the request is simply asked again. A
 * cycle that outlasts the ceiling is reported as *still running*, never as
 * failed: it may well have submitted, and calling it a failure would tell
 * somebody nothing happened when a transaction could be on a ledger.
 */
async function poll(turnId: string): Promise<CycleOutcome> {
  for (let attempt = 0; attempt < POLL_LIMIT; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));

    let response: Response;
    try {
      response = await fetch(`/api/turns/${turnId}`, { cache: 'no-store' });
    } catch {
      continue;
    }
    if (!response.ok) {
      return {
        outcome: 'infra_error',
        summary: `The result of this cycle could not be read (HTTP ${response.status}).`,
        hash: null,
      };
    }

    const view = (await response.json()) as {
      status: string;
      result: { outcome?: string; summary?: string; evidence?: { hash?: string } | null } | null;
    };
    if (view.status !== 'done') continue;

    const result = view.result ?? {};
    return {
      outcome: result.outcome ?? 'infra_error',
      summary: result.summary ?? 'This cycle finished without saying what it did.',
      hash: result.evidence?.hash ?? null,
    };
  }

  return {
    outcome: 'infra_error',
    summary:
      'This cycle is taking longer than this screen waits. It may still be running, and it may have ' +
      'submitted — check the activity before running another.',
    hash: null,
  };
}

export function RunAgent({
  agentId,
  trigger,
  triggerUnreadable = false,
}: {
  agentId: string;
  /** The stored rule, or null when there is none. */
  trigger: StoredTrigger | null;
  /** True when a trigger is stored and this build could not read it. */
  triggerUnreadable?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CycleOutcome | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setRefusal(null);
    setResult(null);

    try {
      // No body. The strategy is on the agent, and a payload here would be a
      // second place for it to live.
      const response = await fetch(`/api/agents/${agentId}/cycle`, {
        method: 'POST',
        cache: 'no-store',
      });
      const started = (await response.json()) as { turnId?: string; message?: string; error?: string };
      if (!response.ok || started.turnId === undefined) {
        setRefusal(started.message ?? started.error ?? 'The cycle did not start.');
        return;
      }

      const finished = await poll(started.turnId);
      setResult(finished);
    } catch (error) {
      setRefusal(error instanceof Error ? error.message : 'The cycle did not complete.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="col-head text-muted-dim">run one cycle</span>
        <p className="measure text-[12.5px] leading-relaxed text-muted">
          Reads the price from the venue, evaluates this agent&rsquo;s stored trigger, and trades
          only if it fires. One cycle per press — there is no scheduler, and nothing here runs on
          its own.
        </p>
      </div>

      {triggerUnreadable ? (
        // Not "no trigger". This agent has a rule and this build could not read
        // it, and telling somebody they have no rule when they have an
        // unreadable one is a lie about which of the two is wrong.
        <div className="panel" data-tone="unproven">
          <span className="col-head text-muted">the stored trigger could not be read</span>
          <p className="measure text-[12.5px] leading-relaxed text-muted">
            This agent has a trigger stored and Limen could not make sense of it. A cycle will
            refuse rather than guess at what it meant. Reconfigure the agent to replace it.
          </p>
        </div>
      ) : trigger === null ? (
        <div className="panel" data-tone="unproven">
          <span className="col-head text-muted">no trigger configured</span>
          <p className="measure text-[12.5px] leading-relaxed text-muted">
            This agent has no rule for when to trade, so a cycle reads the price, records it, and
            trades nothing. That is a real outcome, not a failure. Configure a trigger to give it
            one.
          </p>
        </div>
      ) : (
        <dl className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <dt className="col-head text-muted-dim">reference price</dt>
            <dd className="font-mono text-[13px] text-foreground">{trigger.referencePrice}</dd>
            {/* The ledger travels with the price, here as everywhere. It is also
                what tells a reference a person accepted apart from one a trade
                re-stamped. */}
            <dd className="text-[11.5px] text-faint">
              read at ledger {trigger.referenceLedger.toLocaleString('en-US')}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="col-head text-muted-dim">fires on a fall of</dt>
            <dd className="font-mono text-[13px] text-foreground">{trigger.dropBps} bps</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="col-head text-muted-dim">trade size</dt>
            <dd className="font-mono text-[13px] text-foreground">{trigger.amount}</dd>
          </div>
        </dl>
      )}

      {trigger !== null && !triggerUnreadable && (
        <p className="text-[12px] leading-relaxed text-faint">
          Amounts are in the input asset&rsquo;s smallest unit. This is the agent&rsquo;s stored
          rule — nothing on this screen is sent with the cycle, so what you read here is what runs.
          A cycle that trades moves the reference down to the price it traded at; it never moves up.
        </p>
      )}

      <div>
        <button
          type="button"
          className="btn"
          data-variant="primary"
          disabled={busy}
          onClick={() => void run()}
        >
          {busy ? 'Running one cycle…' : 'Run Agent'}
        </button>
      </div>

      {refusal !== null && (
        <p role="alert" className="measure text-[12.5px] leading-relaxed text-deny">
          {refusal}
        </p>
      )}

      {result !== null && (
        <div
          className="panel"
          data-tone={
            result.outcome === 'succeeded'
              ? 'permitted'
              : result.outcome === 'infra_error'
                ? 'pending'
                : 'refused'
          }
        >
          <span className="eyebrow text-muted">{result.outcome.replace(/_/g, ' ')}</span>
          <p role="status" className="measure text-[13px] leading-relaxed text-foreground/90">
            {result.summary}
          </p>
          {result.hash === null ? (
            // Said out loud rather than left blank. A cycle that traded nothing
            // has no hash because nothing was submitted, and a refusal that
            // never reached a ledger has none for a different reason — neither
            // is a missing value.
            <p className="text-[12px] leading-relaxed text-muted-dim">
              No transaction hash: nothing reached a ledger on this cycle.
            </p>
          ) : (
            <ExplorerLink href={chainTxUrl(result.hash)} title={result.hash}>
              <span className="value">{result.hash}</span>
            </ExplorerLink>
          )}
        </div>
      )}
    </div>
  );
}
