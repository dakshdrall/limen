import Link from 'next/link';
import { connection } from 'next/server';
import { SimulatorStepper, type Preset } from '@/components/simulator/SimulatorStepper';
import { StatusLabels } from '@/components/StatusLabel';
import { FIXTURES, REFUSING_FIXTURES } from '@/fixtures';
import { demoSignerStatus, type DemoUnavailableReason } from '@/lib/demo-signer';

export const metadata = {
  title: 'Limen — simulator',
  description:
    'Derive a permission boundary from a transaction, watch it refuse everything adjacent, and find out whether an OpenZeppelin smart account could actually hold it.',
};

/**
 * Whether step 1 can submit is decided on the server, so nothing about the demo
 * account — not its key, not its address, not the RPC endpoint — reaches the
 * browser. Only the boolean and a reason string cross.
 */
const REASONS: Record<DemoUnavailableReason, string> = {
  no_secret: 'This deployment has no demo account configured.',
  no_destination: 'This deployment has no demo destination account configured.',
  no_rpc: 'This deployment has no Soroban RPC endpoint configured.',
};

/**
 * The shipped flows, with their hashes.
 *
 * The hash rather than the short key is what the stepper needs: it is what goes
 * into resumable state, and recognising one after a reload is what stops a
 * fixture from being rendered with an explorer link. Sent from the server
 * because `FIXTURES` is where they are defined, and a second list in the client
 * would be a second thing to keep in step.
 */
function presets(): Preset[] {
  return Object.entries(FIXTURES).map(([key, tx]) => ({
    key,
    hash: tx.hash,
    refuses: REFUSING_FIXTURES.has(key),
  }));
}

export default async function SimulatorPage() {
  // Read at request time, not at build time: whether the demo account is
  // configured is a property of the running deployment. Baking it into
  // prerendered HTML would freeze the answer, and adding the account later
  // would not turn step 1 on.
  await connection();
  const status = demoSignerStatus();

  return (
    <main className="mx-auto flex w-full max-w-[68rem] flex-col gap-12 px-6 py-14 sm:px-10">
      <header className="flex flex-col gap-4">
        <span className="eyebrow-lead text-faint">simulator</span>
        <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.015em] text-foreground">
          Derivation, without a chain to write to
        </h1>
        <p className="max-w-[76ch] text-[14px] leading-relaxed text-muted">
          Take a transaction, derive the boundary that permits exactly it, and watch that boundary
          refuse everything adjacent. Every refusal here is adjudicated by this repository&rsquo;s
          own evaluator. Nothing on this screen installs anything, and no boundary drawn here has
          been enforced by a network.
        </p>
        <StatusLabels names={['COMPUTED LOCALLY', 'TESTNET ONLY']} />
      </header>

      {/*
        The demotion, said rather than implied.

        This page was the product's front door; it is now one instrument among
        several, and a reviewer who lands on it deserves to know which of the
        two derivation screens they are on. The difference is not
        presentational: `/app/policies/new` derives the same boundary and then
        asks a deployed OpenZeppelin account to hold it, which is a question
        this screen can ask (step 6) but never answer with a ledger.
      */}
      <aside className="flex flex-col gap-2 rounded-[4px] border border-border-subtle bg-surface px-5 py-4">
        <h2 className="col-head text-muted">what this screen is for</h2>
        <p className="max-w-[80ch] text-[13px] leading-relaxed text-muted">
          This is the reasoning engine with the chain taken away — useful for seeing what Limen
          derives, and the only place flows live that no audited primitive can constrain. Those
          flows are marked as such at step 6 rather than quietly omitted.{' '}
          <Link
            href="/app/policies/new"
            className="rounded-[2px] text-foreground underline decoration-border-bright underline-offset-4 transition-colors hover:decoration-accent focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          >
            New policy
          </Link>{' '}
          is the same derivation against a real smart account, where refusal is the network&rsquo;s
          answer and not this repository&rsquo;s.
        </p>
      </aside>

      <SimulatorStepper
        signerAvailable={status.available}
        signerReason={status.available ? null : REASONS[status.reason]}
        presets={presets()}
      />

      <footer className="max-w-[80ch] border-t border-border-subtle pt-6 text-[12.5px] leading-relaxed text-muted-dim">
        The demo account is disposable and holds trivial funds; it is rate-limited and its
        compromise is uninteresting by design. Steps 3 through 6 run entirely in your browser using
        the same <span className="value">@limen/core</span> and{' '}
        <span className="value">@limen/chain</span> packages the test suite runs — the page executes
        exactly the code CI gates on.
      </footer>
    </main>
  );
}
