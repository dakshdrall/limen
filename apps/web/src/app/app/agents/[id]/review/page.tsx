import { notFound, redirect } from 'next/navigation';
import { BuildSteps } from '@/components/app/BuildSteps';
import { ReviewStep } from '@/components/app/ReviewStep';
import { ScreenHeader } from '@/components/app/ScreenHeader';
import { reviveDraft } from '@/lib/agent-config';
import { requireUser } from '@/lib/route-session';
import { drizzleAgentStore } from '@/lib/stores';

export const metadata = {
  title: 'Limen — review the limits',
  description:
    'The limits drafted from a strategy, before anything is installed. This is where a proposal becomes a permission.',
};

/**
 * Step two: review the limits.
 *
 * A server component, and that is what makes the back button work. The agent
 * and its stored proposal are read here, per request, from the row — so
 * arriving by navigation, by reload, or by pressing back from the deploy screen
 * all produce the same page. The old flow held the proposal in React state,
 * which survived none of those.
 *
 * ## Ownership is a query, not a check
 *
 * `findForUser` scopes by `user_id` in the `where`, so an agent belonging to
 * somebody else is not found rather than found-and-refused. `agents.ts` gives
 * the reason at length: an agent id is a UUID in a URL, and a check performed
 * after the row comes back is one `if` away from not happening.
 *
 * ## Why the copy that used to be on the first screen is here
 *
 * *A description is not a permission* is a sentence about this step. On the
 * strategy screen it read as a disclaimer arriving before the thing it
 * disclaims; here it is an instruction about what the reader is looking at.
 */
export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const gate = await requireUser();
  // A signed-out visitor is sent to the start of the flow rather than shown a
  // sign-in panel here. There is nothing on this screen without an agent, and
  // the strategy screen is the one that explains what signing in is for.
  if ('refusal' in gate) redirect('/app/agents/new');

  const agent = await drizzleAgentStore().findForUser(id, gate.user.id);
  if (agent === undefined) notFound();

  const draft = reviveDraft(agent.draft, agent.description ?? '');
  const hadProposal = agent.draft !== null && agent.draft !== undefined;

  return (
    <main className="screen">
      <ScreenHeader
        eyebrow="build · step 2"
        title="Review the limits"
        labels={['TESTNET ONLY', 'NOT AUDITED', 'COMPOSITION ONLY']}
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-12">
        <div className="flex flex-col gap-6">
          <p className="measure text-[13px] leading-relaxed text-muted">
            These are the fields that become the boundary. Correct anything that is wrong — this
            step is where a proposal becomes a permission, and it is the only place that happens.
          </p>

          <ReviewStep agentId={agent.id} initialDraft={draft} hadProposal={hadProposal} />
        </div>

        <aside className="flex flex-col gap-8 lg:border-l lg:border-border-subtle lg:pl-8">
          <BuildSteps current="review" agentId={agent.id} />

          <div className="flex flex-col gap-2">
            <span className="col-head text-muted-dim">the strategy</span>
            <p className="text-[12.5px] leading-relaxed text-muted-dim italic">
              {agent.description ?? 'No strategy was recorded.'}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <span className="col-head text-muted-dim">what a model can do here</span>
            <p className="text-[12.5px] leading-relaxed text-muted">
              A model read the strategy and suggested these numbers. It can be wrong, and nothing it
              suggested has reached a chain. Whatever you accept is what gets installed, and the
              installed rule is what bounds the agent.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}
