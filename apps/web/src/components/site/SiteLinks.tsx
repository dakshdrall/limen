import { SITE_LINKS, type SiteLinkId } from '@/lib/site-links';

/**
 * The two off-site links, in the two registers the site needs them in.
 *
 * The marks are inline SVG rather than an icon font or a file in `public/`.
 * Both alternatives are a second request for two paths, and a font is the worse
 * of them — a glyph that fails to load leaves a box or nothing at all in a link
 * whose only content it was.
 *
 * Neither mark names a colour. They are `currentColor` throughout, exactly as
 * `Mark` is, so they take the text colour of wherever they are placed and the
 * hover and focus treatments around them apply without being restated. A
 * brand-coloured logo would also be the only two saturated shapes in a palette
 * that defines one accent.
 *
 * ## The paths are the official marks and are not redrawn
 *
 * GitHub's is octicons' `mark-github` on a 16 grid; X's is the wordmark glyph on
 * a 24 grid. They are trademarks used to point at the accounts they belong to,
 * which is what they are for, and adjusting their geometry to suit this
 * stylesheet would make them recognisable-ish rather than recognisable. The two
 * `viewBox` values differ for the same reason, and each renders at the size it
 * is given rather than at a size implied by its grid.
 */

function GithubMark({ size }: { size: number }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

function XMark({ size }: { size: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

/**
 * The mark for one link, by id.
 *
 * Exported because the footer draws its own rows: both of its columns share one
 * row treatment so they share one rhythm, and that row lives in `SiteFooter`
 * rather than here. See the note on `FooterSiteLinks` for what happened when
 * each column brought its own.
 */
export function SiteLinkGlyph({ id, size }: { id: SiteLinkId; size: number }) {
  return id === 'github' ? <GithubMark size={size} /> : <XMark size={size} />;
}

/**
 * The header treatment: icons alone, each with an accessible name.
 *
 * Sized to sit with `LedgerCounter` and the network label rather than to match
 * the wordmark. `shrink-0` because the header is one row and these are the two
 * items in it with no text to wrap — a flex item that can be squeezed here is
 * one that gets squeezed to nothing at 390px instead of pushing the row wide
 * enough to be seen doing it.
 */
export function HeaderSiteLinks() {
  return (
    <div className="flex shrink-0 items-center gap-2.5">
      {SITE_LINKS.map(({ id, label, href }) => (
        <a
          key={id}
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={label}
          className="rounded-[3px] text-muted-dim hover:text-foreground"
        >
          <SiteLinkGlyph id={id} size={14} />
        </a>
      ))}
    </div>
  );
}
