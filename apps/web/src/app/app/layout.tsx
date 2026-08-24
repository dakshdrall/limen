/**
 * The app surface, and the one place it is declared to be a console.
 *
 * Every screen under `/app` renders inside this. The narrative site and the
 * docs do not, and that is the entire mechanism keeping the two identities
 * apart — there is no route check anywhere, no pathname read, and nothing a
 * component has to remember. A file's position in the tree decides which
 * palette it gets.
 *
 * ## It adds a class and nothing else
 *
 * No grid, no padding, no max-width. Each page keeps its own `.screen` shell,
 * which is what `design-system.test.ts` requires of every page and what
 * `.bleed` addresses its grid lines against. A layout that introduced a second
 * grid here would put a container between `.screen` and its children and break
 * every full-bleed band on the app surface — the exact failure the two-shell
 * rule exists to prevent.
 *
 * So this is a `div` with a class. The class re-points the palette's custom
 * properties; the components underneath already read those properties and go
 * dark without knowing this file exists.
 *
 * ## Why `min-h-full` is here
 *
 * The console paints a background, and a wrapper that is only as tall as its
 * content paints only that far — leaving the site's light ground visible below
 * a short screen, which reads as a rendering fault rather than as a design.
 * The root layout's `flex-1` div is the flex child that grows; this fills it.
 *
 * ## What it does not do
 *
 * It does not render chrome. The header and footer are siblings of this subtree
 * in the root layout, and they follow the console through `body:has(.console)`
 * in `globals.css` rather than by being re-rendered here. Two footers, or a
 * second header for app routes, would be two things to keep in agreement.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <div className="console min-h-full">{children}</div>;
}
