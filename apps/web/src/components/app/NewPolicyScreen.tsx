'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_SYNTHESIS_OPTIONS,
  SynthesisError,
  synthesize,
  type ObservedTransaction,
  type PolicyProposal,
} from '@limen/core';
import { InstallControl } from '@/components/app/InstallControl';
import { InstallPlanTable } from '@/components/app/InstallPlanTable';
import { Pending, ReadFailure } from '@/components/app/ScreenState';
import { NotEnforceable } from '@/components/NotEnforceable';
import { PolicyTable } from '@/components/PolicyTable';
import { ObservedSection } from '@/components/ObservedSection';
import { Section } from '@/components/Section';
import { StatusLabel } from '@/components/StatusLabel';
import { TransactionPicker } from '@/components/TransactionPicker';
import { type IngestError, parseIngestResponse } from '@/lib/ingest-contract';
import { useLowering } from '@/lib/use-lowering';

/**
 * Deriving a boundary and lowering it onto the chain's own primitives.
 *
 * Four steps, in the order the brief asks for: observe a transaction, review
 * what Limen derived from it, see what would actually be written, and install.
 *
 * The third step is the one that does not exist on `/`. What `synthesize`
 * produces and what an OpenZeppelin smart account can hold are not the same
 * language, and a screen that showed only the first would be describing a
 * boundary the network may never have been asked to enforce. `lower` translates
 * or refuses, and both outcomes get a designed state.
 *
 * The fourth step cannot complete in this build, and says so in place rather
 * than presenting a button that fails. See `InstallStep`.
 */

export function NewPolicyScreen({
  initialTransaction,
  initialKey,
  fixtureKeys,
  refusingKeys,
  liveIngestEnabled,
  observeHash = null,
  accountId = null,
}: {
  initialTransaction: ObservedTransaction;
  initialKey: string;
  fixtureKeys: string[];
  refusingKeys: string[];
  liveIngestEnabled: boolean;
  /**
   * A transaction to observe on arrival, from `?tx=`.
   *
   * How the account screen hands its observed transaction over: by hash, so it
   * is read back from the network here rather than passed as a payload. A
   * derived cap must come from what the ledger recorded, and shipping the
   * amount across a URL would make it come from what the previous screen
   * believed.
   */
  observeHash?: string | null;
  /** The account to install onto, from `?account=`. */
  accountId?: string | null;
}) {
  const [observed, setObserved] = useState<ObservedTransaction>(initialTransaction);
  const [activeKey, setActiveKey] = useState(initialKey);
  const [loading, setLoading] = useState(false);
  const [ingestProblem, setIngestProblem] = useState<IngestError['error'] | null>(null);

  // The proposal is derived, never stored. Recomputing it from `observed` on
  // every render is what makes it impossible for a stale cap to survive a
  // change of transaction.
  let proposal: PolicyProposal | null = null;
  let synthesisRefusal: string | null = null;
  try {
    proposal = synthesize(observed, DEFAULT_SYNTHESIS_OPTIONS);
  } catch (error) {
    if (error instanceof SynthesisError) synthesisRefusal = error.message;
    else throw error;
  }

  const observe = useCallback(async (reference: string, network: 'testnet' | 'simulated') => {
    setLoading(true);
    setIngestProblem(null);
    try {
      const response = await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hash: reference, network }),
      });
      const outcome = await parseIngestResponse(response);
      switch (outcome.kind) {
        case 'observed':
          setObserved(outcome.observed);
          setActiveKey(reference);
          break;
        case 'error':
          setIngestProblem(outcome.error);
          break;
        case 'malformed':
          // Neither a transaction nor a structured refusal. The route's
          // contract is exactly those two shapes, so anything else is a
          // transport failure, not Limen declining.
          setIngestProblem({
            code: 'rpc_failed',
            message: 'the lookup returned a response this build cannot read; nothing was derived',
            detail: `HTTP ${outcome.status}`,
          });
          break;
      }
    } catch (error) {
      setIngestProblem({
        code: 'rpc_failed',
        message: 'the lookup could not be sent from this browser',
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  // Observing the transaction the account screen just made, once.
  //
  // Keyed on the hash rather than run on mount, so arriving with a different
  // `?tx=` observes the new one. The guard is a ref rather than state because
  // nothing renders from it: it records that a fetch was already started, and
  // writing it through `setState` would schedule a render whose only effect is
  // to re-run this check.
  const observeRequested = useRef<string | null>(null);
  useEffect(() => {
    if (observeHash === null || observeRequested.current === observeHash) return;
    observeRequested.current = observeHash;
    void observe(observeHash, 'testnet');
  }, [observeHash, observe]);

  // Lowering follows the proposal automatically. Making it a button would imply
  // the user is choosing to lower, when in fact there is no version of this
  // flow where they would not: the plan is what they are being asked to review.
  const lowered = useLowering(proposal);

  return (
    <div className="flex flex-col gap-14">
      <Section
        index={1}
        title="Observe a transaction"
        subtitle="A boundary is derived from something that already happened. Paste a Soroban testnet hash, or use a shipped fixture."
      >
        <div className="flex flex-col gap-5">
          <TransactionPicker
            fixtureKeys={fixtureKeys}
            refusingKeys={refusingKeys}
            activeKey={activeKey}
            loading={loading}
            liveIngestEnabled={liveIngestEnabled}
            onSelectPreset={(key) => void observe(key, 'simulated')}
            onObserveHash={(hash) => void observe(hash, 'testnet')}
          />
          {ingestProblem !== null && (
            <ReadFailure message={ingestProblem.message} detail={ingestProblem.detail} />
          )}
          <ObservedSection observed={observed} />
        </div>
      </Section>

      <Section
        index={2}
        title="Review what Limen derived"
        subtitle="The least-permissive boundary that still permits the flow above. Computed in your browser by the same package the test suite runs."
      >
        {proposal === null ? (
          <RefusedToDerive message={synthesisRefusal ?? 'synthesis refused'} />
        ) : (
          <PolicyTable proposal={proposal} />
        )}
      </Section>

      <Section
        index={3}
        title="What would be written to the chain"
        subtitle="Not the same thing as the boundary above. Limen's model can express constraints no audited primitive imposes; those are refused here rather than installed as something broader."
        emphasis
      >
        {lowered.status === 'idle' && (
          <p className="text-[13px] text-muted-dim">
            Nothing to lower — the boundary above was not derived.
          </p>
        )}
        {lowered.status === 'pending' && <Pending what="Lowering the proposal onto OpenZeppelin primitives." />}
        {lowered.status === 'lowered' && <InstallPlanTable plan={lowered.plan} />}
        {lowered.status === 'refused' && (
          <NotEnforceable constraint={lowered.constraint} message={lowered.message} />
        )}
        {lowered.status === 'failed' && <ReadFailure message={lowered.message} />}
      </Section>

      <Section
        index={4}
        title="Install"
        subtitle="Writing the plan above to a smart account, signed by its owner."
      >
        {lowered.status === 'lowered' ? (
          <InstallControl
            plan={lowered.plan}
            accountId={accountId}
            observedTxHash={observed.hash}
            observedLedger={observed.ledger}
            headroomBps={DEFAULT_SYNTHESIS_OPTIONS.headroomBps}
          />
        ) : (
          <NothingToInstall />
        )}
      </Section>
    </div>
  );
}

function RefusedToDerive({ message }: { message: string }) {
  return (
    <div className="panel" data-tone="unproven">
      <div className="flex items-center gap-3">
        <span className="eyebrow text-unproven">refused to derive</span>
        <StatusLabel name="COMPUTED LOCALLY" />
      </div>
      <p className="measure text-[13px] leading-relaxed text-foreground/90">{message}</p>
      <p className="measure text-[12.5px] leading-relaxed text-muted-dim">
        Refusing is the designed outcome, not a failure of the demo. A synthesizer that guessed here
        would produce a boundary nobody reviewed.
      </p>
    </div>
  );
}

/**
 * There is no plan, so there is nothing to install.
 *
 * What used to stand here was the caveat explaining that *nothing* could be
 * installed, from a build with no browser signer. `InstallControl` retires it
 * by existing. This is the narrower, still-true statement: lowering refused or
 * has not finished, so there is no plan for a button to write.
 *
 * It is not a disabled install button. A disabled control claims the action
 * exists and something is temporarily wrong; when `lower` has *refused*, the
 * honest reading is that this boundary cannot be installed at all, and
 * `NotEnforceable` above has already said why.
 */
function NothingToInstall() {
  return (
    <div className="panel" data-tone="pending">
      <span className="eyebrow text-muted-dim">nothing to install</span>
      <p className="measure text-[13px] leading-relaxed text-foreground/90">
        There is no lowered plan to write. Either the boundary above was not derived, or lowering
        refused it — in which case the reason is stated above rather than worked around here.
      </p>
      <p className="measure text-[12.5px] leading-relaxed text-muted">
        There is no form here that accepts a secret key, and there will not be one.
      </p>
    </div>
  );
}
