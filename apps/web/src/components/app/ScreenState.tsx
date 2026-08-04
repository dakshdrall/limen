/**
 * The three states the brief says must be designed rather than defaulted:
 * empty, pending, and failed.
 *
 * They live in one file so a new screen inherits them instead of inventing its
 * own spinner and its own phrasing for "something went wrong" — which is how
 * "we could not reach the chain" and "this account has nothing installed" end
 * up looking identical.
 *
 * Two rules the components below encode:
 *
 * 1. **Pending says what it is waiting for.** "Loading…" tells a reader nothing
 *    about whether to wait or reload. "Reading six context rules from testnet"
 *    does.
 * 2. **Empty is an instruction, not an absence.** A screen with nothing on it
 *    is the most common screen a reviewer sees first, and it is the one most
 *    often left as a shrug.
 *
 * A refusal is deliberately *not* here. A boundary refusing a transaction is a
 * result, and `Verdict` renders it — routing it through a failure component
 * would make the product's central behaviour look like a bug.
 */

import type { ReactNode } from 'react';

/**
 * `what` completes the sentence "waiting for …". It is required rather than
 * optional so a caller cannot skip it and get a bare spinner.
 */
export function Pending({ what }: { what: string }) {
  return (
    <div role="status" aria-live="polite" className="panel">
      {/* The row is its own element rather than `flex-row` on the panel. A
          panel is a column of blocks; a caller that needs a row builds one
          inside it, which keeps the panel from having to know about the shapes
          of everything it holds. */}
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent"
        />
        <span className="text-[13px] leading-relaxed text-muted">{what}</span>
      </div>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="panel" data-tone="pending">
      <h3 className="text-[14px] font-semibold tracking-[-0.01em] text-foreground">{title}</h3>
      <div className="measure text-[13px] leading-relaxed text-muted">{children}</div>
    </div>
  );
}

/**
 * A read that did not happen.
 *
 * `detail` is the upstream's own words, kept in a `<details>` rather than
 * dropped: a reviewer debugging their own RPC endpoint needs it, and everyone
 * else should not have to read it. It is never the headline, because an RPC
 * error string is not an explanation.
 *
 * `unconfigured` distinguishes "this build cannot look" from "this account is
 * unreadable". Someone running the repo locally with no endpoint has a working
 * application and no credentials, which is not the same as a broken account,
 * and telling them otherwise sends them to debug the wrong thing.
 */
export function ReadFailure({
  message,
  detail,
  unconfigured = false,
  onRetry,
}: {
  message: string;
  detail?: string;
  unconfigured?: boolean;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="panel"
      data-tone={unconfigured ? 'pending' : 'refused'}
    >
      <div className="flex flex-col gap-1.5">
        <span className={`eyebrow ${unconfigured ? 'text-muted-dim' : 'text-deny'}`}>
          {unconfigured ? 'not configured' : 'read failed'}
        </span>
        <p className="measure text-[13px] leading-relaxed text-foreground/90">{message}</p>
      </div>

      {detail !== undefined && detail.length > 0 && (
        <details className="text-[12px] text-muted-dim">
          <summary className="cursor-pointer rounded-[2px]">
            What the endpoint said
          </summary>
          <p className="scroll-x mt-2 font-mono text-[11.5px] leading-relaxed break-words">{detail}</p>
        </details>
      )}

      {onRetry !== undefined && (
        <button type="button" onClick={onRetry} className="btn" data-variant="secondary">
          Read again
        </button>
      )}
    </div>
  );
}
