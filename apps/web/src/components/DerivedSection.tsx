'use client';

import type { PolicyProposal } from '@limen/core';
import type { ExplainedOption } from '@/app/api/explain/route';
import { PolicyTable } from './PolicyTable';

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
  return (
    <div className="flex flex-col gap-7">
      {/* --- plain English ------------------------------------------------ */}
      <div className="rounded-[5px] border border-border-subtle bg-surface px-4 py-3.5">
        {explaining ? (
          <p className="text-[13px] text-muted-dim">Asking Claude to explain this proposal…</p>
        ) : explanation.length > 0 ? (
          <p className="measure text-[13.5px] leading-relaxed text-foreground">
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

      <PolicyTable proposal={proposal} />

      {/* --- clarifying question ------------------------------------------- */}
      {options.length > 0 && (
        <div className="flex flex-col gap-3 rounded-[5px] border border-border-subtle bg-surface px-4 py-4">
          <h3 className="col-head text-muted">Intent</h3>
          <p className="measure text-[13.5px] leading-relaxed text-foreground">
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
          <p className="measure text-[12.5px] leading-relaxed text-muted-dim">
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
