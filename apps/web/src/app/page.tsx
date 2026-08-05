import Link from 'next/link';
import { Address } from '@/components/Address';
import { Code } from '@/components/Code';
import { TxHash } from '@/components/ExplorerLink';
import { Section } from '@/components/Section';
import { StatusLabels } from '@/components/StatusLabel';
import { PermittedRow, RefusedTable } from '@/components/app/RefusalTable';
import { WaitlistButton } from '@/components/landing/WaitlistButton';
import { EVIDENCE } from '@/lib/evidence';
import { decimalise, ledgersToDuration } from '@/lib/format';
import { RECORDED_DERIVATION, RECORDED_RUN, surveyFor } from '@/lib/recorded-runs';

/**
 * The landing page.
 *
 * What was here before was six sentences, one per viewport, pinned so that
 * scrolling replaced one with the next. It read as a product that had a
 * position and no evidence — and by the time this replaced it, two of those
 * six sentences had also gone stale: the roadmap still said no smart account
 * was deployed, months after the hashes below reached a ledger.
 *
 * The replacement is not a restyle. It is the same page held to the standard
 * every app screen in this repository is already held to: state a thing, then
 * put the hash that proves it next to the statement. Everything here is read
 * from `deployments/testnet.json` or from `generated/evidence.json`, so nothing
 * on this page can drift from what the scripts and the suites actually did.
 *
 * A server component. The one interactive thing is the waitlist button, which
 * is a client island of its own; the previous landing shipped every word of
 * itself to the browser as JavaScript because one button in its header owned
 * some state.
 */

/**
 * How a client tells a refusal from a failure.
 *
 * Transcribed from `packages/chain/scripts/testnet.mjs`, which is the code that
 * produced the hashes in the table above it, and from `isBoundaryRefusal` in
 * `packages/chain/src/errors.ts`. The landing shows this rather than the
 * signing code because the signing code is long and lives on `/docs`, and
 * because this is the check that the first over-limit run in this repository
 * did not have — and that near-miss is the most useful thing this project has
 * to say to anyone writing an agent.
 */
const REFUSAL_SNIPPET = `import { describeContractError, isBoundaryRefusal } from '@limen/chain';

// The call came back FAILED. Two very different things look identical at this
// point: the boundary declining, and the network never getting far enough to
// ask it. contractErrorCodes scans the submitted transaction's own diagnostic
// events; it is in packages/chain/scripts/testnet.mjs, ~20 lines.
const codes = contractErrorCodes(result);

if (isBoundaryRefusal(codes)) {
  // A policy the owner installed said no. Not transport, not budget, not a bug.
  // Do not retry: the same call will be refused for the same reason.
  return { refused: true, why: codes.map(describeContractError) };  // ${RECORDED_RUN.rejectedError}
}

// Anything else is infrastructure. resourceLimitExceeded above all: a footprint
// taken from a recording-mode simulation never runs __check_auth, so the
// transaction dies before the boundary is consulted — and reports the same
// operation result a genuine refusal does.
return { refused: false, why: opResultName(result) };`;

export default function Home() {
  const survey = surveyFor(RECORDED_RUN.smartAccount);

  return (
    <main className="screen">
      <header className="flex flex-col gap-6">
        <span className="eyebrow-lead text-muted-dim">
          smart-account policy synthesis · stellar · soroban
        </span>

        <div className="flex flex-col gap-4">
          <h1 className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="wordmark text-foreground">LIMEN</span>
            <span className="text-[14px] font-normal text-muted-dim sm:text-[15px]">
              the permission layer for agentic money
            </span>
          </h1>
          <p className="hero-h max-w-[24ch] text-foreground">
            A boundary an agent can spend inside.
          </p>
          <div className="measure space-y-3 text-[14px] leading-relaxed text-muted">
            <p>
              Hand an agent a key and it can do everything the account can do. Approve every
              transaction by hand and there is no agent, only a slower you. Soroban already has the
              middle ground — smart accounts whose context rules and policies are checked on-chain,
              inside the authorization path, before a token moves — and reaching it means authoring
              and auditing a <span className="value">Policy</span>-trait contract in Rust.
            </p>
            <p>
              Limen derives that boundary from a transaction that already happened, and installs it
              as a configuration of OpenZeppelin primitives that were audited by someone else. When
              it cannot do that with an audited primitive, it refuses to install rather than
              widening the rule until it fits.
            </p>
          </div>
        </div>

        {/* The spec strip. Mandatory placement, and first rather than last: a
            reader deciding whether to trust a permissions tool should meet its
            limits before its argument, not after it.

            Four labels, not the seven the closed set defines. `OPEN SOURCE` and
            `MIT` are said better by the GitHub link in the top bar and by the
            repository itself, and `IN DEVELOPMENT` is the vague version of what
            `TESTNET ONLY` and `NOT AUDITED` say precisely. Seven labels in a row
            is a badge shelf, and a badge shelf is read as decoration — which
            costs the three that are load-bearing the attention they need. */}
        <StatusLabels
          names={['TESTNET ONLY', 'NOT AUDITED', 'COMPOSITION ONLY', 'NO CUSTODY']}
        />

        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <WaitlistButton />
          <Link href="/app/simulator" className="btn" data-variant="secondary">
            Derive one yourself
          </Link>
          <Link href="/docs" className="text-[13px] link">
            Point an agent at an installed policy
          </Link>
        </div>
      </header>

      <Section
        index={1}
        title="Mechanism"
        subtitle="Three steps, and then the same three steps with the transaction hashes this repository actually produced."
      >
        <ol className="flex measure flex-col gap-4">
          <Step index="01">
            Perform the flow once, from the account that will delegate. One transaction, already
            approved by whoever owns the funds.
          </Step>
          <Step index="02">
            Limen derives the minimum context rule and policy set that permits exactly that flow —
            the contracts that were touched, the functions that were invoked on them, the outflow
            that occurred, and a window — and refuses everything adjacent to it.
          </Step>
          <Step index="03">
            The owner installs it. The agent gets a key registered under that rule, and the network
            is what stops it going further.
          </Step>
        </ol>

        <h3 className="mt-4 text-[14px] font-semibold tracking-[-0.01em] text-foreground">
          The same three steps, worked
        </h3>

        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-[13rem_minmax(0,1fr)]">
          <Field label="01 · observed">
            <TxHash hash={RECORDED_DERIVATION.hash} />{' '}
            <span className="text-[12.5px] text-muted-dim">
              a <span className="value">{RECORDED_DERIVATION.function}</span> of{' '}
              {decimalise(RECORDED_DERIVATION.observedAmount)} on the native SAC, at ledger{' '}
              {RECORDED_DERIVATION.ledger}
            </span>
          </Field>
          <Field label="02 · derived">
            <span className="value text-foreground">
              {decimalise(RECORDED_DERIVATION.derivedCap)}
            </span>{' '}
            {/* Nothing punctuates directly after an `Address`. It is a button
                carrying its own hover padding, so a comma set against it lands
                a space away from the value and reads as a floating comma. An
                em dash, which wants the space anyway, does not. */}
            <span className="text-[12.5px] text-muted-dim">
              cap on <Address value={RECORDED_DERIVATION.token} /> — that function only, and the
              same number as the outflow above, which is the whole claim
            </span>
          </Field>
          <Field label="03 · installed">
            <TxHash hash={RECORDED_RUN.installTx} />{' '}
            <span className="text-[12.5px] text-muted-dim">
              context rule {RECORDED_RUN.contextRuleId} on{' '}
              <Address value={RECORDED_RUN.smartAccount} /> — cap {decimalise(RECORDED_RUN.cap)} per{' '}
              {RECORDED_RUN.windowLedgers} ledgers ({ledgersToDuration(RECORDED_RUN.windowLedgers)})
            </span>
          </Field>
        </dl>

        {/* The seam, stated where a reader meets it rather than discovered
            later. Two real runs read as one pass unless the page says they are
            not, and "derived from a live transaction and installed on chain" is
            precisely the sentence a reviewer would be right to check. */}
        <p className="panel measure text-[12.5px] leading-relaxed text-muted-dim">
          <span className="text-foreground">These are two runs, not one pass.</span>{' '}
          {RECORDED_DERIVATION.installedSeparately} Step 01 was {RECORDED_DERIVATION.producedBy}.
        </p>
      </Section>

      <Section
        index={2}
        title="What the network did when the boundary was tested"
        subtitle="Not this repository's evaluator, and not a simulation. The policy contract ran inside __check_auth on a live host and refused; each attempt below burned a fee and is checkable in an explorer."
        emphasis
      >
        <PermittedRow run={RECORDED_RUN} />

        {survey !== undefined && <RefusedTable rows={survey.axes} caption={survey.note} />}

        <p className="measure text-[13px] leading-relaxed text-muted">
          Each row changes exactly one dimension of the permitted flow: the amount, the function,
          the asset, the contract, the number of invocations, and the window. All six reached a
          ledger and failed there, which was not a given —{' '}
          <span className="value">REFUSED AT SIMULATION</span> exists in this design system for the
          axes that could only have failed before submission, and measured against a live host there
          turned out to be none.
        </p>
        <p className="measure text-[12.5px] leading-relaxed text-muted-dim">
          Limen&rsquo;s own evaluator produces DENY rows too, from the same six axes, and none of
          them are on this page. They are in the{' '}
          <Link href="/app/simulator" className="link" data-tone="strong">
            simulator
          </Link>
          , which says on its face that nothing it draws has been enforced by a network. Keeping the
          two apart is the single most valuable habit this project has.
        </p>
      </Section>

      <Section
        index={3}
        title="How an agent reads that answer"
        subtitle="A refused call and a broken call arrive looking the same. Telling them apart is the difference between an agent that backs off and one that retries forever."
      >
        <Code>{REFUSAL_SNIPPET}</Code>
        <p className="measure text-[12.5px] leading-relaxed text-muted-dim">
          The full signing path — including why a signer signs{' '}
          <span className="value">sha256(payload || context_rule_ids)</span> rather than the
          host&rsquo;s payload, and why a submission has to be simulated twice — is on{' '}
          <Link href="/docs" className="link" data-tone="strong">
            docs
          </Link>
          , with the addresses an agent actually has to be configured with.
        </p>
      </Section>

      <Section
        index={4}
        title="Numbers"
        subtitle="Generated by scripts/evidence.mjs from the test run and the recorded transactions, and checked in CI against a regeneration. Nothing on this page is a figure someone typed."
      >
        <div className="grid gap-px overflow-hidden rounded-[5px] border border-border-default bg-border-subtle sm:grid-cols-2 lg:grid-cols-3">
          <Stat
            value={String(EVIDENCE.tests.total)}
            label="tests passing"
            note={EVIDENCE.tests.suites
              .map((suite) => `${suite.workspace.replace('@limen/', '')} ${suite.tests}`)
              .join(' · ')}
          />
          <Stat
            value={String(EVIDENCE.chain.transactions)}
            label="testnet transactions"
            note="every hash in the deployments file, each one openable in an explorer"
          />
          <Stat
            value={`${EVIDENCE.chain.denyAxes.onLedger} / ${EVIDENCE.chain.denyAxes.total}`}
            label="deny axes refused on-ledger"
            note={`${EVIDENCE.chain.denyAxes.errorDecodedOnLedger} of them with the contract error code decoded from the transaction's own diagnostics`}
          />
          <Stat
            value={String(EVIDENCE.chain.contextRulesInstalled)}
            label="context rules installed"
            note={`on ${EVIDENCE.chain.smartAccounts} deployed smart account, each signed by a script and never by this application`}
          />
          <Stat
            value={String(EVIDENCE.chain.wasmUploads)}
            label="WASMs uploaded"
            note={`${EVIDENCE.chain.wasmSource}, built from the pinned tag rather than written`}
          />
          <Stat
            value={String(EVIDENCE.chain.rustSourceFiles)}
            label="Rust files in this repository"
            note="composition only, counted rather than asserted: git ls-files '*.rs'"
          />
        </div>
      </Section>

      <Section
        index={5}
        title="What this does not do"
        subtitle="Stated here rather than discovered three screens in. Each is a real limit with a reason, not a rough edge."
      >
        <ul className="flex flex-col gap-4">
          <Limit title="No wallet, and no key recovery">
            Deploying, installing, and revoking are all built as browser code paths now, signed by a
            disposable ed25519 key generated in the page. There is no connected-wallet path — a
            wallet can only be a <span className="value">Delegated</span> signer, and that
            requirement cannot be discovered from a simulation, so there is nothing to hand it to
            sign. And there is no export and no backup: clearing site data destroys the key and
            strands the account it owns.
          </Limit>
          <Limit title="The browser has not signed anything yet">
            That path is written and it has not been driven end to end in a real browser, which are
            different claims. No hash on this page was signed in a browser — each was signed either
            by a script or, for the derivation above, by this repository&rsquo;s server-side demo
            signer. The acceptance run that would change that is recorded as unrun rather than
            quietly dropped.
          </Limit>
          <Limit title="One contract per boundary">
            A flow that touches a second contract cannot be installed, because no audited primitive
            constrains that contract and a rule without one would permit every function on it. Limen
            refuses rather than widening. Writing that policy in Rust would close the gap tomorrow
            and is the one thing this project has said it will not do.
          </Limit>
          <Limit title="Testnet, and not audited">
            The OpenZeppelin contracts a boundary is assembled from are audited. The code that
            decides what to assemble is this repository&rsquo;s, and it is not. No real funds are
            involved anywhere in this application.
          </Limit>
        </ul>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <WaitlistButton variant="secondary">
            Tell me when it installs from the browser
          </WaitlistButton>
        </div>
      </Section>

      <footer className="measure border-t border-border-subtle pt-6 text-[12.5px] leading-relaxed text-muted-dim">
        Every hash, address, cap and count on this page is read at build time from{' '}
        <span className="value">packages/chain/deployments/testnet.json</span> and{' '}
        <span className="value">src/generated/evidence.json</span>. The recording is dated{' '}
        {EVIDENCE.chain.recordedAt}. Policy is synthesized deterministically — the same transaction
        always produces the same proposal — and Claude explains a result and phrases the intent
        question, but never authors authorization logic.
      </footer>
    </main>
  );
}

function Step({ index, children }: { index: string; children: React.ReactNode }) {
  return (
    <li className="flex items-baseline gap-4">
      <span className="eyebrow shrink-0 text-faint">{index}</span>
      <span className="text-[14px] leading-relaxed text-muted">{children}</span>
    </li>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="col-head text-muted-dim">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

/**
 * One generated figure, its label, and where it came from.
 *
 * The provenance line is not decoration and not a caption: a number on a page
 * about honesty that cannot be traced to a file is worth less than no number,
 * and it is the line that makes `6 / 6` mean something other than a boast.
 *
 * Two deliberate departures from the usual stat-tile treatment, both because
 * this design system already answers the question differently. The value is set
 * in mono, because mono means "a value you can check" on every other screen
 * here and these are exactly that. And it keeps the global tabular figures
 * rather than switching to proportional ones at display size: the figures are
 * one to three digits, where proportional spacing buys nothing, and the tiles
 * sit in a grid where the digits line up column to column.
 *
 * The tiles share one border by sitting on a hairline grid — `gap-px` over the
 * subtle rule — rather than each drawing its own box. Six boxed cards would be
 * six rules doubled at every seam, which is exactly the noise the ruled-ground
 * approach exists to avoid.
 */
function Stat({ value, label, note }: { value: string; label: string; note: string }) {
  return (
    <div className="flex flex-col gap-1.5 bg-surface p-5">
      <span className="value text-[26px] leading-none font-semibold text-foreground">{value}</span>
      {/* `.col-head` for the voice, `whitespace-normal` to undo the one thing
          it assumes that is false here: a column head must not wrap, because a
          wrapped one changes its column's height. This is not in a column. It
          is in a tile a third of a viewport wide, and `DENY AXES REFUSED
          ON-LEDGER` has to be allowed to take two lines when the tile is
          narrow rather than run out of it. */}
      <span className="col-head whitespace-normal text-muted">{label}</span>
      <span className="text-[11.5px] leading-relaxed text-muted-dim">{note}</span>
    </div>
  );
}

function Limit({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-1.5 border-l border-border-default pl-4">
      <h3 className="text-[14px] font-semibold tracking-[-0.01em] text-foreground">{title}</h3>
      <div className="measure text-[13px] leading-relaxed text-muted">{children}</div>
    </li>
  );
}
