'use client';

import { useCallback, useState } from 'react';
import {
  DEFAULT_SYNTHESIS_OPTIONS,
  SynthesisError,
  synthesize,
  type ObservedTransaction,
  type PolicyProposal,
} from '@limen/core';
import { InstallPlanTable } from '@/components/app/InstallPlanTable';
import { Pending, ReadFailure } from '@/components/app/ScreenState';
import { NotEnforceable } from '@/components/NotEnforceable';
import { PolicyTable } from '@/components/PolicyTable';
import { ObservedSection } from '@/components/ObservedSection';
import { Section } from '@/components/Section';
import { StatusLabel } from '@/components/StatusLabel';
import { TransactionPicker } from '@/components/TransactionPicker';
import { type IngestError } from '@/lib/ingest-contract';
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
}: {
  initialTransaction: ObservedTransaction;
  initialKey: string;
  fixtureKeys: string[];
  refusingKeys: string[];
  liveIngestEnabled: boolean;
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
      const body: unknown = await response.json();
      if (!response.ok) {
        setIngestProblem((body as IngestError).error);
        return;
      }
      setObserved(body as ObservedTransaction);
      setActiveKey(reference);
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
        <InstallStep installable={lowered.status === 'lowered'} />
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
 * The install step, and the reason it does not complete.
 *
 * Installing writes a context rule to a deployed smart account, and that write
 * has to be signed by an owner signer. This build has no signer a browser can
 * use: the passkey path and the browser-generated ed25519 keypair are both
 * unbuilt, and there is deliberately no code path here that would take a secret
 * key from a form.
 *
 * So the button is absent rather than disabled-with-a-tooltip. A disabled
 * button is still a claim that the feature exists and something is temporarily
 * wrong; this is neither. The install transaction that produced the recorded
 * testnet runs was signed by `packages/chain/scripts/testnet.mjs`, and saying
 * so is more useful than a control that cannot work.
 */
function InstallStep({ installable }: { installable: boolean }) {
  return (
    <div className="panel" data-tone="pending">
      <span className="eyebrow text-muted-dim">not built yet</span>
      <p className="measure text-[13px] leading-relaxed text-foreground/90">
        {installable
          ? 'The plan above is installable — it is a valid configuration of primitives already deployed on testnet. What this build cannot do is sign for it.'
          : 'There is no plan to install yet.'}
      </p>
      <p className="measure text-[12.5px] leading-relaxed text-muted">
        Installing writes a context rule to a smart account, and that write must be signed by an
        owner signer. Neither signer path exists in the browser yet: the passkey path is unbuilt, and
        so is the local keypair that would stand in for it. There is no form here that accepts a
        secret key, and there will not be one.
      </p>
      <p className="measure text-[12.5px] leading-relaxed text-muted-dim">
        The installs recorded in the README were signed by{' '}
        <span className="value">packages/chain/scripts/testnet.mjs</span>, which reads its keys from
        the environment and is not part of this application.
      </p>
    </div>
  );
}
