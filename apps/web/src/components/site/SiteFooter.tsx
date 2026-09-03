import Link from 'next/link';
import { FooterClaim } from '@/components/site/FooterClaim';
import { SiteLinkGlyph } from '@/components/site/SiteLinks';
import { StatusLabels } from '@/components/StatusLabel';
import { SITE_LINKS } from '@/lib/site-links';

/**
 * The bar at the bottom of every surface.
 *
 * Lifted out of `app/page.tsx`, where it was the landing page's own `<footer>`
 * and existed nowhere else — so `/docs` and every `/app/*` screen ended without
 * one. Its labels and its sentence about generated figures are carried across
 * verbatim; nothing in it is reworded by the move.
 *
 * ## Two things the move fixes on its own
 *
 * It was **inside `<main>`**. A `contentinfo` landmark nested in the main
 * landmark is not one — a screen reader listing landmarks found the footer only
 * by walking into the page's main content, which is the opposite of what a
 * landmark is for. At the root it is a sibling of `<main>` on every route.
 *
 * And the claim it makes is site-wide while it was rendered on one page.
 * "Every figure on this site is read from `deployments/testnet.json`" is
 * enforced by `evidence.test.ts` across every `.tsx` under `app/` and
 * `components/`, not across the landing alone, so the sentence was already true
 * everywhere and was only being said in one place.
 *
 * It is true everywhere the check reaches, which is not quite everywhere the
 * footer now goes: `/landing` draws two things it does not read, so the sentence
 * is narrowed on that one route and left alone on the others. `FooterClaim`
 * holds both wordings and the reasoning for the split.
 *
 * ## Why `.screen` and not `.scene`
 *
 * It used to be a scene, because it only ever sat under the argument. It now
 * sits under both shells, and it is furniture rather than argument: a footer set
 * at the narrative's rhythm is a footer with three rem of air between its rows
 * on a dense tool screen. The landing's footer gets visibly tighter as a result.
 * That is the trade, made deliberately.
 *
 * The border is on the grid container rather than on a child, so the rule runs
 * the full width of the viewport while the content inside it stays in the
 * content column — the same arrangement the scene version had.
 *
 * ## A server component
 *
 * Nothing here is interactive, `StatusLabels` reads a frozen record, and the two
 * off-site links are anchors. Marking it `'use client'` would put a footer that
 * renders identically on every route into the client bundle of every route.
 *
 * `FooterClaim` is a client component, and it is one paragraph rather than this
 * whole file for that reason: it needs `usePathname` to know which surface it is
 * on, and everything around it stays on the server.
 */
export function SiteFooter() {
  return (
    <footer className="screen border-t border-border-subtle">
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-4">
          <StatusLabels names={['OPEN SOURCE', 'MIT', 'IN DEVELOPMENT', 'TESTNET ONLY']} />
          <FooterClaim />
        </div>

        {/* Two columns, and the off-site one is a real column rather than two
            glyphs appended to the row of routes. `flex-wrap` with a fixed basis
            rather than a two-column grid: at 390px these stack, and a grid that
            collapses to one column leaves the second heading orphaned under the
            first column's last link with nothing marking the break. */}
        <div className="flex flex-wrap gap-x-16 gap-y-8">
          <nav aria-label="Footer" className="flex flex-col gap-3 text-[13px]">
            <span className="col-head text-muted-dim">on this site</span>
            <ul className="flex flex-col gap-2.5">
              <Row>
                <Link href="/app/agents/new" className="link">
                  Build an agent
                </Link>
              </Row>
              <Row>
                <Link href="/docs" className="link">
                  Documentation
                </Link>
              </Row>
              <Row>
                <Link href="/app/try" className="link">
                  Walk the chain writes
                </Link>
              </Row>
              <Row>
                <Link href="/app/simulator" className="link">
                  Simulator
                </Link>
              </Row>
              <Row>
                <Link href="/app/accounts" className="link">
                  Accounts
                </Link>
              </Row>
            </ul>
          </nav>

          <nav aria-label="Limen elsewhere" className="flex flex-col gap-3 text-[13px]">
            <span className="col-head text-muted-dim">elsewhere</span>
            <ul className="flex flex-col gap-2.5">
              {SITE_LINKS.map(({ id, name, label, href }) => (
                <Row key={id}>
                  {/* `aria-hidden`, because the accessible name comes from the
                      visible text beside it. An `aria-label` here as well would
                      announce the link twice — "GitHub, dakshdrall/limen" — and
                      `label` is for the header, where there is no text to read. */}
                  <span aria-hidden="true" className="shrink-0 text-muted-dim">
                    <SiteLinkGlyph id={id} size={13} />
                  </span>
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer noopener"
                    title={label}
                    className="link"
                  >
                    {name}
                  </a>
                </Row>
              ))}
            </ul>
          </nav>
        </div>
      </div>
    </footer>
  );
}

/**
 * One row, in either column.
 *
 * Both columns render through this, and that is the fix rather than the tidying.
 * When each column brought its own row markup, the off-site one wrapped its
 * anchor in `inline-flex` to seat the glyph — which made the glyph rather than
 * the text decide the anchor's height, so its rows came out **23.7px against the
 * other column's 20.8px**. The two columns sit side by side and start aligned, so
 * the divergence accumulated downwards: row two was already 3px out of step, and
 * that is exactly the kind of disagreement the eye registers before anyone can
 * say what it is looking at.
 *
 * `min-h-[1.6em]` rather than a pixel count, so the row is a multiple of its own
 * font size and follows `text-[13px]` if that ever moves. It is a floor and not a
 * height: a link that wraps at a narrow width grows its row rather than
 * overflowing it. `items-center` seats a 13px glyph in a 20.8px row without
 * growing it, which is the property the previous arrangement did not have.
 */
function Row({ children }: { children: React.ReactNode }) {
  return <li className="flex min-h-[1.6em] items-center gap-2">{children}</li>;
}
