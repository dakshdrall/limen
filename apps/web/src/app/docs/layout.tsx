import type { ReactNode } from 'react';
import { DocsNav } from '@/components/docs/DocsNav';

/**
 * The documentation shell: a sidebar that persists, and a column that changes.
 *
 * `.screen` rather than `.scene`, deliberately. A reference is read by somebody
 * with a terminal open beside it, and every scroll spent on air is a scroll
 * spent not finding the error code. The site is spacious because it is making an
 * argument; this is dense because it is being used.
 *
 * The sidebar is `sticky` rather than `fixed` so it participates in the grid and
 * cannot overlap the content column at any width — a fixed sidebar plus a
 * max-width content column is the usual way a docs page ends up with text
 * underneath its own navigation at 1024.
 *
 * ## The content column is `main`
 *
 * It was a `div` until `e2e/viewports.spec.ts` went looking for a `main` here
 * and spent its whole timeout not finding one. Every other route on the site
 * renders one — `/app` as `<main className="screen">`, `/` as a bare `<main>` —
 * and these pages were the only ones without, which meant a screen reader
 * jumping to the main landmark on any docs page landed in the sidebar and had to
 * walk the whole nav to reach the prose.
 *
 * On the inner column rather than on `.screen`, which is the distinction the
 * landmark is for: `main` is the content that is unique to this page, and the
 * sidebar is the same list on all four. `<aside>` was already the right element
 * beside it and is now correctly outside the main region rather than nominally
 * beside it inside a shared `div`.
 */
export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="screen">
      <div className="flex flex-col gap-10 md:flex-row md:gap-12">
        <aside className="shrink-0 md:w-[13.5rem]">
          <div className="md:sticky md:top-[4.5rem]">
            <DocsNav />
          </div>
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
