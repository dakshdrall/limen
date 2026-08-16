/**
 * The documentation's shape, as data.
 *
 * A sidebar is a claim about how a subject decomposes, and it is worth only as
 * much as its honesty about that. These four pages are the four things a person
 * wiring Limen up actually has to understand, in order: what it is, how a
 * boundary is derived, what enforces it, and the reference tables they will come
 * back for. Groups exist because a flat list of four would be a menu rather than
 * a hierarchy.
 *
 * ## Why this is not in the component that renders it
 *
 * `DocsNav` is a client component — it reads `usePathname` to mark the current
 * page. A value exported from a `'use client'` module and imported by a server
 * component does not arrive as itself: it arrives as a client reference proxy,
 * so `DOCS_NAV.flatMap` on the overview page failed at prerender with "is not a
 * function". The build caught it; nothing about the source looks wrong.
 *
 * So the data lives here, outside the boundary, and both the client sidebar and
 * the server overview are consumers. This is the second time the rebuild has
 * produced this shape — the closed label set, now `@limen/shared/status-labels`,
 * is the first — and it is the same
 * rule each time: content is not markup, and a module in the rendering layer is
 * the wrong place to keep it.
 */

export interface DocsEntry {
  href: string;
  label: string;
  /** One line, for the overview's index. Not rendered in the sidebar. */
  blurb: string;
}

export interface DocsGroup {
  title: string;
  entries: DocsEntry[];
}

export const DOCS_NAV: DocsGroup[] = [
  {
    title: 'Start here',
    entries: [
      {
        href: '/docs',
        label: 'Overview',
        blurb: 'What Limen does, what it refuses to do, and what it is not.',
      },
    ],
  },
  {
    title: 'How it works',
    entries: [
      {
        href: '/docs/deriving',
        label: 'Deriving a boundary',
        blurb:
          'From one observed transaction to the narrowest context rule and policy set that permits it.',
      },
      {
        href: '/docs/authorization',
        label: 'The authorization path',
        blurb:
          'What runs inside __check_auth, in what order, and where a refusal actually comes from.',
      },
    ],
  },
  {
    title: 'Reference',
    entries: [
      {
        href: '/docs/reference',
        label: 'Tables',
        blurb: 'Contract error codes, policy primitives, the deny axes, and environment variables.',
      },
    ],
  },
];
