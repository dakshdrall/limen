import { DocPage, DocSectionBlock, P } from '@/components/docs/DocPage';
import { AccountStructureDiagram, AuthorizationDiagram } from '@/components/docs/Diagrams';
import { ExplorerLink } from '@/components/ExplorerLink';
import { chainTxUrl } from '@/lib/explorer';
import { truncateAddress, truncateHash } from '@/lib/format';
import { RECORDED_REVOCATION, SHARED_CONTRACTS } from '@/lib/recorded-runs';

export const metadata = {
  title: 'Limen — the authorization path',
  description:
    'What runs inside __check_auth, in what order, and where a refusal actually comes from.',
};

const CONTENTS = [
  { id: 'path', title: 'What runs before a token moves' },
  { id: 'structure', title: 'The structure of an account' },
  { id: 'who', title: 'Who enforces this' },
  { id: 'revoke', title: 'Revoking, and who can' },
];

export default function AuthorizationPage() {
  const revocation = RECORDED_REVOCATION;

  return (
    <DocPage
      title="The authorization path"
      lead="A boundary is only worth what enforces it. Nothing in this path is Limen: the check runs in contract code on the ledger, and it runs whether or not this repository still exists."
      labels={['TESTNET ONLY', 'NOT AUDITED']}
      contents={CONTENTS}
    >
      <DocSectionBlock id="path" title="What runs before a token moves">
        <P>
          The agent signs an envelope with its own key and pays its own fee. No owner signature is
          anywhere near it. The network invokes <span className="value">__check_auth</span>{' '}on the
          smart account, and the account&rsquo;s own code decides.
        </P>
        <div className="on-ground p-5">
          <AuthorizationDiagram />
        </div>
        <P>
          If any attached policy refuses, the invocation traps. The transaction still reaches a
          ledger and still burns a fee — which is what makes a refusal checkable by anyone rather
          than a claim this application makes about itself.
        </P>
      </DocSectionBlock>

      <DocSectionBlock id="structure" title="The structure of an account">
        <P>
          The relationship between signers, context rules and policies is the thing most often read
          backwards. A policy is attached to a <em>rule</em>, not to a signer, and a signer&rsquo;s
          authority is exactly the union of the rules that name it.
        </P>
        <div className="on-ground p-5">
          <AccountStructureDiagram />
        </div>
      </DocSectionBlock>

      <DocSectionBlock id="who" title="Who enforces this">
        <P>
          Three deployed contracts, all of them OpenZeppelin code that Limen configures rather than
          writes. Their addresses are read from the deployments file.
        </P>
        <div className="scroll-x on-ground w-fit max-w-full">
          <table className="tbl tbl-fit">
            <colgroup>
              <col className="col-attempt" />
              <col className="col-addr" />
              <col className="col-hash" />
            </colgroup>
            <thead>
              <tr className="bg-surface-raised">
                <th scope="col" className="col-head">
                  Contract
                </th>
                <th scope="col" className="col-head">
                  Address
                </th>
                <th scope="col" className="col-head">
                  Deployed
                </th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ['ed25519 verifier', SHARED_CONTRACTS.ed25519Verifier],
                  ['WebAuthn verifier', SHARED_CONTRACTS.webauthnVerifier],
                  ['spending limit policy', SHARED_CONTRACTS.spendingLimitPolicy],
                ] as const
              ).map(([label, contract]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td>
                    <span className="value" title={contract.contract}>
                      {truncateAddress(contract.contract, 8, 6)}
                    </span>
                  </td>
                  <td>
                    <ExplorerLink href={chainTxUrl(contract.deployTx)} title={contract.deployTx}>
                      <span className="value">{truncateHash(contract.deployTx)}</span>
                    </ExplorerLink>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DocSectionBlock>

      <DocSectionBlock id="revoke" title="Revoking, and who can">
        <P>
          Removing a context rule requires the account to authorize itself. The agent&rsquo;s rule
          is a <span className="value">CallContract</span>{' '}rule scoped to a token contract, which
          does not match a call to the account — so the agent&rsquo;s attempt to remove its own
          boundary traps. The owner&rsquo;s <span className="value">Default</span>{' '}rule does match.
        </P>
        <P>
          This is a property of the contract, not of this application declining to draw a button.
          Both halves are on record:
        </P>
        <div className="scroll-x on-ground w-fit max-w-full">
          <table className="tbl tbl-fit">
            <colgroup>
              <col className="col-attempt" />
              <col className="col-error" />
              <col className="col-hash" />
            </colgroup>
            <thead>
              <tr className="bg-surface-raised">
                <th scope="col" className="col-head">
                  Attempt
                </th>
                <th scope="col" className="col-head">
                  Outcome
                </th>
                <th scope="col" className="col-head">
                  On ledger
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>the agent removing its own rule</td>
                <td>
                  <span className="value text-deny">{revocation.agentRevokeError}</span>
                </td>
                <td>
                  <ExplorerLink
                    href={chainTxUrl(revocation.agentRevokeTx)}
                    title={revocation.agentRevokeTx}
                  >
                    <span className="value">{truncateHash(revocation.agentRevokeTx)}</span>
                  </ExplorerLink>
                </td>
              </tr>
              <tr>
                <td>the owner removing it</td>
                <td>
                  <span className="value text-permit">
                    rules after: {revocation.rulesAfterRevoke.join(', ')}
                  </span>
                </td>
                <td>
                  <ExplorerLink href={chainTxUrl(revocation.revokeTx)} title={revocation.revokeTx}>
                    <span className="value">{truncateHash(revocation.revokeTx)}</span>
                  </ExplorerLink>
                </td>
              </tr>
              <tr>
                <td>the permitted call, repeated afterwards</td>
                <td>
                  <span className="value text-unproven">{revocation.postRevokeError}</span>
                </td>
                <td>
                  <ExplorerLink
                    href={chainTxUrl(revocation.postRevokeTx)}
                    title={revocation.postRevokeTx}
                  >
                    <span className="value">{truncateHash(revocation.postRevokeTx)}</span>
                  </ExplorerLink>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <P>
          The last row fails because the rule is gone, not because a limit was reached. Those are
          different claims, and only one of them is evidence the boundary worked — which is why{' '}
          <span className="value">ContextRuleNotFound#3000</span> is deliberately absent from{' '}
          <span className="value">BOUNDARY_REFUSAL_CODES</span>.
        </P>
        <p className="panel measure text-[12.5px] leading-relaxed text-muted-dim" data-tone="pending">
          <span className="eyebrow text-muted uppercase">Provenance</span>
          These three transactions are from {revocation.producedBy}, recorded {revocation.ranAt} on
          smart account{' '}
          <span className="value" title={revocation.smartAccount}>
            {truncateAddress(revocation.smartAccount)}
          </span>
          . {revocation.rulesAfterRevokeNote}
        </p>
      </DocSectionBlock>
    </DocPage>
  );
}
