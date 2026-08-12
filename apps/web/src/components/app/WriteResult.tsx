'use client';

import { describeContractError } from '@limen/chain/errors';
import { Pending } from '@/components/app/ScreenState';
import { TxHash } from '@/components/ExplorerLink';
import type { WriteState } from '@/lib/use-write';

/**
 * What one write step did, rendered the same way on every screen.
 *
 * The distinction it exists to keep visible is the one the whole project rests
 * on: **a transaction that reached a ledger and failed there is evidence; one
 * that never reached a ledger is not.** They are drawn differently and worded
 * differently, and the second never gets a hash — because it does not have one,
 * and a placeholder in that slot would be the single most misleading thing this
 * component could do.
 *
 * It deliberately does not decide whether an on-ledger failure was a *refusal*.
 * That question needs `isBoundaryRefusal` and `isRevokedRule` and the caller's
 * knowledge of what was attempted; a component that guessed would be the
 * `resourceLimitExceeded` trap wearing a badge. Screens that make the claim
 * render a `Verdict` beside this.
 */
export function WriteResult({ state }: { state: WriteState }) {
  if (state.status === 'idle') return null;

  if (state.status === 'running') {
    return <Pending what={state.what} />;
  }

  if (state.status === 'failed') {
    return (
      <div role="alert" className="panel" data-tone="refused">
        <div className="flex flex-col gap-1.5">
          <span className="eyebrow text-deny">
            {state.stage === 'browser' ? 'not submitted' : `stopped at ${state.stage}`}
          </span>
          <p className="measure text-[13px] leading-relaxed text-foreground/90">
            {state.what} did not reach a ledger, so there is no hash and nothing here to check. This
            is not a refusal — the network never ran the call.
          </p>
        </div>

        {state.code !== null && (
          <p className="text-[12.5px] leading-relaxed text-muted">
            The simulation reported{' '}
            <span className="value">{describeContractError(state.code)}</span>. A code from a
            simulation is the contract&rsquo;s verdict, but nothing on chain records it.
          </p>
        )}

        <details className="text-[12px] text-muted-dim">
          <summary className="cursor-pointer rounded-[2px]">What the endpoint said</summary>
          <p className="scroll-x mt-2 font-mono text-[11.5px] leading-relaxed break-words">
            {state.message}
          </p>
        </details>
      </div>
    );
  }

  return (
    <div className="panel" data-tone={state.ok ? undefined : 'refused'}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className={`eyebrow ${state.ok ? 'text-permit' : 'text-deny'}`}>
          {state.ok ? 'on ledger' : 'on ledger — failed there'}
        </span>
        {/* A hash is the whole point of this row, and an empty one is a real
            case: friendbot funding an account that already exists returns no
            transaction. Rendering `TxHash` anyway would link to a 404 that
            reads as this application being broken rather than as there being
            nothing to link. */}
        {state.hash.length > 0 ? (
          <TxHash hash={state.hash} />
        ) : (
          <span className="text-[12px] text-muted-dim">no transaction to link</span>
        )}
      </div>

      <p className="measure text-[13px] leading-relaxed text-foreground/90">{state.what}</p>

      {!state.ok && (
        <dl className="flex flex-wrap gap-x-8 gap-y-2 text-[12.5px]">
          <div className="flex flex-col gap-0.5">
            <dt className="col-head text-muted-dim">operation result</dt>
            <dd className="value text-[13px] text-foreground">{state.opResult}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="col-head text-muted-dim">contract codes</dt>
            <dd className="value text-[13px] text-foreground">
              {state.codes.length === 0
                ? 'none decoded'
                : state.codes.map((code) => describeContractError(code)).join(', ')}
            </dd>
          </div>
        </dl>
      )}

      {!state.ok && state.codes.length === 0 && (
        // The `resourceLimitExceeded` trap, named on screen rather than left for
        // a reader to fall into. `invokeHostFunctionTrapped` is what running out
        // of budget reports *and* what a genuine refusal reports, so a failure
        // with no decoded code is not attributable to the boundary.
        <p className="measure text-[12.5px] leading-relaxed text-muted">
          No contract error code could be decoded from this transaction&rsquo;s diagnostic events,
          so it is not attributable to the boundary. A failure is not a refusal until its error code
          says so.
        </p>
      )}
    </div>
  );
}
