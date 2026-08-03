import Link from 'next/link';
import { PolicyDetail } from '@/components/app/PolicyDetail';
import { StatusLabels } from '@/components/StatusLabel';
import { parsePolicyId } from '@/lib/policy-id';

export const metadata = {
  title: 'Limen — policy',
  description:
    'One installed permission boundary: what it permits, what the network refused, and where each claim comes from.',
};

export default async function PolicyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ref = parsePolicyId(id);

  return (
    <main className="mx-auto flex w-full max-w-[74rem] flex-col gap-12 px-6 py-14 sm:px-10">
      <header className="flex flex-col gap-4">
        <span className="eyebrow-lead text-faint">the refusal screen</span>
        <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.015em] text-foreground">
          One boundary, and what it turned away
        </h1>
        <p className="max-w-[78ch] text-[14px] leading-relaxed text-muted">
          The permitted transaction next to the attempts adjacent to it, each with its transaction
          hash or with the absence of one stated in the row. Refusals here came from a policy
          contract executed by the network, not from this repository&rsquo;s evaluator.
        </p>
        <StatusLabels names={['TESTNET ONLY', 'NOT AUDITED', 'COMPOSITION ONLY']} />
      </header>

      {ref === null ? (
        <div className="flex flex-col gap-3 rounded-[4px] border border-deny-line bg-surface px-5 py-4">
          <span className="eyebrow text-deny">not a policy</span>
          <p className="max-w-[74ch] text-[13px] leading-relaxed text-foreground/90">
            A policy is addressed by its smart account and its context rule id, joined by a hyphen —{' '}
            <span className="value">C…-5</span>. There is no such thing as a globally unique rule id,
            so an id alone would show one account&rsquo;s boundary under another account&rsquo;s
            policy.
          </p>
          <Link
            href="/app/accounts"
            className="self-start rounded-[3px] text-[12.5px] text-muted underline decoration-border-bright underline-offset-4 transition-colors hover:text-foreground hover:decoration-accent focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          >
            All accounts
          </Link>
        </div>
      ) : (
        <PolicyDetail contractId={ref.contractId} ruleId={ref.ruleId} />
      )}
    </main>
  );
}
