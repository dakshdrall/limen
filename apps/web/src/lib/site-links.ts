/**
 * Where Limen lives outside this application.
 *
 * Two links, stated once. A dependency-free module in the same sense as
 * `markers.ts` and `key-roles.ts`: the header and the footer both render these
 * and neither should reach through anything to do it.
 *
 * ## Why this is a module and not two `href` attributes
 *
 * The same argument `lib/explorer.ts` already wins for explorer URLs, and
 * `design-system.test.ts` pins that one as *a fact is stated in one place*.
 * These appear on every route through two different components, so writing them
 * inline is writing them twice — and the failure mode of a URL written twice is
 * that one of them keeps working, which is exactly why nobody notices the other.
 *
 * ## `label` is the accessible name, not decoration
 *
 * Each entry carries the text a screen reader announces. The header renders
 * these icon-only and puts `label` on the link's `aria-label`; the footer
 * renders `name` as visible text and marks the icon `aria-hidden`. Two
 * treatments, one name, and neither of them is a bare glyph — an unlabelled
 * `<svg>` in a link is a link that announces as "link" and nothing else.
 *
 * ## `name` is the destination, not the platform
 *
 * This first read `GitHub` and `X`, which is the obvious choice and was wrong
 * for a reason only visible once drawn: X's mark *is* the letter X, so a link
 * labelled `X` beside it rendered as a glyph followed by a single underlined
 * character, which reads as a typo rather than as a link. Naming the destination
 * fixes that and is the better label anyway — the mark already says which
 * platform, so the word is free to say *which account*, which is the part a
 * reader cannot infer. It is also how the rest of this application talks: the
 * specific thing, not its category.
 */

export type SiteLinkId = 'github' | 'x';

export interface SiteLink {
  id: SiteLinkId;
  /** The destination, for a footer column that has room to name it. */
  name: string;
  /** The accessible name, for the header, where there is only an icon. */
  label: string;
  href: string;
}

export const SITE_LINKS: readonly SiteLink[] = [
  {
    id: 'github',
    name: 'dakshdrall/limen',
    label: 'Limen on GitHub',
    href: 'https://github.com/dakshdrall/limen',
  },
  {
    id: 'x',
    name: '@limennetwork',
    label: 'Limen on X',
    href: 'https://x.com/limennetwork',
  },
];
