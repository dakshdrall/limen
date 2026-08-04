'use client';

import Link from 'next/link';
import { Address } from '@/components/Address';
import type { SnapshotRule, SnapshotSigner } from '@/lib/account-contract';
import { decimalise, ledgersToDuration } from '@/lib/format';
import { formatPolicyId } from '@/lib/policy-id';

/**
 * The installed boundary, as the account holds it.
 *
 * Every column here is chain state read at `atLedger`. Nothing derived by this
 * application appears in this table — `validFromLedger`, the headroom that
 * produced a cap, and the transaction a policy was derived from are all local
 * provenance and belong under their own label on the policy screen, never
 * inside the on-chain rule block. That separation is design decision 5 in the
 * plan and it is the difference between showing what the network will enforce
 * and showing what this app believes.
 */

function signerLabel(signer: SnapshotSigner): string {
  return signer.kind === 'Delegated' ? 'Delegated' : 'External';
}

function signerValue(signer: SnapshotSigner): string {
  return signer.kind === 'Delegated' ? signer.address : signer.publicKey;
}

/**
 * `valid_until` is inclusive on-chain, so a rule whose bound equals the current
 * ledger is live for this ledger and expires with the next one. Saying
 * "expires" rather than "expired" for that case is the difference between a
 * rule someone can still use and one they cannot.
 */
function expiryText(rule: SnapshotRule, atLedger: number): string {
  if (rule.validUntilLedger === null) return 'no expiry';
  const remaining = rule.validUntilLedger - atLedger;
  if (remaining < 0) return `expired ${(-remaining).toLocaleString('en-US')} ledgers ago`;
  return `${rule.validUntilLedger.toLocaleString('en-US')} · ${ledgersToDuration(remaining)} left`;
}

export function RulesTable({
  contractId,
  rules,
  atLedger,
}: {
  contractId: string;
  rules: SnapshotRule[];
  atLedger: number;
}) {
  return (
    <div className="scroll-x rounded-[5px] border border-border-default bg-surface">
      <table className="tbl w-full min-w-[56rem]">
        <thead>
          <tr>
            <th scope="col" className="col-ledger">
              rule
            </th>
            <th scope="col">name</th>
            <th scope="col">authorizes</th>
            <th scope="col" className="col-addr">
              contract
            </th>
            <th scope="col">expiry</th>
            <th scope="col" className="col-signer">
              signers
            </th>
            <th scope="col">policies</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((rule) => (
            <tr key={rule.id} className={rule.live ? undefined : 'opacity-55'}>
              <td className="col-ledger num">
                <Link
                  href={`/app/policies/${formatPolicyId({ contractId, ruleId: rule.id })}`}
                  className="rounded-[2px] link"
                >
                  {rule.id}
                </Link>
              </td>

              <td>
                <span className="value">{rule.name}</span>
                {!rule.live && (
                  <span className="status-label ml-2" title="Past its valid_until ledger. The network will refuse a call made under it.">
                    EXPIRED
                  </span>
                )}
              </td>

              <td className="text-[12.5px] text-muted">
                {rule.contextType === 'CallContract'
                  ? 'calls to one contract'
                  : rule.contextType === 'Default'
                    ? 'any context'
                    : 'contract creation'}
              </td>

              <td className="col-addr">
                {rule.contract === null ? (
                  <span className="text-muted-dim">—</span>
                ) : (
                  <Address value={rule.contract} />
                )}
              </td>

              <td className="text-[12.5px] text-muted">{expiryText(rule, atLedger)}</td>

              <td className="col-signer">
                {rule.signers.length === 0 ? (
                  <span className="text-muted-dim">none</span>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {rule.signers.map((signer) => (
                      <li key={signerValue(signer)} className="flex items-center gap-2">
                        <span className="status-label">{signerLabel(signer)}</span>
                        <Address value={signerValue(signer)} tone="dim" />
                      </li>
                    ))}
                  </ul>
                )}
              </td>

              <td>
                {rule.policies.length === 0 ? (
                  // A rule with no policy is not a safe rule. It authorizes
                  // every call matching its context with nothing bounding the
                  // amount, and reading "none" as benign is the mistake this
                  // wording exists to prevent.
                  <span className="text-[12.5px] text-unproven">unbounded — no policy attached</span>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {rule.policies.map((policy) => (
                      <li key={policy.contract} className="flex flex-col gap-0.5">
                        {policy.limit === null ? (
                          <span className="text-[12.5px] text-unproven">
                            {policy.unreadable ?? 'unreadable'}
                          </span>
                        ) : (
                          <span className="value text-[12.5px]">
                            {decimalise(policy.limit.spentInWindow)} / {decimalise(policy.limit.limit)}{' '}
                            <span className="text-muted-dim">
                              per {ledgersToDuration(policy.limit.periodLedgers)}
                            </span>
                          </span>
                        )}
                        <Address value={policy.contract} tone="dim" />
                      </li>
                    ))}
                  </ul>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
