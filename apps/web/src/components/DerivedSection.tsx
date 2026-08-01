'use client';

import type { PolicyProposal } from '@limen/core';
import type { ExplainedOption } from '@/app/api/explain/route';
import { Address } from './Address';
import { decimalise, ledgersToDuration } from '@/lib/format';

export function DerivedSection({
  proposal,
  explanation,
  question,
  options,
  activeOptionId,
  degraded,
  explaining,
  onSelectOption,
}: {
  proposal: PolicyProposal;
  explanation: string;
  question: string | null;
  options: ExplainedOption[];
  activeOptionId: string | null;
  degraded?: string;
  explaining: boolean;
  onSelectOption: (option: ExplainedOption | null) => void;
}) {
  const rule = proposal.contextRule;

  return (
    <div className="flex flex-col gap-5">
      {/* --- plain English ------------------------------------------------ */}
      <div className="rounded-sm border border-border-subtle bg-surface p-3">
        {explaining ? (
          <p className="text-muted">Asking Claude to explain this proposal…</p>
        ) : explanation.length > 0 ? (
          <p className="text-foreground">{explanation}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {degraded !== undefined && <p className="text-muted-dim">{degraded}</p>}
            <ul className="flex flex-col gap-0.5">
              {proposal.rationale.map((line) => (
                <li key={line} className="text-foreground">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* --- context rule -------------------------------------------------- */}
      <div className="flex flex-col gap-2">
        <h3 className="text-muted uppercase tracking-wide">Context rule</h3>
        <div className="scroll-x rounded-sm border border-border-subtle">
          <table className="w-full min-w-[40rem] border-collapse text-left">
            <tbody>
              <tr className="border-b border-border-subtle">
                <th scope="row" className="w-[14rem] px-3 py-2 text-left font-medium text-muted">
                  allowed contracts
                </th>
                <td className="px-3 py-2">
                  <ul className="flex flex-col gap-1">
                    {rule.allowedContracts.map((contractId) => (
                      <li key={contractId}>
                        <Address value={contractId} />
                      </li>
                    ))}
                  </ul>
                </td>
              </tr>
              <tr className="border-b border-border-subtle">
                <th scope="row" className="px-3 py-2 text-left font-medium text-muted">
                  allowed functions
                </th>
                <td className="px-3 py-2">
                  <ul className="flex flex-col gap-1">
                    {rule.allowedContracts.map((contractId) => (
                      <li key={contractId} className="flex flex-wrap items-baseline gap-2">
                        <Address value={contractId} />
                        <span className="text-muted-dim">→</span>
                        <span className="text-foreground">
                          {(rule.allowedFunctions[contractId] ?? [])
                            .map((fn) => `${fn}()`)
                            .join(', ')}
                        </span>
                      </li>
                    ))}
                  </ul>
                </td>
              </tr>
              <tr>
                <th scope="row" className="px-3 py-2 text-left font-medium text-muted">
                  validity
                </th>
                <td className="px-3 py-2 text-foreground tabular-nums">
                  ledger {rule.validFromLedger} → {rule.validUntilLedger}{' '}
                  <span className="text-muted-dim">
                    ({ledgersToDuration(rule.validUntilLedger - rule.validFromLedger)})
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* --- policies ------------------------------------------------------ */}
      <div className="flex flex-col gap-2">
        <h3 className="text-muted uppercase tracking-wide">
          Policies <span className="text-muted-dim">({proposal.policies.length} of 5 max)</span>
        </h3>
        <div className="scroll-x rounded-sm border border-border-subtle">
          <table className="w-full min-w-[44rem] border-collapse text-left">
            <thead>
              <tr className="border-b border-border-bright bg-surface-raised text-muted">
                <th scope="col" className="px-3 py-2 font-medium tracking-wide uppercase">
                  Primitive
                </th>
                <th scope="col" className="px-3 py-2 font-medium tracking-wide uppercase">
                  Target
                </th>
                <th scope="col" className="px-3 py-2 font-medium tracking-wide uppercase">
                  Configuration
                </th>
              </tr>
            </thead>
            <tbody>
              {proposal.policies.map((policy) => (
                <tr
                  key={
                    policy.kind === 'spending_limit'
                      ? `limit-${policy.asset}`
                      : `allow-${policy.contractId}`
                  }
                  className="border-b border-border-subtle last:border-b-0"
                >
                  <td className="px-3 py-2 align-top text-accent">{policy.kind}</td>
                  <td className="px-3 py-2 align-top">
                    <Address
                      value={policy.kind === 'spending_limit' ? policy.asset : policy.contractId}
                    />
                  </td>
                  <td className="px-3 py-2 align-top text-foreground">
                    {policy.kind === 'spending_limit' ? (
                      <span className="tabular-nums">
                        {policy.limit}{' '}
                        <span className="text-muted-dim">({decimalise(policy.limit)})</span> per{' '}
                        {policy.windowLedgers} ledgers{' '}
                        <span className="text-muted-dim">
                          ({ledgersToDuration(policy.windowLedgers)})
                        </span>
                      </span>
                    ) : (
                      policy.functions.map((fn) => `${fn}()`).join(', ')
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* --- clarifying question ------------------------------------------- */}
      {options.length > 0 && (
        <div className="flex flex-col gap-2 rounded-sm border border-border-subtle bg-surface p-3">
          <h3 className="text-muted uppercase tracking-wide">Intent</h3>
          <p className="text-foreground">
            {question ?? 'How much spending headroom should this policy allow?'}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onSelectOption(null)}
              aria-pressed={activeOptionId === null}
              className={`cursor-pointer rounded-sm border px-2.5 py-1.5 text-left ${
                activeOptionId === null
                  ? 'border-accent bg-accent/10 text-foreground'
                  : 'border-border-bright text-muted hover:border-accent hover:text-foreground'
              }`}
            >
              Keep the default
              <span className="block text-muted-dim">cap = observed outflow, per 7 days</span>
            </button>
            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => onSelectOption(option)}
                aria-pressed={activeOptionId === option.id}
                className={`cursor-pointer rounded-sm border px-2.5 py-1.5 text-left ${
                  activeOptionId === option.id
                    ? 'border-accent bg-accent/10 text-foreground'
                    : 'border-border-bright text-muted hover:border-accent hover:text-foreground'
                }`}
              >
                {option.label}
                <span className="block text-muted-dim tabular-nums">
                  headroom {option.headroomBps / 100}% · window {option.windowLedgers} ledgers
                </span>
              </button>
            ))}
          </div>
          <p className="text-muted-dim">
            No option is applied until you pick one. Claude may phrase this question and choose
            which options to surface; the headroom and window values themselves are defined
            server-side and are the only values that can reach the synthesizer.
          </p>
        </div>
      )}
    </div>
  );
}
