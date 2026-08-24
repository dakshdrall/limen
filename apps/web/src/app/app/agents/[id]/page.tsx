import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Address } from '@/components/Address';
import { ScreenHeader } from '@/components/app/ScreenHeader';
import { requireUser } from '@/lib/route-session';
import { drizzleAgentStore } from '@/lib/stores';

export const metadata = {
  title: 'Limen — agent',
  description: 'One agent: its strategy, the limits installed on it, and where those limits live.',
};

/**
 * One agent, as the database records it.
 *
 * Where the build flow ends, and the page a deployed agent is reached from
 * afterwards. It answers three questions and refuses a fourth.
 *
 * ## Every value here is a database fact or a pointer
 *
 * The smart account address and the context rule id are **pointers**: they say
 * where to look, not what the rule currently permits. `agents.ts`'s header
 * forbids the second kind and gives the reason — a cached copy of a cap is a
 * claim about the past rendered as the present, and a policy revoked on another
 * device would still read as live. So this screen links to the explorer rather
 * than restating a limit it has not just read.
 *
 * Reading the live rule off the network belongs here eventually and is
 * deliberately absent rather than approximated. `TODO(roadmap)`: the holdings,
 * the last trade and the run control that Milestone 3 asks for, once there is a
 * trade to have made — none of which exists yet, and a screen that laid out
 * empty places for them would be claiming a feature by its furniture.
 */
export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const gate = await requireUser();
  if ('refusal' in gate) redirect('/app/agents/new');

  const store = drizzleAgentStore();
  const agent = await store.findForUser(id, gate.user.id);
  if (agent === undefined) notFound();

  // The list carries the two chain pointers; the single-agent read does not, so
  // this finds its own row in it rather than growing a second store method for
  // one screen.
  const summary = (await store.listForUser(gate.user.id)).find((row) => row.id === id);

  return (
    <main className="screen">
      <ScreenHeader
        eyebrow="agent"
        title={agent.name}
        labels={['TESTNET ONLY', 'NOT AUDITED', 'IN DEVELOPMENT']}
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-12">
        <div className="flex flex-col gap-6">
          <div className="panel">
            <span className="col-head text-muted-dim">the strategy</span>
            <p className="measure text-[13px] leading-relaxed text-foreground/90">
              {agent.description ?? 'No strategy was recorded for this agent.'}
            </p>
          </div>

          <div className="panel">
            <span className="col-head text-muted-dim">where its boundary lives</span>
            {summary?.smartAccount == null ? (
              <>
                <p className="measure text-[13px] leading-relaxed text-muted">
                  This agent has no smart account yet, so there is no boundary on a chain to point
                  at. Nothing it could do is bounded by anything, because there is nothing to do it
                  with.
                </p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                  <Link href={`/app/agents/${agent.id}/review`} className="link">
                    Review its limits
                  </Link>
                </div>
              </>
            ) : (
              <dl className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <dt className="col-head text-muted-dim">smart account</dt>
                  <dd className="text-[13px]">
                    <Address value={summary.smartAccount} />
                  </dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="col-head text-muted-dim">context rule</dt>
                  <dd className="text-[13px]">
                    <span className="value">{summary.contextRuleId ?? 'none recorded'}</span>
                  </dd>
                </div>
              </dl>
            )}
          </div>

          <div className="panel" data-tone="unproven">
            <span className="col-head text-muted">what this agent cannot do yet</span>
            <p className="measure text-[13px] leading-relaxed text-muted">
              Limen installs the boundary and stops there. There is no trading tool behind this
              agent — nothing here has placed a trade, and the limits above bound an agent that
              cannot yet act on its own.
            </p>
          </div>
        </div>

        <aside className="flex flex-col gap-8 lg:border-l lg:border-border-subtle lg:pl-8">
          <div className="flex flex-col gap-2">
            <span className="col-head text-muted-dim">status</span>
            <p className="font-mono text-[12px] tracking-[0.1em] text-foreground uppercase">
              {agent.status}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <span className="col-head text-muted-dim">elsewhere</span>
            <div className="flex flex-col gap-1 text-[13px]">
              <Link href={`/app/agents/${agent.id}/chat`} className="link">
                Talk to this agent
              </Link>
              <Link href="/app/agents" className="link">
                All your agents
              </Link>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
