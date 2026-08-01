'use client';

import { useState, type ReactNode } from 'react';
import { PinnedEntries, type Entry } from './PinnedEntries';
import { WaitlistModal } from './WaitlistModal';

/**
 * The argument, above the demo.
 *
 * Six entries, one idea each, held one viewport at a time. The copy is
 * deliberately short: this page is read by people who are about to decide
 * whether a permission boundary is trustworthy, and every sentence that
 * persuades rather than states costs credibility. Prose is sans; every
 * contract field, primitive, and function name is mono, the same rule the
 * demo below follows.
 */
export function Landing() {
  // `opened` counts openings rather than tracking a boolean alone: it keys the
  // modal, so each open mounts a fresh one and no previous confirmation or
  // error survives into the next.
  const [waitlist, setWaitlist] = useState({ open: false, opened: 0 });
  const openWaitlist = () =>
    setWaitlist((previous) => ({ open: true, opened: previous.opened + 1 }));

  return (
    <>
      <header className="landing-header entry-inner gap-6">
        <span className="eyebrow-lead text-muted-dim">
          smart-account policy synthesis · stellar · soroban
        </span>

        <div className="flex flex-col gap-3">
          <h1 className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="wordmark text-foreground">LIMEN</span>
            <span className="text-[14px] font-normal text-muted-dim sm:text-[15px]">
              the permission layer for agentic money
            </span>
          </h1>
          <p className="entry-p max-w-[52ch] text-muted">
            A boundary an agent can spend inside, derived from a transaction that already happened.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <button
            type="button"
            onClick={openWaitlist}
            className="cursor-pointer rounded-[4px] border border-accent bg-accent-dim px-3.5 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-accent/15"
          >
            Join the waitlist
          </button>
          <a
            href="#demo"
            className="rounded-[3px] text-[13px] text-muted underline decoration-border-bright underline-offset-4 transition-colors hover:text-foreground hover:decoration-accent focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          >
            Skip to the demo
          </a>
        </div>
      </header>

      <PinnedEntries entries={buildEntries(openWaitlist)} />

      <WaitlistModal
        key={waitlist.opened}
        open={waitlist.open}
        onClose={() => setWaitlist((previous) => ({ ...previous, open: false }))}
      />
    </>
  );
}

function buildEntries(openWaitlist: () => void): Entry[] {
  return [
    {
      label: 'The problem',
      content: (
        <>
          <h2 className="entry-h max-w-[16ch] text-foreground">Funds delegation is binary.</h2>
          <p className="entry-p max-w-[58ch] text-muted">
            Hand an agent a key and it can do everything the account can do. Approve every
            transaction by hand and there is no agent — only a slower you. Nothing sits between the
            two by default.
          </p>
        </>
      ),
    },
    {
      label: 'Why it persists',
      content: (
        <>
          <h2 className="entry-h max-w-[19ch] text-foreground">
            The middle ground exists. Reaching it is the problem.
          </h2>
          <p className="entry-p max-w-[62ch] text-muted">
            Soroban has smart accounts — context rules and policies enforced inside the
            authorization path, on-chain, before a token moves. Using one means authoring and
            auditing a <Mono>Policy</Mono>-trait contract in Rust. That bar excludes almost
            everyone who needs the boundary.
          </p>
        </>
      ),
    },
    {
      label: 'What Limen does',
      content: (
        <h2 className="entry-h entry-h-lead max-w-[20ch] text-foreground">
          Limen derives the boundary from a transaction that already happened.
        </h2>
      ),
    },
    {
      label: 'Mechanism',
      content: (
        <>
          <h2 className="entry-h text-foreground">Mechanism.</h2>
          <ol className="flex max-w-[62ch] flex-col gap-5">
            <Step index="01">Perform the flow once, from the account that will delegate.</Step>
            <Step index="02">
              Limen derives the minimum context rule and policy set that permits exactly that flow,
              and refuses everything adjacent to it.
            </Step>
            <Step index="03">The agent operates inside it, and never holds a key.</Step>
          </ol>
        </>
      ),
    },
    {
      label: 'The boundary',
      content: (
        <>
          <h2 className="entry-h max-w-[17ch] text-foreground">
            Assume the agent&rsquo;s key is stolen.
          </h2>

          <div className="flex flex-col gap-5">
            <p className="entry-p max-w-[52ch] text-muted">The holder can spend. Only this:</p>
            {/* Wide enough that each clause and its field name sit on one
                line at desktop sizes; narrower viewports wrap the field
                underneath, which stays legible. */}
            <ul className="flex max-w-[78ch] flex-col gap-3">
              <Condition field="allowedContracts">
                only the contracts that were observed
              </Condition>
              <Condition field="allowedFunctions">
                only the functions that were invoked on them
              </Condition>
              <Condition field="spending_limit">
                only up to the derived cap, per asset, gross of inflows
              </Condition>
              <Condition field="validUntilLedger">
                only inside the context rule&rsquo;s window
              </Condition>
            </ul>
            <p className="entry-p max-w-[62ch] text-muted-dim">
              Every condition is checked on-chain, in the authorization path, before a token moves.
            </p>
          </div>

          <p className="entry-p max-w-[62ch] text-foreground">
            They cannot reach a contract that was never observed, call a function that was never
            invoked, exceed the cap, or act once the window has closed. They cannot widen any of it:
            that takes the account&rsquo;s own signature, which the agent never held.
          </p>
        </>
      ),
    },
    {
      label: 'Where it stands',
      content: (
        <>
          <h2 className="entry-h text-foreground">Where it stands.</h2>

          <dl className="flex max-w-[68ch] flex-col gap-5">
            <Stage version="V1" state="shipped" tone="permit">
              Deterministic synthesis composed from audited OpenZeppelin primitives, fixture-based
              ingest, a deny-case harness that gates CI, testnet install payloads. No smart account
              is deployed yet: refusal is proven by this repository&rsquo;s evaluator, not by an
              on-chain policy contract.
            </Stage>
            <Stage version="V2" state="next">
              Live Soroban RPC ingest. Install onto a deployed smart account.
            </Stage>
            <Stage version="V3" state="later">
              Policy code generation past the composed primitives. An MCP server. Mainnet.
            </Stage>
          </dl>

          <button
            type="button"
            onClick={openWaitlist}
            className="self-start cursor-pointer rounded-[4px] border border-accent bg-accent-dim px-3.5 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-accent/15"
          >
            Join the waitlist
          </button>
        </>
      ),
    },
  ];
}

/** An on-chain name inside prose. Never used for anything Limen merely says. */
function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[0.86em] text-foreground">{children}</span>;
}

function Step({ index, children }: { index: string; children: ReactNode }) {
  return (
    <li className="flex items-baseline gap-4 sm:gap-5">
      <span className="entry-mono shrink-0 text-faint">{index}</span>
      <span className="entry-p text-muted">{children}</span>
    </li>
  );
}

/**
 * One clause of the boundary, paired with the field that enforces it. The
 * field name is mono because it is a value in the derived policy below, not a
 * description of one.
 */
function Condition({ field, children }: { field: string; children: ReactNode }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-l border-border-bright pl-4">
      <span className="entry-p text-foreground">{children}</span>
      <span className="entry-mono text-muted-dim">{field}</span>
    </li>
  );
}

function Stage({
  version,
  state,
  tone = 'muted',
  children,
}: {
  version: string;
  state: string;
  tone?: 'permit' | 'muted';
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <dt className="entry-mono flex items-baseline gap-2">
        <span className={tone === 'permit' ? 'text-permit' : 'text-foreground'}>{version}</span>
        <span className="text-faint" aria-hidden="true">
          ·
        </span>
        <span className={tone === 'permit' ? 'text-permit' : 'text-muted-dim'}>{state}</span>
      </dt>
      <dd className="text-[14px] leading-relaxed text-muted sm:text-[15px]">{children}</dd>
    </div>
  );
}
