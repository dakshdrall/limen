'use client';

import { useState } from 'react';
import { ExplorerLink } from '@/components/ExplorerLink';
import { chainTxUrl } from '@/lib/explorer';


/**
 * One cycle, on a button.
 *
 * The whole of Milestone 3 reachable from a screen: read the price, evaluate,
 * trade if it fires, and show what came back including the hash. There is no
 * scheduler behind it and there is not meant to be — the agent acts when
 * somebody asks it to, once, and an agent that could start itself would be one
 * you cannot stop by stopping asking.
 *
 * ## The trigger is on this screen because it is not yet on the agent
 *
 * The builder collects a pair and a position size; it does not yet collect a
 * rule for *when* to trade. Rather than invent one at cycle time or pretend an
 * agent has a stored strategy it does not, this asks — with the reference
 * prefilled from the price the server just read, so the common case is one
 * click. The prose strategy above it is what the agent is *for*; these numbers
 * are what this cycle will actually evaluate, and the difference is stated on
 * screen rather than blurred.
 *
 * ## What this control does not do
 *
 * It does not bound anything. Whatever it sends, `gate.ts` refuses what only
 * Limen can see and the installed cap refuses what exceeds it — on a ledger,
 * with a hash. A form that pre-checked an amount against the cap would be the
 * inversion this project exists to avoid, so it does not.
 */

interface CycleOutcome {
  outcome: string;
  summary: string;
  hash: string | null;
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
  inputAsset,
  outputAsset,
  livePrice,
  suggestedAmount,
}: {
  agentId: string;
  inputAsset: string;
  outputAsset: string;
  /** Output units per probe of input, read server-side. Null when unavailable. */
  livePrice: string | null;
  /** The max position size, when one is configured. The obvious trade size. */
  suggestedAmount: string | null;
}) {
  const [reference, setReference] = useState(livePrice ?? '');
  const [dropBps, setDropBps] = useState('500');
  const [amount, setAmount] = useState(suggestedAmount ?? '');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CycleOutcome | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setRefusal(null);
    setResult(null);

    try {
      const trigger =
        reference.trim().length > 0 && amount.trim().length > 0
          ? {
              kind: 'price_drop' as const,
              referencePrice: reference.trim(),
              dropBps: Number(dropBps),
              amount: amount.trim(),
            }
          : null;

      const response = await fetch(`/api/agents/${agentId}/cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ config: { inputAsset, outputAsset, trigger } }),
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
          Reads the price from the venue, evaluates the trigger below, and trades only if it fires.
          One cycle per press — there is no scheduler, and nothing here runs on its own.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="col-head text-muted-dim">reference price</span>
          <input
            className="field"
            type="text"
            inputMode="numeric"
            value={reference}
            disabled={busy}
            onChange={(event) => setReference(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="col-head text-muted-dim">fires on a fall of (bps)</span>
          <input
            className="field"
            type="text"
            inputMode="numeric"
            value={dropBps}
            disabled={busy}
            onChange={(event) => setDropBps(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="col-head text-muted-dim">trade size</span>
          <input
            className="field"
            type="text"
            inputMode="numeric"
            value={amount}
            disabled={busy}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
      </div>

      <p className="text-[12px] leading-relaxed text-faint">
        The reference is prefilled with the price the server read for this page. Amounts are in the
        input asset&rsquo;s smallest unit. Leave the reference or the size empty to read the price
        without trading.
      </p>

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
