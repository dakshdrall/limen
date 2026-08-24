import { notFound, redirect } from 'next/navigation';
import { BuildSteps } from '@/components/app/BuildSteps';
import { DeployStep } from '@/components/app/DeployStep';
import { OffChainSummary } from '@/components/app/OffChainSummary';
import { ScreenHeader } from '@/components/app/ScreenHeader';
import { requireUser } from '@/lib/route-session';
import { drizzleAgentStore } from '@/lib/stores';

export const metadata = {
  title: 'Limen — deploy the agent',
  description:
    'Create the smart account and install the reviewed boundary on it — four transactions on Stellar testnet.',
};

/**
 * Step three: deploy.
 *
 * The boundary is read from `policies` on the server rather than carried here
 * from the review screen, which is what makes this route survive a reload and a
 * back-navigation. It is also the honest source: `install_plan_json` is what
 * `beginDeployment` will install, so rendering it means the table on this screen
 * and the rule that reaches the chain are the same object rather than two
 * objects that ought to match.
 *
 * ## An agent with no proposed policy is sent back rather than shown a dead button
 *
 * Arriving here without having accepted limits — by typing the URL, or by
 * pressing forward after going back and editing — means there is nothing to
 * install. The redirect to the review step is the whole handling: a deploy
 * button that cannot deploy is the shape of control this application does not
 * render.
 */
export default async function DeployPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const gate = await requireUser();
  if ('refusal' in gate) redirect('/app/agents/new');

  const store = drizzleAgentStore();
  const agent = await store.findForUser(id, gate.user.id);
  if (agent === undefined) notFound();

  const policy = await store.proposedPolicy(id, gate.user.id);
  if (policy === undefined) redirect(`/app/agents/${id}/review`);

  return (
    <main className="screen">
      <ScreenHeader
        eyebrow="build · step 3"
        title="Deploy the agent"
        labels={['TESTNET ONLY', 'NOT AUDITED', 'COMPOSITION ONLY']}
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-12">
        <div className="flex flex-col gap-6">
          <p className="measure text-[13px] leading-relaxed text-muted">
            This creates the smart account, funds it, and installs the boundary below as a context
            rule on it. Four transactions on Stellar testnet, signed by keys generated in this
            browser.
          </p>

          <DeployStep agentId={agent.id} plan={policy.installPlan} />

          {/*
            The limits the chain will NOT enforce, shown beside the ones it
            will. Rendered from the stored row rather than recomputed, so what
            is on screen is what was written down. Every constraint the builder
            collects appears here — a limit collected and never shown is the
            per-transaction-ceiling gap all over again.
          */}
          {policy.enforcedOffChain !== null && (
            <OffChainSummary
              perTransactionCap={policy.enforcedOffChain.perTransactionCap}
              recipients={policy.enforcedOffChain.recipients}
              allowedPairs={policy.enforcedOffChain.allowedPairs ?? []}
              maxPositionSize={policy.enforcedOffChain.maxPositionSize ?? null}
              assetLabel={policy.proposal.policies.find((p) => p.kind === 'spending_limit')?.asset ?? ''}
              assetDecimals={7}
            />
          )}
        </div>

        <aside className="flex flex-col gap-8 lg:border-l lg:border-border-subtle lg:pl-8">
          <BuildSteps current="deploy" agentId={agent.id} />

          <div className="flex flex-col gap-2">
            <span className="col-head text-muted-dim">the agent</span>
            <p className="text-[12.5px] leading-relaxed text-muted">{agent.name}</p>
          </div>

          <div className="flex flex-col gap-2">
            <span className="col-head text-muted-dim">where the boundary came from</span>
            <p className="text-[12.5px] leading-relaxed text-muted">
              Derived from the limits you accepted by the same deterministic synthesizer that
              derives one from a transaction that already happened, and lowered onto primitives an
              OpenZeppelin smart account can hold. Limen installs what you reviewed rather than
              re-deriving it now.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}
