'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LedgerCounter } from '@/components/LedgerCounter';
import { Mark } from '@/components/Mark';
import { useLedger } from '@/components/LedgerSource';
import { HeaderSiteLinks } from '@/components/site/SiteLinks';
import { NETWORK } from '@/lib/network';

/**
 * The bar across the top of every surface.
 *
 * Three jobs, in descending order of importance: say which network is being
 * addressed, say where the reader is, and get them somewhere else.
 *
 * The network indicator reads `NETWORK` rather than the string `TESTNET`. A
 * second place for that fact to be written down is a second place for it to be
 * wrong, and the one it would be wrong on is the day a mainnet build ships —
 * where a bar confidently saying TESTNET is worse than no bar at all.
 *
 * ## `built` is not dead code
 *
 * Every section here is built today, so the flag currently does nothing. It
 * stays because the alternative is that the next planned-before-written section
 * ships as a 404, which reads as a broken application, where "not built yet"
 * just reads as true. `design-system.test.ts` pins both the flag and the state
 * it renders, and separately checks that every `built: true` entry points at a
 * route that exists — the typo case, which is invisible in review.
 */

interface Section {
  href: string;
  label: string;
  built: boolean;
}

const SECTIONS: Section[] = [
  { href: '/docs', label: 'Docs', built: true },
  { href: '/app/accounts', label: 'App', built: true },
];

export function SiteHeader() {
  const pathname = usePathname();
  const sequence = useLedger();

  return (
    <header className="sticky top-0 z-20 border-b border-border-subtle bg-background/92 backdrop-blur-none">
      <div className="mx-auto flex h-12 w-full max-w-[var(--bleed-max)] items-center gap-4 px-[var(--screen-pad)]">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 text-foreground"
          aria-label="Limen, home"
        >
          <Mark size={17} />
          <span className="font-mono text-[12.5px] font-semibold tracking-[0.22em]">LIMEN</span>
        </Link>

        <nav aria-label="Sections" className="flex items-center gap-1">
          {SECTIONS.map(({ href, label, built }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            if (!built) {
              return (
                <span
                  key={href}
                  aria-disabled="true"
                  title="Not built yet"
                  className="rounded-[3px] px-2 py-1 font-mono text-[10.5px] tracking-[0.12em] text-faint uppercase"
                >
                  {label}
                </span>
              );
            }
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`rounded-[3px] px-2 py-1 font-mono text-[10.5px] tracking-[0.12em] uppercase ${
                  active ? 'bg-accent-dim text-foreground' : 'text-muted-dim hover:text-foreground'
                }`}
              >
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-3">
          <HeaderSiteLinks />
          <LedgerCounter sequence={sequence} />
          <span
            className="status-label"
            title="Every address, hash and reading on this site is Stellar testnet. No real funds are involved anywhere."
          >
            {NETWORK}
          </span>
        </div>
      </div>
    </header>
  );
}
