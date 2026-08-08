import Image, { type StaticImageData } from 'next/image';
import Link from 'next/link';
import stepCreate from '../../public/shots/step-create.png';
import stepDerive from '../../public/shots/step-derive.png';
import stepInstall from '../../public/shots/step-install.png';
import stepObserve from '../../public/shots/step-observe.png';
import { Address } from '@/components/Address';
import { Code } from '@/components/Code';
import { TxHash } from '@/components/ExplorerLink';
import { Section } from '@/components/Section';
import { StatusLabels } from '@/components/StatusLabel';
import { PermittedRow, RefusedTable } from '@/components/app/RefusalTable';
import { RevokePanel } from '@/components/landing/RevokePanel';
import { SectionNav } from '@/components/landing/SectionNav';
import { SiteFooter } from '@/components/landing/SiteFooter';
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
    <>
      {/* Outside `main`, and outside `.screen`. A sticky bar placed inside the
          grid would be laid out in the content column, so when it stuck it would
          paint its background over the middle of the page and let the content
          scroll past it through both gutters. It is chrome, it belongs beside
          `TopBar` rather than inside the document, and `<nav>` before `<main>` is
          also where a screen reader expects to meet it. */}
      <SectionNav />

      <main className="screen">
        {/* Two columns from `xl` up, where the content column is 1104px and the
            split is 640 for the screenshot and 416 for the argument. 640 is not a
            round number picked by eye: it is the width at which the application's
            13px body text survives the reduction to about 9.6px, checked by
            rendering the image at that size rather than by arithmetic. Below `xl`
            the image goes under the text at full width, which is more legible
            still. */}
        <header className="grid items-start gap-x-12 gap-y-12 xl:grid-cols-[minmax(0,1fr)_640px]">
          <div className="flex flex-col gap-6">
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
          </div>

          {/* The product, photographed rather than described.

              Generated by `scripts/screenshots.mjs` from the running application,
              so the figures inside it cannot drift from what the app renders. A
              static import, which is what lets Next read the intrinsic size at
              build time — a hand-written width and height would go wrong the next
              time the crop changes, and go wrong as layout shift, which is the one
              way an image can damage a page it is not even the subject of. */}
          <figure className="flex flex-col gap-2.5">
            <Image
              src={stepInstall}
              alt="The simulator's fifth step, in the application: a derived context rule allowing one contract and one function with a seven-day validity window, two policies below it — a spending limit of 500000000 stroops per 120960 ledgers and a function allowlist naming transfer() — and the unsigned payload that would install them."
              sizes="(min-width: 1280px) 640px, 100vw"
              preload
              className="h-auto w-full rounded-[5px] border border-border-default"
            />
            <figcaption className="text-[11.5px] leading-relaxed text-muted-dim">
              The simulator deriving a boundary from a shipped flow, and the payload that would
              install it. Nothing on that screen is submitted, and nothing here is a mock-up: the
              image is generated from the running application by a committed script.
            </figcaption>
          </figure>
        </header>

        <Section
          id="mechanism"
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
          id="evidence"
          index={2}
          title="What the network did when the boundary was tested"
          subtitle="Not this repository's evaluator, and not a simulation. The policy contract ran inside __check_auth on a live host and refused; each attempt below burned a fee and is checkable in an explorer."
          emphasis
          // The one band that spans the viewport. It is the section the page
          // exists to show — seven rows the network actually refused, each with a
          // hash — and it is also the widest thing here, the table `--screen-max`
          // was sized around. Everything else stays in the measure so that this
          // reads as the page opening up rather than as the page being wide.
          bleed
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
          id="how-it-works"
          index={4}
          title="How it works, in the application"
          subtitle="Four steps in the product itself. The first three are screenshots generated from the running application by a committed script; the fourth is not a screenshot, and the reason is the same reason the other three can be trusted."
        >
          {/* The alternating band. The image column is 640 and the text takes the
              rest, rather than an even split — 640 is the width these crops were
              measured legible at, and a 552px half-column puts the application's
              13px body text under 8px. See `scripts/screenshots.mjs`.

              Below `xl` every beat stacks, text first. The alternation is placed
              with `col-start` rather than by reordering the source, so the reading
              order is heading-then-figure in all four beats and at every width —
              a band that alternates by DOM order reads correctly down one column
              and backwards down the other. */}
          <div className="flex flex-col gap-14">
            <Beat
              index="01"
              side="left"
              title="Create the account, and the two keys"
              figure={
                <Shot
                  src={stepCreate}
                  alt="The first step of the account screen, headed “Generate the two keys”: an owner key and an agent key, both created in this browser, beside a TESTNET ONLY · LOCAL KEY label, with the note that the two disposable ed25519 keypairs are kept in this browser's storage and cannot be exported, and a “Generate keys” button."
                  caption="The first step of /app/accounts/new, before anything is generated."
                />
              }
            >
              An owner key and an agent key, both disposable ed25519 pairs generated in the page and
              kept in this browser&rsquo;s storage. The owner installs boundaries; the agent is what a
              boundary is installed <em>against</em>. They are not a wallet and they never reach a
              Limen server — and, as the step says on its own face, clearing site data destroys them
              and strands the account they own.
            </Beat>

            <Beat
              index="02"
              side="right"
              title="Observe a transaction that already happened"
              figure={
                <Shot
                  src={stepObserve}
                  alt="The observe step of the install flow: a field for pasting any Soroban testnet transaction hash, three shipped presets with simple-transfer selected, and the resolved transaction below it — hash, network, ledger and source account, a single transfer() invocation on one contract with its three arguments, and one outward token movement of 500000000 tagged OUT."
                  caption="The first step of /app/policies/new, with a shipped flow selected. Any Soroban testnet hash can go in the field instead and is resolved live through RPC."
                />
              }
            >
              A boundary is derived from something that already happened, so the flow starts by reading
              one back: the contracts it touched, the functions invoked on them, and the token
              movements it caused. Only outward movements contribute to a cap, and they are summed
              gross — an inflow of the same asset is never subtracted, because a rule that netted them
              off would permit a larger outflow than the account was ever observed making.
            </Beat>

            <Beat
              index="03"
              side="left"
              title="Derive the boundary, and install it"
              figure={
                <Shot
                  src={stepDerive}
                  alt="The simulator's third step, “Derive the boundary”, badged COMPUTED LOCALLY: a context rule allowing one contract, one function — transfer() — and a validity window of about seven days; two policies below it, a spending_limit of 500000000 per 120960 ledgers and a function_allowlist naming transfer(); and the rationale string each was derived from."
                  caption="The simulator's third step, on a shipped flow. It carries the COMPUTED LOCALLY badge because nothing the simulator draws has been enforced by a network. The payload an install produces is the screenshot at the top of this page."
                />
              }
            >
              The minimum context rule and policy set that permits exactly that flow: the one contract,
              the one function, a validity window, and a spending limit equal to the outflow that
              actually occurred. Each line carries the rationale it was derived from, so a reviewer
              checks the rule against the transaction rather than against a description of it. Every
              policy is a configuration of an audited OpenZeppelin primitive — and when no primitive
              can express the flow, this step refuses rather than widening the rule until it fits.
            </Beat>

            {/* The one beat with no photograph, and the strongest of the four. See
                `RevokePanel` for why it is data rather than an image, and why it
                wears the refusal table's surface rather than a screenshot frame. */}
            <Beat
              index="04"
              side="right"
              title="Take it back, and watch the agent stop"
              figure={<RevokePanel />}
            >
              A boundary installed here can be taken back, and the four transactions beside this are
              that happening on testnet: the agent spending inside its cap, the agent failing to remove
              its own boundary, the owner removing it, and the agent&rsquo;s first call repeated
              against a rule that is no longer there. The last is not counted as a refusal — there was
              no boundary left to consult, which is a different claim and a weaker one. This step is
              the only one with no screenshot, because the single screen that shows revoke reads a live
              chain, and a photograph of a live read is one account&rsquo;s rule frozen at one ledger.
            </Beat>
          </div>
        </Section>

        <Section
          index={5}
          title="Capabilities"
          subtitle="Six things this does, each one a claim the rest of this page has already shown the evidence for. Nothing here is on a roadmap; the limits are two sections down and are not a shorter list than they were."
        >
          {/* The same hairline grid the `Numbers` tiles sit on — `gap-px` over the
              subtle rule, so six tiles share five rules rather than drawing twelve.
              Six boxed cards would double every seam, which is exactly the noise
              the ruled-ground approach exists to avoid. */}
          <div className="grid gap-px overflow-hidden rounded-[5px] border border-border-default bg-border-subtle sm:grid-cols-2 lg:grid-cols-3">
            <Capability title="Derived, not authored">
              The rule is synthesized from a transaction that already happened — the contracts it
              touched, the functions invoked, the outflow it caused. Deterministically: the same
              transaction always produces the same proposal.
            </Capability>
            <Capability title="Assembled from audited primitives">
              A boundary is a configuration of OpenZeppelin&rsquo;s smart-account contracts, deployed
              from a pinned tag. No Rust is generated, and none is hand-written either.
            </Capability>
            <Capability title="Refuses rather than widens">
              When no audited primitive can express a flow, the install is declined. A rule stretched
              until it fits is a rule that permits more than it was asked to.
            </Capability>
            <Capability title="Enforced by the network">
              The policy contract runs inside <span className="value">__check_auth</span> on the host,
              before a token moves. Not by this application, and not by an agent choosing to comply.
            </Capability>
            <Capability title="Refusals an agent can act on">
              A refusal and an infrastructure failure arrive looking identical.{' '}
              <span className="value">@limen/chain</span> decodes the contract error from the
              submitted transaction&rsquo;s own diagnostics, so an agent can back off instead of
              retrying forever.
            </Capability>
            <Capability title="Revocable, and provably so">
              The owner removes the rule and the agent&rsquo;s next call stops working — while the
              agent&rsquo;s own attempt to remove it is refused by the contract rather than by a
              button this application declines to draw.
            </Capability>
          </div>
        </Section>

        <Section
          index={6}
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
          id="limits"
          index={7}
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
            <Limit title="The browser has signed, and no person has clicked">
              The acceptance flow has been driven end to end in a real browser twice, and every hash it
              produced is recorded and re-checked against public Horizon by a process that did not
              produce it. It was driven by a test, not by a hand — so what is retired is the claim that
              only a script had ever signed, and what is not claimed is that anyone has sat in front of
              it. The hashes on <em>this</em> page are still the script&rsquo;s; the browser&rsquo;s are
              in the deployments file.
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

        <SiteFooter />
      </main>
    </>
  );
}

/**
 * One beat of the `How it works` band: a numbered claim, and the evidence for it.
 *
 * The split is 640 for the figure and the rest for the text, rather than an even
 * one. 640 is not a round number chosen by eye — it is the width the screenshots
 * were measured legible at, and an even split of the 1104px content column would
 * put the application's 13px body text under 8px. See `scripts/screenshots.mjs`.
 *
 * The alternation is done with `col-start` rather than by reordering the source,
 * which matters for two readers who never see the alternation at all. A screen
 * reader and a keyboard get one linear order, and it is heading-then-figure in
 * every beat. Ordering the DOM instead would give the odd beats the correct
 * reading order and the even ones the reverse of it.
 *
 * Below `xl` the two stack, text first, and the figure takes the full content
 * column — where the screenshots render larger than 640 and are more legible
 * still.
 */
function Beat({
  index,
  side,
  title,
  figure,
  children,
}: {
  index: string;
  /** Which side the figure sits on from `xl` up. Below that, nothing alternates. */
  side: 'left' | 'right';
  title: string;
  figure: React.ReactNode;
  children: React.ReactNode;
}) {
  const figureLeft = side === 'left';
  return (
    <div
      className={`grid items-start gap-x-12 gap-y-6 ${
        figureLeft ? 'xl:grid-cols-[640px_minmax(0,1fr)]' : 'xl:grid-cols-[minmax(0,1fr)_640px]'
      }`}
    >
      <div
        className={`flex flex-col gap-3 xl:row-start-1 ${figureLeft ? 'xl:col-start-2' : 'xl:col-start-1'}`}
      >
        <div className="flex items-baseline gap-3">
          <span className="eyebrow shrink-0 text-faint">{index}</span>
          <h3 className="text-[17px] leading-tight font-semibold tracking-[-0.01em] text-foreground">
            {title}
          </h3>
        </div>
        <p className="measure text-[13px] leading-relaxed text-muted">{children}</p>
      </div>

      {/* `min-w-0` so a wide figure — the revoke panel's mono hashes, in
          particular — shrinks with its column instead of forcing the grid wider
          than the page. */}
      <div
        className={`min-w-0 xl:row-start-1 ${figureLeft ? 'xl:col-start-1' : 'xl:col-start-2'}`}
      >
        {figure}
      </div>
    </div>
  );
}

/**
 * A generated product screenshot, with what it is underneath it.
 *
 * Static imports, so Next reads each file's intrinsic size at build time. A
 * hand-written width and height is the version that goes wrong the next time a
 * crop changes, and it goes wrong as layout shift — which is the one way an
 * image can damage a page it is not even the subject of.
 *
 * No `loading` prop: `next/image` defaults to `lazy`, which is what every image
 * in this band wants. Only the hero's opts out, with `preload`, because it is
 * the one above the fold.
 */
function Shot({ src, alt, caption }: { src: StaticImageData; alt: string; caption: string }) {
  return (
    <figure className="flex flex-col gap-2.5">
      <Image
        src={src}
        alt={alt}
        sizes="(min-width: 1280px) 640px, 100vw"
        className="h-auto w-full rounded-[5px] border border-border-default"
      />
      <figcaption className="text-[11.5px] leading-relaxed text-muted-dim">{caption}</figcaption>
    </figure>
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

/**
 * One capability tile.
 *
 * Deliberately shaped like `Stat` and deliberately not carrying a figure. Both
 * grids sit on the same hairline ground, which is what makes them read as one
 * system rather than as two card treatments — but a capability is a claim in
 * prose and giving it a display-size value would invent a number for something
 * that does not have one.
 */
function Capability({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 bg-surface p-5">
      <h3 className="text-[14px] font-semibold tracking-[-0.01em] text-foreground">{title}</h3>
      <p className="text-[12.5px] leading-relaxed text-muted">{children}</p>
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
