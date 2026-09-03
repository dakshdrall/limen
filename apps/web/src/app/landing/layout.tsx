import type { Metadata } from 'next';
import { Fraunces, Spline_Sans, Spline_Sans_Mono } from 'next/font/google';
import './landing.css';

/**
 * The narrative surface's own shell.
 *
 * A layout rather than additions to the root one, and that is the whole of why
 * this file exists. Three typefaces and a block of SVG filters are needed by one
 * route; declaring them in `app/layout.tsx` would put them in the document of
 * every route, and `next/font` would emit preload hints for faces that `/docs`
 * and `/app/*` never paint. The root layout keeps IBM Plex and is untouched.
 *
 * ## The typefaces, self-hosted
 *
 * `next/font/google` downloads the files at build time and serves them from this
 * origin. There is no `<link>` to Google in the shipped page and no request to
 * it at runtime — the same guarantee the root layout documents for Plex, made
 * the same way. The prototype loaded them from Google's CDN with a system-font
 * fallback appended; both of those are dropped here, the second because
 * `globals.css` is forbidden a system stack and it would be strange for one
 * surface to quietly reintroduce what the rest of the site refuses.
 *
 * `adjustFontFallback` is left on, so the swap frame is drawn in a
 * metrics-matched local face and the display line does not reflow when Fraunces
 * arrives. That is the layout-shift requirement, and it is satisfied by not
 * turning off the thing that already handles it.
 *
 * Fraunces is asked for its `SOFT` and `WONK` axes explicitly. They are what the
 * prototype sets in `font-variation-settings`, and an axis not requested here is
 * an axis subset out of the file — the declaration would then be inert and the
 * heading would render in the default instance, which is a different typeface to
 * look at and a silent difference to debug.
 */
const fraunces = Fraunces({
  variable: '--font-display',
  subsets: ['latin'],
  axes: ['SOFT', 'WONK', 'opsz'],
  display: 'swap',
});

const splineSans = Spline_Sans({
  variable: '--font-body',
  subsets: ['latin'],
  display: 'swap',
});

const splineSansMono = Spline_Sans_Mono({
  variable: '--font-body-mono',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Limen — agents that trade inside a limit the account holds',
  description:
    'Limen deploys autonomous trading agents on Stellar. The spending limit lives inside the account, not inside our code — so a trade past it fails on the ledger, with a hash you can look up.',
};

/**
 * The filter ids are namespaced, and it matters more than it looks.
 *
 * `filter: url(#id)` resolves against the whole document, not against the
 * subtree that declared it. The root layout renders a header and a footer on
 * every route, `Mark` is an inline SVG, and any other surface is free to add
 * one — so a bare `#silverGrain` here is a name in a namespace shared with every
 * component in the application, matched by whichever element happens to come
 * first in document order. The prefix makes a collision impossible rather than
 * unlikely.
 *
 * Emitted once, here, rather than per heading: nine headings referencing one
 * filter is nine references to one filter, while nine copies of the `<defs>`
 * would be nine duplicate ids, which is the collision case again with this file
 * as its author.
 *
 * The `<animate>` elements run SMIL, which is what makes the grain move without
 * a rAF loop or a class of its own. Under `prefers-reduced-motion` the filter is
 * dropped from the text entirely by `landing.css`, so these keep animating an
 * element nothing references — measured as nothing, and simpler than tearing the
 * definitions out of the document.
 */
export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`landing ${fraunces.variable} ${splineSans.variable} ${splineSansMono.variable}`}
    >
      <svg className="landing-defs" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="limen-landing-tape-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1c1509" stopOpacity=".95" />
            <stop offset="1" stopColor="#0a0804" stopOpacity="0" />
          </linearGradient>

          <filter
            id="limen-landing-silver-grain"
            x="-6%"
            y="-14%"
            width="112%"
            height="128%"
            colorInterpolationFilters="sRGB"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.011 0.019"
              numOctaves="2"
              seed="7"
              result="warp"
            >
              <animate
                attributeName="baseFrequency"
                dur="17s"
                repeatCount="indefinite"
                values="0.011 0.019;0.019 0.011;0.009 0.022;0.011 0.019"
              />
            </feTurbulence>
            <feDisplacementMap
              in="SourceGraphic"
              in2="warp"
              scale="5.5"
              xChannelSelector="R"
              yChannelSelector="G"
              result="warped"
            />
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.55"
              numOctaves="3"
              seed="2"
              result="speck"
            >
              <animate
                attributeName="baseFrequency"
                dur="2.6s"
                repeatCount="indefinite"
                values="0.55;0.72;0.6;0.55"
              />
            </feTurbulence>
            <feColorMatrix in="speck" type="saturate" values="0" result="grey" />
            <feComponentTransfer in="grey" result="grain">
              <feFuncA type="linear" slope="0.95" intercept="0" />
            </feComponentTransfer>
            <feComposite in="grain" in2="warped" operator="in" result="grainInText" />
            <feBlend in="grainInText" in2="warped" mode="overlay" />
          </filter>

          <filter
            id="limen-landing-silver-grain-lite"
            x="-4%"
            y="-10%"
            width="108%"
            height="120%"
            colorInterpolationFilters="sRGB"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.013 0.021"
              numOctaves="1"
              seed="11"
              result="warp"
            >
              <animate
                attributeName="baseFrequency"
                dur="21s"
                repeatCount="indefinite"
                values="0.013 0.021;0.02 0.014;0.013 0.021"
              />
            </feTurbulence>
            <feDisplacementMap
              in="SourceGraphic"
              in2="warp"
              scale="2.4"
              xChannelSelector="R"
              yChannelSelector="G"
              result="warped"
            />
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.6"
              numOctaves="2"
              seed="5"
              result="speck"
            >
              <animate
                attributeName="baseFrequency"
                dur="3.4s"
                repeatCount="indefinite"
                values="0.6;0.76;0.6"
              />
            </feTurbulence>
            <feColorMatrix in="speck" type="saturate" values="0" result="grey" />
            <feComponentTransfer in="grey" result="grain">
              <feFuncA type="linear" slope="0.7" intercept="0" />
            </feComponentTransfer>
            <feComposite in="grain" in2="warped" operator="in" result="grainInText" />
            <feBlend in="grainInText" in2="warped" mode="overlay" />
          </filter>
        </defs>
      </svg>

      <div className="pagegrain" aria-hidden="true" />
      {children}
    </div>
  );
}
