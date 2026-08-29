import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { readBalance, SOROSWAP_TESTNET_ROUTER } from '@limen/chain';
import { Address } from '@/components/Address';
import { ExplorerLink } from '@/components/ExplorerLink';
import { ScreenHeader } from '@/components/app/ScreenHeader';
import { RunAgent, type StoredTrigger } from '@/components/app/RunAgent';
import { chainTxUrl } from '@/lib/explorer';
import { truncateAddress } from '@/lib/format';
import { RPC_URL } from '@/lib/chain-config';
import { requireUser } from '@/lib/route-session';
import { drizzleAgentStore } from '@/lib/stores';

export const metadata = {
  title: 'Limen — agent',
  description:
    'One agent: its strategy, the limits installed on it, what it holds, and the last thing it did.',
};

/**
 * One agent, and the single button that makes it act.
 *
 * Everything on this page is either a database fact, a value read from the
 * network on this request, or a pointer to one. Nothing is a cached claim about
 * what the boundary currently permits — `agents.ts`'s header forbids that, and a
 * detail page is where the temptation is strongest, because every number would
 * be cheaper to store than to read.
 *
 * ## The holdings are read now, and the ledger travels with them
 *
 * `readBalance` is a simulation against the account, on this request. A balance
 * is stale the moment it is read, so the ledger it was read at is rendered
 * beside it rather than left implicit.
 *
 * ## The last trade is the past, and is labelled as the past
 *
 * A recorded transaction says what happened once. It does not say the rule is
 * still installed, still live, or still has room — those are read from the
 * chain when something needs them, which is what `gate.ts` does every turn.
 */
/**
 * `agents.trigger_json` into something a screen can render, or null.
 *
 * Deliberately strict and deliberately silent. A stored trigger missing its
 * ledger, or carrying a `dropBps` as a string, is not a trigger this build
 * understands — and rendering four fields when three parsed would put a number
 * on screen that the runtime will not act on. The caller distinguishes "no
 * trigger" from "stored but unreadable" by checking the raw column, which is
 * why this returns null for both rather than throwing on one.
 */
function readTrigger(stored: unknown): StoredTrigger | null {
  if (typeof stored !== 'object' || stored === null) return null;
  const row = stored as Record<string, unknown>;
  if (row.kind !== 'price_drop') return null;
  if (typeof row.referencePrice !== 'string' || !/^[0-9]+$/.test(row.referencePrice)) return null;
  if (typeof row.referenceLedger !== 'number' || !Number.isInteger(row.referenceLedger)) return null;
  if (typeof row.dropBps !== 'number' || !Number.isInteger(row.dropBps)) return null;
  if (typeof row.amount !== 'string' || !/^[0-9]+$/.test(row.amount)) return null;

  return {
    referencePrice: row.referencePrice,
    referenceLedger: row.referenceLedger,
    dropBps: row.dropBps,
    amount: row.amount,
  };
}

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const gate = await requireUser();
  if ('refusal' in gate) redirect('/app/agents/new');

  const store = drizzleAgentStore();
  const agent = await store.findForUser(id, gate.user.id);
  if (agent === undefined) notFound();

  const summary = (await store.listForUser(gate.user.id)).find((row) => row.id === id);
  const policy = await store.proposedPolicy(id, gate.user.id);
  const lastTrade = await store.lastTransaction(id, gate.user.id);

  const offChain = policy?.enforcedOffChain ?? null;
  const pair = offChain?.allowedPairs?.[0] ?? null;
  const [inputAsset, outputAsset] = pair === null ? [null, null] : pair.split('/');

  // The stored rule, narrowed for display only. `agents.trigger_json` is
  // `unknown` because nothing checked it when it was written, and the runtime
  // re-validates it on every cycle regardless of what this screen makes of it.
  // Narrowing to null when it does not fit is what lets the screen say "stored
  // and unreadable" rather than rendering half a rule.
  const storedTrigger = readTrigger(agent.trigger);

  // Read on this request, never stored. Null when the account is not deployed
  // or the network could not be asked — both render as "not read" rather than
  // as a zero, because a zero balance and an unread one are different facts.
  let holdings: { stroops: string; ledger: number } | null = null;
  if (summary?.smartAccount != null && inputAsset != null) {
    try {
      const read = await readBalance(
        { rpcUrl: RPC_URL, simulationSource: summary.smartAccount },
        { token: inputAsset, holder: summary.smartAccount },
      );
      holdings = { stroops: read.amount.toString(), ledger: read.ledger };
    } catch {
      holdings = null;
    }
  }

  const cap = policy?.installPlan.rules
    .flatMap((rule) => rule.policies)
    .find((entry) => entry.kind === 'spending_limit');

  return (
    <main className="screen">
      <ScreenHeader
        eyebrow="agent"
        title={agent.name}
        labels={['TESTNET ONLY', 'NOT AUDITED', 'IN DEVELOPMENT']}
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-12">
        <div className="flex flex-col gap-6">
          <div className="panel">
            <span className="col-head text-muted-dim">the strategy</span>
            <p className="measure text-[13px] leading-relaxed text-foreground/90">
              {agent.description ?? 'No strategy was recorded for this agent.'}
            </p>
          </div>

          {inputAsset != null && outputAsset != null && summary?.smartAccount != null ? (
            <RunAgent
              agentId={agent.id}
              trigger={storedTrigger}
              triggerUnreadable={agent.trigger !== null && storedTrigger === null}
            />
          ) : (
            <div className="panel" data-tone="unproven">
              <span className="col-head text-muted">this agent cannot run a cycle</span>
              <p className="measure text-[13px] leading-relaxed text-muted">
                {summary?.smartAccount == null
                  ? 'It has no smart account yet, so there is nothing to trade from.'
                  : 'No allowed pair is configured, so there is nothing it may trade. Limen refuses ' +
                    'every swap until a pair is set.'}
              </p>
            </div>
          )}

          <div className="panel">
            <span className="col-head text-muted-dim">last transaction</span>
            {lastTrade === undefined ? (
              <p className="text-[13px] text-muted">
                Nothing recorded. This agent has not submitted anything.
              </p>
            ) : (
              <dl className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <dt className="col-head text-muted-dim">what happened</dt>
                  <dd className="text-[13px] text-foreground/90">
                    {lastTrade.reachedLedger === true
                      ? lastTrade.isBoundaryRefusal === true
                        ? 'The boundary refused it, on a ledger.'
                        : 'It reached a ledger.'
                      : 'It never reached a ledger.'}
                  </dd>
                </div>
                {lastTrade.hash !== null && (
                  <div className="flex flex-col gap-1">
                    <dt className="col-head text-muted-dim">transaction</dt>
                    <dd className="scroll-x text-[13px] break-words">
                      <ExplorerLink href={chainTxUrl(lastTrade.hash)} title={lastTrade.hash}>
                        <span className="value">{lastTrade.hash}</span>
                      </ExplorerLink>
                    </dd>
                  </div>
                )}
                <div className="flex flex-col gap-1">
                  <dt className="col-head text-muted-dim">amount</dt>
                  <dd className="text-[13px]">
                    <span className="value">{lastTrade.amount ?? 'not recorded'}</span>
                  </dd>
                </div>
              </dl>
            )}
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
            <span className="col-head text-muted-dim">holdings</span>
            {holdings === null ? (
              <p className="text-[12.5px] text-muted">
                Not read. A balance nobody could read is not a balance of zero.
              </p>
            ) : (
              <>
                <p className="font-mono text-[13px] text-foreground">{holdings.stroops}</p>
                <p className="text-[12px] text-faint">at ledger {holdings.ledger.toLocaleString('en-US')}</p>
              </>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <span className="col-head text-muted-dim">risk limits</span>
            <dl className="flex flex-col gap-2 text-[12.5px]">
              <div>
                <dt className="text-muted-dim">daily cap — the network&rsquo;s</dt>
                <dd className="font-mono text-foreground">
                  {cap?.kind === 'spending_limit' ? cap.limit : 'none installed'}
                </dd>
              </div>
              <div>
                <dt className="text-muted-dim">max position — Limen&rsquo;s</dt>
                <dd className="font-mono text-foreground">{offChain?.maxPositionSize ?? 'none'}</dd>
              </div>
              <div>
                <dt className="text-muted-dim">allowed pair — Limen&rsquo;s</dt>
                <dd className="scroll-x font-mono text-[11.5px] break-words text-foreground">
                  {pair ?? 'none — every swap refused'}
                </dd>
              </div>
            </dl>
            <p className="text-[12px] leading-relaxed text-faint">
              Only the daily cap is enforced by the account. The other two are Limen&rsquo;s, and a
              refusal citing them has no transaction hash.
            </p>
          </div>

          {summary?.smartAccount != null && (
            <div className="flex flex-col gap-2">
              <span className="col-head text-muted-dim">smart account</span>
              <div className="text-[13px]">
                <Address value={summary.smartAccount} />
              </div>
              <p className="text-[12px] text-faint">venue {truncateAddress(SOROSWAP_TESTNET_ROUTER)}</p>
            </div>
          )}

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
