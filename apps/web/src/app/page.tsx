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
  RECORDED_DERIVATION,
  RECORDED_REVOCATION,
  RECORDED_RUN,
  RECORDED_SURVEY,
  SHARED_CONTRACTS,
} from '@/lib/recorded-runs';

/**
 * The argument, in six scenes.
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

  return (
    <main>
      {/* ---------------------------------------------------------------- hero */}
      <section className="scene" aria-labelledby="hero-title">
        <Reveal className="flex flex-col gap-6 measure-scene">
          <StatusLabels names={['TESTNET ONLY', 'NOT AUDITED', 'COMPOSITION ONLY', 'NO CUSTODY']} />
          <h1 id="hero-title" className="scene-h1 text-foreground">
            The boundary is derived, not authored.
          </h1>
          <p className="scene-lead">
            Every other way to give an agent spending authority asks you to describe the limit —
            set a cap, pick the contracts, choose a window, and get it right first time, in the
            abstract, about money. Limen asks you to do the thing once. The boundary is inferred
            from a transaction that already happened, and it permits exactly that and nothing
            adjacent to it.
          </p>
          <p className="text-[15px] leading-relaxed text-muted">
            You already told us what you meant by doing it.
          </p>
        </Reveal>

        <SceneBlock index={1} className="flex flex-wrap items-center gap-3">
          <Link href="/app/simulator" className="btn" data-variant="primary" data-register="scene">
            See it derive one
          </Link>
          <Link href="/docs" className="btn" data-variant="secondary" data-register="scene">
            Read the docs
          </Link>
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
        eyebrow="Where we are"
        title="Today there are two options, and both of them are bad."
        lead="Give the agent a key and hope. Or approve every transaction yourself, and not have an agent."
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
            There is nothing between them. That gap is the entire problem, and it is why most
            agentic money today is either a demo on testnet or a key in an environment variable.
          </p>
        </SceneBlock>
      </Scene>

      {/* ------------------------------------------------------------- scene 2 */}
      <Scene
        id="configure"
        index="02"
        eyebrow="The middle ground"
        title="The middle ground exists. Reaching it means writing a contract."
        lead="Soroban smart accounts can hold a policy that constrains what a signer may do. The mechanism is real, audited and deployed. Almost nobody has one."
      >
        <SceneBlock index={1}>
          <p className="text-[15px] leading-relaxed text-muted measure-scene">
            Getting there means writing Rust, auditing it, and deploying it — per agent, per
            counterparty, per change of mind. So the products that offer a middle ground offer it
            as a form: describe the limit up front, in the abstract, before you have done the thing
            you are describing. Pick a cap. Choose the contracts. Set a window.
          </p>
        </SceneBlock>

        <SceneBlock index={2}>
          <p className="text-[15px] leading-relaxed text-muted measure-scene">
            That is a reasonable thing to build and an unreasonable thing to ask. You are being
            asked to write down, correctly and in advance, a description of an action you were
            about to take anyway — and to be right about it the first time, about money. The
            description is the part that goes wrong, and the action was sitting right there.
          </p>
        </SceneBlock>
      </Scene>

      {/* ------------------------------------------------------------- scene 3 */}
      <Scene
        id="derive"
        index="03"
        eyebrow="The turn"
        from="left"
        title="So don't describe it. Do it once, and let the boundary be read off what happened."
        lead="Perform the flow. Limen observes the transaction and derives the narrowest rule that permits it: the contracts it touched, the functions it invoked, the outflow that actually occurred, and a window."
      >
        <SceneBlock index={1}>
          <p className="text-[15px] leading-relaxed text-muted measure-scene">
            Nothing wider. The derived cap is the outflow that happened, not a round number near
            it — and that equality is the claim, not a coincidence. Below is a boundary derived
            from a transaction observed on live testnet, with both numbers as the recording holds
            them.
          </p>
        </SceneBlock>

        <SceneBlock index={2}>
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

        <SceneBlock index={3}>
          {/* The seam. This transaction was observed and derived from; the
              recorded install was built by the script from the same parameters.
              The recording says so and so does the page. */}
          <p className="panel measure text-[12.5px] leading-relaxed text-muted-dim" data-tone="pending">
            <span className="eyebrow text-muted uppercase">How this was produced</span>
            {derivation.producedBy}. {derivation.installedSeparately}
          </p>
        </SceneBlock>
      </Scene>

      {/* ------------------------------------------------------------- scene 4 */}
      <Scene
        id="enforced"
        index="04"
        eyebrow="Enforcement"
        title="Installed on the account, and enforced by the network."
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

        <SceneBlock index={2}>
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

      {/* ------------------------------------------------------------- scene 5 */}
      <Scene
        id="refuses"
        index="05"
        eyebrow="The proof"
        title="What it refuses."
        lead="A boundary that permits the thing it was derived from proves nothing — the permitted flow is the one flow it was built to allow. What matters is what happens one step to the side."
      >
        <SceneBlock index={1}>
          <p className="text-[15px] leading-relaxed text-muted measure-scene">
            Six ways to be adjacent to the permitted flow. Each changes exactly one dimension:
            the amount, the function, the asset, the contract, the number of invocations, the
            ledger it arrives on. Every one was attempted against a real rule on a real account,
            and every one was refused on a ledger.
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

      {/* ------------------------------------------------------------- scene 6 */}
      <Scene
        id="revoke"
        index="06"
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
            — a different account from the one in scenes 04 and 05. Two accounts&rsquo; hashes in one
            column read as one account&rsquo;s unless the page says otherwise.
          </p>
        </SceneBlock>
      </Scene>

      {/* ---------------------------------------------------------- what's next */}
      <Scene
        id="build"
        index="07"
        eyebrow="What you get back"
        title="An agent that can act, inside a boundary you did not have to describe."
      >
        <SceneBlock index={1} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="panel">
            <p className="eyebrow text-muted uppercase">Derive</p>
            <p className="text-[14px] leading-relaxed text-foreground/90">
              Point Limen at a transaction the account already made. Get back the narrowest rule
              that permits it.
            </p>
          </div>
          <div className="panel">
            <p className="eyebrow text-muted uppercase">Install</p>
            <p className="text-[14px] leading-relaxed text-foreground/90">
              One signed call puts the rule on the account. The agent&rsquo;s key becomes a signer
              that can only act inside it.
            </p>
          </div>
          <div className="panel">
            <p className="eyebrow text-muted uppercase">Revoke</p>
            <p className="text-[14px] leading-relaxed text-foreground/90">
              One signed call takes it away, and only yours works. The agent&rsquo;s does not.
            </p>
          </div>
        </SceneBlock>

        <SceneBlock index={2} className="flex flex-col gap-4">
          <h3 className="scene-h3 text-foreground">What this is not, stated plainly</h3>
          <ul className="flex flex-col gap-2.5 text-[14px] leading-relaxed text-muted measure-scene">
            <li>
              <span className="value text-foreground">Testnet only.</span> Every address and hash on
              this site is Stellar testnet. No real funds are involved anywhere.
            </li>
            <li>
              <span className="value text-foreground">Not audited.</span> The OpenZeppelin contracts
              Limen installs are audited. The code that decides what to install is not, and no third
              party has reviewed it.
            </li>
            <li>
              <span className="value text-foreground">Composition only.</span> Every policy is a
              configuration of an existing primitive. {EVIDENCE.chain.rustSourceFiles} lines of Rust
              are generated, which is the claim as a number rather than as a promise.
            </li>
            <li>
              <span className="value text-foreground">No custody.</span> No key of yours reaches a
              Limen server, an environment variable, or a log line. Any key that can move funds here
              was generated in your browser and stays in it.
            </li>
            <li>
              <span className="value text-foreground">Single-transaction derivation.</span> A
              boundary is derived from one observed transaction. Deriving from a set of them, and
              arguing about what their union should permit, is not built.
            </li>
          </ul>
        </SceneBlock>
      </Scene>

      {/* -------------------------------------------------------------- waitlist */}
      <Scene
        id="waitlist"
        index="08"
        eyebrow="If this is your problem"
        title="Tell us what you're building."
        lead="Limen is in development and changing weekly. If you are giving an agent spending authority and the two bad options are your two bad options, we would like to hear from you."
      >
        <SceneBlock index={1}>
          <WaitlistForm />
        </SceneBlock>
      </Scene>

      <footer className="scene border-t border-border-subtle">
        <div className="flex flex-col gap-4">
          <StatusLabels names={['OPEN SOURCE', 'MIT', 'IN DEVELOPMENT', 'TESTNET ONLY']} />
          <p className="text-[12.5px] leading-relaxed text-muted-dim measure">
            Every figure on this site is read from{' '}
            <span className="value">deployments/testnet.json</span> or from a generated evidence
            file, and a check fails the build when either drifts. Nothing on this page is typed by
            hand.
          </p>
          <nav className="flex flex-wrap gap-4 text-[13px]" aria-label="Footer">
            <Link href="/docs" className="link">
              Documentation
            </Link>
            <Link href="/app/simulator" className="link">
              Simulator
            </Link>
            <Link href="/app/accounts" className="link">
              Accounts
            </Link>
          </nav>
        </div>
      </footer>
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
