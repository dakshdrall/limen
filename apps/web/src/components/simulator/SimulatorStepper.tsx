'use client';

import Link from 'next/link';
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
import { INITIAL_STATE, LAST_BEAT, loadState, saveState, type DemoState } from '@/lib/demo-state';
import { useLowering } from '@/lib/use-lowering';
import { DenyTable, type AdjudicatedCase } from '@/components/DenyTable';
import { ExplorerLink } from '@/components/ExplorerLink';
import { InstallPlanTable } from '@/components/app/InstallPlanTable';
import { Pending, ReadFailure } from '@/components/app/ScreenState';
import { NotEnforceable } from '@/components/NotEnforceable';
import { ObservedSection } from '@/components/ObservedSection';
import { PolicyTable } from '@/components/PolicyTable';
import { RefusalSection } from '@/components/RefusalSection';
import { Beat, type BeatKind } from '@/components/simulator/Beat';

/**
 * A shipped flow the simulator can start from.
 *
 * `hash` rather than the short key, because it is what goes into the resumable
 * state — see the note on `sourceOf` below. `refuses` marks the fixtures whose
 * whole purpose is to be declined somewhere in the pipeline, so a reviewer knows
 * the refusal is the point rather than a broken preset.
 */
export interface Preset {
  key: string;
  hash: string;
  refuses: boolean;
}

const BEATS: Array<{ index: number; title: string; blurb: string }> = [
  {
    index: 1,
    title: 'Get a transaction',
    blurb:
      'Either a real transfer submitted to Stellar testnet from a disposable demo account, or one of the flows shipped with this repository. No wallet and no funded account of your own, either way.',
  },
  {
    index: 2,
    title: 'Observe it',
    blurb:
      'Read back into an observable flow: through Soroban RPC for a testnet hash, from the repository for a shipped one.',
  },
  {
    index: 3,
    title: 'Derive the boundary',
    blurb:
      'The minimum context rule and policy set that permits exactly that flow, composed from audited OpenZeppelin primitives.',
  },
  {
    index: 4,
    title: 'Try to exceed it',
    blurb: 'Adjacent transactions, one mutated dimension each. Every one must be refused.',
  },
  {
    index: 5,
    title: 'Read the policy',
    blurb: 'The exact policy configuration that was derived, and the unsigned payload.',
  },
  {
    index: 6,
    title: 'Ask whether it could be installed',
    blurb:
      'What Limen derives and what an OpenZeppelin smart account can hold are different languages. Lowering either translates the boundary or refuses it and names the constraint.',
  },
];

// The list and the state's accepted range are one number, declared where the
// range is enforced. A stepper with a beat the sanitiser rejects would silently
// reset every reviewer who reached it.
if (BEATS.length !== LAST_BEAT) throw new Error('BEATS and LAST_BEAT disagree');

type IngestOutcome =
  | { ok: true; observed: ObservedTransaction }
  | { ok: false; error: { code: string; message: string; detail?: string } };

/** Where the transaction on screen came from. Matches `/api/ingest`'s vocabulary. */
type Source = 'testnet' | 'simulated';

/**
 * Reads a hash back through the live ingest path. Touches no React state, so
 * both the button handler and the resume effect can call it — the effect awaits
 * it before updating anything.
 */
async function fetchObserved(hash: string, network: Source): Promise<IngestOutcome> {
  try {
    const response = await fetch('/api/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hash, network }),
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

export function SimulatorStepper({
  signerAvailable,
  signerReason,
  presets,
}: {
  signerAvailable: boolean;
  signerReason: string | null;
  presets: Preset[];
}) {
  const [state, setState] = useState<DemoState>(INITIAL_STATE);
  const [observed, setObserved] = useState<ObservedTransaction | null>(null);
  const [xdr, setXdr] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [errors, setErrors] = useState<
    Record<number, { code: string; message: string; detail?: string }>
  >({});
  const restored = useRef(false);

  /**
   * Which path the hash on screen came from.
   *
   * Derived from the shipped preset list rather than persisted, which is why
   * `DemoState` did not have to grow a field: a fixture's hash is a constant of
   * this repository, so recognising one after a reload is a lookup, not a
   * memory. `null` when nothing has been chosen yet.
   *
   * It has to be answerable. A shipped fixture rendered with an explorer link
   * and an `on-chain` badge would be this page claiming a transaction exists
   * that never did — and the fixtures carry real StrKey addresses precisely so
   * they look like production data, which makes the mislabel invisible.
   */
  const sourceOf = useCallback(
    (hash: string | null): Source | null => {
      if (hash === null) return null;
      return presets.some((preset) => preset.hash === hash) ? 'simulated' : 'testnet';
    },
    [presets],
  );
  const source = sourceOf(state.hash);

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

  const setError = useCallback(
    (beat: number, error: { code: string; message: string; detail?: string }) => {
      setErrors((previous) => ({ ...previous, [beat]: error }));
    },
    [],
  );

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
      const payload = (await response.json()) as {
        hash?: string;
        error?: { code: string; message: string };
      };
      if (!response.ok || payload.hash === undefined) {
        setError(
          1,
          payload.error ?? { code: 'submit_failed', message: 'the demo transaction failed' },
        );
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

  /**
   * Start from a shipped flow instead.
   *
   * Resets everything downstream rather than only moving the beat forward.
   * Switching presets mid-run and leaving the previous transaction's derived
   * boundary on screen would be the stalest possible number on a page whose
   * argument is that nothing derived is ever stored.
   */
  function choosePreset(preset: Preset) {
    clearError(1);
    clearError(2);
    setObserved(null);
    setXdr(null);
    setState((previous) => ({ ...previous, beat: 2, hash: preset.hash }));
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
    async (hash: string, network: Source) => {
      setBusy(2);
      clearError(2);
      try {
        applyOutcome(await fetchObserved(hash, network));
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
      const outcome = await fetchObserved(resumeHash, sourceOf(resumeHash) ?? 'testnet');
      if (!cancelled) applyOutcome(outcome);
    })();

    return () => {
      cancelled = true;
    };
  }, [resumeHash, applyOutcome, sourceOf]);

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
        refusal: {
          code: 'not_expressible',
          message: error instanceof Error ? error.message : String(error),
        },
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

  /* --- beat 6: could it be installed? ----------------------------------- */

  // Gated on the beat rather than run eagerly, so the answer arrives with the
  // step that asks the question rather than being computed and held back.
  const lowered = useLowering(state.beat >= 6 ? proposal : null);

  const advance = (to: number) =>
    setState((previous) => ({ ...previous, beat: Math.max(previous.beat, to) }));

  // Only a hash that reached a ledger gets a link to one. A shipped fixture's
  // hash is valid-looking and belongs to no transaction anywhere.
  const explorer =
    state.hash !== null && source === 'testnet'
      ? explorerTxUrl({ network: 'testnet', hash: state.hash })
      : undefined;

  /**
   * Beats 1 and 2 report what they actually did; 3 onwards always run here.
   * Before anything is chosen, beat 1 is the on-chain option it is offering.
   */
  const kindOf = (index: number): BeatKind => {
    if (index > 2) return 'computed';
    if (source === null) return 'on-chain';
    return source === 'simulated' ? 'shipped' : 'on-chain';
  };

  return (
    <ol className="flex flex-col gap-5">
      {BEATS.map((beat) => (
        <Beat
          key={beat.index}
          index={beat.index}
          title={beat.title}
          kind={kindOf(beat.index)}
          blurb={beat.blurb}
          reached={state.beat >= beat.index}
          busy={busy === beat.index}
          error={errors[beat.index]}
          isRefusal={
            errors[beat.index] !== undefined &&
            REFUSAL_CODES.has(errors[beat.index]!.code as never)
          }
        >
          {beat.index === 1 && (
            <BeatOne
              available={signerAvailable}
              reason={signerReason}
              hash={state.hash}
              source={source}
              presets={presets}
              explorer={explorer}
              busy={busy === 1}
              onPerform={() => void perform()}
              onChoosePreset={choosePreset}
            />
          )}

          {beat.index === 2 && state.beat >= 2 && (
            <div className="flex flex-col gap-4">
              {state.hash === null || source === null ? (
                <p className="text-[13px] text-muted">Nothing has been chosen in step 1 yet.</p>
              ) : observed === null ? (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void observe(state.hash!, source)}
                  className="btn"
                  data-variant="primary"
                >
                  {busy === 2
                    ? 'Reading…'
                    : source === 'testnet'
                      ? 'Read it back from testnet'
                      : 'Read the shipped flow'}
                </button>
              ) : (
                // No continue button here. `applyOutcome` advances the beat in
                // the same handler that sets `observed`, so beat 3 derives
                // itself as soon as this lands and a gate would never render.
                <ObservedSection observed={observed} />
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
                  <Continue
                    onClick={() => advance(4)}
                    shown={state.beat === 3}
                    label="Try to exceed it"
                  />
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
              <p className="measure text-[12.5px] leading-relaxed text-muted-dim">
                Refusal here is adjudicated by this repository&rsquo;s evaluator — an independent
                implementation of the same rules — not by a deployed policy contract. Nothing above
                has been enforced on-chain.
              </p>
              <Continue
                onClick={() => advance(5)}
                shown={state.beat === 4}
                label="Read the policy"
              />
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
                {/* This used to say the MVP does not deploy a smart account.
                    It does now — `packages/chain/deployments/testnet.json` has
                    the hashes — so the true reason this payload goes nowhere
                    changed, and the caveat had to change with it rather than
                    staying comfortably pessimistic. */}
                <p className="measure text-[12.5px] leading-relaxed text-muted-dim">
                  This is the argument payload, fully derived from the proposal above. Submitting it
                  would need a smart account to write to and an owner signature to authorize the
                  write; this screen has neither, and nothing here is submitted.
                </p>
                <Continue
                  onClick={() => advance(6)}
                  shown={state.beat === 5}
                  label="Ask whether it could be installed"
                />
              </div>
            </div>
          )}

          {beat.index === 6 && state.beat >= 6 && (
            <div className="flex flex-col gap-4">
              {lowered.status === 'idle' && (
                <p className="text-[13px] text-muted-dim">
                  Nothing to lower — no boundary was derived above.
                </p>
              )}
              {lowered.status === 'pending' && (
                <Pending what="Lowering the derived boundary onto OpenZeppelin primitives." />
              )}
              {lowered.status === 'failed' && <ReadFailure message={lowered.message} />}

              {lowered.status === 'lowered' && (
                <>
                  <InstallPlanTable plan={lowered.plan} />
                  <p className="measure text-[12.5px] leading-relaxed text-muted-dim">
                    This plan is installable: every line of it configures a primitive already
                    deployed on testnet. Nothing installs it here, and this screen has no account to
                    install it on.{' '}
                    <Link href="/app/policies/new" className="link">
                      New policy
                    </Link>{' '}
                    runs the same derivation against a real smart account.
                  </p>
                </>
              )}

              {lowered.status === 'refused' && (
                <>
                  <NotEnforceable constraint={lowered.constraint} message={lowered.message} />
                  {/* PLAN-V3 decision 1, on screen rather than only in the
                      plan. Multi-contract flows live in the simulator because
                      no audited primitive can constrain the second contract —
                      and a reviewer needs to be told that here, at the moment
                      the flow visibly stops, rather than inferring it from a
                      screen that simply never mentions installing. */}
                  <p className="measure text-[12.5px] leading-relaxed text-muted-dim">
                    This is why the flow is on this screen and not on{' '}
                    <Link href="/app/policies/new" className="link">
                      New policy
                    </Link>
                    . The deny table above is real reasoning about a real boundary, and it is
                    evaluated entirely in your browser — for this flow no network will ever be asked
                    to agree with it, because there is nothing installable to ask.
                  </p>
                </>
              )}
            </div>
          )}
        </Beat>
      ))}
    </ol>
  );
}

function Continue({ onClick, shown, label }: { onClick: () => void; shown: boolean; label: string }) {
  if (!shown) return null;
  return (
    <button type="button" onClick={onClick} className="btn" data-variant="primary">
      {label}
    </button>
  );
}

/**
 * Step 1, and the two ways to satisfy it.
 *
 * The preset row is always offered, not only as a fallback when the demo account
 * is missing. Before, skipping straight past an unconfigured beat 1 set no hash
 * at all and left step 2 saying "beat 1 has not produced a transaction yet" with
 * nothing to click — a dead end reachable by every reviewer running this
 * repository without credentials, which is most of them. It is also what makes
 * the simulator the home for flows the chain cannot hold: reaching the
 * multi-contract case needs a way to select it.
 */
function BeatOne({
  available,
  reason,
  hash,
  source,
  presets,
  explorer,
  busy,
  onPerform,
  onChoosePreset,
}: {
  available: boolean;
  reason: string | null;
  hash: string | null;
  source: Source | null;
  presets: Preset[];
  explorer: string | undefined;
  busy: boolean;
  onPerform: () => void;
  onChoosePreset: (preset: Preset) => void;
}) {
  const chosen = hash === null ? null : (presets.find((preset) => preset.hash === hash) ?? null);

  return (
    <div className="flex flex-col gap-4">
      {hash !== null && (
        <div className="flex flex-col gap-2.5">
          <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-baseline gap-x-5 gap-y-2">
            <dt className="col-head text-muted-dim">hash</dt>
            <dd className="value break-all text-foreground">{hash}</dd>
          </dl>
          {explorer !== undefined ? (
            <span className="text-[13px]">
              <ExplorerLink href={explorer}>View on stellar.expert</ExplorerLink>
            </span>
          ) : (
            // No explorer link, and the reason said rather than left as an
            // absence: this hash is well-formed and belongs to no transaction.
            <p className="measure text-[12.5px] leading-relaxed text-muted-dim">
              {chosen === null ? 'This flow' : `${chosen.key}`} ships with the repository. Its hash
              is well-formed and no explorer will find it, because no such transaction was ever
              submitted anywhere.
            </p>
          )}
        </div>
      )}

      {source !== 'testnet' && (
        <div className="flex flex-col gap-2.5">
          {available ? (
            <button
              type="button"
              disabled={busy}
              onClick={onPerform}
              className="btn"
              data-variant="primary"
            >
              {busy ? 'Submitting to testnet…' : 'Perform a transaction on testnet'}
            </button>
          ) : (
            <p className="measure text-[13px] leading-relaxed text-muted">
              {reason ?? 'The demo account is not configured for this deployment.'} This step is the
              only one that needs it; everything below runs from a shipped flow instead.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        <h4 className="col-head text-muted">
          {hash === null ? 'or start from a shipped flow' : 'shipped flows'}
        </h4>
        <div className="flex flex-wrap gap-2">
          {presets.map((preset) => (
            <button
              key={preset.key}
              type="button"
              aria-pressed={preset.hash === hash}
              onClick={() => onChoosePreset(preset)}
              className={`cursor-pointer rounded-[3px] border px-3 py-1.5 font-mono text-[11.5px] tracking-[0.04em] transition-colors ${
                preset.hash === hash
                  ? 'border-accent bg-accent-dim text-accent'
                  : 'border-border-default text-muted hover:border-border-bright hover:text-foreground'
              }`}
            >
              {preset.key}
              {preset.refuses && <span className="ml-2 text-faint">refused</span>}
            </button>
          ))}
        </div>
        <p className="measure text-[12.5px] leading-relaxed text-muted-dim">
          Shipped flows were never observed on a live network. The ones marked{' '}
          <span className="text-faint">refused</span>{' '}
          are declined somewhere in the pipeline on purpose — a simulator that can only succeed is
          not evidence about anything.
        </p>
      </div>
    </div>
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
