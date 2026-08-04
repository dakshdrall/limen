import type { ReactNode } from 'react';
import { chainTxUrl } from '@/lib/explorer';
import { truncateHash } from '@/lib/format';

/**
 * A link out to a block explorer.
 *
 * This is the single most important affordance on the site, and it had three
 * different treatments: green text with a green focus ring on the simulator,
 * inherited text with a green underline in `ObservedSection`, and muted with an
 * accent hover in the docs table. Every claim this project makes is qualified
 * by "checkable in an explorer", so the control that does the checking has to be
 * recognisable on sight, on every screen, without a reviewer working out that
 * three different-looking things are the same thing.
 *
 * Drawn quiet rather than green-on-green: these sit next to `Verdict` badges in
 * two tables, and a green link beside a green PERMIT badge makes the badge
 * harder to find. The permit hue is carried by the underline and by hover,
 * which is enough to mark it as pointing at evidence.
 *
 * Focus is deliberately not restyled. One of the previous three overrode the
 * focus ring to `--permit`, which quietly contradicted the global rule that
 * focus is the accent everywhere — a keyboard user who learns the accent ring
 * should not meet a green one on one screen.
 */
export function ExplorerLink({
  href,
  title,
  children,
}: {
  href: string;
  /** The full value, when the label is truncated. */
  title?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      title={title}
      className="link whitespace-nowrap decoration-permit-line hover:text-permit hover:decoration-permit"
    >
      {children}
    </a>
  );
}

/**
 * A transaction hash, truncated and linked to the explorer.
 *
 * The commonest thing this application renders, and it had been written out
 * longhand in four places: three of them restated the explorer's base URL, and
 * all four chose their own truncation for a column whose width is a shared
 * token. `--col-hash` guarantees the box is the same on every screen; this
 * guarantees what goes in it is too.
 *
 * The full hash is in the `title`, as with `Address` — a truncated value a
 * reviewer cannot recover is a value they cannot check.
 *
 * Only for hashes that are on this build's network. A fixture hash is 64 hex
 * characters and looks identical; linking one sends a reviewer to a 404 that
 * reads as the product being broken. `Beat`'s `shipped fixture` state is the
 * answer there, and it deliberately renders no link at all.
 */
export function TxHash({ hash }: { hash: string }) {
  return (
    <ExplorerLink href={chainTxUrl(hash)} title={hash}>
      <span className="value text-foreground/90">{truncateHash(hash)}</span>
    </ExplorerLink>
  );
}
