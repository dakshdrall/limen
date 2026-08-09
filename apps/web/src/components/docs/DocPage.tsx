import type { ReactNode } from 'react';
import { StatusLabels } from '@/components/StatusLabel';
import type { StatusLabelName } from '@/lib/status-labels';

/**
 * A documentation page: heading, limits, contents rail, body.
 *
 * Dense where the site is spacious. `/docs` deliberately uses `.screen` and not
 * `.scene` — a reference is read by someone with a terminal open beside it, and
 * every scroll they spend on air is a scroll they spend not finding the error
 * code. That is the same argument the app screens make, which is why they share
 * a shell.
 *
 * ## The contents rail is declared, not scraped
 *
 * The obvious implementation walks the DOM for headings after mount. That costs
 * a client component, produces nothing until hydration, and silently disagrees
 * with the page whenever a heading is conditionally rendered.
 *
 * Declaring the contents makes the page a server component with a rail that is
 * correct in the HTML, and makes the ids a contract rather than a side effect of
 * whatever the heading text happened to slugify to. The cost is that a section
 * added without an entry is missing from the rail — which `docs.test.ts` catches
 * by checking every declared anchor exists in the rendered source and vice
 * versa, in both directions.
 */

export interface DocSection {
  id: string;
  title: string;
}

export function DocPage({
  title,
  lead,
  labels,
  contents,
  children,
}: {
  title: string;
  lead: ReactNode;
  labels?: readonly StatusLabelName[];
  contents: readonly DocSection[];
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:gap-10">
      <div className="min-w-0 flex-1">
        <header className="flex flex-col gap-3 border-b border-border-subtle pb-6">
          <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.02em] text-foreground">
            {title}
          </h1>
          <p className="measure text-[14px] leading-relaxed text-muted">{lead}</p>
          {labels === undefined ? null : (
            <div className="pt-1">
              <StatusLabels names={labels} />
            </div>
          )}
        </header>

        {/* The rail, inline, for the widths where there is no room beside the
            body. Same list, one source. */}
        <nav aria-label="On this page" className="mt-6 flex flex-col gap-2 lg:hidden">
          <p className="col-head">On this page</p>
          <ul className="flex flex-col gap-1">
            {contents.map(({ id, title: heading }) => (
              <li key={id}>
                <a href={`#${id}`} className="link text-[13px]">
                  {heading}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-8 flex flex-col gap-12">{children}</div>
      </div>

      <aside className="hidden w-[13rem] shrink-0 lg:block">
        <div className="sticky top-[4.5rem] flex flex-col gap-2">
          <p className="col-head">On this page</p>
          <ul className="flex flex-col gap-1.5">
            {contents.map(({ id, title: heading }) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className="block text-[12.5px] leading-snug text-muted-dim hover:text-foreground"
                >
                  {heading}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}

/** A section of a documentation page. The `id` must match a declared content entry. */
export function DocSectionBlock({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="flex scroll-mt-20 flex-col gap-4">
      <h2 className="text-[17px] leading-snug font-semibold tracking-[-0.01em] text-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Running prose inside a documentation section. */
export function P({ children }: { children: ReactNode }) {
  return <p className="measure text-[13.5px] leading-relaxed text-muted">{children}</p>;
}
