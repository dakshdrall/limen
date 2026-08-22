import Link from 'next/link';
import { ExplorerLink } from '@/components/ExplorerLink';
import { Reveal } from '@/components/Reveal';
import { StatusLabels } from '@/components/StatusLabel';
import { Verdict } from '@/components/Verdict';
import { DenyAxisTable } from '@/components/site/DenyAxisTable';
import { Scene, SceneBlock } from '@/components/site/Scene';
import { WaitlistForm } from '@/components/site/WaitlistForm';
import { EVIDENCE } from '@/lib/evidence';
import { chainTxUrl } from '@/lib/explorer';
import { decimalise, ledgersToDuration, truncateAddress, truncateHash } from '@/lib/format';
import {
  RECORDED_AGENT_BUILD,
  RECORDED_AGENT_BUILD_RUN,
  RECORDED_DERIVATION,
  RECORDED_REVOCATION,
  RECORDED_RUN,
  RECORDED_SURVEY,
  SHARED_CONTRACTS,
} from '@/lib/recorded-runs';

/**
 * The argument, in nine scenes.
 *
 * Every figure below is read from `deployments/testnet.json` through
 * `lib/recorded-runs.ts`, or from `generated/evidence.json` through
 * `lib/evidence.ts`. Nothing is typed. `evidence.test.ts` fails the build if a
 * transaction hash or an address appears as a literal anywhere that renders,
 * which is the fence that keeps that true as scenes are edited.
 *
 * The limits are stated in the hero, above the argument rather than under it.
 * That ordering is a requirement and not a preference: a claim qualified after
 * the reader has already accepted it is not qualified.
 *
 * ## What the repositioning moved, and what it deliberately did not
 *
 * This page used to argue for a permission layer: the thesis was *the boundary
 * is derived, not authored*, and the whole of it was about how a limit gets
 * written. That is still the mechanism and it is still true. It is no longer
 * the headline, because it answers a question a reader has not yet asked — you
 * cannot care how a boundary is authored until you want an agent inside one.
 *
 * So the product goes first — 02 build it, 03 deploy it, 04 talk to it — and
 * the permission work becomes 05 to 07, under the heading it actually earns:
 * *why you can trust it*. Nothing in that section was softened to make room. The derivation, the `__check_auth` attribution, the
 * six-axis refusal survey and the revocation sequence are all still here, with
 * the same hashes and the same provenance panels, because they are the reason
 * any of the scenes above them are worth reading.
 *
 * The limits list stays last and stays whole. `caveats.test.ts` pins its five
 * headings and the four labels in the hero, in both directions, and a
 * repositioning is exactly the kind of edit that fence exists to survive.
 */

/** A labelled figure, for the small evidence rows a scene ends on. */
function Fact({
  label,
  children,
  wide,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${wide === true ? 'sm:col-span-2' : ''}`}>
      <dt className="col-head">{label}</dt>
      <dd className="text-[13px] text-foreground">{children}</dd>
    </div>
  );
}

function Facts({ children }: { children: React.ReactNode }) {
  return (
    <dl className="on-ground grid grid-cols-1 gap-x-8 gap-y-5 p-5 sm:grid-cols-2">{children}</dl>
  );
}

export default function Home() {
  const derivation = RECORDED_DERIVATION;
  const run = RECORDED_RUN;
  const revocation = RECORDED_REVOCATION;
  const build = RECORDED_AGENT_BUILD;
  const buildRun = RECORDED_AGENT_BUILD_RUN;

  return (
    <main>
      {/* ---------------------------------------------------------------- hero */}
      <section className="scene" aria-labelledby="hero-title">
        <Reveal className="flex flex-col gap-6 measure-scene">
          <StatusLabels names={['TESTNET ONLY', 'NOT AUDITED', 'COMPOSITION ONLY', 'NO OWNER CUSTODY']} />
          <h1 id="hero-title" className="scene-h1 text-foreground">
            Describe an agent in a sentence. Deploy it in about a minute.
          </h1>
          <p className="scene-lead">
            Limen turns a sentence into a working agent on Stellar — its own smart account, its
            own signing key, and a spending boundary installed on chain before it is allowed to
            run. What that agent may then spend on your behalf is decided by the account itself:
            not by us, and not by the model that drafted it.
          </p>
          <p className="text-[15px] leading-relaxed text-muted">
            Not a key in an environment variable, and not a notification asking you to approve
            something.
          </p>
        </Reveal>

        <SceneBlock index={1} className="flex flex-col gap-3">
          {/* The primary points at the builder. Through V7 it pointed at
              `/app/try`, which is the guided walk through the chain writes —
              a good page, and the wrong front door for someone who wants an
              agent rather than a tour of one. `/app/try` keeps its place as
              the quiet register, and the simulator moves to the footer. */}
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/app/agents/new" className="btn" data-variant="primary" data-register="scene">
              Build an agent
            </Link>
            <Link href="/docs" className="btn" data-variant="secondary" data-register="scene">
              Read the docs
            </Link>
            <Link href="/app/try" className="btn" data-variant="quiet" data-register="scene">
              Walk it transaction by transaction
            </Link>
          </div>
          <p className="text-[12.5px] leading-relaxed text-muted-dim measure">
            Building one on testnet submits real transactions, funded by friendbot — no real money
            anywhere. Deploying a bounded agent runs today; holding a conversation with one does
            not yet, and scene 04 says which half is which.
          </p>
        </SceneBlock>

        <SceneBlock index={2}>
          <p className="text-[12.5px] leading-relaxed text-muted-dim measure">
            {EVIDENCE.chain.transactions} transactions recorded on Stellar {EVIDENCE.chain.network},
            across {EVIDENCE.chain.smartAccounts} smart accounts and{' '}
            {EVIDENCE.chain.contextRulesInstalled} installed context rules, as of{' '}
            {EVIDENCE.chain.recordedAt}. {EVIDENCE.tests.total} tests over {EVIDENCE.tests.files}{' '}
            files. Every hash on this page is checkable in a block explorer.
          </p>
        </SceneBlock>
      </section>

      {/* ------------------------------------------------------------- scene 1 */}
      <Scene
        id="today"
        index="01"
        eyebrow="Why this is hard"
        title="An agent that can pay for things is an agent holding your money."
        lead="Which leaves two options, and both of them are bad. Give it a key and hope. Or approve every transaction yourself, and not really have an agent."
      >
        <SceneBlock index={1} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="panel" data-tone="refused">
            <p className="eyebrow text-deny uppercase">Hand over a key</p>
            <p className="text-[14px] leading-relaxed text-foreground/90">
              The agent can do anything you can do. Every transfer, every contract, every amount,
              for as long as the key exists. The limit is your trust in a model&rsquo;s judgement
              and in the code around it, and neither of those is a limit.
            </p>
          </div>
          <div className="panel" data-tone="refused">
            <p className="eyebrow text-deny uppercase">Approve every call</p>
            <p className="text-[14px] leading-relaxed text-foreground/90">
              Nothing moves without you. Which is safe, and which means the agent is a
              suggestion engine with extra steps — you are still the one doing the work, only now
              you are doing it at the speed of notifications.
            </p>
          </div>
        </SceneBlock>

        <SceneBlock index={2}>
          <p className="text-[15px] leading-relaxed text-muted measure-scene">
            There is nothing between them. That gap is why most agentic money today is either a
            demo on testnet or a key in an environment variable — and it is the gap this platform
            is built in. An agent on Limen holds a key that can only do one narrow thing, and the
            account it holds the key to is what stops it doing anything else.
          </p>
        </SceneBlock>
      </Scene>

      {/* ------------------------------------------------------------- scene 2 */}
      <Scene
        id="build"
        index="02"
        eyebrow="Build"
        from="left"
        title="Say what it should do. Read back what it may do."
        lead="You write one sentence. Limen drafts an agent from it — the job, the token, a ceiling per payment, a window — and shows you the limits it intends to install before anything is signed."
      >
        <SceneBlock index={1} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="panel">
            <p className="eyebrow text-muted uppercase">Describe</p>
            <p className="text-[14px] leading-relaxed text-foreground/90">
              &ldquo;Pay my contractor up to 50 XLM a week.&rdquo; One sentence, in the box, in
              your own words.
            </p>
          </div>
          <div className="panel">
            <p className="eyebrow text-muted uppercase">Review</p>
            <p className="text-[14px] leading-relaxed text-foreground/90">
              The draft comes back as limits rather than as prose: which token, how much, how
              often, until when. Every field is editable, and nothing is installed until you say
              so.
            </p>
          </div>
          <div className="panel">
            <p className="eyebrow text-muted uppercase">Deploy</p>
            <p className="text-[14px] leading-relaxed text-foreground/90">
              You sign once. The account, the agent&rsquo;s key and the boundary all go on chain
              together, and the agent does not exist until the boundary does.
            </p>
          </div>
        </SceneBlock>

        <SceneBlock index={2}>
          <p className="text-[15px] leading-relaxed text-muted measure-scene">
            The order matters more than the speed. The boundary is installed in the same flow that
            creates the agent, not bolted on afterwards as a setting somebody might skip — so
            there is no window in which the agent exists and is unbounded.
          </p>
        </SceneBlock>
      </Scene>

      {/* ------------------------------------------------------------- scene 3 */}
      <Scene
        id="deploy"
        index="03"
        eyebrow="Deploy"
        title="Four writes, one after another, and then it is live."
        lead="A smart account of its own, a fee account for the agent's key, the key registered as a signer, and the boundary installed on that signer. Below is a deployment this screen actually performed on testnet."
      >
        <SceneBlock index={1}>
          <Facts>
            <Fact label="Smart account created">
              <span className="value" title={build.smartAccount}>
                {truncateAddress(build.smartAccount)}
              </span>
            </Fact>
            <Fact label="Closed on ledgers">
              <span className="value">{build.ledgerRange}</span>
            </Fact>
            <Fact label="Account deployed">
              <ExplorerLink href={chainTxUrl(build.deployTx)} title={build.deployTx}>
                <span className="value">{truncateHash(build.deployTx)}</span>
              </ExplorerLink>
            </Fact>
            <Fact label="Agent key registered">
              <ExplorerLink href={chainTxUrl(build.seedTx)} title={build.seedTx}>
                <span className="value">{truncateHash(build.seedTx)}</span>
              </ExplorerLink>
            </Fact>
            <Fact label="Boundary installed">
              <ExplorerLink href={chainTxUrl(build.installTx)} title={build.installTx}>
                <span className="value">{truncateHash(build.installTx)}</span>
              </ExplorerLink>
            </Fact>
            <Fact label="Ceiling installed">
              <span className="value text-permit">{decimalise(build.limit)}</span>{' '}
              <span className="text-muted-dim">
                per {ledgersToDuration(build.periodLedgers)}, derived at ledger{' '}
                {build.derivedAtLedger.toLocaleString('en-US')}
              </span>
            </Fact>
          </Facts>
        </SceneBlock>

        <SceneBlock index={2}>
          {/* Provenance, and the one limit that matters about this particular
              recording: no model answered. `withoutAModel` is a required field
              on the type for exactly that reason — a scene citing this run as
              evidence for the sentence-to-draft step would be citing it for the
              one thing it does not show. */}
          <p className="panel measure text-[12.5px] leading-relaxed text-muted-dim" data-tone="pending">
            <span className="eyebrow text-muted uppercase">How this was produced</span>
            {buildRun.producedBy} A Playwright spec drove that browser and no person clicked
            through it, so this is evidence that the path runs end to end, not that somebody found
            it easy. {buildRun.withoutAModel}
          </p>
        </SceneBlock>
      </Scene>

      {/* ------------------------------------------------------------- scene 4 */}
      <Scene
        id="talk"
        index="04"
        eyebrow="Talk"
        title="Then you talk to it — and the account still decides."
        lead="You ask the agent to pay someone. It builds the transaction and signs with its own key, and the account checks the boundary before anything moves. Your approval is not in that loop, because you already gave it once, when you installed the boundary."
      >
        <SceneBlock index={1}>
          <p className="text-[15px] leading-relaxed text-muted measure-scene">
            Nothing in that sentence asks you to trust the model. The agent can propose anything it
            likes — a larger amount, a different token, a contract you never mentioned — and the
            account refuses it in the same way it would refuse a stranger, because the check is not
            a policy the agent is asked to observe. It is a policy the agent is unable to exceed.
          </p>
        </SceneBlock>

        <SceneBlock index={2} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="panel">
            <p className="eyebrow text-muted uppercase">What you do</p>
            <p className="text-[14px] leading-relaxed text-foreground/90">
              Say what you want done. You approve nothing per transaction and sign nothing per
              transaction — you already signed the only thing that mattered, which was the
              boundary.
            </p>
          </div>
          <div className="panel">
            <p className="eyebrow text-muted uppercase">What it cannot do</p>
            <p className="text-[14px] leading-relaxed text-foreground/90">
              Exceed the ceiling, touch another token, call another contract, or outlive the
              window. Each of those is refused on a ledger, and the three scenes below are the
              hashes.
            </p>
          </div>
        </SceneBlock>

        <SceneBlock index={3}>
          {/* The honest half of this scene, and it is not optional.
              `/app/agents/new`'s own header states it: the agent key this flow
              creates is generated in the browser and stays there, so an agent
              that acts while nobody is watching needs a key Limen holds, and
              that runtime is not shipped. The closed set in
              `packages/shared/src/status-labels.ts` has a label for a
              server-held agent key and `caveats.test.ts` keeps it off every
              rendered surface for the same reason — overstating a risk you have
              not taken on is still stating something false. That assertion
              reads this file's source, comments included, so the label is
              described here rather than quoted. This scene describes the loop
              the boundary was built for and says plainly which half of it runs
              today; it moves to the present tense in the commit that makes it
              true, and not before. */}
          <p className="panel measure text-[12.5px] leading-relaxed text-muted-dim" data-tone="pending">
            <span className="eyebrow text-muted uppercase">What runs today</span>
            The boundary, the deployment and every refusal below are live on testnet and have
            hashes. The conversation does not: an agent that acts while your browser is closed
            needs a key held somewhere other than your browser, and today the agent key this flow
            creates is generated in your browser and stays in it. Until that changes, this scene
            describes the loop the boundary was built for rather than one you can run.
          </p>
        </SceneBlock>
      </Scene>

      {/* ------------------------------------------------------------- scene 5
          The permission work starts here. It used to be the whole page and it
          is now the reason to trust the four scenes above it — which is a
          demotion in position and not in substance. Both halves of the original
          argument are intact in this scene: the boundary is derived rather than
          described, and the thing enforcing it is the account. */}
      <Scene
        id="boundary"
        index="05"
        eyebrow="Why you can trust it"
        from="left"
        title="The limit is not a setting. It is a rule on the account, and the account is what enforces it."
        lead="Not by this repository's evaluator, and not by a server that could be down or persuaded. The boundary is a context rule and a policy contract on a Soroban smart account, checked inside __check_auth before a token moves."
      >
        <SceneBlock index={1}>
          <p className="text-[15px] leading-relaxed text-muted measure-scene">
            The agent&rsquo;s key is registered as a signer that may only act under that rule. When
            it signs, the account&rsquo;s own code runs first and either authorizes the call or
            traps. If Limen disappeared tomorrow, the boundary would still be there and would still
            be enforced, because the thing enforcing it is the account.
          </p>
        </SceneBlock>

        <SceneBlock index={2} className="flex flex-col gap-4">
          <h3 className="scene-h3 text-foreground">And where the rule comes from</h3>
          <p className="text-[15px] leading-relaxed text-muted measure-scene">
            A boundary you have to describe is a boundary you can also mis-describe — correctly, in
            advance, in the abstract, about money. So Limen would rather read one off a transaction
            that already happened. Perform the flow once and it derives the narrowest rule that
            permits it: the
            contracts it touched, the functions it invoked, the outflow that actually occurred, and
            a window. Nothing wider. The derived cap is the outflow that happened, not a round
            number near it — and that equality is the claim, not a coincidence. Below is a boundary
            derived from a transaction observed on live testnet, with both numbers as the recording
            holds them.
          </p>
        </SceneBlock>

        <SceneBlock index={3}>
          <Facts>
            <Fact label="Observed transaction">
              <ExplorerLink href={chainTxUrl(derivation.hash)} title={derivation.hash}>
                <span className="value">{truncateHash(derivation.hash)}</span>
              </ExplorerLink>
            </Fact>
            <Fact label="At ledger">
              <span className="value">{derivation.ledger.toLocaleString('en-US')}</span>
            </Fact>
            <Fact label="Function invoked">
              <span className="value">{derivation.function}</span>
            </Fact>
            <Fact label="Token contract">
              <span className="value" title={derivation.token}>
                {truncateAddress(derivation.token)}
              </span>
            </Fact>
            <Fact label="Outflow observed">
              <span className="value">{decimalise(derivation.observedAmount)}</span>
            </Fact>
            <Fact label="Cap derived">
              <span className="value text-permit">{decimalise(derivation.derivedCap)}</span>
            </Fact>
          </Facts>
        </SceneBlock>

        <SceneBlock index={4}>
          {/* The seam. This transaction was observed and derived from; the
              recorded install was built by the script from the same parameters.
              The recording says so and so does the page. */}
          <p className="panel measure text-[12.5px] leading-relaxed text-muted-dim" data-tone="pending">
            <span className="eyebrow text-muted uppercase">How this was produced</span>
            {derivation.producedBy}. {derivation.installedSeparately}
          </p>
        </SceneBlock>

        <SceneBlock index={5} className="flex flex-col gap-4">
          <h3 className="scene-h3 text-foreground">What it looks like once installed</h3>
          <Facts>
            <Fact label="Smart account">
              <span className="value" title={run.smartAccount}>
                {truncateAddress(run.smartAccount)}
              </span>
            </Fact>
            <Fact label="Context rule">
              <span className="value">#{run.contextRuleId}</span>
            </Fact>
            <Fact label="Policy contract" wide>
              <span className="value" title={SHARED_CONTRACTS.spendingLimitPolicy.contract}>
                {truncateAddress(SHARED_CONTRACTS.spendingLimitPolicy.contract, 8, 6)}
              </span>{' '}
              <span className="text-muted-dim">
                — an audited OpenZeppelin primitive, configured. No Rust is generated and none is
                written by hand.
              </span>
            </Fact>
            <Fact label="Cap installed">
              <span className="value">{decimalise(run.cap)}</span>
            </Fact>
            <Fact label="Window">
              <span className="value">{run.windowLedgers.toLocaleString('en-US')} ledgers</span>{' '}
              <span className="text-muted-dim">{ledgersToDuration(run.windowLedgers)}</span>
            </Fact>
            <Fact label="Install transaction" wide>
              <ExplorerLink href={chainTxUrl(run.installTx)} title={run.installTx}>
                <span className="value">{truncateHash(run.installTx)}</span>
              </ExplorerLink>
            </Fact>
          </Facts>
        </SceneBlock>
      </Scene>

      {/* ------------------------------------------------------------- scene 6 */}
      <Scene
        id="refuses"
        index="06"
        eyebrow="The proof"
        title="What it refuses."
        lead="A boundary that permits the thing it was derived from proves nothing — the permitted flow is the one flow it was built to allow. What matters is what happens one step to the side."
      >
        <SceneBlock index={1}>
          <p className="text-[15px] leading-relaxed text-muted measure-scene">
            Six ways to be adjacent to the permitted flow. Each changes exactly one dimension:
            the amount, the function, the asset, the contract, the number of invocations, the
            ledger it arrives on. Every one was attempted against a real rule on a real account,
            and every one was refused on a ledger. This is the table to read if you are deciding
            whether to believe anything else on this page.
          </p>
        </SceneBlock>

        <SceneBlock index={2} className="bleed">
          <DenyAxisTable axes={RECORDED_SURVEY.axes} />
        </SceneBlock>

        <SceneBlock index={3}>
          <p className="panel measure text-[12.5px] leading-relaxed text-muted-dim" data-tone="pending">
            <span className="eyebrow text-muted uppercase">What the recording says</span>
            {RECORDED_SURVEY.note}
          </p>
        </SceneBlock>
      </Scene>

      {/* ------------------------------------------------------------- scene 7 */}
      <Scene
        id="revoke"
        index="07"
        eyebrow="Taking it back"
        title="The agent cannot remove its own boundary. You can."
        lead="A permission you cannot withdraw is not a permission. And a boundary the agent can lift is not a boundary — so the network refuses that too, and there is a hash for it."
      >
        <SceneBlock index={1}>
          <p className="text-[15px] leading-relaxed text-muted measure-scene">
            Removing a context rule requires the account to authorize itself. The agent&rsquo;s
            rule permits calls to a token contract, which is not a call to the account, so its
            attempt traps — refused by the contract, not by this application declining to draw a
            button. The owner&rsquo;s rule does permit it. Afterwards the same call that worked
            before stops working, and it fails for a different reason.
          </p>
        </SceneBlock>

        <SceneBlock index={2} className="flex flex-col gap-3">
          <RevokeStep
            state="permitted"
            title="The agent spends inside the boundary"
            detail={`${decimalise(revocation.permittedAmount)} of a ${decimalise(revocation.derivedCap)} cap — deliberately under it, which is what makes the last step legible.`}
            hash={revocation.permittedTx}
          />
          <RevokeStep
            state="denied"
            title="The agent tries to remove its own boundary"
            detail={revocation.agentRevokeError}
            hash={revocation.agentRevokeTx}
          />
          <RevokeStep
            state="permitted"
            title="The owner removes it"
            detail={`${revocation.rulesAfterRevokeNote}`}
            hash={revocation.revokeTx}
          />
          <RevokeStep
            state={revocation.postRevokeIsRevokedRule ? 'rule-revoked' : 'denied'}
            title="The agent repeats the call that worked"
            detail={`${revocation.postRevokeError} — it fails because the rule is gone, not because the limit was reached. Those are different claims and only one of them is evidence the boundary worked.`}
            hash={revocation.postRevokeTx}
          />
        </SceneBlock>

        <SceneBlock index={3}>
          <p className="panel measure text-[12.5px] leading-relaxed text-muted-dim" data-tone="pending">
            <span className="eyebrow text-muted uppercase">A different run</span>
            These four transactions are from {revocation.producedBy}, recorded {revocation.ranAt} on
            smart account{' '}
            <span className="value" title={revocation.smartAccount}>
              {truncateAddress(revocation.smartAccount)}
            </span>{' '}
            — a different account from the one in scene 05, and from the deployment in scene 03.
            Three accounts&rsquo; hashes in one column read as one account&rsquo;s unless the page
            says otherwise.
          </p>
        </SceneBlock>
      </Scene>

      {/* ---------------------------------------------------------- what's next */}
      <Scene
        id="get"
        index="08"
        eyebrow="What you get back"
        title="An agent that can act, inside a boundary you did not have to describe."
      >
        <SceneBlock index={1} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="panel">
            <p className="eyebrow text-muted uppercase">An agent</p>
            <p className="text-[14px] leading-relaxed text-foreground/90">
              With its own smart account, its own key, and a job it can do while you are asleep and
              your browser is closed.
            </p>
          </div>
          <div className="panel">
            <p className="eyebrow text-muted uppercase">A boundary</p>
            <p className="text-[14px] leading-relaxed text-foreground/90">
              One token contract, transfer only, up to your ceiling, until your expiry — installed
              on the account and checked by it, not by us.
            </p>
          </div>
          <div className="panel">
            <p className="eyebrow text-muted uppercase">A way out</p>
            <p className="text-[14px] leading-relaxed text-foreground/90">
              One signed call takes the boundary away, and only yours works. The agent&rsquo;s does
              not.
            </p>
          </div>
        </SceneBlock>

        <SceneBlock index={2} className="flex flex-col gap-4">
          <h3 className="scene-h3 text-foreground">What this is not, stated plainly</h3>
          <ul className="flex flex-col gap-2.5 text-[14px] leading-relaxed text-muted measure-scene">
            <li>
              <span className="value text-foreground">Testnet only.</span>{' '}Every address and hash on
              this site is Stellar testnet. No real funds are involved anywhere.
            </li>
            <li>
              <span className="value text-foreground">Not audited.</span>{' '}The OpenZeppelin contracts
              Limen installs are audited. The code that decides what to install is not, and no third
              party has reviewed it.
            </li>
            <li>
              <span className="value text-foreground">Composition only.</span>{' '}Every policy is a
              configuration of an existing primitive. {EVIDENCE.chain.rustSourceFiles} lines of Rust
              are generated, which is the claim as a number rather than as a promise.
            </li>
            <li>
              <span className="value text-foreground">No owner custody.</span>{' '}The key that owns
              your account — a passkey, or a key generated in your browser — never reaches a Limen
              server, an environment variable, or a log line. Limen cannot move your funds outside
              the boundary you installed, and cannot remove that boundary.
            </li>
            <li>
              <span className="value text-foreground">Single-transaction derivation.</span>{' '}A
              boundary is derived from one observed transaction. Deriving from a set of them, and
              arguing about what their union should permit, is not built.
            </li>
            <li>
              <span className="value text-foreground">No agent runtime.</span>{' '}An agent is
              deployed, bounded and revocable today. It is not yet conversational and does not yet
              act on its own: the key it holds is generated in your browser and stays there, so
              nothing signs while your browser is closed. Scene 04 is the loop this is built for,
              not a loop you can run.
            </li>
          </ul>
        </SceneBlock>

        {/* The caveats come first and the way in comes after them, deliberately:
            what this is not is the thing a person should have read before
            spending a friendbot call, not after. */}
        <SceneBlock index={3} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/app/agents/new" className="btn" data-variant="primary" data-register="scene">
              Build an agent
            </Link>
          </div>
          <p className="text-[12.5px] leading-relaxed text-muted-dim measure">
            A sentence, a passkey, and a boundary you read before you sign it. The account, the
            agent&rsquo;s key and the rule all go on testnet in the same flow.
          </p>
        </SceneBlock>
      </Scene>

      {/* -------------------------------------------------------------- waitlist */}
      <Scene
        id="waitlist"
        index="09"
        eyebrow="If this is your problem"
        title="Tell us what you're building."
        lead="Limen is in development and changing weekly. If you want an agent that can spend and the two bad options are your two bad options, we would like to hear from you."
      >
        <SceneBlock index={1}>
          <WaitlistForm />
        </SceneBlock>
      </Scene>

    </main>
  );
}

/**
 * One step of the revoke sequence.
 *
 * The verdict is passed rather than inferred, because the recording carries the
 * distinction and the page must not re-decide it. `ContextRuleNotFound#3000` is
 * deliberately absent from `BOUNDARY_REFUSAL_CODES` — "the boundary refused
 * you" and "the boundary is gone" are different claims — so the last step reads
 * `postRevokeIsRevokedRule` off the recording instead of pattern-matching the
 * error string and guessing.
 */
function RevokeStep({
  state,
  title,
  detail,
  hash,
}: {
  state: 'permitted' | 'denied' | 'rule-revoked';
  title: string;
  detail: string;
  hash: string;
}) {
  return (
    <div className="on-ground flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:gap-5">
      <div className="shrink-0">
        <Verdict state={state} />
      </div>
      <div className="flex flex-1 flex-col gap-1.5">
        <p className="text-[14px] font-medium text-foreground">{title}</p>
        <p className="text-[13px] leading-relaxed text-muted">{detail}</p>
      </div>
      <div className="shrink-0 sm:pt-0.5">
        <ExplorerLink href={chainTxUrl(hash)} title={hash}>
          <span className="value">{truncateHash(hash)}</span>
        </ExplorerLink>
      </div>
    </div>
  );
}
