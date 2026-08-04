'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NETWORK } from '@/lib/network';

/**
 * The chrome that is on every screen, marketing and app alike.
 *
 * Named sections, not a hamburger and not a scroll-to-anchor: on a tool, the
 * navigation is part of the instrument panel and hiding it behind a control
 * costs a click on every single traversal.
 *
 * The network indicator on the right reads from `lib/network.ts` — the same
 * constant anything that builds a transaction reads. A header that hardcodes
 * "TESTNET" is decoration, and the one thing this indicator must never be is
 * wrong about which chain the user is looking at.
 */

/**
 * `built: false` renders the section as present but unavailable, with the
 * reason in its tooltip, rather than linking to a route that does not exist.
 *
 * A nav item that 404s is worse than one that says "not built yet": the first
 * looks like the application is broken, the second is just the truth. The flag
 * is here rather than in a comment so that shipping a screen and lighting its
 * nav entry are the same edit.
 *
 * Every section is built as of step 10, so nothing currently carries
 * `built: false`. The branch stays: the next section to be planned before it is
 * written needs it, and rebuilding the mechanism from scratch under deadline is
 * how a placeholder becomes a 404 instead.
 */
interface Section {
  label: string;
  href: string;
  /** `false` renders the unavailable state below. See above. */
  built: boolean;
}

const SECTIONS: readonly Section[] = [
  { label: 'MECHANISM', href: '/', built: true },
  { label: 'INTERFACE', href: '/app/accounts', built: true },
  { label: 'ACTIVITY', href: '/app/activity', built: true },
  { label: 'SIMULATOR', href: '/app/simulator', built: true },
  { label: 'DOCS', href: '/docs', built: true },
];

const NOT_BUILT = 'Not built yet. The chain layer behind this screen is implemented and proven on testnet; the screen is not.';

const GITHUB = 'https://github.com/dakshdrall/limen';

/**
 * The active section.
 *
 * `/` matches only itself; everything else matches its own subtree, so
 * `/app/accounts/CBNP…` still lights INTERFACE. Prefix-matching `/` would light
 * every section at once.
 */
function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function TopBar() {
  const pathname = usePathname();

  // The bar is solid, not translucent. At 95% with no blur it is not restraint,
  // it is content bleeding through the chrome — and blurring it to hide that
  // would be the glass effect this system does not use.
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background">
      <nav
        aria-label="Sections"
        className="mx-auto flex h-11 max-w-[1400px] items-center gap-6 px-4 sm:px-6"
      >
        <Link
          href="/"
          className="font-mono text-[13px] font-semibold tracking-[0.22em] text-foreground"
        >
          LIMEN
        </Link>

        <ul className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {SECTIONS.map(({ label, href, built }) => {
            const active = isActive(pathname, href);
            const base =
              'inline-block rounded-[2px] px-2 py-1 font-mono text-[10.5px] font-medium tracking-[0.13em] whitespace-nowrap transition-colors';

            if (!built) {
              return (
                <li key={href}>
                  {/* Focusable, so a keyboard user reaches the explanation the
                      same way a pointer user reaches the tooltip. */}
                  <span
                    tabIndex={0}
                    role="link"
                    aria-disabled="true"
                    title={NOT_BUILT}
                    className={`${base} cursor-not-allowed text-faint`}
                  >
                    {label}
                  </span>
                </li>
              );
            }

            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={`${base} ${
                    active ? 'bg-accent-dim text-accent' : 'text-muted-dim hover:text-muted'
                  }`}
                >
                  {label}
                </Link>
              </li>
            );
          })}
          <li>
            <a
              href={GITHUB}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-block rounded-[2px] px-2 py-1 font-mono text-[10.5px] font-medium tracking-[0.13em] whitespace-nowrap text-muted-dim transition-colors hover:text-muted"
            >
              GITHUB
            </a>
          </li>
        </ul>

        {/* Always visible, never ambiguous. */}
        <span
          className="status-label shrink-0"
          title="Every address, hash, and balance in this application is on Stellar testnet. No real funds are involved."
        >
          <span aria-hidden="true" className="text-accent">
            ◈
          </span>
          {NETWORK}
        </span>
      </nav>
    </header>
  );
}
