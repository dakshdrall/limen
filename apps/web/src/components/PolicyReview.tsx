'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_SYNTHESIS_OPTIONS,
  SynthesisError,
  evaluate,
  generateDenyCases,
  synthesize,
  type ObservedTransaction,
} from '@limen/core';
import type { ExplainResponse, ExplainedOption } from '@/app/api/explain/route';
import { REFUSAL_CODES, type IngestError, type IngestErrorCode } from '@/lib/ingest-contract';
import { DenyTable, type AdjudicatedCase } from './DenyTable';
import { DerivedSection } from './DerivedSection';
import { InstallSection } from './InstallSection';
import { ObservedSection } from './ObservedSection';
import { AttemptedFlow, RefusalSection } from './RefusalSection';
import { Section } from './Section';
import { TransactionPicker } from './TransactionPicker';

interface Problem {
  code: IngestErrorCode;
  message: string;
  detail?: string;
}

/**
 * `@limen/core` is pure, so synthesis, deny-case generation, and evaluation all
 * run in the browser — the page runs exactly the code the test suite runs, with
 * no server round trip and no second implementation to drift.
 *
 * The invariant this component exists to hold: every constraint rendered below
 * comes from a `synthesize()` return value. Nothing here stores a derived
 * number in state, and nothing widens a policy without an explicit click.
 */
export function PolicyReview({
  initialTransaction,
  initialKey,
  fixtureKeys,
  refusingKeys,
  liveIngestEnabled,
}: {
  initialTransaction: ObservedTransaction;
  initialKey: string;
  fixtureKeys: string[];
  refusingKeys: string[];
  /** False when the deployment has no Soroban RPC endpoint configured. */
  liveIngestEnabled: boolean;
}) {
  const [observed, setObserved] = useState<ObservedTransaction>(initialTransaction);
  const [activeKey, setActiveKey] = useState<string>(initialKey);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  // [A1] Null until the user explicitly picks. Never pre-selected, never set
  // from a model response.
  const [selectedOption, setSelectedOption] = useState<ExplainedOption | null>(null);

  const [explain, setExplain] = useState<ExplainResponse | null>(null);
  const [explaining, setExplaining] = useState(false);

  const { proposal, refusal } = useMemo(() => {
    const options =
      selectedOption === null
        ? DEFAULT_SYNTHESIS_OPTIONS
        : {
            ...DEFAULT_SYNTHESIS_OPTIONS,
            headroomBps: selectedOption.headroomBps,
            windowLedgers: selectedOption.windowLedgers,
          };
    try {
      return { proposal: synthesize(observed, options), refusal: null };
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
  }, [observed, selectedOption]);

  const adjudicated: AdjudicatedCase[] = useMemo(() => {
    if (proposal === null) return [];
    return generateDenyCases(observed, proposal).map((denyCase) => ({
      denyCase,
      decision: evaluate(proposal, denyCase.candidate),
    }));
  }, [observed, proposal]);

  const observedDecision = useMemo(
    () =>
      proposal === null ? { permitted: false, reasons: ['no proposal'] } : evaluate(proposal, observed),
    [observed, proposal],
  );

  // Explanation is derived from the rationale of the *default* proposal, so a
  // widening choice does not retrigger a model call mid-review.
  const rationaleKey = proposal?.rationale.join('\n') ?? '';
  useEffect(() => {
    if (proposal === null || selectedOption !== null) return;
    let cancelled = false;

    void (async () => {
      setExplaining(true);
      try {
        const response = await fetch('/api/explain', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ rationale: proposal.rationale }),
        });
        const payload = (await response.json()) as ExplainResponse;
        if (!cancelled) setExplain(payload);
      } catch {
        if (!cancelled) {
          setExplain({
            explained: false,
            explanation: '',
            question: null,
            options: [],
            degraded: 'Could not reach the explain endpoint — showing the structured rationale.',
          });
        }
      } finally {
        if (!cancelled) setExplaining(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rationaleKey]);

  /**
   * One path for presets and for pasted hashes: both are references the ingest
   * route resolves. A preset resolves from disk with no network call; a hash
   * resolves through Soroban RPC.
   */
  async function ingest(reference: string, { live }: { live: boolean }) {
    setLoading(true);
    setProblem(null);
    setSelectedOption(null);
    try {
      const response = await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hash: reference, network: live ? 'testnet' : 'simulated' }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as IngestError;
        setProblem(
          payload.error ?? { code: 'bad_request', message: 'ingest failed for an unstated reason' },
        );
        return;
      }
      setObserved((await response.json()) as ObservedTransaction);
      setActiveKey(reference);
    } catch (error) {
      setProblem({
        code: 'rpc_failed',
        message: 'Could not reach the ingest endpoint.',
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  }

  const picker = (
    <TransactionPicker
      fixtureKeys={fixtureKeys}
      refusingKeys={refusingKeys}
      activeKey={activeKey}
      loading={loading}
      liveIngestEnabled={liveIngestEnabled}
      onSelectPreset={(key) => void ingest(key, { live: false })}
      onObserveHash={(hash) => void ingest(hash, { live: true })}
    />
  );

  // An ingest problem replaces the review rather than sitting above a stale
  // one: the transaction on screen must always be the transaction that was
  // asked for.
  if (problem !== null) {
    return (
      <div className="flex flex-col gap-10">
        {picker}
        {REFUSAL_CODES.has(problem.code) ? (
          <RefusalSection
            code={problem.code}
            message={problem.message}
            detail={problem.detail}
            attempted={
              <p className="measure text-[13px] leading-relaxed text-muted">
                Reading{' '}
                <span className="value break-all text-foreground">{activeKey}</span> into an
                observable flow.
              </p>
            }
          />
        ) : (
          <TransportError problem={problem} />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-14">
      {picker}

      <Section index={1} title="Observed" subtitle="A transaction that was performed.">
        <ObservedSection observed={observed} />
      </Section>

      <Section
        index={2}
        title="Derived policy"
        subtitle="The minimum context rule and policy set that permits exactly that flow. Composed from audited OpenZeppelin primitives — no generated code."
      >
        {proposal === null && refusal !== null ? (
          <RefusalSection
            code={refusal.code}
            message={refusal.message}
            attempted={<AttemptedFlow {...summarise(observed)} />}
          />
        ) : proposal !== null ? (
          <DerivedSection
            proposal={proposal}
            explanation={explain?.explanation ?? ''}
            question={explain?.question ?? null}
            options={explain?.options ?? []}
            activeOptionId={selectedOption?.id ?? null}
            degraded={explain?.degraded}
            explaining={explaining}
            onSelectOption={setSelectedOption}
          />
        ) : null}
      </Section>

      <Section
        index={3}
        emphasis
        title="What this policy now refuses"
        subtitle="Adjacent transactions, one mutated dimension each. Every row must read DENY."
      >
        {proposal === null ? (
          <p className="text-[13px] text-muted">
            No proposal was derived, so there is nothing to adjudicate against. The refusal above is
            the result.
          </p>
        ) : (
          <DenyTable observed={observed} observedDecision={observedDecision} cases={adjudicated} />
        )}
      </Section>

      <Section index={4} title="Install" subtitle="Client-side signing. Testnet only.">
        {proposal === null ? (
          <p className="text-[13px] text-muted">No proposal to install.</p>
        ) : (
          <InstallSection proposal={proposal} />
        )}
      </Section>
    </div>
  );
}

/**
 * A transport failure is not a refusal. Limen did not decline to derive
 * anything here — it never got to look, and saying otherwise would claim
 * judgement it did not exercise.
 */
function TransportError({ problem }: { problem: Problem }) {
  return (
    <div className="flex flex-col gap-3 rounded-[5px] border border-border-bright bg-surface p-5">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="col-head text-muted">COULD NOT LOOK</span>
        <span className="value text-muted-dim">{problem.code}</span>
      </div>
      <p className="measure text-[13px] leading-relaxed text-foreground">{problem.message}</p>
      {problem.detail !== undefined && problem.detail.length > 0 && (
        <p className="value measure break-words text-[12px] text-faint">{problem.detail}</p>
      )}
      <p className="measure text-[12.5px] leading-relaxed text-muted-dim">
        This is a failure to reach or read the transaction, not a judgement about it. No policy was
        derived and none was withheld.
      </p>
    </div>
  );
}

function summarise(observed: ObservedTransaction) {
  const contracts = new Set(observed.invocations.map((i) => i.contractId));
  const functions = new Set(observed.invocations.map((i) => `${i.contractId}.${i.functionName}`));
  const assets = new Set(
    observed.movements.filter((m) => m.from === observed.source).map((m) => m.asset),
  );
  return {
    contracts: contracts.size,
    functions: functions.size,
    assets: assets.size,
    ledger: observed.ledger,
  };
}
