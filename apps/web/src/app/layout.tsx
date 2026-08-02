import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { TopBar } from "@/components/TopBar";
import "./globals.css";

/**
 * IBM Plex, self-hosted.
 *
 * `next/font/google` downloads the files at build time and serves them from
 * this origin — there is no request to Google at runtime, and no system-font
 * fallback stack anywhere in the cascade. The previous typeface was Geist,
 * loaded from the Next.js default helper, which is the single clearest tell
 * that a page was generated rather than designed.
 *
 * Plex was drawn for IBM's technical documentation, and its mono is a true
 * companion to its sans rather than an unrelated face. That is what lets "mono
 * is reserved for on-chain values" read as one system rather than as a mix:
 * the two share a skeleton, so switching between them signals provenance
 * without signalling a change of voice.
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
  openGraph: {
    type: "website",
    siteName: "Limen",
    title: TITLE,
    description: DESCRIPTION,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

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
        <TopBar />
        {children}
      </body>
    </html>
  );
}
