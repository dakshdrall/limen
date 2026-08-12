'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { DOCS_NAV } from '@/lib/docs-nav';

/**
 * The documentation sidebar.
 *
 * The hierarchy itself is data and lives in `lib/docs-nav.ts` — see that module
 * for why it is not in this file. This is the rendering of it, and it is a
 * client component for exactly one reason: `usePathname`, to mark the page the
 * reader is on.
 *
 * Every entry points at a route that exists. `docs.test.ts` proves it — a
 * sidebar entry that 404s is the one navigation failure a reader attributes to
 * the product rather than to themselves.
 */
export function DocsNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Documentation" className="flex flex-col gap-6">
      {DOCS_NAV.map((group) => (
        <div key={group.title} className="flex flex-col gap-2">
          <p className="col-head">{group.title}</p>
          <ul className="flex flex-col gap-0.5">
            {group.entries.map(({ href, label }) => {
              const active = pathname === href;
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className={`block rounded-[3px] border-l-2 py-1 pl-3 text-[13px] ${
                      active
                        ? 'border-accent bg-accent-dim text-foreground'
                        : 'border-transparent text-muted hover:border-border-bright hover:text-foreground'
                    }`}
                  >
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
