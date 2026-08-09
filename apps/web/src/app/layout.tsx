import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
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

const TITLE = "Limen — the permission layer for agentic money on Stellar";
const DESCRIPTION =
  "Derive the minimum smart-account context rule and policy set that permits one observed transaction, and refuses everything adjacent to it.";

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
 * The root layout, in its scaffold form.
 *
 * The V5 layout wrapped everything in `LedgerSource` so that one ledger poll
 * served the whole application and no two readouts could disagree about what
 * the present is. That property is being kept, but the component that provides
 * it is part of the rendering layer and is rebuilt in step 2; re-adding it here
 * before there is anything to read it would be scaffolding pretending to be a
 * system.
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
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
