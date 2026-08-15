/**
 * The 404, in the design system rather than Next's.
 *
 * At the root of `app/`, so it answers for every URL this application does not
 * have a route for, not only for a `notFound()` call inside a segment. Nothing
 * calls `notFound()` today — the two dynamic routes check the shape of their id
 * and render a refusal panel that names what a valid one looks like, which is a
 * better answer than a 404 because it can be specific. So in practice this is
 * the unmatched-URL page, and it is written as one.
 *
 * ## Not a failure, and it does not report itself
 *
 * A 404 is the application working. Somebody followed a stale link, typed a
 * path, or kept a bookmark from before `/demo` became `/app/simulator`. Routing
 * it into the error reporter would put a steady trickle of crawler traffic into
 * the channel that exists so a real defect is noticed, and the failure mode of
 * a noisy alert channel is that the one line that mattered is scrolled past.
 *
 * So this page sends nothing, and that is a decision rather than an omission —
 * `app/error.tsx` reports because a render throw is always a defect, and this
 * does not because a missing page usually is not.
 *
 * ## A server component, deliberately
 *
 * There is no `'use client'` here and nothing to hydrate. This is also the page
 * most likely to be reached by a crawler and the one that should cost the least
 * to render, and a client boundary would put the whole design system's markup
 * through hydration to display four links.
 */

import Link from 'next/link';

export const metadata = {
  title: 'Limen — no such page',
  description: 'There is no page at this address.',
};

/**
 * Where to go instead.
 *
 * The three front doors of the application rather than a sitemap: the argument,
 * the instrument, and the reference. A 404 that lists twelve routes is a 404
 * that has decided the reader knows which one they wanted.
 */
const WAYS_BACK = [
  { href: '/', name: 'Front page', what: 'what Limen is, and the evidence for it' },
  { href: '/app/accounts', name: 'Accounts', what: 'the boundary installed on a smart account' },
  { href: '/docs', name: 'Documentation', what: 'how authorization and derivation work' },
] as const;

export default function NotFound() {
  return (
    <main className="screen">
      <header className="flex flex-col gap-4">
        <span className="eyebrow-lead text-faint">no such page</span>
        <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.015em] text-foreground">
          There is nothing at this address.
        </h1>
        <div className="measure space-y-3 text-[14px] leading-relaxed text-muted">
          <p>
            The page itself is fine &mdash; this URL simply is not one of its routes. That is
            usually a link of ours that moved, or a path typed by hand.
          </p>
          <p>
            If you were opening a smart account or a policy, those live under{' '}
            <span className="value">/app/accounts</span> and{' '}
            <span className="value">/app/policies</span>{' '}
            and are addressed by contract id. Getting the id wrong lands on the screen for that
            account, which will say so; getting the route wrong lands here.
          </p>
        </div>
      </header>

      <div className="panel" data-tone="pending">
        <span className="eyebrow text-muted-dim">where to go instead</span>
        <ul className="flex flex-col gap-3">
          {WAYS_BACK.map((way) => (
            <li key={way.href} className="flex flex-col gap-1">
              <Link href={way.href} className="link text-[13px]" data-tone="strong">
                {way.name}
              </Link>
              <span className="text-[12.5px] leading-relaxed text-muted-dim">{way.what}</span>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
