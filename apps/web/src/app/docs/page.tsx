import Link from 'next/link';
import { Address } from '@/components/Address';
import { TxHash } from '@/components/ExplorerLink';
import { Section } from '@/components/Section';
import { ScreenHeader } from '@/components/app/ScreenHeader';
import { StatusLabel } from '@/components/StatusLabel';
import { Verdict } from '@/components/Verdict';
import { SPENDING_LIMIT_ERRORS } from '@limen/chain';
import { decimalise, ledgersToDuration } from '@/lib/format';
import { RECORDED_RUN, SHARED_CONTRACTS } from '@/lib/recorded-runs';

export const metadata = {
  title: 'Limen — pointing an agent at an installed policy',
  description:
    'How an agent gets a key that cannot exceed its boundary: who holds which key, what the owner installs, what the agent signs, and what the network does when it tries to go further.',
};

/**
 * The one page that explains the product thesis in the terms PLAN-V3 §5 states
 * it: the claim is not that the agent holds no key, it is that **the key the
 * agent holds cannot exceed the boundary, and can be revoked**.
 *
 * Every address, hash, cap and error code below is read from
 * `packages/chain/deployments/testnet.json` or from `@limen/chain`'s own error
 * tables. None is typed into this file. Documentation that restates constants
 * in prose is documentation that goes quietly wrong the first time a script is
 * re-run, and a page whose whole subject is "check this yourself" cannot afford
 * a single number a reviewer checks and finds stale.
 *
 * A server component: nothing here is interactive except `Address`, and no
 * secret, key, or endpoint is involved at any point.
 */

const SIGNER_ROWS = [
  {
    actor: 'Owner',
    signer: 'the account’s default context rule',
    holds: 'a key you already have — in the recorded run, a testnet keypair read from the environment by a script',
    can: 'install a context rule, add or remove signers, revoke',
    exists: true,
  },
  {
    actor: 'Agent',
    signer: 'External(ed25519_verifier, pubkey)',
    holds: 'the agent’s own process. Limen never sees it, and neither does the owner',
    can: 'exactly what the installed rule permits, and nothing adjacent to it',
    exists: true,
  },
  {
    actor: 'Owner (passkey)',
    signer: 'External(webauthn_verifier, pubkey)',
    holds: 'a platform authenticator; never leaves it',
    can: 'the same as the owner above, without a script',
    exists: false,
  },
] as const;

/**
 * The install call, and the signature the agent produces, as they are actually
 * written. Transcribed from `packages/chain/scripts/testnet.mjs`, which is the
 * code that produced the hashes further down this page — not an idealised
 * version of it.
 */
const SIGN_SNIPPET = `import { Keypair, Networks, StrKey, authorizeEntry } from '@stellar/stellar-sdk';
import { authDigest, authPayload, externalSigner } from '@limen/chain';

const agent = Keypair.fromSecret(process.env.AGENT_SECRET);
const rules = [${RECORDED_RUN.contextRuleId}];  // the context rule the owner installed for this key

// Two things here are easy to get wrong and both are silent when wrong:
//
//  1. __check_auth expects an AuthPayload, so the signature goes in verbatim as
//     signatureScVal — not as the SDK's built-in ed25519 signature vector.
//  2. Signers do NOT sign the host's payload. They sign
//     sha256(payload || context_rule_ids.to_xdr()), which binds the selected
//     rules into the signature. Without it, a sponsor could collect a signature
//     made under a strict rule and submit it against a weaker one.
const sign = (entry) =>
  authorizeEntry(
    entry,
    async (_preimage, payload) => ({
      signatureScVal: authPayload(
        [{
          signer: externalSigner(VERIFIER, StrKey.decodeEd25519PublicKey(agent.publicKey())),
          signature: agent.sign(authDigest(payload, rules)),
        }],
        rules,
      ),
    }),
    validUntilLedger,
    Networks.TESTNET,
  );`;

const SIMULATE_SNIPPET = `// Simulate once in recording mode to collect the auth entries, sign them, then
// simulate AGAIN with the signed entries attached before assembling.
//
// This is not belt and braces. Recording-mode simulation never executes
// __check_auth, so its footprint omits the verifier and policy contracts and
// its budget omits their work. A transaction assembled from it dies with
// resourceLimitExceeded *before the boundary is ever consulted* — and reports
// the same operation result a genuine refusal does. The first over-limit run in
// this repository was very nearly recorded as proof of a refusal that had not
// happened.
const recording = await server.simulateTransaction(unsigned);
const signed = await Promise.all(recording.result.auth.map(sign));
const enforcing = await server.simulateTransaction(withAuth(signed));
const tx = rpc.assembleTransaction(withAuth(signed), enforcing).build();`;

export default function DocsPage() {
  return (
    <main className="screen">
      <ScreenHeader
        eyebrow="docs"
        title="Pointing an agent at an installed policy"
        lede={
          <>
            <p>
              The claim Limen makes is not that an agent holds no key. An agent that holds no key
              cannot act. The claim is that the key it holds{' '}
              <em className="text-foreground not-italic">
                cannot exceed the boundary installed for it
              </em>
              , that the boundary was derived from a transaction someone already approved, and that
              it can be revoked without moving any funds or rotating anything else.
            </p>
            <p>
              Everything below is the recorded testnet run, by its real addresses and hashes. It is
              checkable in an explorer, which is the only thing that makes any of it more than a
              claim.
            </p>
          </>
        }
        labels={['TESTNET ONLY', 'COMPOSITION ONLY', 'NOT AUDITED', 'NO CUSTODY']}
      />

      <Section
        index={1}
        title="Three keys, and who holds each"
        subtitle="Keeping these apart is most of the security argument. The owner's key and the agent's key are different keys, held by different parties, doing different things."
      >
        <div className="scroll-x">
          <table className="tbl w-full min-w-[46rem]">
            <thead>
              <tr>
                <th scope="col">actor</th>
                <th scope="col">signer</th>
                <th scope="col">key held where</th>
                <th scope="col">can do</th>
                <th scope="col" className="col-label">
                  status
                </th>
              </tr>
            </thead>
            <tbody>
              {SIGNER_ROWS.map((row) => (
                <tr key={row.actor}>
                  <td className="text-foreground">{row.actor}</td>
                  <td className="value text-muted">{row.signer}</td>
                  <td className="text-muted">{row.holds}</td>
                  <td className="text-muted">{row.can}</td>
                  <td className="col-label">
                    <span className={`eyebrow ${row.exists ? 'text-permit' : 'text-muted-dim'}`}>
                      {row.exists ? 'in use' : 'not built'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="measure text-[12.5px] leading-relaxed text-muted-dim">
          No key of any of these three reaches a Limen server. The owner signs the install; the
          agent signs its own calls. There is no code path in this repository that holds one on
          behalf of a user, and no form anywhere in this application that accepts a secret key.
        </p>
      </Section>

      <Section
        index={2}
        title="What the owner installs"
        subtitle="A context rule pins one contract, one signer, and the policies that constrain it. Installing is a write, so it is signed by the owner — under the account's default rule, id 0."
      >
        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-[13rem_minmax(0,1fr)]">
          <Field label="smart account">
            <Address value={RECORDED_RUN.smartAccount} />
          </Field>
          <Field label="ed25519 verifier">
            <Address value={SHARED_CONTRACTS.ed25519Verifier.contract} />
          </Field>
          <Field label="spending limit policy">
            <Address value={SHARED_CONTRACTS.spendingLimitPolicy.contract} />
          </Field>
          <Field label="agent public key">
            <Address value={RECORDED_RUN.agentSigner} />
          </Field>
          <Field label="constrained contract">
            <Address value={RECORDED_RUN.token} />
          </Field>
          <Field label="context rule id">
            <span className="value text-foreground">{RECORDED_RUN.contextRuleId}</span>
          </Field>
          <Field label="cap">
            {/* Decimalised for reading and the raw integer kept beside it. The
                integer is the value the contract holds; the decimal is never
                fed back into anything. Same helpers every other screen uses,
                so a cap is the same shape wherever it appears. */}
            <span className="value text-foreground">{decimalise(RECORDED_RUN.cap)}</span>{' '}
            <span className="text-[12.5px] text-muted-dim">
              ({RECORDED_RUN.cap} stroops) per {RECORDED_RUN.windowLedgers} ledgers,{' '}
              {ledgersToDuration(RECORDED_RUN.windowLedgers)}
            </span>
          </Field>
          <Field label="install transaction">
            <TxHash hash={RECORDED_RUN.installTx} />
          </Field>
        </dl>

        <p className="measure text-[13px] leading-relaxed text-muted">
          The agent&rsquo;s key is registered as{' '}
          <span className="value">External(ed25519_verifier, pubkey)</span> — the account does not
          verify the signature itself, it delegates to the audited verifier contract above. The
          spending limit is a separate audited contract, attached to the same rule. Limen wrote
          neither of them.
        </p>
        <p className="measure text-[12.5px] leading-relaxed text-muted-dim">
          Deriving this rule from a transaction rather than writing it by hand is what{' '}
          <Link href="/app/policies/new" className="link" data-tone="strong">
            New policy
          </Link>{' '}
          does. What it will not do is install: that write needs an owner signature, and no signer
          exists in the browser yet. The rule above was installed by{' '}
          <span className="value">packages/chain/scripts/testnet.mjs</span>.
        </p>
      </Section>

      <Section
        index={3}
        title="What the agent signs"
        subtitle="The agent builds an ordinary Soroban invocation. The only unusual part is the authorization entry, and it is unusual in two specific ways."
      >
        <Code>{SIGN_SNIPPET}</Code>

        <p className="measure text-[13px] leading-relaxed text-muted">
          <span className="value">VERIFIER</span> is the ed25519 verifier address in step 2, and{' '}
          <span className="value">rules</span> is the context rule the owner installed for this key.
          Both are the agent&rsquo;s configuration; neither is a secret. The agent&rsquo;s secret
          key never leaves the process that signs with it.
        </p>

        <h3 className="mt-2 text-[14px] font-semibold tracking-[-0.01em] text-foreground">
          Simulate twice, or you will misread the result
        </h3>
        <Code>{SIMULATE_SNIPPET}</Code>
      </Section>

      <Section
        index={4}
        title="What the network does when the agent tries to exceed it"
        subtitle="Not a client-side check, and not this repository's opinion. The policy contract panics inside __check_auth and the transaction fails on-ledger."
        emphasis
      >
        <div className="scroll-x">
          <table className="tbl w-full min-w-[42rem]">
            <thead>
              <tr>
                <th scope="col" className="col-verdict">
                  outcome
                </th>
                <th scope="col">what happened</th>
                <th scope="col" className="col-hash">
                  transaction
                </th>
              </tr>
            </thead>
            <tbody>
              {/* `Verdict`, not two coloured words. Every verdict in this
                  application carries a glyph and a border so it survives
                  greyscale, and a table that hand-rolled its own would be the
                  first place that rule quietly stopped holding. */}
              <tr>
                <td className="col-verdict">
                  <Verdict state="permitted" />
                </td>
                <td className="text-muted">a transfer of exactly the cap, inside the rule</td>
                <td className="col-hash">
                  <TxHash hash={RECORDED_RUN.permittedTx} />
                </td>
              </tr>
              <tr>
                <td className="col-verdict">
                  <Verdict state="denied" />
                </td>
                <td className="text-muted">
                  the same transfer, above the cap —{' '}
                  <span className="value">{RECORDED_RUN.rejectedError}</span>
                </td>
                <td className="col-hash">
                  <TxHash hash={RECORDED_RUN.rejectedTx} />
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="measure text-[13px] leading-relaxed text-muted">
          An agent should treat these as results, not as transport errors. The spending limit policy
          raises exactly these codes, and they are the difference between &ldquo;your call was
          declined by the boundary&rdquo; and &ldquo;something broke&rdquo;:
        </p>

        <ul className="flex flex-col gap-1.5">
          {Object.entries(SPENDING_LIMIT_ERRORS).map(([code, name]) => (
            <li key={code} className="value text-muted-dim">
              {name}#{code}
            </li>
          ))}
        </ul>

        <p className="measure text-[12.5px] leading-relaxed text-muted-dim">
          <span className="text-foreground">A failure is not a refusal until its error code says
          so.</span>{' '}
          <span className="value">invokeHostFunctionTrapped</span> is also what a transaction that
          ran out of budget reports. Decode the contract error out of the diagnostic events before
          concluding anything about the boundary —{' '}
          <span className="value">isBoundaryRefusal</span> in{' '}
          <span className="value">@limen/chain</span> is that check, and the tables it reads are
          transcribed from the pinned OpenZeppelin sources.
        </p>
      </Section>

      <Section
        index={5}
        title="What this does not do yet"
        subtitle="Stated here rather than discovered later. Each of these is a real limit, not a rough edge."
      >
        <ul className="flex flex-col gap-4">
          <Limit title="No browser signer, so nothing installs from the interface">
            Installing and revoking are writes that need an owner signature. The passkey path is
            unbuilt, and so is the browser-generated keypair that would stand in for it. Every
            install this repository has recorded was signed by{' '}
            <span className="value">packages/chain/scripts/testnet.mjs</span>, which reads
            disposable testnet keys from the environment and is not part of this application.
          </Limit>
          <Limit title="No revoke button">
            Removing a context rule is the same kind of write, and blocked on the same missing
            signer. The rule above expires on its own at its{' '}
            <span className="value">valid_until</span> ledger, which is the only revocation
            currently demonstrated.
          </Limit>
          <Limit title="One contract per boundary">
            A flow that touches a second contract cannot be installed, because no audited primitive
            constrains that contract and a rule without one would permit every function on it.
            Limen refuses rather than widening. Those flows live in the{' '}
            <Link href="/app/simulator" className="link" data-tone="strong">
              simulator
            </Link>
            , labelled and evaluated locally, and they are the roadmap trigger for a Limen-authored
            policy — the one place this project has said it will not put unaudited code.
          </Limit>
          <Limit title="Testnet, and not audited">
            <div className="mb-2 flex flex-wrap gap-1.5">
              <StatusLabel name="TESTNET ONLY" />
              <StatusLabel name="NOT AUDITED" weight="loud" />
            </div>
            The OpenZeppelin contracts an installed boundary is made of are audited. The code that
            decides what to install is this repository&rsquo;s, and it is not.
          </Limit>
        </ul>
      </Section>

      <footer className="measure border-t border-border-subtle pt-6 text-[12.5px] leading-relaxed text-muted-dim">
        Every address and hash on this page is read at build time from{' '}
        <span className="value">packages/chain/deployments/testnet.json</span>, and every error code
        from <span className="value">@limen/chain</span>&rsquo;s own tables. Nothing here is typed
        into the page, so nothing here can drift from what the scripts actually did.
      </footer>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="col-head text-muted-dim">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}



function Code({ children }: { children: string }) {
  return (
    <pre className="scroll-x value rounded-[5px] border border-border-default bg-surface p-4 text-[11.5px] leading-relaxed text-muted">
      {children}
    </pre>
  );
}

function Limit({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-1.5 border-l border-border-default pl-4">
      <h3 className="text-[14px] font-semibold tracking-[-0.01em] text-foreground">{title}</h3>
      <div className="measure text-[13px] leading-relaxed text-muted">{children}</div>
    </li>
  );
}
