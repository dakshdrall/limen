import Link from 'next/link';
import { DocPage, DocSectionBlock, P } from '@/components/docs/DocPage';
import { ExplorerLink } from '@/components/ExplorerLink';
import { DOCS_NAV } from '@/lib/docs-nav';
import { EVIDENCE } from '@/lib/evidence';
import { chainTxUrl } from '@/lib/explorer';
import { decimalise, truncateAddress, truncateHash } from '@/lib/format';
import { RECORDED_RUN, SHARED_CONTRACTS } from '@/lib/recorded-runs';

export const metadata = {
  title: 'Limen — documentation',
  description:
    'How Limen derives a permission boundary from an observed transaction, what enforces it, and what it refuses.',
};

const CONTENTS = [
  { id: 'what', title: 'What Limen does' },
  { id: 'not', title: 'What it is not' },
  { id: 'worked', title: 'The recorded run' },
  { id: 'pages', title: 'The rest of these docs' },
];

export default function DocsOverview() {
  const run = RECORDED_RUN;

  return (
    <DocPage
      title="Documentation"
      lead="Limen builds agents that can spend on Stellar, and gives each one a boundary the account enforces rather than the agent observes. This is how it works and what it refuses to claim."
      labels={['TESTNET ONLY', 'NOT AUDITED', 'COMPOSITION ONLY', 'NO OWNER CUSTODY']}
      contents={CONTENTS}
    >
      <DocSectionBlock id="what" title="What Limen does">
        <P>
          You describe an agent in a sentence. Limen drafts it — the job, the token, a ceiling per
          period, an expiry — and shows you those limits before anything is signed. When you
          approve them it deploys the agent onto Stellar in one flow: a Soroban smart account of
          its own, a signing key registered against that account, and the boundary installed on
          that key. Then you message the agent, and it acts on your behalf.
        </P>
        <P>
          The boundary is the part worth reading twice. It is a context rule and a policy contract
          on the account, checked by the account before a token moves — so what the agent may do is
          not a rule it has been asked to follow. It is a rule it is unable to exceed, and it stays
          enforced whether or not Limen is running.
        </P>
        <P>
          Where a boundary comes from is the other half. Limen would rather read one off a
          transaction that already happened than ask you to describe one in the abstract: given an
          observed transfer, it derives the minimum context rule and policy set that would have
          permitted it — the contracts it touched, the functions it invoked, the outflow that
          occurred, and a window. The derived cap equals the observed outflow exactly. That
          equality is the design, not a coincidence — a boundary rounded up to a comfortable number
          is a boundary somebody chose, and choosing is the step this removes.
        </P>
      </DocSectionBlock>

      <DocSectionBlock id="not" title="What it is not">
        <P>
          These limits are stated here rather than discovered later, and they are the same four
          labels that appear above every screen.
        </P>
        <ul className="measure flex flex-col gap-3 text-[13.5px] leading-relaxed text-muted">
          <li>
            <span className="value text-foreground">Testnet only.</span>{' '}Every address, hash and
            reading in this documentation is Stellar testnet. There is no mainnet build.
          </li>
          <li>
            <span className="value text-foreground">Not audited.</span>{' '}The OpenZeppelin contracts
            Limen installs are audited. The code that decides <em>what</em>{' '}to install — the
            synthesizer, the lowering, this application — is not, and no third party has reviewed
            it.
          </li>
          <li>
            <span className="value text-foreground">Composition only.</span>{' '}Every policy is a
            configuration of an existing audited primitive.{' '}
            {EVIDENCE.chain.rustSourceFiles === 0
              ? 'No Rust is generated and none is written by hand'
              : `${EVIDENCE.chain.rustSourceFiles} Rust source files are generated`}
            , which is the claim as a number rather than as a promise.
          </li>
          <li>
            <span className="value text-foreground">No owner custody.</span>{' '}The key that owns
            your account — a passkey, or a key generated in your browser — never reaches a Limen
            server, an environment variable, or a log line. Limen cannot move your funds outside the
            boundary you installed, and cannot remove that boundary.
          </li>
          <li>
            <span className="value text-foreground">One transaction in.</span>{' '}A boundary is derived
            from a single observed transaction. Deriving from a set of them, and deciding what their
            union should permit, is not built.
          </li>
        </ul>
      </DocSectionBlock>

      <DocSectionBlock id="worked" title="The recorded run">
        <P>
          Everything in these pages is described against one run recorded on testnet. Its addresses
          and hashes are read from <span className="value">deployments/testnet.json</span>, so they
          cannot drift from what was actually executed.
        </P>
        <dl className="on-ground grid grid-cols-1 gap-x-8 gap-y-4 p-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <dt className="col-head">Smart account</dt>
            <dd className="value text-[12.5px]" title={run.smartAccount}>
              {truncateAddress(run.smartAccount, 8, 6)}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="col-head">Context rule</dt>
            <dd className="value text-[12.5px]">#{run.contextRuleId}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="col-head">Policy contract</dt>
            <dd
              className="value text-[12.5px]"
              title={SHARED_CONTRACTS.spendingLimitPolicy.contract}
            >
              {truncateAddress(SHARED_CONTRACTS.spendingLimitPolicy.contract, 8, 6)}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="col-head">Cap</dt>
            <dd className="value text-[12.5px]">{decimalise(run.cap)}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="col-head">Install</dt>
            <dd className="text-[12.5px]">
              <ExplorerLink href={chainTxUrl(run.installTx)} title={run.installTx}>
                <span className="value">{truncateHash(run.installTx)}</span>
              </ExplorerLink>
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="col-head">Refused</dt>
            <dd className="text-[12.5px]">
              <ExplorerLink href={chainTxUrl(run.rejectedTx)} title={run.rejectedTx}>
                <span className="value">{truncateHash(run.rejectedTx)}</span>
              </ExplorerLink>{' '}
              <span className="value text-deny">{run.rejectedError}</span>
            </dd>
          </div>
        </dl>
      </DocSectionBlock>

      <DocSectionBlock id="pages" title="The rest of these docs">
        <ul className="flex flex-col gap-3">
          {DOCS_NAV.flatMap((group) => group.entries)
            .filter((entry) => entry.href !== '/docs')
            .map((entry) => (
              <li key={entry.href} className="flex flex-col gap-1">
                <Link href={entry.href} className="link text-[13.5px]" data-tone="strong">
                  {entry.label}
                </Link>
                <span className="measure text-[13px] leading-relaxed text-muted-dim">
                  {entry.blurb}
                </span>
              </li>
            ))}
        </ul>
      </DocSectionBlock>
    </DocPage>
  );
}
