'use client';

/**
 * The screen a render failure gets, instead of Next's.
 *
 * Next's default is a black page with `Application error: a client-side
 * exception has occurred` on it. It is accurate and it is the wrong thing to
 * put in front of a reviewer: it says nothing about what failed, implies by its
 * silence that they might have caused it, and offers no way onward except the
 * back button. This project's own `ScreenState` already argues that a failure is
 * a state to design rather than default — this is that argument applied to the
 * one failure `ScreenState` cannot represent, because by the time it fires there
 * is no component left to render a panel.
 *
 * ## What this catches, and what it does not
 *
 * It catches a **throw during render** of a page or a nested layout below the
 * root, and replaces that subtree with what is below.
 *
 * It does not catch the React #418 that motivated the reporting, and no error
 * boundary could. A hydration mismatch is recoverable: React re-renders on the
 * client and nothing throws past a component, so this file is never entered.
 * That class is caught by the window listener in `instrumentation-client.ts`,
 * which is a separate mechanism for a separate failure and not a fallback for
 * this one. Both report; see `lib/report.ts` for which is which.
 *
 * It also does not catch a throw in the **root layout**, which renders above
 * every boundary including this one. `global-error.tsx` is the file for that and
 * is deliberately absent: it replaces the root layout, so it must ship its own
 * `<html>`, `<body>`, fonts and stylesheet, and what it can honestly render is a
 * sentence and a link. That is a page whose own failure mode is a font stack
 * this design system bans, written for a case where the shell itself is broken.
 * When the root layout grows something that can throw — it currently holds a
 * ledger poll and two chrome components — it is worth adding, and it is not
 * worth adding first.
 *
 * ## Three things the copy has to do
 *
 * State what failed, say it was not their fault, and give a way back. In that
 * order, because a reader who does not yet know what happened cannot use a way
 * back — and because "not your fault" is only credible after the sentence that
 * names whose it was.
 *
 * The middle paragraph is the one that is specific to this product rather than
 * to error pages in general. A render failure says nothing about whether a
 * write landed, and on a screen that installs a permission boundary onto a smart
 * account that is the first thing a reader needs to know and the last thing an
 * error page usually tells them. Telling somebody to "try again" without it is
 * telling them to submit a second transaction on the strength of a page that
 * has already admitted it does not know what happened.
 */

import { useEffect } from 'react';
import Link from 'next/link';
import { sendReport } from '@/lib/report';

export default function RouteError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    // Keyed on the error so a retry that fails differently is reported, and a
    // re-render with the same error is not. `sendReport` dedupes as well; this
    // is about not asking it the same question every frame.
    sendReport('boundary', error);
  }, [error]);

  return (
    <main className="screen">
      <header className="flex flex-col gap-4">
        <span className="eyebrow-lead text-faint">this screen</span>
        <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.015em] text-foreground">
          This screen did not render.
        </h1>
      </header>

      <div className="panel" data-tone="refused">
        <span className="eyebrow text-deny">render failed</span>

        <div className="measure space-y-3 text-[13px] leading-relaxed text-foreground/90">
          <p>
            Something in Limen&rsquo;s own code threw while this page was being drawn. This is a
            defect on our side, on this screen. Nothing you typed caused it and nothing you can
            change will route around it.
          </p>
          <p>
            It also does not tell you whether something you had already started reached the ledger
            &mdash; a page that failed to draw does not know. If you were deploying an account or
            installing a boundary, read the account before running that step a second time, rather
            than submitting it again on the strength of this screen.
          </p>
        </div>

        {/* The digest is Next's hash of a server-side error and the join key to
            the unminified version in the server log. It is shown rather than
            hidden because the person most likely to be looking at this page is
            the person who can use it, and it identifies an error rather than a
            reader. */}
        {error.digest !== undefined && (
          <details className="text-[12px] text-muted-dim">
            <summary className="cursor-pointer rounded-[2px]">What to quote if you tell us</summary>
            <p className="scroll-x mt-2 font-mono text-[11.5px] leading-relaxed break-words">
              {error.digest}
            </p>
          </details>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => unstable_retry()} className="btn" data-variant="primary">
            Draw this screen again
          </button>
          <Link href="/app/accounts" className="link text-[12.5px]">
            All accounts
          </Link>
          <Link href="/" className="link text-[12.5px]">
            Front page
          </Link>
        </div>
      </div>

      {/* Said out loud, because a page that sends something about a reader
          without telling them is doing the thing this application spends its
          whole surface arguing against. The list is exhaustive — it is
          `REPORT_FIELDS`, in prose. */}
      <p className="measure text-[12.5px] leading-relaxed text-muted-dim">
        This failure was reported to us automatically: the error&rsquo;s message and stack, this
        screen&rsquo;s path, your browser&rsquo;s user-agent string, and which build you are on.
        Any address, key or transaction hash in those was replaced with a placeholder before the
        report left this page, and nothing else about you or this browser was collected.
      </p>
    </main>
  );
}
