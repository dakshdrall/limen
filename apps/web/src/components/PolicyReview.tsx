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
import { DenyTable, type AdjudicatedCase } from './DenyTable';
import { DerivedSection } from './DerivedSection';
import { InstallSection } from './InstallSection';
import { ObservedSection } from './ObservedSection';
import { Section } from './Section';

/**
 * `@limen/core` is pure, so synthesis, deny-case generation, and evaluation all
 * run in the browser — the page runs exactly the code the test suite runs, with
 * no server round trip and no second implementation to drift.
 */
export function PolicyReview({
  initialTransaction,
  initialKey,
  fixtureKeys,
}: {
  initialTransaction: ObservedTransaction;
  initialKey: string;
  fixtureKeys: string[];
}) {
  const [observed, setObserved] = useState<ObservedTransaction>(initialTransaction);
  const [activeKey, setActiveKey] = useState<string>(initialKey);
  const [loading, setLoading] = useState(false);
  const [ingestError, setIngestError] = useState<string | null>(null);

  // [A1] Null until the user explicitly picks. Never pre-selected, never set
  // from a model response.
  const [selectedOption, setSelectedOption] = useState<ExplainedOption | null>(null);

  const [explain, setExplain] = useState<ExplainResponse | null>(null);
  const [explaining, setExplaining] = useState(false);

  const { proposal, synthesisError } = useMemo(() => {
    const options =
      selectedOption === null
        ? DEFAULT_SYNTHESIS_OPTIONS
        : {
            ...DEFAULT_SYNTHESIS_OPTIONS,
            headroomBps: selectedOption.headroomBps,
            windowLedgers: selectedOption.windowLedgers,
          };
    try {
      return { proposal: synthesize(observed, options), synthesisError: null as string | null };
    } catch (error) {
      return {
        proposal: null,
        synthesisError:
          error instanceof SynthesisError
            ? `${error.code}: ${error.message}`
            : error instanceof Error
              ? error.message
              : String(error),
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
    () => (proposal === null ? { permitted: false, reasons: ['no proposal'] } : evaluate(proposal, observed)),
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

  async function loadFixture(key: string) {
    setLoading(true);
    setIngestError(null);
    setSelectedOption(null);
    try {
      const response = await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hash: key }),
      });
      const payload = (await response.json()) as ObservedTransaction & { error?: string };
      if (!response.ok) {
        setIngestError(payload.error ?? 'ingest failed');
        return;
      }
      setObserved(payload);
      setActiveKey(key);
    } catch (error) {
      setIngestError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-14">
      <div className="flex flex-wrap items-center gap-2">
        <span className="col-head mr-1 text-muted-dim">transaction</span>
        {fixtureKeys.map((key) => (
          <button
            key={key}
            type="button"
            disabled={loading}
            onClick={() => void loadFixture(key)}
            aria-pressed={key === activeKey}
            className={`value cursor-pointer rounded-[4px] border px-2.5 py-1 transition-colors hover:border-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 ${
              key === activeKey
                ? 'border-accent bg-accent-dim text-foreground'
                : 'border-border-default text-muted hover:bg-surface-hover'
            }`}
          >
            {key}
          </button>
        ))}
        {loading && <span className="text-[12.5px] text-muted-dim">loading…</span>}
        {ingestError !== null && <span className="text-[12.5px] text-deny">{ingestError}</span>}
      </div>

      <Section index={1} title="Observed" subtitle="A transaction that was performed.">
        <ObservedSection observed={observed} />
      </Section>

      <Section
        index={2}
        title="Derived policy"
        subtitle="The minimum context rule and policy set that permits exactly that flow. Composed from audited OpenZeppelin primitives — no generated code."
      >
        {proposal === null ? (
          <p className="text-[13px] text-deny">Synthesis refused this transaction — {synthesisError}</p>
        ) : (
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
        )}
      </Section>

      <Section
        index={3}
        emphasis
        title="What this policy now refuses"
        subtitle="Adjacent transactions, one mutated dimension each. Every row must read DENY."
      >
        {proposal === null ? (
          <p className="text-[13px] text-muted">No proposal to evaluate.</p>
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
