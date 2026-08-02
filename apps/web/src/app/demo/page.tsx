import Link from 'next/link';
import { connection } from 'next/server';
import { DemoStepper } from '@/components/demo/DemoStepper';
import { demoSignerStatus, type DemoUnavailableReason } from '@/lib/demo-signer';

export const metadata = {
  title: 'Limen — guided demo',
  description:
    'Perform a real testnet transaction, derive a permission boundary from it, and watch the boundary refuse everything adjacent.',
};

/**
 * Whether beat 1 can run is decided on the server, so nothing about the demo
 * account — not its key, not its address, not the RPC endpoint — reaches the
 * browser. Only the boolean and a reason string cross.
 */
const REASONS: Record<DemoUnavailableReason, string> = {
  no_secret: 'This deployment has no demo account configured.',
  no_destination: 'This deployment has no demo destination account configured.',
  no_rpc: 'This deployment has no Soroban RPC endpoint configured.',
};

export default async function DemoPage() {
  // Whether the demo account is configured is a property of the running
  // deployment, not of the build. Without this the answer would be frozen into
  // the prerendered HTML, and adding the account later would not turn beat 1 on.
  await connection();
  const status = demoSignerStatus();

  return (
    <main className="mx-auto flex w-full max-w-[68rem] flex-col gap-12 px-6 py-16 sm:px-10">
      <header className="flex flex-col gap-4">
        <span className="eyebrow-lead text-faint">the walkthrough</span>
        <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.015em] text-foreground">
          Five steps, start to finish
        </h1>
        <p className="max-w-[76ch] text-[14px] leading-relaxed text-muted">
          Perform a transaction, derive the boundary that permits exactly it, and watch that boundary
          refuse everything adjacent. No wallet, no funded account, no credentials. Each step states
          plainly whether what happened was on-chain or computed in your browser.
        </p>
        <Link
          href="/"
          className="self-start rounded-[3px] text-[13px] text-muted underline decoration-border-bright underline-offset-4 transition-colors hover:text-foreground hover:decoration-accent focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
        >
          Back to the overview
        </Link>
      </header>

      <DemoStepper
        signerAvailable={status.available}
        signerReason={status.available ? null : REASONS[status.reason]}
      />

      <footer className="max-w-[80ch] border-t border-border-subtle pt-6 text-[12.5px] leading-relaxed text-muted-dim">
        The demo account is disposable and holds trivial funds; it is rate-limited and its
        compromise is uninteresting by design. Steps 3 through 5 run entirely in your browser using
        the same <span className="value">@limen/core</span> package the test suite runs — the page
        executes exactly the code CI gates on.
      </footer>
    </main>
  );
}
