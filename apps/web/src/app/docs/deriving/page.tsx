import { Code } from '@/components/Code';
import { DocPage, DocSectionBlock, P } from '@/components/docs/DocPage';
import { DerivationDiagram } from '@/components/docs/Diagrams';
import { ExplorerLink } from '@/components/ExplorerLink';
import { chainTxUrl } from '@/lib/explorer';
import { decimalise, ledgersToDuration, truncateHash } from '@/lib/format';
import { RECORDED_DERIVATION, RECORDED_RUN } from '@/lib/recorded-runs';

export const metadata = {
  title: 'Limen — deriving a boundary',
  description:
    'From one observed transaction to the narrowest context rule and policy set that permits it.',
};

const CONTENTS = [
  { id: 'pipeline', title: 'The pipeline' },
  { id: 'extract', title: 'extract: what is read' },
  { id: 'synthesize', title: 'synthesize: what is derived' },
  { id: 'refusals', title: 'When synthesis refuses' },
  { id: 'lower', title: 'lower: contract arguments' },
  { id: 'evidence', title: 'A derivation on record' },
];

export default function DerivingPage() {
  const derivation = RECORDED_DERIVATION;
  const run = RECORDED_RUN;

  return (
    <DocPage
      title="Deriving a boundary"
      lead="One observed transaction goes in. A context rule and a policy set come out, narrow enough that everything adjacent to the observed flow is refused."
      labels={['TESTNET ONLY', 'COMPOSITION ONLY']}
      contents={CONTENTS}
    >
      <DocSectionBlock id="pipeline" title="The pipeline">
        <P>
          Four functions, in order. Each is pure and independently tested; none of them touches the
          network except the read at the front and the write at the back.
        </P>
        <div className="on-ground p-5">
          <DerivationDiagram />
        </div>
      </DocSectionBlock>

      <DocSectionBlock id="extract" title="extract: what is read">
        <P>
          <span className="value">extract</span> turns a Soroban transaction into an{' '}
          <span className="value">ObservedTransaction</span>: the contracts it invoked, the function
          names, the arguments, and the token movements attributable to the account the policy will
          install on.
        </P>
        <P>
          The last part is the one that is easy to get wrong, and it was wrong once. The{' '}
          <span className="value">source</span>{' '}is the account the policy installs on — not the
          envelope&rsquo;s fee source. For a smart account moving its own funds those differ: the
          fee is paid by a classic account. <span className="value">synthesize</span>{' '}counts a
          movement toward the cap only when it comes from <span className="value">source</span>, so
          setting it to the fee source derived no cap at all and every boundary was refused at
          lowering. That defect was found by a browser and could not be reached by any Node test.
        </P>
        <Code>{`interface ObservedTransaction {
  hash: string;
  network: 'testnet' | 'mainnet' | 'simulated';
  ledger: number;
  source: Address;          // the account the policy installs on
  invocations: Invocation[];
  movements: TokenMovement[];
  attribution: 'exact' | 'transaction-level';
}`}</Code>
        <P>
          <span className="value">attribution</span>{' '}is carried rather than inferred. A
          single-invocation transaction attributes its movements exactly; a multi-invocation one can
          only attribute them at transaction level, and the UI says which it is holding rather than
          presenting both with the same confidence.
        </P>
      </DocSectionBlock>

      <DocSectionBlock id="synthesize" title="synthesize: what is derived">
        <P>
          <span className="value">synthesize</span>{' '}produces the narrowest proposal that permits the
          observation. Every dimension is taken from what happened:
        </P>
        <div className="scroll-x on-ground w-fit max-w-full">
          <table className="tbl tbl-fit">
            <colgroup>
              <col className="col-label" />
              <col className="col-attempt" />
              <col className="col-attempt" />
            </colgroup>
            <thead>
              <tr className="bg-surface-raised">
                <th scope="col" className="col-head">
                  Dimension
                </th>
                <th scope="col" className="col-head">
                  Derived from
                </th>
                <th scope="col" className="col-head">
                  Refuses
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="value">contract</td>
                <td>the contract ids actually invoked</td>
                <td>a call to any other contract</td>
              </tr>
              <tr>
                <td className="value">function</td>
                <td>the function names actually invoked</td>
                <td>any other function on the same contract</td>
              </tr>
              <tr>
                <td className="value">asset</td>
                <td>the token contract the movement was in</td>
                <td>a transfer of any other token</td>
              </tr>
              <tr>
                <td className="value">amount</td>
                <td>the outflow that actually occurred</td>
                <td>a transfer above it, within the window</td>
              </tr>
              <tr>
                <td className="value">window</td>
                <td>a ledger count chosen by the caller</td>
                <td>the same call after the window closes</td>
              </tr>
            </tbody>
          </table>
        </div>
        <P>
          The window is the one dimension not read off the transaction, because a transaction does
          not contain one. It is the single number a person supplies, and the interface offers a
          discrete set rather than a free field — the recorded run used{' '}
          <span className="value">{run.windowLedgers.toLocaleString('en-US')}</span> ledgers,{' '}
          {ledgersToDuration(run.windowLedgers)}.
        </P>
      </DocSectionBlock>

      <DocSectionBlock id="refusals" title="When synthesis refuses">
        <P>
          Synthesis fails rather than guessing. A transaction with no attributable outflow, or one
          whose movements cannot be tied to the installing account, produces a{' '}
          <span className="value">SynthesisError</span>{' '}and no proposal — because the alternative is
          a boundary derived from an assumption, which is the thing this whole approach exists to
          avoid.
        </P>
        <P>
          A refusal here is not a failure of the product. Deriving a permission from a transaction
          whose meaning is ambiguous would be.
        </P>
      </DocSectionBlock>

      <DocSectionBlock id="lower" title="lower: contract arguments">
        <P>
          <span className="value">lower</span>{' '}turns a proposal into the exact arguments the
          OpenZeppelin smart-account interface expects — a context rule naming the signer and the
          contract, and a spending-limit policy carrying the cap and window. It generates no Rust
          and compiles nothing. The policy contract is already deployed and audited; lowering
          configures it.
        </P>
        <P>
          This is where a proposal that cannot be represented on chain is rejected, before anything
          is signed. A cap of zero, a window of zero ledgers, or a proposal naming no contract all
          fail here rather than at the network.
        </P>
      </DocSectionBlock>

      <DocSectionBlock id="evidence" title="A derivation on record">
        <P>
          The following boundary was derived from a transaction observed on live testnet. Both
          numbers are read from the recording.
        </P>
        <dl className="on-ground grid grid-cols-1 gap-x-8 gap-y-4 p-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <dt className="col-head">Observed transaction</dt>
            <dd className="text-[12.5px]">
              <ExplorerLink href={chainTxUrl(derivation.hash)} title={derivation.hash}>
                <span className="value">{truncateHash(derivation.hash)}</span>
              </ExplorerLink>
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="col-head">Function</dt>
            <dd className="value text-[12.5px]">{derivation.function}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="col-head">Outflow observed</dt>
            <dd className="value text-[12.5px]">{decimalise(derivation.observedAmount)}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="col-head">Cap derived</dt>
            <dd className="value text-[12.5px] text-permit">
              {decimalise(derivation.derivedCap)}
            </dd>
          </div>
        </dl>
        <p className="panel measure text-[12.5px] leading-relaxed text-muted-dim" data-tone="pending">
          <span className="eyebrow text-muted uppercase">How this was produced</span>
          {derivation.producedBy}. {derivation.installedSeparately}
        </p>
      </DocSectionBlock>
    </DocPage>
  );
}
