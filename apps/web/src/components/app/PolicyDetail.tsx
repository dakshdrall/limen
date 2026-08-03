'use client';

import Link from 'next/link';
import { useStored } from '@/lib/use-store';
import { Address } from '@/components/Address';
import { EmptyState, Pending, ReadFailure } from '@/components/app/ScreenState';
import { PermittedRow, RefusedTable } from '@/components/app/RefusalTable';
import { Section } from '@/components/Section';
import { StatusLabel } from '@/components/StatusLabel';
import { Verdict } from '@/components/Verdict';
import type { SnapshotRule } from '@/lib/account-contract';
import { decimalise, ledgersToDuration } from '@/lib/format';
import { getProvenance, type StoredProvenance } from '@/lib/store';
import { surveyFor, walkthroughFor } from '@/lib/recorded-runs';
import { useAccountSnapshot } from '@/lib/use-account-snapshot';

/**
 * One installed policy: what it permits, what it has refused, and where each of
 * those two claims comes from.
 *
 * The screen is laid out in provenance order, and the order is the argument.
 * First the rule as the chain holds it. Then the refusals the network produced,
 * with hashes. Then — last, smallest, and under its own label — the part that
 * only this browser knows: which transaction the boundary was derived from and
 * with what headroom. Putting local provenance last is not modesty. It is the
 * only arrangement in which a reader cannot mistake it for chain state.
 */

export function PolicyDetail({ contractId, ruleId }: { contractId: string; ruleId: number }) {
  const { state, reload } = useAccountSnapshot(contractId);
  const provenance = useStored<StoredProvenance | null>(
    () => getProvenance(contractId, ruleId) ?? null,
    [contractId, ruleId],
  );

  const run = walkthroughFor(contractId, ruleId);
  const survey = surveyFor(contractId);

  const rule =
    state.status === 'ok' ? state.snapshot.rules.find((candidate) => candidate.id === ruleId) : undefined;

  return (
    <div className="flex flex-col gap-14">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="col-head text-muted-dim">rule</span>
          <span className="value text-[15px] text-foreground">{ruleId}</span>
          <span className="text-muted-dim">on</span>
          <Address value={contractId} />
        </div>
        <Link
          href={`/app/accounts/${contractId}`}
          className="rounded-[3px] text-[12.5px] text-muted underline decoration-border-bright underline-offset-4 transition-colors hover:text-foreground hover:decoration-accent focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
        >
          Whole account
        </Link>
      </div>

      <Section
        index={1}
        title="The boundary, as the chain holds it"
        subtitle="Read from the ledger when this screen loaded. Not restored from anything this browser stored."
      >
        {state.status === 'pending' && <Pending what="Reading this context rule and its policies from testnet." />}
        {state.status === 'failed' && (
          <ReadFailure
            message={state.message}
            detail={state.detail}
            unconfigured={state.unconfigured}
            onRetry={reload}
          />
        )}
        {state.status === 'ok' &&
          (rule === undefined ? (
            <EmptyState title={`This account has no rule ${ruleId}.`}>
              <p>
                The account answered, so this is its real state. Rule ids come from a counter that
                only increases and removal leaves a gap rather than renumbering — so a missing id
                means the rule was never created, or was revoked.
              </p>
            </EmptyState>
          ) : (
            <RuleFacts rule={rule} atLedger={state.snapshot.ledger} />
          ))}
      </Section>

      <Section
        index={2}
        title="What the network refused"
        subtitle="Attempts adjacent to the permitted flow, each refused by the policy contract executed by the host — not by this repository's evaluator."
        emphasis
      >
        <div className="flex flex-col gap-7">
          {run !== undefined && <PermittedRow run={run} />}

          {survey === undefined ? (
            <EmptyState title="No refusal has been recorded against this account.">
              <p>
                The boundary above is installed and readable, and nothing in this repository has
                attempted to cross it. That is an absence of evidence, not evidence of enforcement —
                the deny table on the{' '}
                <Link
                  href="/"
                  className="rounded-[2px] underline decoration-border-bright underline-offset-4 transition-colors hover:text-accent hover:decoration-accent focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
                >
                  mechanism page
                </Link>{' '}
                adjudicates the same six axes locally, and says so.
              </p>
            </EmptyState>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <StatusLabel name="ON-CHAIN" weight="loud" />
                <p className="text-[12.5px] text-muted-dim">
                  Every row below reached a ledger. Each hash is checkable in an explorer.
                </p>
              </div>
              <RefusedTable rows={survey.axes} caption={survey.note} />
              {run === undefined && (
                <p className="max-w-[86ch] text-[12px] leading-relaxed text-unproven">
                  These attempts were recorded against this account, not against rule {ruleId}. The
                  note above says which rules produced them. They are shown here as the account&rsquo;s
                  history and are not a claim about this rule.
                </p>
              )}
            </>
          )}
        </div>
      </Section>

      <Section
        index={3}
        title="Where this boundary came from"
        subtitle="Derivation provenance. This exists nowhere on chain — it is what this browser recorded when the policy was derived."
      >
        {provenance === undefined ? (
          <Pending what="Reading this browser's record of how the policy was derived." />
        ) : provenance === null ? (
          <EmptyState title="This browser did not derive this policy.">
            <p>
              Provenance is written when a policy is installed through this application, and it lives
              only in the browser that did it. Its absence says nothing about the rule above, which
              is installed and enforced regardless.
            </p>
          </EmptyState>
        ) : (
          <Provenance provenance={provenance} />
        )}
      </Section>
    </div>
  );
}

function RuleFacts({ rule, atLedger }: { rule: SnapshotRule; atLedger: number }) {
  const expired = !rule.live;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <StatusLabel name="ON-CHAIN" />
        <Verdict state={expired ? 'denied' : 'permitted'} />
        <p className="text-[12.5px] text-muted-dim">
          {expired
            ? `Past its valid_until ledger at ${atLedger.toLocaleString('en-US')}. The network refuses every call made under it.`
            : `Live at ledger ${atLedger.toLocaleString('en-US')}.`}
        </p>
      </div>

      <dl className="grid gap-x-10 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        <Fact label="rule name" value={<span className="value">{rule.name}</span>} />
        <Fact
          label="authorizes"
          value={
            rule.contract === null ? (
              <span className="text-muted">any context</span>
            ) : (
              <Address value={rule.contract} />
            )
          }
        />
        <Fact
          label="valid until"
          value={
            <span className="value">
              {rule.validUntilLedger === null ? 'no expiry' : rule.validUntilLedger.toLocaleString('en-US')}
            </span>
          }
        />
        {rule.policies.map((policy) =>
          policy.limit === null ? (
            <Fact
              key={policy.contract}
              label="policy"
              value={<span className="text-unproven">{policy.unreadable ?? 'unreadable'}</span>}
            />
          ) : (
            [
              <Fact
                key={`${policy.contract}-cap`}
                label="cap"
                value={<span className="value">{decimalise(policy.limit.limit)}</span>}
              />,
              <Fact
                key={`${policy.contract}-spent`}
                label="spent this window"
                value={<span className="value">{decimalise(policy.limit.spentInWindow)}</span>}
              />,
              <Fact
                key={`${policy.contract}-window`}
                label="window"
                value={<span className="value">{ledgersToDuration(policy.limit.periodLedgers)}</span>}
              />,
            ]
          ),
        )}
      </dl>

      {rule.policies.length === 0 && (
        <p className="max-w-[80ch] text-[13px] leading-relaxed text-unproven">
          No policy is attached to this rule. Its signers may make any call matching its context, in
          any amount, until it expires.
        </p>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="col-head text-muted-dim">{label}</dt>
      <dd className="text-[13px] text-foreground">{value}</dd>
    </div>
  );
}

function Provenance({ provenance }: { provenance: StoredProvenance }) {
  return (
    <div className="flex flex-col gap-5">
      <StatusLabel name="COMPUTED LOCALLY" />
      <dl className="grid gap-x-10 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        <Fact
          label="derived from"
          value={<Address value={provenance.observedTxHash} />}
        />
        <Fact
          label="observed at ledger"
          value={<span className="value">{provenance.observedLedger.toLocaleString('en-US')}</span>}
        />
        <Fact
          label="headroom"
          value={<span className="value">{(provenance.headroomBps / 100).toFixed(2)}%</span>}
        />
        <Fact label="installed by" value={<Address value={provenance.installTxHash} />} />
      </dl>
      <p className="max-w-[84ch] text-[12px] leading-relaxed text-muted-dim">
        <span className="value">validFromLedger</span> — the ledger the boundary was derived from —
        has no counterpart on an OpenZeppelin context rule. It is kept here as provenance and is
        deliberately absent from the on-chain block above, because a field rendered inside that block
        would read as something the network enforces.
      </p>
    </div>
  );
}
