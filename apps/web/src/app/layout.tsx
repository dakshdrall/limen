import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { LedgerSource } from "@/components/LedgerSource";
import { SiteFooter } from "@/components/site/SiteFooter";
import { SiteHeader } from "@/components/site/SiteHeader";
import "./globals.css";

/**
 * IBM Plex, self-hosted.
 *
 * Carried across the V6 rebuild unchanged, because the reasoning behind it is
 * not a decision about the old page's shape. `next/font/google` downloads the
 * files at build time and serves them from this origin — there is no request to
 * Google at runtime, and no system-font fallback stack anywhere in the cascade.
 *
 * Plex was drawn for IBM's technical documentation, and its mono is a true
 * companion to its sans rather than an unrelated face. That is what lets "mono
 * is reserved for on-chain values" read as one system rather than as a mix: the
 * two share a skeleton, so switching between them signals provenance without
 * signalling a change of voice.
 *
 * `adjustFontFallback` stays on. It generates a metrics-matched local face used
 * only for the swap frame before the webfont paints; it is not a fallback
 * *stack*, and turning it off buys a layout shift for nothing.
 */
const plexSans = IBM_Plex_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const TITLE = "Limen — describe an agent, deploy it on Stellar, and hold it to a limit";
const DESCRIPTION =
  "Build an agent from one sentence, review the limits it will run under, and deploy it to its own Stellar smart account — where the boundary is enforced by the account rather than by us.";

/**
 * `metadataBase` resolves the generated OG and Twitter cards to absolute URLs,
 * which every crawler requires. Vercel supplies the production hostname; the
 * localhost fallback keeps a local build from failing on a relative image URL.
 */
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL !== undefined
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: TITLE,
  description: DESCRIPTION,
};

/**
 * The root layout.
 *
 * One ledger poll for the whole application. `LedgerSource` wraps rather than
 * sits beside, so the header's counter and any screen's closing window read the
 * same sequence and cannot disagree about what the present is. `children` is
 * passed through as a prop, so the pages under it stay server components.
 *
 * `SiteFooter` is here rather than on the landing page, which is where it used to
 * live and where it was the only footer on the site — `/docs` and every `/app/*`
 * screen simply ended. It is also now a sibling of the page's `<main>` rather
 * than a child of it; see that component for why that was worth the move on its
 * own.
 *
 * The wrapper around `children` earns its place: `body` is a flex column, so
 * without something growing to fill it a short page — a read failure, an empty
 * account list — leaves the footer floating halfway up the viewport with ground
 * below it. `flex-1` on the wrapper rather than on the pages, because a page
 * cannot know what is under it. It is a plain `div` and not a shell, so the
 * `.screen` and `.scene` grids inside it are unaffected: each is still the grid
 * parent of its own children, which is what `.bleed` addresses.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${plexSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <LedgerSource>
          <SiteHeader />
          <div className="flex-1">{children}</div>
          <SiteFooter />
        </LedgerSource>
      </body>
    </html>
  );
}
