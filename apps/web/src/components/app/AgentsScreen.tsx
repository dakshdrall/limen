'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AccountLink } from '@/components/app/AccountLink';
import { EmptyState, Pending, ReadFailure } from '@/components/app/ScreenState';
import { ExplorerLink } from '@/components/ExplorerLink';
import { StatusLabel } from '@/components/StatusLabel';
import { chainContractUrl } from '@/lib/explorer';
import { useIdentity } from '@/lib/use-identity';
import { STRATEGY_INPUT_PASSKEY_LABEL } from '@/components/app/StrategyInput';

/**
 * The agents this person owns, and what each one is actually allowed to do.
 *
 * ## Every cap on this screen came from the ledger, this page load
 *
 * `GET /api/agents` reads each deployed agent's context rule and spending limit
 * over RPC and returns the sequence it read them at. Nothing here is cached and
 * there is no column it could have come from — `schema.ts` rule 2 forbids one,
 * and a list view is where that rule earns its keep: an agent revoked on
 * another device must not appear here as bounded. So every row that shows a cap
 * also shows the ledger it was true at, and a row whose rule has gone says so
 * in those words rather than showing a blank.
 *
 * ## Six things a cap cell can be, and only one of them is a number
 *
 * `capState` distinguishes them because collapsing any two would misinform:
 *
 * | state | what it means |
 * |---|---|
 * | `read` | the ledger answered, and the numbers are its |
 * | `not_deployed` | a draft. There is no account and no rule yet |
 * | `no_rule` | deployed, but the rule is **not on the account** — revoked, or never finished |
 * | `unconfigured` | this build has no RPC endpoint and cannot look |
 * | `not_read` | past the request's read budget. Not read, which is not the same as absent |
 * | `failed` | the endpoint was asked and did not answer |
 *
 * The one that matters most is `no_rule` against `unconfigured`. *"This agent
 * has no boundary"* and *"this deployment cannot see boundaries"* are opposite
 * problems — one is alarming and one is a missing environment variable — and a
 * screen that showed the same dash for both would send a reader to debug the
 * wrong thing.
 *
 * ## The three identity states are the builder's, deliberately
 *
 * `StrategyInput` already decided what signed-out, unavailable and unknown look
 * like on a screen that needs a database, and a second screen inventing its own
 * phrasing for the same three facts is how a product ends up with two different
 * explanations of the same situation.
 */

type CapState = 'read' | 'no_rule' | 'unconfigured' | 'failed' | 'not_read' | 'not_deployed';

interface Cap {
  limit: string;
  spentInWindow: string;
  periodLedgers: number;
  validUntilLedger: number | null;
  ledger: number;
}

interface ListedAgent {
  id: string;
  name: string;
  description: string | null;
  status: string;
  smartAccount: string | null;
  contextRuleId: number | null;
  createdAt: string;
  capState: CapState;
  cap: Cap | null;
  capDetail: string | null;
}

type Load =
  | { kind: 'loading' }
  | { kind: 'loaded'; agents: ListedAgent[] }
  | { kind: 'failed'; message: string; detail?: string };

/**
 * The request, as a plain function of nothing, returning the state it produced.
 *
 * Outside the component and free of `setState` on purpose. `react-hooks/set-
 * state-in-effect` refuses a setter called synchronously from an effect body —
 * cascading renders — and the way out is not to silence it but to make the
 * effect *await* something and set state in the callback, which is the
 * subscribe-to-an-external-system shape the rule is written to allow. The HTTP
 * call is that external system.
 *
 * A returned `Load` rather than a thrown error, because every failure here has
 * a sentence a person reads, and the two arms are equally ordinary.
 */
async function readAgents(): Promise<Load> {
  try {
    const response = await fetch('/api/agents', { cache: 'no-store' });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      return {
        kind: 'failed',
        message: 'This list could not be read.',
        detail: `HTTP ${response.status}${body.error === undefined ? '' : ` — ${body.error}`}`,
      };
    }
    const body = (await response.json()) as { agents: ListedAgent[] };
    return { kind: 'loaded', agents: body.agents };
  } catch (error) {
    return {
      kind: 'failed',
      message: 'This list could not be read.',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export function AgentsScreen() {
  const identity = useIdentity();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  /** Bumped by the retry control. Re-running the effect is what re-reads. */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // Only once there is a session to scope by. Asking while signed out would
    // spend a request to be told 401 and would race the identity store's own
    // first fetch.
    if (identity.status !== 'signed-in') return;

    // `cancelled` rather than an AbortController: the request is cheap and the
    // thing worth preventing is a resolved fetch writing state into a component
    // that has since unmounted or moved on to a newer attempt.
    let cancelled = false;
    void readAgents().then((next) => {
      if (!cancelled) setLoad(next);
    });
    return () => {
      cancelled = true;
    };
  }, [identity.status, attempt]);

  if (identity.status === 'unknown') {
    return <Pending what="Checking whether this browser is signed in" />;
  }

  if (identity.status === 'unavailable') {
    return (
      <EmptyState title="This deployment cannot store agents">
        <p>
          An agent is a row in a database with an owner, and this build has no{' '}
          <span className="value">DATABASE_URL</span>. Every other screen here works without one —
          they keep what they know in this browser — but an agent that nobody owns is an agent
          nobody can revoke, so this screen refuses rather than listing something it cannot record.
        </p>
      </EmptyState>
    );
  }

  if (identity.status === 'signed-out') {
    return (
      <EmptyState title="Sign in to see your agents">
        <p>
          Use <span className="value">Connect wallet</span>{' '}
          at the top right, or sign in with a passkey. An agent has an owner: the row that records
          this agent records who may pause and revoke it, and this list is scoped to that owner.
        </p>
        <p>
          <StatusLabel name={STRATEGY_INPUT_PASSKEY_LABEL} />
        </p>
      </EmptyState>
    );
  }

  if (load.kind === 'loading') {
    return <Pending what="Reading each deployed agent's boundary from testnet" />;
  }

  if (load.kind === 'failed') {
    return (
      <ReadFailure
        message={load.message}
        detail={load.detail}
        onRetry={() => {
          setLoad({ kind: 'loading' });
          setAttempt((previous) => previous + 1);
        }}
      />
    );
  }

  if (load.agents.length === 0) {
    return (
      <EmptyState title="No agents yet">
        <p>
          An agent is a smart account with a permission rule installed on it, and a key Limen holds
          that can act only inside that rule.
        </p>
        <p>
          <Link href="/app/agents/new" className="link">
            Describe one and deploy it
          </Link>
          .
        </p>
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {load.agents.map((agent) => (
        <AgentRow key={agent.id} agent={agent} />
      ))}

      <p className="measure text-[12.5px] leading-relaxed text-muted-dim">
        Every cap above was read from the ledger when this screen loaded, at the sequence shown
        beside it. Nothing on this page is cached — reloading asks the network again.
      </p>
    </div>
  );
}

function AgentRow({ agent }: { agent: ListedAgent }) {
  return (
    <div className="panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[14px] font-semibold tracking-[-0.01em] text-foreground">
          {agent.name}
        </h3>
        <span className="eyebrow text-muted">{agent.status.toLowerCase()}</span>
      </div>

      {agent.description !== null && agent.description.length > 0 && (
        <p className="measure text-[12.5px] leading-relaxed text-muted">{agent.description}</p>
      )}

      <dl className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <dt className="col-head text-muted-dim">smart account</dt>
          <dd className="text-[13px]">
            {agent.smartAccount === null ? (
              <span className="text-muted-dim">
                none yet — this agent was described but never deployed
              </span>
            ) : (
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <AccountLink contractId={agent.smartAccount} />
                {/* The outside view. `AccountLink` shows what Limen read; this
                    shows what anyone else can see, which is what makes the
                    row checkable by someone who does not trust this page. */}
                <ExplorerLink href={chainContractUrl(agent.smartAccount)} title={agent.smartAccount}>
                  <span className="text-[12px]">explorer</span>
                </ExplorerLink>
              </span>
            )}
          </dd>
        </div>

        <div className="flex flex-col gap-1">
          <dt className="col-head text-muted-dim">installed cap</dt>
          <dd className="text-[13px]">
            <CapCell agent={agent} />
          </dd>
        </div>
      </dl>

      {agent.status === 'ACTIVE' ? (
        <p className="text-[13px]">
          <Link href={`/app/agents/${agent.id}/chat`} className="link">
            Talk to this agent
          </Link>
        </p>
      ) : (
        // Not a disabled link. `/api/agents/[id]/chat` refuses a non-ACTIVE
        // agent with 409, so offering the control would be offering something
        // that cannot work — which this application does not do.
        <p className="text-[12.5px] leading-relaxed text-muted-dim">
          Only a deployed agent can be talked to. This one is{' '}
          <span className="value">{agent.status}</span>.
        </p>
      )}
    </div>
  );
}

/** The six states, each said in its own words. See the header's table. */
function CapCell({ agent }: { agent: ListedAgent }) {
  if (agent.capState === 'read' && agent.cap !== null) {
    const { limit, spentInWindow, periodLedgers, validUntilLedger, ledger } = agent.cap;
    return (
      <span className="flex flex-col gap-1">
        <span>
          <span className="value">{limit}</span>{' '}
          <span className="text-muted-dim">
            per {periodLedgers.toLocaleString('en-US')} ledgers
          </span>
        </span>
        <span className="text-[12px] text-muted-dim">
          <span className="value">{spentInWindow}</span>{' '}
          {validUntilLedger === null
            ? 'spent in this window, no expiry'
            : `spent in this window, valid until ledger ${validUntilLedger.toLocaleString('en-US')}`}
        </span>
        {/* The sequence, always. A cap without the ledger it was read at is a
            claim about the past presented as the present. */}
        <span className="text-[12px] text-muted-dim">
          read at ledger <span className="value">{ledger.toLocaleString('en-US')}</span>
        </span>
      </span>
    );
  }

  if (agent.capState === 'not_deployed') {
    return <span className="text-muted-dim">no boundary yet — nothing is installed</span>;
  }

  if (agent.capState === 'no_rule') {
    return (
      <span className="flex flex-col gap-1">
        <span className="text-deny">no rule on the account</span>
        <span className="text-[12px] text-muted-dim">{agent.capDetail}</span>
      </span>
    );
  }

  if (agent.capState === 'unconfigured') {
    return (
      <span className="flex flex-col gap-1">
        <span className="text-muted-dim">not read — this build cannot reach a network</span>
        <span className="text-[12px] text-muted-dim">{agent.capDetail}</span>
      </span>
    );
  }

  if (agent.capState === 'not_read') {
    return (
      <span className="text-muted-dim">
        not read — past this request&rsquo;s read budget. Open the agent to read it.
      </span>
    );
  }

  return (
    <span className="flex flex-col gap-1">
      <span className="text-deny">the network was asked and did not answer</span>
      <span className="text-[12px] text-muted-dim">{agent.capDetail}</span>
    </span>
  );
}
