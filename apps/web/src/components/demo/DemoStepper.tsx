'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_SYNTHESIS_OPTIONS,
  SynthesisError,
  evaluate,
  generateDenyCases,
  synthesize,
  type ObservedTransaction,
  type PolicyProposal,
} from '@limen/core';
import { REFUSAL_CODES, type IngestError } from '@/lib/ingest-contract';
import { explorerTxUrl } from '@/lib/explorer';
import { INITIAL_STATE, loadState, saveState, type DemoState } from '@/lib/demo-state';
import { DenyTable, type AdjudicatedCase } from '../DenyTable';
import { ObservedSection } from '../ObservedSection';
import { PolicyTable } from '../PolicyTable';
import { RefusalSection } from '../RefusalSection';
import { Beat, type BeatKind } from './Beat';

const BEATS: Array<{ index: number; title: string; kind: BeatKind; blurb: string }> = [
  {
    index: 1,
    title: 'Perform a transaction',
    kind: 'on-chain',
    blurb:
      'A real transfer is submitted to Stellar testnet from a disposable demo account, so you need no wallet and no funded account of your own.',
  },
  {
    index: 2,
    title: 'Observe it',
    kind: 'on-chain',
    blurb:
      'That hash is read back through Soroban RPC and turned into an observable flow — the same live path a pasted hash takes.',
  },
  {
    index: 3,
    title: 'Derive the boundary',
    kind: 'computed',
    blurb:
      'The minimum context rule and policy set that permits exactly that flow, composed from audited OpenZeppelin primitives.',
  },
  {
    index: 4,
    title: 'Try to exceed it',
    kind: 'computed',
    blurb:
      'Adjacent transactions, one mutated dimension each. Every one must be refused.',
  },
  {
    index: 5,
    title: 'Read the policy',
    kind: 'computed',
    blurb: 'The exact policy configuration that would be installed, and the unsigned payload.',
  },
];

type IngestOutcome =
  | { ok: true; observed: ObservedTransaction }
  | { ok: false; error: { code: string; message: string; detail?: string } };

/**
 * Reads a hash back through the live ingest path. Touches no React state, so
 * both the button handler and the resume effect can call it — the effect awaits
 * it before updating anything.
 */
async function fetchObserved(hash: string): Promise<IngestOutcome> {
  try {
    const response = await fetch('/api/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hash, network: 'testnet' }),
    });
    if (!response.ok) {
      const payload = (await response.json()) as IngestError;
      return { ok: false, error: payload.error };
    }
    return { ok: true, observed: (await response.json()) as ObservedTransaction };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'unreachable',
        message: 'Could not reach the ingest endpoint.',
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export function DemoStepper({
  signerAvailable,
  signerReason,
}: {
  signerAvailable: boolean;
  signerReason: string | null;
}) {
  const [state, setState] = useState<DemoState>(INITIAL_STATE);
  const [observed, setObserved] = useState<ObservedTransaction | null>(null);
  const [xdr, setXdr] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<number, { code: string; message: string; detail?: string }>>({});
  const restored = useRef(false);

  // Resume. Only the beat index and the hash come back — everything derived is
  // recomputed below from the observed transaction.
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    setState(loadState(window.sessionStorage));
  }, []);

  useEffect(() => {
    if (!restored.current) return;
    saveState(window.sessionStorage, state);
  }, [state]);

  const setError = useCallback((beat: number, error: { code: string; message: string; detail?: string }) => {
    setErrors((previous) => ({ ...previous, [beat]: error }));
  }, []);

  const clearError = useCallback((beat: number) => {
    setErrors((previous) => {
      const next = { ...previous };
      delete next[beat];
      return next;
    });
  }, []);

  /* --- beat 1: perform ------------------------------------------------- */

  async function perform() {
    setBusy(1);
    clearError(1);
    try {
      const response = await fetch('/api/demo/perform', { method: 'POST' });
      const payload = (await response.json()) as { hash?: string; error?: { code: string; message: string } };
      if (!response.ok || payload.hash === undefined) {
        setError(1, payload.error ?? { code: 'submit_failed', message: 'the demo transaction failed' });
        return;
      }
      setObserved(null);
      setState((previous) => ({ ...previous, beat: 2, hash: payload.hash ?? null }));
    } catch (error) {
      setError(1, {
        code: 'unreachable',
        message: 'Could not reach the demo endpoint.',
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(null);
    }
  }

  /* --- beat 2: observe -------------------------------------------------- */

  const applyOutcome = useCallback(
    (outcome: IngestOutcome) => {
      if (outcome.ok) {
        setObserved(outcome.observed);
        setState((previous) => (previous.beat < 3 ? { ...previous, beat: 3 } : previous));
      } else {
        setError(2, outcome.error);
      }
    },
    [setError],
  );

  const observe = useCallback(
    async (hash: string) => {
      setBusy(2);
      clearError(2);
      try {
        applyOutcome(await fetchObserved(hash));
      } finally {
        setBusy(null);
      }
    },
    [applyOutcome, clearError],
  );

  // Resuming past beat 2 re-runs the observation from the stored hash rather
  // than restoring a stored transaction — the hash is the only thing worth
  // persisting, and re-reading it is what keeps the rendered flow honest.
  //
  // The fetch is awaited before any state is touched, so this effect never
  // updates state synchronously on mount.
  const resumeHash = state.hash !== null && state.beat >= 3 && observed === null ? state.hash : null;
  useEffect(() => {
    if (resumeHash === null) return;
    let cancelled = false;

    void (async () => {
      const outcome = await fetchObserved(resumeHash);
      if (!cancelled) applyOutcome(outcome);
    })();

    return () => {
      cancelled = true;
    };
  }, [resumeHash, applyOutcome]);

  /* --- beats 3 and 4: derived, every time ------------------------------- */

  const { proposal, refusal } = useMemo((): {
    proposal: PolicyProposal | null;
    refusal: { code: string; message: string } | null;
  } => {
    if (observed === null) return { proposal: null, refusal: null };
    try {
      return { proposal: synthesize(observed, DEFAULT_SYNTHESIS_OPTIONS), refusal: null };
    } catch (error) {
      if (error instanceof SynthesisError) {
        return { proposal: null, refusal: { code: error.code, message: error.message } };
      }
      return {
        proposal: null,
        refusal: { code: 'not_expressible', message: error instanceof Error ? error.message : String(error) },
      };
    }
  }, [observed]);

  const adjudicated: AdjudicatedCase[] = useMemo(() => {
    if (observed === null || proposal === null) return [];
    return generateDenyCases(observed, proposal).map((denyCase) => ({
      denyCase,
      decision: evaluate(proposal, denyCase.candidate),
    }));
  }, [observed, proposal]);

  /* --- beat 5: the payload ---------------------------------------------- */

  useEffect(() => {
    if (proposal === null || state.beat < 5) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/install-preview', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ proposal }),
        });
        const payload = (await response.json()) as { xdr?: string; error?: string };
        if (!cancelled && payload.xdr !== undefined) setXdr(payload.xdr);
      } catch {
        // Beat 5's payload is a rendering of the proposal; failing to build it
        // does not invalidate anything above.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [proposal, state.beat]);

  const advance = (to: number) => setState((previous) => ({ ...previous, beat: Math.max(previous.beat, to) }));

  const explorer = state.hash !== null ? explorerTxUrl({ network: 'testnet', hash: state.hash }) : undefined;

  return (
    <ol className="flex flex-col gap-5">
      {BEATS.map((beat) => (
        <Beat
          key={beat.index}
          index={beat.index}
          title={beat.title}
          kind={beat.kind}
          blurb={beat.blurb}
          reached={state.beat >= beat.index}
          busy={busy === beat.index}
          error={errors[beat.index]}
          isRefusal={errors[beat.index] !== undefined && REFUSAL_CODES.has(errors[beat.index]!.code as never)}
        >
          {beat.index === 1 && (
            <BeatOne
              available={signerAvailable}
              reason={signerReason}
              hash={state.hash}
              explorer={explorer}
              busy={busy === 1}
              onPerform={() => void perform()}
              onSkip={() => advance(2)}
            />
          )}

          {beat.index === 2 && state.beat >= 2 && (
            <div className="flex flex-col gap-4">
              {state.hash === null ? (
                <p className="text-[13px] text-muted">
                  Beat 1 has not produced a transaction yet.
                </p>
              ) : observed === null ? (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void observe(state.hash!)}
                  className={ACTION}
                >
                  {busy === 2 ? 'Reading…' : 'Observe it'}
                </button>
              ) : (
                <>
                  <ObservedSection observed={observed} />
                  <Continue onClick={() => advance(3)} shown={state.beat === 2} label="Derive the boundary" />
                </>
              )}
            </div>
          )}

          {beat.index === 3 && state.beat >= 3 && observed !== null && (
            <div className="flex flex-col gap-4">
              {refusal !== null ? (
                <RefusalSection
                  code={refusal.code}
                  message={refusal.message}
                  attempted={
                    <p className="text-[13px] text-muted">
                      Deriving a boundary from the transaction observed above.
                    </p>
                  }
                />
              ) : proposal !== null ? (
                <>
                  <PolicyTable proposal={proposal} />
                  <Rationale proposal={proposal} />
                  <Continue onClick={() => advance(4)} shown={state.beat === 3} label="Try to exceed it" />
                </>
              ) : null}
            </div>
          )}

          {beat.index === 4 && state.beat >= 4 && observed !== null && proposal !== null && (
            <div className="flex flex-col gap-4">
              <DenyTable
                observed={observed}
                observedDecision={evaluate(proposal, observed)}
                cases={adjudicated}
              />
              <p className="max-w-[80ch] text-[12.5px] leading-relaxed text-muted-dim">
                Refusal here is adjudicated by this repository&rsquo;s evaluator — an independent
                implementation of the same rules — not by a deployed policy contract. Nothing above
                has been enforced on-chain.
              </p>
              <Continue onClick={() => advance(5)} shown={state.beat === 4} label="Read the policy" />
            </div>
          )}

          {beat.index === 5 && state.beat >= 5 && proposal !== null && (
            <div className="flex flex-col gap-4">
              <PolicyTable proposal={proposal} />
              <div className="flex flex-col gap-2">
                <h4 className="col-head text-muted">Unsigned payload</h4>
                {xdr === null ? (
                  <p className="text-[12.5px] text-muted-dim">Building…</p>
                ) : (
                  <pre className="scroll-x value max-h-[14rem] overflow-y-auto rounded-[5px] border border-border-default bg-surface p-4 text-[11.5px] leading-relaxed break-all whitespace-pre-wrap text-muted">
                    {xdr}
                  </pre>
                )}
                <p className="max-w-[80ch] text-[12.5px] leading-relaxed text-muted-dim">
                  This is the argument payload, fully derived from the proposal above. The enclosing
                  transaction depends on a deployed OpenZeppelin smart account, which this MVP does
                  not deploy — so nothing here is submitted.
                </p>
              </div>
            </div>
          )}
        </Beat>
      ))}
    </ol>
  );
}

const ACTION =
  'self-start cursor-pointer rounded-[4px] border border-accent bg-accent-dim px-3.5 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-50';

function Continue({ onClick, shown, label }: { onClick: () => void; shown: boolean; label: string }) {
  if (!shown) return null;
  return (
    <button type="button" onClick={onClick} className={ACTION}>
      {label}
    </button>
  );
}

function BeatOne({
  available,
  reason,
  hash,
  explorer,
  busy,
  onPerform,
  onSkip,
}: {
  available: boolean;
  reason: string | null;
  hash: string | null;
  explorer: string | undefined;
  busy: boolean;
  onPerform: () => void;
  onSkip: () => void;
}) {
  if (hash !== null) {
    return (
      <div className="flex flex-col gap-2.5">
        <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-baseline gap-x-5 gap-y-2">
          <dt className="col-head text-muted-dim">hash</dt>
          <dd className="value break-all text-foreground">{hash}</dd>
        </dl>
        {explorer !== undefined && (
          <a
            href={explorer}
            target="_blank"
            rel="noreferrer"
            className="self-start rounded-[3px] text-[13px] text-permit underline decoration-permit-line underline-offset-4 transition-colors hover:decoration-permit"
          >
            View on stellar.expert
          </a>
        )}
      </div>
    );
  }

  if (!available) {
    return (
      <div className="flex flex-col gap-3">
        <p className="max-w-[80ch] text-[13px] leading-relaxed text-muted">
          {reason ?? 'The demo account is not configured for this deployment.'} Beat 1 is the only
          step that needs it — the rest of the walkthrough runs from a shipped transaction.
        </p>
        <button type="button" onClick={onSkip} className={ACTION}>
          Continue from a shipped preset
        </button>
      </div>
    );
  }

  return (
    <button type="button" disabled={busy} onClick={onPerform} className={ACTION}>
      {busy ? 'Submitting to testnet…' : 'Perform a transaction'}
    </button>
  );
}

function Rationale({ proposal }: { proposal: PolicyProposal }) {
  return (
    <div className="flex flex-col gap-2">
      <h4 className="col-head text-muted">Rationale</h4>
      <ul className="flex flex-col gap-1.5">
        {proposal.rationale.map((line) => (
          <li key={line} className="value break-all text-muted-dim">
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}
