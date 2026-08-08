import { WaitlistButton } from '@/components/landing/WaitlistButton';

/**
 * The landing's own section nav, and deliberately not an addition to `TopBar`.
 *
 * PLAN-V5 F6. The obvious implementation is four more entries in `TopBar`'s
 * `SECTIONS`, and it fails immediately: `design-system.test.ts` takes every
 * `built: true` href there and asserts a `page.tsx` exists for it, so `/#evidence`
 * resolves to `src/app/#evidence/page.tsx` and the suite goes red. That test is
 * guarding something real — a nav entry pointing at a route with no page is an
 * invisible 404 — and the fix is not to loosen it into accepting anything with a
 * `#` in it.
 *
 * The fix is that these are two different objects. `TopBar` is global chrome,
 * shared with every app screen, where an in-page anchor means nothing: there is
 * no `#evidence` on `/app/activity`. This bar exists on one page, points only
 * within it, and pins the waitlist to the right. Different rules, different
 * component, and `TopBar` and its test are untouched.
 *
 * ## What it does not do
 *
 * No scroll-spy. Highlighting the section you are currently in needs an observer,
 * which means shipping JavaScript and a `'use client'` boundary to a page whose
 * entire point is that it is static — for a cue the reader already has, since
 * they can see where they are. The one client island here is the waitlist button,
 * which was already one.
 *
 * No smooth scrolling either. The global reduced-motion rule sets
 * `scroll-behavior: auto`, and nothing in this stylesheet ever sets it to
 * `smooth`, so an anchor is a jump. The scroll margin that keeps a target clear
 * of the two sticky bars lives on `Section`, next to the `id` it belongs with.
 */

/**
 * Four anchors, each of which must match an `id` on the landing.
 *
 * Exported because `design-system.test.ts` reads it: the failure this component
 * can have that review will not catch is an anchor pointing at an `id` that was
 * renamed or never existed, which produces a link that silently does nothing.
 * That is the same class of fault `TopBar`'s `built` flag exists for, checked the
 * same way — against the page rather than against a promise.
 */
export const LANDING_ANCHORS: readonly { label: string; href: string }[] = [
  { label: 'Mechanism', href: '#mechanism' },
  { label: 'Evidence', href: '#evidence' },
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Limits', href: '#limits' },
];

export function SectionNav() {
  return (
    // Under `TopBar` rather than over it: `top-11` is that bar's own height, and
    // `z-40` keeps it below the bar it sits under and above the page it scrolls
    // over. Solid, for the reason `TopBar` is solid — a translucent bar with no
    // blur is not restraint, it is content bleeding through the chrome.
    <div className="sticky top-11 z-40 border-b border-border-subtle bg-background">
      <nav
        aria-label="On this page"
        // The same container as `TopBar`, so the two bars share a left edge.
        // Chrome aligns with chrome; the content column below is a different
        // measurement and lining up with it would leave these two disagreeing.
        className="mx-auto flex h-10 max-w-[1400px] items-center gap-4 px-4 sm:px-6"
      >
        <ul className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {LANDING_ANCHORS.map(({ label, href }) => (
            <li key={href}>
              {/* A plain anchor, not `Link`. This never leaves the page, and
                  routing a same-page hash through the router buys nothing. */}
              <a
                href={href}
                className="inline-block rounded-[2px] px-2 py-1 text-[12.5px] whitespace-nowrap text-muted-dim transition-colors hover:text-foreground"
              >
                {label}
              </a>
            </li>
          ))}
        </ul>

        {/* `.btn` pins `align-self: flex-start`, which in a row that has already
            said `items-center` lifts the button off the centre line. The wrapper
            is what defers it back to the row. */}
        <div className="flex shrink-0 items-center">
          <WaitlistButton />
        </div>
      </nav>
    </div>
  );
}
