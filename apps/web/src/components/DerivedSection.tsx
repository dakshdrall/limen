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
    <div className="flex flex-col gap-7">
      {/* --- plain English ------------------------------------------------ */}
      <div className="rounded-[5px] border border-border-subtle bg-surface px-4 py-3.5">
        {explaining ? (
          <p className="text-[13px] text-muted-dim">Asking Claude to explain this proposal…</p>
        ) : explanation.length > 0 ? (
          <p className="max-w-[80ch] text-[13.5px] leading-relaxed text-foreground">
            {explanation}
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {degraded !== undefined && (
              <p className="text-[12.5px] text-muted-dim">{degraded}</p>
            )}
            <ul className="flex flex-col gap-1">
              {proposal.rationale.map((line) => (
                <li key={line} className="value break-all text-muted">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* --- context rule -------------------------------------------------- */}
      <div className="flex flex-col gap-2.5">
        <h3 className="col-head text-muted">Context rule</h3>
        <div className="scroll-x rounded-[5px] border border-border-default bg-surface">
          <table className="w-full min-w-[42rem] border-collapse text-left">
            <tbody>
              <tr className="border-b border-border-subtle">
                <th
                  scope="row"
                  className="col-head w-[13rem] px-4 py-3 text-left align-top text-muted-dim"
                >
                  allowed contracts
                </th>
                <td className="px-4 py-3">
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
                <th scope="row" className="col-head px-4 py-3 text-left align-top text-muted-dim">
                  allowed functions
                </th>
                <td className="px-4 py-3">
                  <ul className="flex flex-col gap-1.5">
                    {rule.allowedContracts.map((contractId) => (
                      <li key={contractId} className="flex flex-wrap items-baseline gap-x-2">
                        <Address value={contractId} tone="dim" />
                        <span aria-hidden="true" className="text-faint">
                          →
                        </span>
                        <span className="value text-foreground">
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
                <th scope="row" className="col-head px-4 py-3 text-left align-top text-muted-dim">
                  validity
                </th>
                <td className="px-4 py-3">
                  <span className="value text-foreground">
                    ledger {rule.validFromLedger} → {rule.validUntilLedger}
                  </span>{' '}
                  <span className="text-[12.5px] text-muted-dim">
                    ({ledgersToDuration(rule.validUntilLedger - rule.validFromLedger)})
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* --- policies ------------------------------------------------------ */}
      <div className="flex flex-col gap-2.5">
        <h3 className="col-head flex items-baseline gap-2 text-muted">
          Policies
          <span className="text-faint normal-case tracking-normal">
            ({proposal.policies.length} of 5 max)
          </span>
        </h3>
        <div className="scroll-x rounded-[5px] border border-border-default bg-surface">
          <table className="w-full min-w-[46rem] border-collapse text-left">
            <thead>
              <tr className="border-b border-border-bright bg-surface-raised text-muted-dim">
                <th scope="col" className="col-head w-[12rem] px-4 py-2.5">
                  Primitive
                </th>
                <th scope="col" className="col-head w-[11rem] px-4 py-2.5">
                  Target
                </th>
                <th scope="col" className="col-head px-4 py-2.5">
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
                  className="border-b border-border-subtle transition-colors last:border-b-0 hover:bg-surface-hover"
                >
                  <td className="value px-4 py-3 align-top text-accent">{policy.kind}</td>
                  <td className="px-4 py-3 align-top">
                    <Address
                      value={policy.kind === 'spending_limit' ? policy.asset : policy.contractId}
                    />
                  </td>
                  <td className="px-4 py-3 align-top">
                    {policy.kind === 'spending_limit' ? (
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span className="value font-semibold text-foreground">{policy.limit}</span>
                        <span className="value text-muted-dim">({decimalise(policy.limit)})</span>
                        <span className="text-[12.5px] text-muted">
                          per <span className="value">{policy.windowLedgers}</span> ledgers
                        </span>
                        <span className="text-[12.5px] text-muted-dim">
                          ({ledgersToDuration(policy.windowLedgers)})
                        </span>
                      </span>
                    ) : (
                      <span className="value text-foreground">
                        {policy.functions.map((fn) => `${fn}()`).join(', ')}
                      </span>
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
        <div className="flex flex-col gap-3 rounded-[5px] border border-border-subtle bg-surface px-4 py-4">
          <h3 className="col-head text-muted">Intent</h3>
          <p className="max-w-[80ch] text-[13.5px] leading-relaxed text-foreground">
            {question ?? 'How much spending headroom should this policy allow?'}
          </p>
          <div className="flex flex-wrap gap-2">
            <OptionButton
              active={activeOptionId === null}
              label="Keep the default"
              detail="cap = observed outflow, per 7 days"
              onClick={() => onSelectOption(null)}
            />
            {options.map((option) => (
              <OptionButton
                key={option.id}
                active={activeOptionId === option.id}
                label={option.label}
                detail={`headroom ${option.headroomBps / 100}% · window ${option.windowLedgers} ledgers`}
                onClick={() => onSelectOption(option)}
              />
            ))}
          </div>
          <p className="max-w-[86ch] text-[12.5px] leading-relaxed text-muted-dim">
            No option is applied until you pick one. Claude may phrase this question and choose
            which options to surface; the headroom and window values themselves are defined
            server-side and are the only values that can reach the synthesizer.
          </p>
        </div>
      )}
    </div>
  );
}

function OptionButton({
  active,
  label,
  detail,
  onClick,
}: {
  active: boolean;
  label: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex cursor-pointer flex-col gap-0.5 rounded-[4px] border px-3 py-2 text-left transition-colors ${
        active
          ? 'border-accent bg-accent-dim text-foreground'
          : 'border-border-bright text-muted hover:border-accent hover:bg-surface-hover hover:text-foreground'
      }`}
    >
      <span className="text-[13px] font-medium">{label}</span>
      <span className={`value ${active ? 'text-accent' : 'text-muted-dim'}`}>{detail}</span>
    </button>
  );
}
