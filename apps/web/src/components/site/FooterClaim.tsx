'use client';

import { usePathname } from 'next/navigation';

/**
 * The footer's provenance sentence, scoped to the route it is true of.
 *
 * The site-wide wording — *every figure on this site is read from
 * `deployments/testnet.json` … nothing on this page is typed by hand* — holds on
 * `/`, on `/docs/*` and across `/app/*`, where `evidence.test.ts` enforces it
 * file by file. It does **not** hold on `/landing`. Two things there are drawn
 * rather than read: the hero's candle tape is a seeded random walk computed in
 * `CandleTape`, and the *Authored* column's three field names are invented
 * placeholders standing in for a policy form nobody fills in.
 *
 * So the claim is narrowed on that one route rather than softened everywhere.
 * The rest of the site keeps the sentence exactly as it was — a caveat that has
 * to hedge for the weakest surface it appears on stops being worth reading, and
 * the strong version is the one `evidence.test.ts` actually backs.
 *
 * What the narrow version claims is the part of `/landing` that *is* read: the
 * cap, both amounts, both hashes and the contract error all come out of
 * `RECORDED_TRADING`, which is the C0 run in `deployments/testnet.json`. That is
 * the evidence the page asks to be believed on, and it is checkable. The tape
 * says what it is next to itself, in `CandleTape`, because a reader looking at a
 * chart should not have to reach the footer to learn it is a drawing.
 *
 * ## Why this is a client component and the footer around it is not
 *
 * `usePathname` needs one, and this is the smallest thing that can hold it —
 * a paragraph with no state, no effect and no event handler. `SiteFooter` stays
 * a server component, so the links, the labels and `StatusLabels` are still
 * rendered on the server on every route; what reaches the client bundle is this
 * file and nothing else. `SiteHeader` already reads `usePathname` to mark the
 * current section, so the mechanism is not new to the chrome.
 *
 * It is a route test rather than a `:has(.landing)` rule in CSS, which is how
 * the palette follows this surface. A hidden paragraph is still in the served
 * HTML, and a sentence that says *nothing on this page is typed by hand* in the
 * source of the one page where that is false is the exact fault being fixed —
 * `display: none` would move it out of view rather than out of the document.
 * Static rendering is unaffected: the pathname is known per route at build time,
 * so each page is prerendered with its own sentence and there is nothing for
 * hydration to disagree about.
 */
export function FooterClaim() {
  const pathname = usePathname();

  if (pathname === '/landing') {
    return (
      <p className="text-[12.5px] leading-relaxed text-muted-dim measure">
        Every figure in this page&rsquo;s ledger evidence — the cap, both amounts, both hashes and
        the contract error — is read from{' '}
        <span className="value">deployments/testnet.json</span>, and a check fails the build when it
        drifts.
      </p>
    );
  }

  return (
    <p className="text-[12.5px] leading-relaxed text-muted-dim measure">
      Every figure on this site is read from{' '}
      <span className="value">deployments/testnet.json</span>{' '}or from a generated evidence file,
      and a check fails the build when either drifts. Nothing on this page is typed by hand.
    </p>
  );
}
