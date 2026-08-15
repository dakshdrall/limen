import {
  BOUNDARY_REFUSAL_CODES,
  CONTRACT_ERRORS,
  REVOKED_RULE_CODES,
  SMART_ACCOUNT_ERRORS,
} from '@limen/chain';
import { DocPage, DocSectionBlock, P } from '@/components/docs/DocPage';
import { ExplorerLink } from '@/components/ExplorerLink';
import { Verdict } from '@/components/Verdict';
import { chainTxUrl } from '@/lib/explorer';
import { truncateHash } from '@/lib/format';
import { RECORDED_SURVEY } from '@/lib/recorded-runs';

export const metadata = {
  title: 'Limen — reference',
  description:
    'Contract error codes, policy primitives, the six deny axes, and environment variables.',
};

const CONTENTS = [
  { id: 'errors', title: 'Contract error codes' },
  { id: 'primitives', title: 'Policy primitives' },
  { id: 'axes', title: 'The six deny axes' },
  { id: 'env', title: 'Environment variables' },
];

/**
 * The environment this application reads.
 *
 * Typed here rather than scanned out of the source, because the *meaning* of a
 * variable is not recoverable from `process.env.X` — and a table of names with
 * no explanation is a table nobody can act on. What is guaranteed by test
 * instead is that this list has no entry the code does not read and misses none
 * that it does; see `docs.test.ts`.
 */
const ENVIRONMENT = [
  {
    name: 'NEXT_PUBLIC_STELLAR_RPC_URL',
    scope: 'browser',
    required: false,
    note: 'Soroban RPC endpoint for reads. Falls back to the public testnet endpoint.',
  },
  {
    name: 'SOROBAN_RPC_URL',
    scope: 'server',
    required: false,
    note: 'Server-side RPC endpoint, used by the routes that keep the SDK out of the browser bundle.',
  },
  {
    name: 'NEXT_PUBLIC_SMART_ACCOUNT_ID',
    scope: 'browser',
    required: false,
    note: 'The account the app screens open on when no other is chosen.',
  },
  {
    name: 'NEXT_PUBLIC_SITE_URL',
    scope: 'browser',
    required: false,
    note: 'Absolute origin for share-card URLs. Vercel supplies one automatically in production.',
  },
  {
    name: 'VERCEL_PROJECT_PRODUCTION_URL',
    scope: 'platform',
    required: false,
    note: 'Supplied by Vercel, not set by hand. Used as the share-card origin when NEXT_PUBLIC_SITE_URL is absent.',
  },
  {
    name: 'ANTHROPIC_API_KEY',
    scope: 'server',
    required: false,
    note: 'Enables the explain endpoint. Absent, that route declines rather than degrading silently.',
  },
  {
    name: 'LIMEN_DEMO_SECRET',
    scope: 'server',
    required: false,
    note: 'A disposable testnet key used only by the scripted demo transfer. Never a user key.',
  },
  {
    name: 'LIMEN_DEMO_DESTINATION',
    scope: 'server',
    required: false,
    note: 'Where the scripted demo transfer sends its testnet dust.',
  },
  {
    name: 'LIMEN_SIMULATION_SOURCE',
    scope: 'server',
    required: false,
    note: 'Source account used for read-only simulation, which costs no fee and needs no signature.',
  },
  {
    name: 'WAITLIST_STORE_PATH',
    scope: 'server',
    required: false,
    note: 'Where waitlist entries are written. Defaults to a file in the system temp directory.',
  },
  {
    name: 'LIMEN_ERROR_WEBHOOK',
    scope: 'server',
    required: false,
    note: 'Where error reports are delivered. Server-side only, because a webhook URL is a credential. Unset, a report is logged and not sent.',
  },
  {
    name: 'NEXT_PUBLIC_LIMEN_RELEASE',
    scope: 'browser',
    required: false,
    note: 'The short commit SHA an error report names as its build. Derived from the platform at build time, not set by hand.',
  },
] as const;

const PRIMITIVES = [
  {
    kind: 'spending_limit',
    configures: 'asset, limit, windowLedgers',
    refuses: 'an outflow above the cap within the window',
    source: 'OpenZeppelin spending-limit policy',
  },
  {
    kind: 'function_allowlist',
    configures: 'contractId, functions',
    refuses: 'any function on that contract outside the list',
    source: 'context rule scoping',
  },
] as const;

export default function ReferencePage() {
  // Sorted numerically so the table reads as a range rather than as whatever
  // order the object literal happened to be written in.
  const errors = Object.entries(CONTRACT_ERRORS)
    .map(([code, name]) => ({ code: Number(code), name }))
    .sort((a, b) => a.code - b.code);

  return (
    <DocPage
      title="Reference"
      lead="The tables you come back for. Every error code here is read from @limen/chain, and every hash from the deployments file — none of it is transcribed into this page."
      labels={['TESTNET ONLY', 'COMPOSITION ONLY']}
      contents={CONTENTS}
    >
      <DocSectionBlock id="errors" title="Contract error codes">
        <P>
          Decoded from a failed transaction&rsquo;s own diagnostic events. The{' '}
          <span className="value">boundary</span>{' '}column is the distinction the whole product turns
          on: a boundary refusal is evidence the rule did its job, whereas a missing rule or a
          malformed call is not. <span className="value">ContextRuleNotFound</span>{' '}is deliberately
          excluded — &ldquo;the boundary refused you&rdquo; and &ldquo;the boundary is gone&rdquo;
          are different claims.
        </P>
        <div className="scroll-x on-ground w-fit max-w-full">
          <table className="tbl tbl-fit">
            {/* Three columns, not four. The contract each code comes from was
                its own column until it turned out the four together overflow
                the documentation's content measure — and a table that scrolls
                sideways to reveal a two-word label is a table that has spent a
                reader's attention badly. It sits under the name instead, which
                is the treatment the primitives table below already uses. */}
            <colgroup>
              <col className="col-ledger" />
              <col className="col-error" />
              <col className="col-label" />
            </colgroup>
            <thead>
              <tr className="bg-surface-raised">
                <th scope="col" className="col-head">
                  Code
                </th>
                <th scope="col" className="col-head">
                  Name
                </th>
                <th scope="col" className="col-head">
                  Boundary
                </th>
              </tr>
            </thead>
            <tbody>
              {errors.map(({ code, name }) => (
                <tr key={code}>
                  <td className="num">{code}</td>
                  <td>
                    <span className="value">{name}</span>
                    <div className="mt-0.5 text-[11px] text-muted-dim">
                      {code in SMART_ACCOUNT_ERRORS ? 'smart account' : 'spending limit'}
                    </div>
                  </td>
                  <td>
                    {BOUNDARY_REFUSAL_CODES.has(code) ? (
                      <span className="value text-deny">refusal</span>
                    ) : REVOKED_RULE_CODES.has(code) ? (
                      <span className="value text-unproven">no rule</span>
                    ) : (
                      <span className="value text-faint">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DocSectionBlock>

      <DocSectionBlock id="primitives" title="Policy primitives">
        <P>
          The closed set of things a derived boundary can be lowered into. Both are configurations
          of existing audited code — adding a third means deploying a third audited primitive, not
          generating one.
        </P>
        <div className="scroll-x on-ground w-fit max-w-full">
          <table className="tbl tbl-fit">
            <colgroup>
              <col className="col-signer" />
              <col className="col-attempt" />
              <col className="col-attempt" />
            </colgroup>
            <thead>
              <tr className="bg-surface-raised">
                <th scope="col" className="col-head">
                  Kind
                </th>
                <th scope="col" className="col-head">
                  Configures
                </th>
                <th scope="col" className="col-head">
                  Refuses
                </th>
              </tr>
            </thead>
            <tbody>
              {PRIMITIVES.map((primitive) => (
                <tr key={primitive.kind}>
                  <td>
                    <span className="value">{primitive.kind}</span>
                    <div className="mt-1 text-[11.5px] text-muted-dim">{primitive.source}</div>
                  </td>
                  <td>
                    <span className="value text-muted">{primitive.configures}</span>
                  </td>
                  <td className="text-muted-dim">{primitive.refuses}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DocSectionBlock>

      <DocSectionBlock id="axes" title="The six deny axes">
        <P>
          Each axis changes exactly one dimension of the permitted flow. These are the attempts made
          against a real rule on a real account; every one reached a ledger and failed there.
        </P>
        <div className="scroll-x on-ground w-fit max-w-full">
          <table className="tbl tbl-fit">
            <colgroup>
              <col className="col-verdict" />
              <col className="col-axis" />
              <col className="col-attempt" />
              <col className="col-error" />
              <col className="col-hash" />
            </colgroup>
            <thead>
              <tr className="bg-surface-raised">
                <th scope="col" className="col-head">
                  Verdict
                </th>
                <th scope="col" className="col-head">
                  Axis
                </th>
                <th scope="col" className="col-head">
                  Attempt
                </th>
                <th scope="col" className="col-head">
                  Simulated / on ledger
                </th>
                <th scope="col" className="col-head">
                  Hash
                </th>
              </tr>
            </thead>
            <tbody>
              {RECORDED_SURVEY.axes.map((axis) => (
                <tr key={axis.axis}>
                  <td>
                    <Verdict state="denied" />
                  </td>
                  <td>
                    <span className="value text-muted-dim">{axis.axis}</span>
                  </td>
                  <td>{axis.attempt}</td>
                  <td>
                    <div className="value text-muted">{axis.sim}</div>
                    <div className="value mt-1 text-muted-dim">{axis.ledger}</div>
                  </td>
                  <td>
                    {axis.hash === undefined ? (
                      <span className="value text-faint">—</span>
                    ) : (
                      <ExplorerLink href={chainTxUrl(axis.hash)} title={axis.hash}>
                        <span className="value">{truncateHash(axis.hash)}</span>
                      </ExplorerLink>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <P>
          Both columns are shown because they are different claims. The simulation error is what the
          RPC predicted; the ledger error is what the network actually returned, decoded from
          diagnostic events. They agree on five of six — the sixth reached a ledger and failed
          there, but its contract code was not recovered from that run&rsquo;s diagnostics, and the
          recording says so rather than filling it in.
        </P>
      </DocSectionBlock>

      <DocSectionBlock id="env" title="Environment variables">
        <P>
          None of these is required to read the site or the documentation. Every one has a fallback
          or a route that declines cleanly in its absence — a missing variable never degrades into a
          screen that silently shows something wrong.
        </P>
        <div className="scroll-x on-ground w-fit max-w-full">
          <table className="tbl tbl-fit">
            <colgroup>
              <col className="col-signer" />
              <col className="col-label" />
              <col className="col-attempt" />
            </colgroup>
            <thead>
              <tr className="bg-surface-raised">
                <th scope="col" className="col-head">
                  Variable
                </th>
                <th scope="col" className="col-head">
                  Scope
                </th>
                <th scope="col" className="col-head">
                  Purpose
                </th>
              </tr>
            </thead>
            <tbody>
              {ENVIRONMENT.map((variable) => (
                <tr key={variable.name}>
                  <td>
                    <span className="value">{variable.name}</span>
                  </td>
                  <td>
                    <span className="value text-muted-dim">{variable.scope}</span>
                  </td>
                  <td className="text-muted-dim">{variable.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <P>
          No secret key appears in any of these except{' '}
          <span className="value">LIMEN_DEMO_SECRET</span>, which is a disposable testnet key used
          only by the scripted demo transfer. No user key is ever read from the environment, because
          no user key ever leaves the browser that generated it.
        </P>
      </DocSectionBlock>
    </DocPage>
  );
}
