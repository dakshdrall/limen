import Link from 'next/link';
import { PolicyDetail } from '@/components/app/PolicyDetail';
import { ScreenHeader } from '@/components/app/ScreenHeader';
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
    <main className="screen">
      <ScreenHeader
        eyebrow="the refusal screen"
        title="One boundary, and what it turned away"
        lede={
          <>
            The permitted transaction next to the attempts adjacent to it, each with its transaction
            hash or with the absence of one stated in the row. Refusals here came from a policy
            contract executed by the network, not from this repository&rsquo;s evaluator.
          </>
        }
        labels={['TESTNET ONLY', 'NOT AUDITED', 'COMPOSITION ONLY']}
      />

      {ref === null ? (
        <div className="panel" data-tone="refused">
          <span className="eyebrow text-deny">not a policy</span>
          <p className="measure text-[13px] leading-relaxed text-foreground/90">
            A policy is addressed by its smart account and its context rule id, joined by a hyphen —{' '}
            <span className="value">C…-5</span>. There is no such thing as a globally unique rule
            id, so an id alone would show one account&rsquo;s boundary under another
            account&rsquo;s policy.
          </p>
          <Link href="/app/accounts" className="link self-start text-[12.5px]">
            All accounts
          </Link>
        </div>
      ) : (
        <PolicyDetail contractId={ref.contractId} ruleId={ref.ruleId} />
      )}
    </main>
  );
}
