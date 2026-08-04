import { StatusLabel } from '@/components/StatusLabel';

/**
 * A boundary that no audited primitive can impose.
 *
 * One component, because there is one answer. `/app/policies/new` renders it on
 * the way to an install that will not happen, and `/app/simulator` renders it
 * for flows that live there precisely because they cannot be installed — the
 * multi-contract case, per PLAN-V3 decision 1. If those two screens explained
 * the same refusal differently, a reviewer comparing them would reasonably
 * conclude one of them was making it up.
 *
 * This is a result, not an error. It reads as the composition-only rule doing
 * its job, and it names the constraint rather than gesturing at one.
 */
export function NotEnforceable({ constraint, message }: { constraint: string; message: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-[4px] border border-unproven-line bg-surface px-5 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="eyebrow text-unproven">not enforceable on-chain</span>
        <StatusLabel name="COMPOSITION ONLY" weight="loud" />
      </div>
      <p className="max-w-[78ch] text-[13px] leading-relaxed text-foreground/90">{message}</p>
      <p className="text-[12.5px] text-muted-dim">
        constraint: <span className="value">{constraint}</span>
      </p>
      <p className="max-w-[78ch] text-[12.5px] leading-relaxed text-muted-dim">
        Closing this gap would take a Limen-authored Rust policy in the authorization path. That is
        the one place this project has said it will not put unaudited code, so the boundary is
        refused instead.
      </p>
    </div>
  );
}
